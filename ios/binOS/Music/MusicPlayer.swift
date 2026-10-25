import AVFoundation
import MediaPlayer
import Observation
import UIKit

// 本机的播放器：播放共享队列里的歌，后台继续播放，接入锁屏和系统的媒体控制；
// 同时登记成 binOS 的一个播放器，别的设备可以遥控它
@Observable
final class MusicPlayer {
    static let shared = MusicPlayer()

    private(set) var queue: [Track] = []
    private(set) var index: Int?
    private(set) var status: PlaybackStatus = .idle
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    private(set) var error: String?
    var volume: Double = 0.7 {
        didSet {
            player.volume = Float(volume)
            save()
        }
    }
    var repeatMode: RepeatMode = .off {
        didSet { save() }
    }
    // 在 binOS 里登记的播放器 id，别的设备用它遥控这里
    private(set) var playerId: String?

    var current: Track? { index.flatMap { queue.indices.contains($0) ? queue[$0] : nil } }

    private let player = AVPlayer()
    private var observations: [NSKeyValueObservation] = []
    private var timeObserver: Any?
    private var started = false
    private var connection: EventStream?
    private var lastReport: (state: PlayerState, at: Date)?
    private var executing = false
    private var artwork: (url: String, image: UIImage)?
    // 开始加载这首歌之后，又切了歌，前一次的加载结果作废
    private var loadToken = 0
    // 各个来源的曲目从哪个来源取音频流（ProviderInfo.stream），没有的不能在本机播放
    private var streamProviders: [String: String]?

    private init() {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "music/volume") != nil { volume = defaults.double(forKey: "music/volume") }
        repeatMode = RepeatMode(rawValue: defaults.string(forKey: "music/repeat") ?? "") ?? .off
        player.volume = Float(volume)
    }

    // 启动时调用一次：读队列、登记播放器、接上系统的媒体控制
    func start() {
        guard !started else { return }
        started = true
        observe()
        setupRemoteCommands()
        connect()
        Task {
            while true {
                try? await Task.sleep(for: .seconds(1))
                await reportIfNeeded()
            }
        }
        Task { await refreshQueue() }
    }

    // 换服务器后重新登记
    func restart() {
        stop()
        queue = []
        index = nil
        connection?.stop()
        playerId = nil
        connect()
        streamProviders = nil
        Task { await refreshQueue() }
    }

    private func save() {
        UserDefaults.standard.set(volume, forKey: "music/volume")
        UserDefaults.standard.set(repeatMode.rawValue, forKey: "music/repeat")
    }

    // MARK: 队列

    @discardableResult
    func refreshQueue() async -> Bool {
        guard let snapshot = try? await MusicAPI.queue() else { return false }
        apply(snapshot)
        return true
    }

    // 当前的歌还在队列里就接着放，不在了就停下
    private func apply(_ snapshot: QueueSnapshot) {
        let currentRef = current?.ref
        queue = snapshot.tracks
        if let currentRef {
            if let next = queue.firstIndex(where: { $0.ref == currentRef }) {
                index = next
            } else {
                stop()
            }
        } else if index == nil, let saved = UserDefaults.standard.string(forKey: "music/current") {
            index = queue.firstIndex { "\($0.ref.provider):\($0.ref.id)" == saved }
        }
        updateNowPlaying()
    }

    func add(_ tracks: [Track]) async throws {
        apply(try await MusicAPI.mutate(.init(type: "add", tracks: tracks)))
    }

    func remove(_ track: Track) async throws {
        let wasCurrent = track.ref == current?.ref
        let playing = status == .playing || status == .loading
        let nextIndex = index
        if wasCurrent { stop() }
        apply(try await MusicAPI.mutate(.init(type: "remove", ref: track.ref)))
        // 正在放的歌被移除时接着放下一首
        if wasCurrent, playing, let nextIndex, !queue.isEmpty {
            select(min(nextIndex, queue.count - 1))
        }
    }

    // 把 track 移到第 target 首；先在本机生效，没做成时以服务端的队列为准
    func move(_ track: Track, to target: Int) async throws {
        guard let from = queue.firstIndex(where: { $0.ref == track.ref }) else { return }
        let currentRef = current?.ref
        var next = queue
        next.remove(at: from)
        next.insert(track, at: min(max(target, 0), next.count))
        queue = next
        index = currentRef.flatMap { ref in queue.firstIndex { $0.ref == ref } }
        do {
            apply(try await MusicAPI.mutate(.init(type: "move", ref: track.ref, index: target)))
        } catch {
            await refreshQueue()
            throw error
        }
    }

    func clear() async throws {
        stop()
        apply(try await MusicAPI.mutate(.init(type: "clear")))
    }

    // 加入队列并马上播放
    func playNow(_ track: Track) async throws {
        if !queue.contains(where: { $0.ref == track.ref }) {
            try await add([track])
        }
        if let target = queue.firstIndex(where: { $0.ref == track.ref }) {
            select(target)
        }
    }

    // MARK: 播放

    func select(_ target: Int) {
        guard queue.indices.contains(target) else { return }
        index = target
        let track = queue[target]
        UserDefaults.standard.set("\(track.ref.provider):\(track.ref.id)", forKey: "music/current")
        status = .loading
        error = nil
        position = 0
        duration = (track.durationMs ?? 0) / 1000
        player.replaceCurrentItem(with: nil)
        updateNowPlaying()
        loadToken += 1
        let token = loadToken
        Task { await load(track, token: token) }
    }

    // 收到 music 通知时重新读取：来源的设置会影响能不能取音频流
    func refreshProviders() async {
        guard let providers = try? await MusicAPI.providers() else { return }
        streamProviders = Dictionary(providers.compactMap { provider in provider.stream.map { (provider.id, $0.provider) } }, uniquingKeysWith: { first, _ in first })
    }

    private func load(_ track: Track, token: Int) async {
        do {
            if streamProviders == nil { await refreshProviders() }
            guard token == loadToken else { return }
            guard let provider = streamProviders?[track.ref.provider] else {
                throw APIError.http(422, code: "unsupported", message: "这首歌不能在本机播放")
            }
            let url = MusicAPI.streamURL(provider: provider, id: track.ref.id)
            var options: [String: Any] = [:]
            if let cookies = HTTPCookieStorage.shared.cookies(for: url), !cookies.isEmpty {
                options[AVURLAssetHTTPCookiesKey] = cookies
            }
            let asset = AVURLAsset(url: url, options: options)
            let item = AVPlayerItem(asset: asset)
            // 一首歌常常有一小时，默认会缓冲很多才开始放
            item.preferredForwardBufferDuration = 8
            player.replaceCurrentItem(with: item)
            activateSession()
            player.play()
        } catch {
            guard token == loadToken else { return }
            status = .error
            self.error = error.localizedDescription
            updateNowPlaying()
        }
    }

    private func activateSession() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    func play() {
        guard !queue.isEmpty else { return }
        if player.currentItem == nil || status == .ended || status == .error {
            select(index ?? 0)
        } else {
            activateSession()
            player.play()
        }
    }

    func pause() {
        player.pause()
    }

    func toggle() {
        status == .playing || status == .loading ? pause() : play()
    }

    func stop() {
        loadToken += 1
        player.pause()
        player.replaceCurrentItem(with: nil)
        status = .idle
        position = 0
        updateNowPlaying()
    }

    // 自动接下一首时，到了队尾只有全部循环才回到开头；手动的下一首总是循环
    func next(auto: Bool = false) {
        guard !queue.isEmpty else { return }
        let current = index ?? -1
        if current + 1 < queue.count {
            select(current + 1)
        } else if !auto || repeatMode == .all {
            select(0)
        } else {
            status = .ended
            updateNowPlaying()
        }
    }

    // 放了超过 3 秒时回到开头，否则上一首
    func previous() {
        guard !queue.isEmpty else { return }
        if position > 3 {
            seek(to: 0)
        } else {
            select(((index ?? 0) - 1 + queue.count) % queue.count)
        }
    }

    func seek(to seconds: Double) {
        position = seconds
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 1000))
        updateNowPlaying()
    }

    private func observe() {
        observations.append(player.observe(\.timeControlStatus) { _, _ in
            Task { @MainActor in MusicPlayer.shared.syncStatus() }
        })
        observations.append(player.observe(\.currentItem?.status) { _, _ in
            Task { @MainActor in
                let music = MusicPlayer.shared
                guard let item = music.player.currentItem else { return }
                if item.status == .failed {
                    music.status = .error
                    music.error = item.error?.localizedDescription ?? "无法播放"
                    music.updateNowPlaying()
                } else if item.status == .readyToPlay {
                    let seconds = item.duration.seconds
                    if seconds.isFinite, seconds > 0, music.current?.durationMs == nil { music.duration = seconds }
                    music.updateNowPlaying()
                }
            }
        })
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { time in
            MainActor.assumeIsolated { MusicPlayer.shared.position = time.seconds.isFinite ? time.seconds : 0 }
        }
        NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { notification in
            let ended = notification.object as? AVPlayerItem
            MainActor.assumeIsolated {
                let music = MusicPlayer.shared
                guard ended === music.player.currentItem else { return }
                if music.repeatMode == .one, let index = music.index {
                    music.select(index)
                } else {
                    music.next(auto: true)
                }
            }
        }
    }

    private func syncStatus() {
        guard player.currentItem != nil, status != .error else { return }
        switch player.timeControlStatus {
        case .playing: status = .playing
        case .paused: if status != .loading || player.currentItem?.status == .failed { status = .paused }
        case .waitingToPlayAtSpecifiedRate: status = .loading
        @unknown default: break
        }
        updateNowPlaying()
    }

    // MARK: 锁屏和系统的媒体控制

    private func setupRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in self?.play(); return .success }
        center.pauseCommand.addTarget { [weak self] _ in self?.pause(); return .success }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in self?.toggle(); return .success }
        center.nextTrackCommand.addTarget { [weak self] _ in self?.next(); return .success }
        center.previousTrackCommand.addTarget { [weak self] _ in self?.previous(); return .success }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.seek(to: event.positionTime)
            return .success
        }
    }

    private func updateNowPlaying() {
        let center = MPNowPlayingInfoCenter.default()
        guard let track = current, status != .idle else {
            center.nowPlayingInfo = nil
            center.playbackState = .stopped
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artistText,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: status == .playing ? 1.0 : 0.0,
        ]
        if let album = track.album?.title { info[MPMediaItemPropertyAlbumTitle] = album }
        if let artwork, artwork.url == track.artworkUrl {
            let image = artwork.image
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        } else if let url = track.artworkUrl.flatMap(URL.init(string:)) {
            Task {
                guard let (data, _) = try? await URLSession.shared.data(from: url), let image = UIImage(data: data) else { return }
                artwork = (url.absoluteString, image)
                updateNowPlaying()
            }
        }
        center.nowPlayingInfo = info
        center.playbackState = status == .playing ? .playing : .paused
    }

    // MARK: 被遥控

    var state: PlayerState {
        PlayerState(
            track: current?.ref, status: status, positionMs: max(position, 0) * 1000, durationMs: max(duration, 0) * 1000,
            volume: volume, repeat: repeatMode, controls: .init(seek: true, volume: true), error: error.map { String($0.prefix(2000)) })
    }

    private func connect() {
        let label = UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iOS"
        let stream = EventStream(
            url: { API.shared.url("\(MusicAPI.base)/players/connect", query: ["label": label]) },
            onMessage: { [weak self] message in self?.receive(message) },
            onConnectedChange: { [weak self] connected in if !connected { self?.playerId = nil } }
        )
        connection = stream
        stream.start()
    }

    private struct PlayerMessage: Decodable {
        let type: String
        let playerId: String?
        let command: CommandResult?
    }

    private func receive(_ message: SSEMessage) {
        guard let parsed = try? JSONDecoder.api.decode(PlayerMessage.self, from: Data(message.data.utf8)) else { return }
        if parsed.type == "connected", let id = parsed.playerId {
            playerId = id
            lastReport = nil
            Task { await report(result: nil) }
        } else if parsed.type == "command", let command = parsed.command {
            Task { await execute(command) }
        }
    }

    // 状态变了每秒报一次，没变时每 10 秒报一次心跳
    private func reportIfNeeded() async {
        guard playerId != nil else { return }
        let current = state
        if let last = lastReport, last.state == current, Date().timeIntervalSince(last.at) < 10 { return }
        await report(result: nil)
    }

    private struct Report: Encodable {
        struct Result: Encodable {
            let id: String
            let error: String?
        }

        let state: PlayerState
        let result: Result?
    }

    private func report(result: Report.Result?) async {
        guard let playerId else { return }
        let current = state
        lastReport = (current, Date())
        try? await API.shared.post("\(MusicAPI.base)/players/\(playerId)/report", body: Report(state: current, result: result))
    }

    private func execute(_ command: CommandResult) async {
        guard !executing else {
            await report(result: .init(id: command.id, error: "播放器正在执行别的命令"))
            return
        }
        executing = true
        defer { executing = false }
        guard await refreshQueue() else {
            await report(result: .init(id: command.id, error: "共享队列尚未同步，请重试。"))
            return
        }
        // 以服务端的状态为准：已经过期或被取消的命令不再执行，也不回报
        do {
            guard try await MusicAPI.commandStatus(command.id) == "pending" else { return }
        } catch APIError.http {
            return
        } catch {
            await report(result: .init(id: command.id, error: String(error.localizedDescription.prefix(2000))))
            return
        }
        var failure: String?
        switch command.command {
        case .play, .next, .previous, .select:
            if queue.isEmpty {
                failure = "队列是空的"
                break
            }
            let before = current?.ref
            switch command.command {
            case .play: play()
            case .next: next()
            case .previous: previous()
            case .select(let ref):
                if let target = queue.firstIndex(where: { $0.ref == ref }) { select(target) } else { failure = "歌曲不在共享队列中" }
            default: break
            }
            if failure == nil { failure = await waitForPlaying(changingFrom: command.command == .play ? nil : before) }
        case .pause: pause()
        case .stop: stop()
        case .seek(let ms):
            if duration <= 0 || [.idle, .loading, .error].contains(status) { failure = "现在不能跳转" } else { seek(to: ms / 1000) }
        case .volume(let value): volume = min(max(value, 0), 1)
        case .setRepeat(let mode): repeatMode = mode
        case .unknown: failure = "这个版本的 app 不支持这个命令"
        }
        await report(result: .init(id: command.id, error: failure))
    }

    // 开始播放才算成功：10 秒内放起来了就是成功，出错、停下或换了别的歌就是失败
    private func waitForPlaying(changingFrom _: TrackRef?) async -> String? {
        let target = current?.ref
        for _ in 0..<100 {
            if status == .playing { return nil }
            if status == .error { return error ?? "播放失败" }
            if current?.ref != target { return "已经换了别的歌" }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return "10 秒内没有开始播放"
    }
}
