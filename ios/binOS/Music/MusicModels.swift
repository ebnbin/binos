import Foundation

// 与 server/src/apps/music/types.ts 对应

struct TrackRef: Codable, Hashable {
    let provider: String
    let id: String
}

struct Track: Codable, Hashable, Identifiable {
    struct Album: Codable, Hashable {
        let id: String?
        @Default<Defaults.Empty> var title: String
    }

    let ref: TrackRef
    @Default<Defaults.Empty> var title: String
    @Lossy var artists: [String]
    let album: Album?
    let artworkUrl: String?
    let durationMs: Double?
    @Default<Defaults.Empty> var externalUrl: String

    var id: TrackRef { ref }
    var artistText: String { artists.joined(separator: "、") }
}

struct CatalogPage: Decodable {
    @Lossy var tracks: [Track] = []
    let nextPage: String?
    let warning: String?
}

struct QueueSnapshot: Decodable {
    let revision: Int
    @Lossy var tracks: [Track]
}

struct Capability: Decodable, Hashable {
    @Default<Defaults.Empty> var state: String
    let reason: String?
}

struct ProviderInfo: Decodable, Hashable, Identifiable {
    struct Reference: Decodable, Hashable {
        let pattern: String
        let capability: String
    }

    struct Input: Decodable, Hashable {
        @Lossy var references: [Reference]
    }

    struct Field: Decodable, Hashable, Identifiable {
        struct Link: Decodable, Hashable {
            let label: String
            let url: String
        }

        let id: String
        @Default<Defaults.Empty> var label: String
        @Default<Defaults.Empty> var description: String
        @Default<Defaults.False> var secret: Bool
        @Default<Defaults.False> var configured: Bool
        @Lossy var links: [Link]
    }

    struct Configuration: Decodable, Hashable {
        @Lossy var fields: [Field]
    }

    let id: String
    @Default<Defaults.Empty> var name: String
    @Default<Defaults.Empty> var description: String
    let input: Input
    @LossyDictionary var capabilities: [String: Capability]
    let configuration: Configuration

    func available(_ capability: String) -> Bool { capabilities[capability]?.state == "available" }

    // 按清单里的规则判断输入是链接还是搜索词
    func operation(for query: String) -> String {
        for reference in input.references {
            if let regex = try? NSRegularExpression(pattern: reference.pattern, options: .caseInsensitive),
               regex.firstMatch(in: query, range: NSRange(query.startIndex..., in: query)) != nil {
                return reference.capability
            }
        }
        return "search"
    }
}

struct PlaybackSource: Decodable {
    let kind: String
    let url: String?
    let id: String?
}

struct Lyrics: Decodable {
    @Default<Defaults.Empty> var text: String
    let attribution: String?
}

enum PlaybackStatus: String, Codable, LenientEnum {
    case idle, loading, playing, paused, ended, error
    // 别的播放器报来的、这个版本不认识的状态
    case unknown

    static var fallback: Self { .unknown }
}

enum RepeatMode: String, Codable, LenientEnum {
    case off, all, one

    static var fallback: Self { .off }
}

struct PlayerState: Codable, Hashable {
    struct Controls: Codable, Hashable {
        @Default<Defaults.False> var seek: Bool = false
        @Default<Defaults.False> var volume: Bool = false
    }

    let track: TrackRef?
    let status: PlaybackStatus
    @Default<Defaults.Zero> var positionMs: Double = 0
    @Default<Defaults.Zero> var durationMs: Double = 0
    let volume: Double
    let `repeat`: RepeatMode
    let controls: Controls
    let error: String?

    private enum Keys: String, CodingKey { case track, status, positionMs, durationMs, volume, `repeat`, controls, error }

    // 没在放歌时 track 要写成 null，不能省略
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(track, forKey: .track)
        try c.encode(status, forKey: .status)
        try c.encode(positionMs, forKey: .positionMs)
        try c.encode(durationMs, forKey: .durationMs)
        try c.encode(volume, forKey: .volume)
        try c.encode(`repeat`, forKey: .repeat)
        try c.encode(controls, forKey: .controls)
        try c.encodeIfPresent(error, forKey: .error)
    }
}

struct PlayerSnapshot: Decodable, Hashable, Identifiable {
    let id: String
    @Default<Defaults.Empty> var label: String
    @Default<Defaults.Zero> var updatedAt: Double
    let state: PlayerState?
}

// 遥控别的播放器、以及被遥控时收到的命令
enum PlayerCommand: Codable, Hashable {
    case play, pause, stop, next, previous
    case select(TrackRef)
    case seek(Double)
    case volume(Double)
    case setRepeat(RepeatMode)
    // 这个版本不认识的命令：回报失败，不执行
    case unknown(String)

    private enum Keys: String, CodingKey { case type, ref, positionMs, volume, `repeat` }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "play": self = .play
        case "pause": self = .pause
        case "stop": self = .stop
        case "next": self = .next
        case "previous": self = .previous
        case "select": self = .select(try c.decode(TrackRef.self, forKey: .ref))
        case "seek": self = .seek(try c.decode(Double.self, forKey: .positionMs))
        case "volume": self = .volume(try c.decode(Double.self, forKey: .volume))
        case "repeat": self = .setRepeat(try c.decode(RepeatMode.self, forKey: .repeat))
        case let type: self = .unknown(type)
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .play: try c.encode("play", forKey: .type)
        case .pause: try c.encode("pause", forKey: .type)
        case .stop: try c.encode("stop", forKey: .type)
        case .next: try c.encode("next", forKey: .type)
        case .previous: try c.encode("previous", forKey: .type)
        case .select(let ref):
            try c.encode("select", forKey: .type)
            try c.encode(ref, forKey: .ref)
        case .seek(let position):
            try c.encode("seek", forKey: .type)
            try c.encode(position, forKey: .positionMs)
        case .volume(let volume):
            try c.encode("volume", forKey: .type)
            try c.encode(volume, forKey: .volume)
        case .setRepeat(let mode):
            try c.encode("repeat", forKey: .type)
            try c.encode(mode, forKey: .repeat)
        case .unknown(let type):
            try c.encode(type, forKey: .type)
        }
    }
}

struct CommandResult: Decodable {
    let id: String
    @Default<Defaults.Empty> var playerId: String
    let command: PlayerCommand
    @Default<Defaults.Empty> var status: String
}

enum MusicAPI {
    private static var api: API { API.shared }
    static let base = "/api/apps/music"

    static func providers() async throws -> [ProviderInfo] {
        struct Response: Decodable { @Lossy var providers: [ProviderInfo] }
        let response: Response = try await api.get("\(base)/providers")
        return response.providers
    }

    static func catalog(provider: String, operation: String, query: String, page: String? = nil) async throws -> CatalogPage {
        var params = ["q": query]
        if let page { params["page"] = page }
        return try await api.get("\(base)/providers/\(provider)/\(operation)", query: params)
    }

    // 值为空字符串表示移除这一项
    static func configure(provider: String, values: [String: String]) async throws -> ProviderInfo {
        try await api.send("PUT", "\(base)/providers/\(provider)/settings", body: values)
    }

    static func lyrics(_ ref: TrackRef) async throws -> Lyrics {
        try await api.get("\(base)/providers/\(ref.provider)/lyrics", query: ["q": ref.id])
    }

    static func queue() async throws -> QueueSnapshot {
        try await api.get("\(base)/queue")
    }

    struct Mutation: Encodable {
        struct Operation: Encodable {
            let type: String
            var tracks: [Track]?
            var ref: TrackRef?
        }

        let id = UUID().uuidString
        let operation: Operation
    }

    static func mutate(_ operation: Mutation.Operation) async throws -> QueueSnapshot {
        try await api.send("POST", "\(base)/queue", body: Mutation(operation: operation))
    }

    static func players() async throws -> [PlayerSnapshot] {
        struct Response: Decodable { @Lossy var players: [PlayerSnapshot] }
        let response: Response = try await api.get("\(base)/players")
        return response.players
    }

    struct CommandBody: Encodable {
        let id = UUID().uuidString
        let command: PlayerCommand
    }

    static func command(player: String, _ command: PlayerCommand) async throws {
        let _: Ignored = try await api.send("POST", "\(base)/players/\(player)/commands", body: CommandBody(command: command))
    }

    // 只等 3 秒：网络缓冲太久的命令宁可报错也不执行
    static func commandStatus(_ id: String) async throws -> String {
        struct Response: Decodable { let status: String }
        var request = api.request(api.url("\(base)/commands/\(id)"))
        request.timeoutInterval = 3
        return try JSONDecoder.api.decode(Response.self, from: try await api.data(request)).status
    }
}
