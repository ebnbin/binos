import SwiftUI

// 音乐：搜索或粘贴链接加入共享队列，本机播放；也可以遥控别的设备上的播放器
struct MusicRootView: View {
    private let player = MusicPlayer.shared
    @State private var providers: [ProviderInfo] = []
    @State private var providersError: String?
    @State private var provider = "youtube-music"
    @State private var showingSettings = false
    @State private var query = ""
    @State private var results: CatalogPage?
    @State private var searching = false
    @State private var error: String?
    @Bindable private var router = AppRouter.shared
    @State private var others: [PlayerSnapshot] = []

    var body: some View {
        NavigationStack {
            List {
                if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    searchResults
                } else {
                    if let providersError {
                        Text(providersError).font(.footnote).foregroundStyle(.red)
                    }
                    if let track = player.current {
                        Section {
                            Button { router.nowPlaying = true } label: {
                                NowPlayingSummary(track: track)
                            }
                            .buttonStyle(.plain)
                            if providers.first(where: { $0.id == track.ref.provider })?.available("recommendations") == true {
                                NavigationLink("发现相似歌曲") { RecommendationsView(track: track) }
                            }
                        }
                    }
                    queueSection
                    if !others.isEmpty {
                        Section("其他播放器") {
                            ForEach(others) { RemotePlayerRow(snapshot: $0, queue: player.queue) }
                        }
                    }
                }
            }
            .navigationTitle("音乐")
            .searchable(text: $query, prompt: "搜索，或粘贴 YouTube 链接")
            .onSubmit(of: .search) { Task { await search() } }
            .onChange(of: query) { results = nil }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("来源", selection: $provider) {
                            ForEach(providers) { Text($0.name).tag($0.id) }
                        }
                        if selected?.configuration.fields.isEmpty == false {
                            Button("音乐设置", systemImage: "gearshape") { showingSettings = true }
                        }
                        if !player.queue.isEmpty {
                            Button("清空队列", systemImage: "trash", role: .destructive) {
                                Task { try? await player.clear() }
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                }
            }
            .refreshable {
                await player.refreshQueue()
                await loadOthers()
            }
            .sheet(isPresented: $router.nowPlaying) { NowPlayingView() }
            .sheet(isPresented: $showingSettings) {
                if let selected {
                    ProviderSettingsView(provider: selected) { updated in
                        if let index = providers.firstIndex(where: { $0.id == updated.id }) { providers[index] = updated }
                    }
                }
            }
            .task(id: EventHub.shared.music) {
                do {
                    providers = try await MusicAPI.providers()
                    providersError = nil
                } catch is CancellationError {
                } catch {
                    providersError = error.localizedDescription
                }
            }
            .task {
                while !Task.isCancelled {
                    await loadOthers()
                    try? await Task.sleep(for: .seconds(5))
                }
            }
        }
    }

    // 记住的来源不在了就用第一个
    private var selected: ProviderInfo? { providers.first { $0.id == provider } ?? providers.first }

    private var queryText: String { query.trimmingCharacters(in: .whitespaces) }

    // 当前输入对应的能力不可用时的说明
    private var capabilityNotice: String? {
        guard let selected else { return nil }
        let operation = selected.operation(for: queryText)
        let capability = selected.capabilities[operation]
        switch capability?.state {
        case "configuration-required": return capability?.reason
        case "unsupported": return "此来源不支持\(operation == "search" ? "搜索" : "链接导入")。"
        default: return nil
        }
    }

    private func loadOthers() async {
        if let players = try? await MusicAPI.players() {
            others = players.filter { $0.id != player.playerId }
        }
    }

    private var queueSection: some View {
        Section {
            if player.queue.isEmpty {
                Text("队列是空的，搜索歌曲加入队列").foregroundStyle(.secondary)
            }
            ForEach(Array(player.queue.enumerated()), id: \.element.id) { offset, track in
                Button {
                    player.select(offset)
                } label: {
                    TrackRow(track: track, playing: offset == player.index && player.status != .idle)
                }
                .buttonStyle(.plain)
                .swipeActions {
                    Button("移除", systemImage: "trash", role: .destructive) {
                        Task { try? await player.remove(track) }
                    }
                }
                .contextMenu {
                    if let url = URL(string: track.externalUrl) {
                        Link(destination: url) { Label("在 YouTube 打开", systemImage: "safari") }
                    }
                    Button("移除", systemImage: "trash", role: .destructive) {
                        Task { try? await player.remove(track) }
                    }
                }
            }
        } header: {
            Text("共享队列 · \(player.queue.count) 首")
        }
    }

    @ViewBuilder
    private var searchResults: some View {
        if let selected {
            Text(selected.description).font(.footnote).foregroundStyle(.secondary)
        }
        if let capabilityNotice {
            Text(capabilityNotice).font(.footnote).foregroundStyle(.secondary)
        } else if searching {
            HStack { Spacer(); ProgressView(); Spacer() }
        } else if let error {
            Text(error).foregroundStyle(.red)
        } else if let results {
            if let warning = results.warning {
                Text(warning).font(.footnote).foregroundStyle(.orange)
            }
            Section {
                if results.tracks.count > 1 {
                    Button("全部加入队列", systemImage: "text.badge.plus") {
                        Task { try? await player.add(results.tracks) }
                    }
                }
                ForEach(results.tracks) { CatalogTrackRow(track: $0) }
                if let next = results.nextPage {
                    Button("更多结果") { Task { await search(page: next) } }
                }
            }
        } else {
            Text("按搜索键开始").foregroundStyle(.secondary)
        }
    }

    private func search(page: String? = nil) async {
        let text = queryText
        guard !text.isEmpty, let selected, capabilityNotice == nil else { return }
        let operation = selected.operation(for: text)
        if page == nil { searching = true }
        error = nil
        defer { searching = false }
        do {
            let loaded = try await MusicAPI.catalog(provider: selected.id, operation: operation, query: text, page: page)
            // 翻页时接在已有的结果后面
            if page != nil, let previous = results {
                results = CatalogPage(tracks: previous.tracks + loaded.tracks, nextPage: loaded.nextPage, warning: loaded.warning)
            } else {
                results = loaded
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// 查找结果里的一首：可以直接播放或加入队列
private struct CatalogTrackRow: View {
    let track: Track
    private let player = MusicPlayer.shared

    var body: some View {
        HStack {
            TrackRow(track: track, playing: false)
            Menu {
                Button("播放", systemImage: "play.fill") { Task { try? await player.playNow(track) } }
                Button("加入队列", systemImage: "text.badge.plus") { Task { try? await player.add([track]) } }
            } label: {
                Image(systemName: player.queue.contains { $0.ref == track.ref } ? "checkmark.circle.fill" : "plus.circle")
                    .font(.title3)
            }
        }
    }
}

// 和某首歌相似的歌曲，由这首歌的来源推荐
private struct RecommendationsView: View {
    let track: Track
    @State private var results: CatalogPage?
    @State private var loading = false
    @State private var error: String?
    private let player = MusicPlayer.shared

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(.red) }
            if let results {
                if let warning = results.warning {
                    Text(warning).font(.footnote).foregroundStyle(.orange)
                }
                if results.tracks.isEmpty {
                    Text("没有找到内容").foregroundStyle(.secondary)
                } else {
                    Button("全部加入队列", systemImage: "text.badge.plus") {
                        Task { try? await player.add(results.tracks) }
                    }
                }
                ForEach(results.tracks) { CatalogTrackRow(track: $0) }
                if let next = results.nextPage {
                    Button(loading ? "加载中…" : "加载更多") { Task { await load(page: next) } }
                        .disabled(loading)
                }
            }
        }
        .overlay { if results == nil && error == nil { ProgressView() } }
        .navigationTitle("相似歌曲")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(page: nil) }
    }

    private func load(page: String?) async {
        loading = true
        defer { loading = false }
        do {
            let loaded = try await MusicAPI.catalog(provider: track.ref.provider, operation: "recommendations", query: track.ref.id, page: page)
            results = page == nil ? loaded : CatalogPage(tracks: (results?.tracks ?? []) + loaded.tracks, nextPage: loaded.nextPage, warning: loaded.warning)
            error = nil
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct Artwork: View {
    let url: String?
    var size: CGFloat = 44

    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Image(systemName: "music.note")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.quaternary)
        }
        .frame(width: size, height: size)
        .clipShape(.rect(cornerRadius: size / 8))
    }
}

private struct TrackRow: View {
    let track: Track
    let playing: Bool

    var body: some View {
        HStack(spacing: 12) {
            Artwork(url: track.artworkUrl)
            VStack(alignment: .leading, spacing: 2) {
                Text(track.title).lineLimit(1).foregroundStyle(playing ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                Text(track.artistText).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            if playing {
                Image(systemName: "waveform").symbolEffect(.variableColor.iterative, isActive: MusicPlayer.shared.status == .playing).foregroundStyle(.tint)
            } else if let ms = track.durationMs {
                Text(playTime(ms / 1000)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .contentShape(.rect)
    }
}

private struct NowPlayingSummary: View {
    let track: Track
    private let player = MusicPlayer.shared

    var body: some View {
        HStack(spacing: 14) {
            Artwork(url: track.artworkUrl, size: 64)
            VStack(alignment: .leading, spacing: 4) {
                Text(track.title).font(.headline).lineLimit(2)
                Text(track.artistText).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                if let error = player.error, player.status == .error {
                    Text(error).font(.caption).foregroundStyle(.red).lineLimit(2)
                }
            }
            Spacer()
            PlayPauseButton().font(.title)
        }
    }
}

struct PlayPauseButton: View {
    private let player = MusicPlayer.shared

    var body: some View {
        Button {
            player.toggle()
        } label: {
            if player.status == .loading {
                ProgressView()
            } else {
                Image(systemName: player.status == .playing ? "pause.fill" : "play.fill")
                    .contentTransition(.symbolEffect(.replace))
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(player.status == .playing ? "暂停" : "播放")
    }
}

// 底部标签栏上方的迷你播放器
struct MiniPlayer: View {
    let onOpen: () -> Void
    private let player = MusicPlayer.shared
    @State private var showingNowPlaying = false

    var body: some View {
        HStack(spacing: 10) {
            if let track = player.current {
                Artwork(url: track.artworkUrl, size: 30)
                VStack(alignment: .leading, spacing: 0) {
                    Text(track.title).font(.footnote.weight(.semibold)).lineLimit(1)
                    Text(track.artistText).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                PlayPauseButton()
                Button { player.next() } label: { Image(systemName: "forward.fill") }
                    .buttonStyle(.plain)
                    .accessibilityLabel("下一首")
            }
        }
        .padding(.horizontal, 14)
        .contentShape(.rect)
        .onTapGesture { showingNowPlaying = true }
        .sheet(isPresented: $showingNowPlaying) { NowPlayingView() }
    }
}

struct NowPlayingView: View {
    @Bindable private var player = MusicPlayer.shared
    @State private var scrubbing: Double?
    @State private var lyrics: Lyrics?
    @State private var showingLyrics = false

    var body: some View {
        VStack(spacing: 24) {
            Capsule().fill(.tertiary).frame(width: 40, height: 5).padding(.top, 8)
            if let track = player.current {
                if showingLyrics {
                    ScrollView {
                        Text(lyrics?.text ?? "没有歌词")
                            .font(.title3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if let attribution = lyrics?.attribution {
                            Text(attribution).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxHeight: .infinity)
                } else {
                    Artwork(url: track.artworkUrl, size: 300)
                        .shadow(radius: 20, y: 10)
                        .frame(maxHeight: .infinity)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(track.title).font(.title2.bold()).lineLimit(2)
                    Text(track.artistText).font(.title3).foregroundStyle(.secondary).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(spacing: 4) {
                    Slider(value: Binding(get: { scrubbing ?? player.position }, set: { scrubbing = $0 }), in: 0...max(player.duration, 1)) { editing in
                        if !editing, let scrubbing {
                            player.seek(to: scrubbing)
                            self.scrubbing = nil
                        }
                    }
                    HStack {
                        Text(playTime(scrubbing ?? player.position))
                        Spacer()
                        Text(playTime(player.duration))
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                }
                if let error = player.error, player.status == .error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                HStack(spacing: 44) {
                    Button { player.previous() } label: { Image(systemName: "backward.fill") }
                    PlayPauseButton().font(.system(size: 44))
                    Button { player.next() } label: { Image(systemName: "forward.fill") }
                }
                .font(.title)
                .buttonStyle(.plain)
                HStack(spacing: 12) {
                    Image(systemName: "speaker.fill").foregroundStyle(.secondary)
                    Slider(value: $player.volume, in: 0...1)
                    Image(systemName: "speaker.wave.3.fill").foregroundStyle(.secondary)
                }
                HStack {
                    Button {
                        showingLyrics.toggle()
                    } label: {
                        Image(systemName: "quote.bubble").foregroundStyle(showingLyrics ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                    }
                    Spacer()
                    Picker("循环", selection: $player.repeatMode) {
                        Label("不循环", systemImage: "repeat").tag(RepeatMode.off)
                        Label("全部循环", systemImage: "repeat").tag(RepeatMode.all)
                        Label("单曲循环", systemImage: "repeat.1").tag(RepeatMode.one)
                    }
                    .pickerStyle(.menu)
                }
                .font(.title3)
            } else {
                ContentUnavailableView("没有在播放", systemImage: "music.note")
            }
        }
        .padding(.horizontal, 28)
        .padding(.bottom)
        .presentationDragIndicator(.hidden)
        .task(id: "\(player.current?.ref.id ?? "")-\(showingLyrics)") {
            guard showingLyrics, let ref = player.current?.ref else { return }
            lyrics = try? await MusicAPI.lyrics(ref)
        }
    }
}

// 别的设备上的播放器：看它在放什么，遥控它
private struct RemotePlayerRow: View {
    let snapshot: PlayerSnapshot
    let queue: [Track]
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: snapshot.label.contains("iOS") || snapshot.label.contains("Android") ? "iphone" : "laptopcomputer")
                Text(snapshot.label).font(.headline)
                Spacer()
                if let state = snapshot.state {
                    Text(statusName(state.status)).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let ref = snapshot.state?.track, let track = queue.first(where: { $0.ref == ref }) {
                Text("\(track.title) · \(track.artistText)").font(.footnote).lineLimit(1)
            }
            HStack(spacing: 28) {
                control(.previous, "backward.fill")
                control(snapshot.state?.status == .playing ? .pause : .play, snapshot.state?.status == .playing ? "pause.fill" : "play.fill")
                control(.next, "forward.fill")
                control(.stop, "stop.fill")
            }
            .buttonStyle(.borderless)
            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
    }

    private func control(_ command: PlayerCommand, _ icon: String) -> some View {
        Button {
            Task {
                do {
                    try await MusicAPI.command(player: snapshot.id, command)
                    error = nil
                } catch {
                    self.error = error.localizedDescription
                }
            }
        } label: {
            Image(systemName: icon)
        }
        .disabled(snapshot.state == nil)
    }

    private func statusName(_ status: PlaybackStatus) -> String {
        switch status {
        case .idle: "空闲"
        case .loading: "加载中"
        case .playing: "播放中"
        case .paused: "已暂停"
        case .ended: "已放完"
        case .error: "出错"
        }
    }
}

// 播放时间：3:05，超过一小时是 1:01:00
func playTime(_ seconds: Double) -> String {
    let duration = Duration.seconds(max(seconds, 0))
    return seconds >= 3600 ? duration.formatted(.time(pattern: .hourMinuteSecond)) : duration.formatted(.time(pattern: .minuteSecond))
}
