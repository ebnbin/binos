import Foundation

// 与 server/src/services/kita/types.ts、server/src/apps/code/types.ts 对应

struct ContextUsage: Codable, Hashable {
    @Default<Defaults.ZeroInt> var tokens: Int
    @Default<Defaults.ZeroInt> var window: Int
}

struct Tokens: Codable, Hashable {
    @Default<Defaults.ZeroInt> var input: Int
    @Default<Defaults.ZeroInt> var output: Int
    @Default<Defaults.ZeroInt> var cacheRead: Int
    @Default<Defaults.ZeroInt> var cacheWrite: Int
    var total: Int { input + output + cacheRead + cacheWrite }
}

struct Attachment: Codable, Hashable {
    let file: String
    let name: String
}

enum FileChange: Decodable, Hashable {
    case write(content: String)
    case replace(before: String, after: String, all: Bool)
    case diff(op: String, diff: String)

    private enum Keys: String, CodingKey { case type, content, before, after, all, op, diff }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "write": self = .write(content: try c.decode(String.self, forKey: .content))
        case "replace": self = .replace(before: try c.decode(String.self, forKey: .before), after: try c.decode(String.self, forKey: .after), all: (try? c.decode(Bool.self, forKey: .all)) ?? false)
        default: self = .diff(op: try c.decode(String.self, forKey: .op), diff: try c.decode(String.self, forKey: .diff))
        }
    }
}

enum ToolDetail: Decodable, Hashable {
    case command(String)
    case read(path: String)
    case edit(path: String, change: FileChange?)
    case search(pattern: String, files: Bool)
    case webSearch(String)
    case webFetch(url: String, prompt: String?)
    case imageView(path: String)
    case browser(action: String, target: String?)
    case mcp(server: String, tool: String)
    case subagent(description: String, prompt: String?, type: String?)
    case toolSearch(String)
    case skill(String)
    case todo
    case other

    private enum Keys: String, CodingKey { case kind, command, path, change, pattern, target, query, url, prompt, action, server, tool, description, type, name }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        func string(_ key: Keys) -> String { (try? c.decode(String.self, forKey: key)) ?? "" }
        func optional(_ key: Keys) -> String? { try? c.decode(String.self, forKey: key) }
        switch try c.decode(String.self, forKey: .kind) {
        case "command": self = .command(string(.command))
        case "read": self = .read(path: string(.path))
        case "edit": self = .edit(path: string(.path), change: try? c.decode(FileChange.self, forKey: .change))
        case "search": self = .search(pattern: string(.pattern), files: optional(.target) == "files")
        case "web_search": self = .webSearch(string(.query))
        case "web_fetch": self = .webFetch(url: string(.url), prompt: optional(.prompt))
        case "image_view": self = .imageView(path: string(.path))
        case "browser": self = .browser(action: string(.action), target: optional(.target))
        case "mcp": self = .mcp(server: string(.server), tool: string(.tool))
        case "subagent": self = .subagent(description: string(.description), prompt: optional(.prompt), type: optional(.type))
        case "tool_search": self = .toolSearch(string(.query))
        case "skill": self = .skill(string(.name))
        case "todo": self = .todo
        default: self = .other
        }
    }
}

struct InputEntry: Hashable {
    let time: String
    let mode: String
    let text: String
    let attachments: [Attachment]
    let model: String?
    let effort: String?
}

struct ToolCallEntry: Hashable {
    let time: String
    let id: String
    let name: String
    let tool: ToolDetail
    let input: JSONValue?
    let parent: String?
    // 发给页面时省略过长的命令，完整的按调用的位置另外读
    let clipped: Bool
}

struct ToolResultEntry: Hashable {
    let time: String
    let callId: String
    let status: String
    let output: String?
    let truncated: Bool
    let images: [String]
    let parent: String?
    // 发给页面时只留了输出的末尾，完整的按调用的位置另外读
    let clipped: Bool
}

struct TurnEndEntry: Hashable {
    let time: String
    let durationMs: Double
    let outcome: String?
    let error: String?
    let model: String?
    let outputTokens: Int?
    let context: ContextUsage?
}

// 对话里的一条记录
enum Entry: Decodable, Hashable {
    case session(agent: String, time: String)
    case input(InputEntry)
    case thinking(time: String, text: String, durationMs: Double?, parent: String?)
    case text(time: String, text: String, files: [String: String], parent: String?)
    case toolCall(ToolCallEntry)
    case toolResult(ToolResultEntry)
    case compact(time: String, trigger: String, preTokens: Int?, postTokens: Int?, parent: String?)
    case turnEnd(TurnEndEntry)
    case other(time: String)

    private enum Keys: String, CodingKey {
        case type, time, agent, mode, text, attachments, model, effort, durationMs, files, parent, id, name, tool, input
        case callId, status, output, truncated, images, trigger, preTokens, postTokens, outcome, error, outputTokens, context, clipped
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        let time = (try? c.decode(String.self, forKey: .time)) ?? ""
        let parent = try? c.decode(String.self, forKey: .parent)
        let clipped = (try? c.decode(Bool.self, forKey: .clipped)) ?? false
        func string(_ key: Keys) -> String { (try? c.decode(String.self, forKey: key)) ?? "" }
        // 没有类型的也占一条，后面条目的序号才对得上
        switch (try? c.decode(String.self, forKey: .type)) ?? "" {
        case "session":
            self = .session(agent: string(.agent), time: time)
        case "input":
            self = .input(InputEntry(
                time: time, mode: string(.mode), text: string(.text),
                attachments: (try? c.decode(Lossy<Attachment>.self, forKey: .attachments))?.wrappedValue ?? [],
                model: try? c.decode(String.self, forKey: .model), effort: try? c.decode(String.self, forKey: .effort)))
        case "thinking":
            self = .thinking(time: time, text: string(.text), durationMs: try? c.decode(Double.self, forKey: .durationMs), parent: parent)
        case "text":
            self = .text(time: time, text: string(.text), files: (try? c.decode([String: String].self, forKey: .files)) ?? [:], parent: parent)
        case "tool_call":
            self = .toolCall(ToolCallEntry(
                time: time, id: string(.id), name: string(.name),
                tool: (try? c.decode(ToolDetail.self, forKey: .tool)) ?? .other,
                input: try? c.decode(JSONValue.self, forKey: .input), parent: parent, clipped: clipped))
        case "tool_result":
            self = .toolResult(ToolResultEntry(
                time: time, callId: string(.callId), status: string(.status), output: try? c.decode(String.self, forKey: .output),
                truncated: (try? c.decode(Bool.self, forKey: .truncated)) ?? false,
                images: (try? c.decode(Lossy<String>.self, forKey: .images))?.wrappedValue ?? [], parent: parent, clipped: clipped))
        case "compact":
            self = .compact(time: time, trigger: string(.trigger), preTokens: try? c.decode(Int.self, forKey: .preTokens), postTokens: try? c.decode(Int.self, forKey: .postTokens), parent: parent)
        case "turn_end":
            self = .turnEnd(TurnEndEntry(
                time: time, durationMs: (try? c.decode(Double.self, forKey: .durationMs)) ?? 0,
                outcome: try? c.decode(String.self, forKey: .outcome), error: try? c.decode(String.self, forKey: .error),
                model: try? c.decode(String.self, forKey: .model), outputTokens: try? c.decode(Int.self, forKey: .outputTokens),
                context: try? c.decode(ContextUsage.self, forKey: .context)))
        default:
            self = .other(time: time)
        }
    }

    var parent: String? {
        switch self {
        case .thinking(_, _, _, let parent), .text(_, _, _, let parent), .compact(_, _, _, _, let parent): parent
        case .toolCall(let call): call.parent
        case .toolResult(let result): result.parent
        default: nil
        }
    }

    var time: String {
        switch self {
        case .session(_, let time), .thinking(let time, _, _, _), .text(let time, _, _, _), .compact(let time, _, _, _, _), .other(let time): time
        case .input(let input): input.time
        case .toolCall(let call): call.time
        case .toolResult(let result): result.time
        case .turnEnd(let end): end.time
        }
    }
}

// 回答进行中的临时内容
nonisolated struct TaskProgress: Decodable, Hashable {
    let activity: String?
    let toolUses: Int?
    let tokens: Int?
}

nonisolated enum LiveStatus: Decodable, Hashable {
    case requesting, thinking, compacting
    case tool(String)
    case retrying(Int)
    case waiting(Int)
    case other

    private enum Keys: String, CodingKey { case type, name, attempt, tasks }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try? c.decode(String.self, forKey: .type) {
        case "requesting": self = .requesting
        case "thinking": self = .thinking
        case "compacting": self = .compacting
        case "tool": self = .tool((try? c.decode(String.self, forKey: .name)) ?? "")
        case "retrying": self = .retrying((try? c.decode(Int.self, forKey: .attempt)) ?? 1)
        case "waiting": self = .waiting((try? c.decode(Int.self, forKey: .tasks)) ?? 0)
        default: self = .other
        }
    }
}

nonisolated struct Live: Decodable, Hashable {
    var thinking: String
    var text: String
    var status: LiveStatus?
    var tasks: [String: TaskProgress]
    var files: [String: String]

    private enum Keys: String, CodingKey { case thinking, text, status, tasks, files }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        thinking = (try? c.decode(String.self, forKey: .thinking)) ?? ""
        text = (try? c.decode(String.self, forKey: .text)) ?? ""
        status = try? c.decode(LiveStatus.self, forKey: .status)
        tasks = try c.decode(LossyDictionary<TaskProgress>.self, forKey: .tasks).wrappedValue
        files = try c.decode(LossyDictionary<String>.self, forKey: .files).wrappedValue
    }
}

// 发给页面的一条事件：seq 是到它为止的条数
struct PageEvent: Decodable {
    let seq: Int
    let data: Entry
}

// 订阅 session 收到的一条。window：只要最后几轮时最先收到，from 是补发的第一条之前的条数；events：订阅时补发的条目，一次发完
enum KitaSessionEvent: Decodable {
    case window(from: Int, session: Entry)
    case events([PageEvent])
    case event(PageEvent)
    case live(Live?)
    case thinking(String)
    case text(String)
    case status(LiveStatus?)
    case task(callId: String, progress: TaskProgress?)
    case file(path: String, name: String)
    case unknown

    private enum Keys: String, CodingKey { case type, event, events, from, session, live, text, status, callId, progress, path, name }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .type) {
        case "window": self = .window(from: try c.decode(Int.self, forKey: .from), session: try c.decode(Entry.self, forKey: .session))
        case "events": self = .events(try c.decode([PageEvent].self, forKey: .events))
        case "event": self = .event(try c.decode(PageEvent.self, forKey: .event))
        case "live": self = .live(try c.decodeIfPresent(Live.self, forKey: .live))
        case "thinking": self = .thinking(try c.decode(String.self, forKey: .text))
        case "text": self = .text(try c.decode(String.self, forKey: .text))
        case "status": self = .status(try c.decodeIfPresent(LiveStatus.self, forKey: .status))
        case "task": self = .task(callId: try c.decode(String.self, forKey: .callId), progress: try c.decodeIfPresent(TaskProgress.self, forKey: .progress))
        case "file": self = .file(path: try c.decode(String.self, forKey: .path), name: try c.decode(String.self, forKey: .name))
        default: self = .unknown
        }
    }
}

// Code app 的数据

struct Project: Decodable, Hashable, Identifiable {
    let id: String
    @Default<Defaults.Empty> var name: String
    let repository: String?
    let defaultBranch: String?
}

struct Upload: Codable, Hashable {
    let file: String
    let name: String
}

struct QueuedMessage: Decodable, Hashable, Identifiable {
    let id: String
    @Default<Defaults.Empty> var time: String
    @Default<Defaults.Empty> var text: String
    @Lossy var attachments: [Upload]
    let model: String?
    let effort: String?
}

struct PullRequest: Decodable, Hashable {
    let url: String
    let number: Int
    let state: String?
    let title: String?
    let preview: String?
}

struct SessionSummary: Decodable, Hashable, Identifiable {
    let project: String
    let id: Int
    let kitaSession: String
    @Default<Defaults.Empty> var title: String
    @Default<Defaults.Empty> var updatedAt: String
    @Default<Defaults.False> var running: Bool
    @Default<Defaults.False> var waiting: Bool
    @Default<Defaults.False> var unread: Bool
    let outcome: String?
    @Default<Defaults.False> var pinned: Bool
    @Default<Defaults.False> var archived: Bool
    let context: ContextUsage?
    let agent: String
    let model: String?
    let effort: String?
    @Default<Defaults.ZeroInt> var turns: Int
    let tokens: Tokens?
    @Default<Defaults.False> var priced: Bool
    let quota: Double?
    @Lossy var prs: [PullRequest]
    @Lossy var queue: [QueuedMessage]

    var updated: Date { Date(iso: updatedAt) ?? .distantPast }
}

struct SearchResult: Decodable, Hashable {
    let id: Int
    @Default<Defaults.Empty> var title: String
    @Default<Defaults.False> var archived: Bool
    let item: Int?
    @Default<Defaults.Empty> var kind: String
    @Default<Defaults.Empty> var before: String
    @Default<Defaults.Empty> var match: String
    @Default<Defaults.Empty> var after: String
}

struct SearchResponse: Decodable {
    @Lossy var results: [SearchResult]
    @Default<Defaults.ZeroInt> var total: Int
}

struct CodeUsage: Decodable, Hashable {
    let resetsAt: Double
    let week: Double?
}

struct AgentModel: Decodable, Hashable, Identifiable {
    let id: String
    @Default<Defaults.Empty> var name: String
    @Lossy var efforts: [String]
    let isDefault: Bool?
}

struct AgentCatalog: Decodable, Hashable {
    let agent: String
    @Default<Defaults.False> var available: Bool
    @Lossy var models: [AgentModel]
    @Lossy var efforts: [String]
}

struct QuotaWindow: Decodable, Hashable {
    let id: String
    @Default<Defaults.ZeroInt> var minutes: Int
    let label: String?
    @Default<Defaults.Zero> var utilization: Double
    @Default<Defaults.Zero> var resetsAt: Double
}

struct Limits: Decodable, Hashable {
    @Default<Defaults.False> var limited: Bool
    @Lossy var windows: [QuotaWindow]
    @Default<Defaults.Empty> var updatedAt: String
}

struct ClaudeAuth: Decodable, Hashable {
    struct Expiry: Decodable, Hashable {
        let expiresAt: String?
        let broken: Bool?
    }
    @Default<Defaults.Empty> var mode: String
    let login: Expiry?
    let backup: Expiry?
}

struct CodexAuth: Decodable, Hashable {
    @Default<Defaults.False> var loggedIn: Bool
    let broken: Bool?
}

struct AgentAuths: Decodable, Hashable {
    let claude: ClaudeAuth?
    let codex: CodexAuth?
}

struct AgentStatus: Decodable, Hashable {
    @LossyDictionary var limits: [String: Limits]
    let auth: AgentAuths
}

// 新的一轮用哪个 agent、模型和思考程度；没有就是默认的
struct Choice: Hashable {
    var agent: String
    var model: String?
    var effort: String?
}

enum Agents {
    static let names = ["claude": "Claude", "codex": "Codex"]
    static let defaultAgent = "claude"

    static func name(_ agent: String) -> String { names[agent] ?? agent }

    // claude-opus-5-5 → Opus 5.5；gpt-5-codex → GPT-5-Codex
    static func modelName(_ agent: String, _ model: String) -> String {
        if agent == "claude" {
            guard let match = model.wholeMatch(of: /claude-([a-z]+)-(\d+)(?:-(\d+))?.*/) else { return model }
            let family = String(match.1)
            let version = match.3.map { "\(match.2).\($0)" } ?? String(match.2)
            return "\(family.prefix(1).uppercased())\(family.dropFirst()) \(version)"
        }
        if model.hasPrefix("gpt-") {
            return model.split(separator: "-").enumerated().map { index, part in index == 0 ? "GPT" : part.prefix(1).uppercased() + part.dropFirst() }.joined(separator: "-")
        }
        return model
    }

    private static let effortNames = ["minimal": "最低", "low": "低", "medium": "中", "high": "高", "xhigh": "很高", "max": "最高", "ultra": "极高"]
    static func effortName(_ effort: String) -> String { effortNames[effort] ?? effort }
}
