import Foundation
import Observation

// 与 server/src/services/kita/types.ts、server/src/apps/kita/types.ts 对应

// 喜多 app 里的一段对话。temporary：临时对话，不带喜多的身份，也读写不了记忆
struct KitaConversation: Decodable, Hashable, Identifiable {
    let id: String
    let title: String
    let temporary: Bool
    let agent: String
    let state: String
    let createdAt: String
    let updatedAt: String
    let outcome: String?

    var updated: Date { Date(iso: updatedAt) ?? .distantPast }
}

struct KitaPhoto: Decodable, Hashable {
    let file: String
    let addedAt: String
}

struct KitaProfile: Decodable, Hashable {
    let description: String
    let photos: [KitaPhoto]
    let avatar: String?
}

// 谁写的：用户在页面上，或者某个 app 的 session 里的 agent
struct MemorySource: Decodable, Hashable {
    let type: String
    let owner: String?
    let session: String?
}

struct Memory: Decodable, Hashable, Identifiable {
    struct Version: Decodable, Hashable {
        let text: String
        let kind: String
        let time: String
        let source: MemorySource
    }

    let id: String
    let text: String
    // stated：用户说过或确认过的；inferred：agent 推测的，用户确认前不能当作事实
    let kind: String
    let scope: String
    let source: MemorySource
    let createdAt: String
    let updatedAt: String
    // 改动前的各个版本，从旧到新
    let history: [Version]
}

// 正在回答的 session，不在回答的不在里面
struct KitaActivity: Decodable, Hashable {
    let session: String
    let owner: String
    let state: String
    let since: String
}

// 喜多 app 用到的全部数据，有变化时重新读取；Code 的对话开始、结束时 activity 也会变
@Observable
final class KitaStore {
    static let shared = KitaStore()

    private(set) var conversations: [KitaConversation]?
    private(set) var profile: KitaProfile?
    private(set) var memories: [Memory]?
    private(set) var activity: [KitaActivity] = []
    private(set) var catalogs: [AgentCatalog] = []
    private(set) var failed = false
    private var latest = 0

    private init() {}

    func refresh() async {
        latest += 1
        let request = latest
        struct Conversations: Decodable { let conversations: [KitaConversation] }
        struct Profile: Decodable { let profile: KitaProfile }
        struct Memories: Decodable { let memories: [Memory] }
        struct Activity: Decodable { let activity: [KitaActivity] }
        do {
            let conversations: Conversations = try await API.shared.get("/api/apps/kita/conversations")
            let profile: Profile = try await API.shared.get("/api/kita/profile")
            let memories: Memories = try await API.shared.get("/api/kita/memories")
            let activity: Activity? = try? await API.shared.get("/api/kita/activity")
            guard request == latest else { return }
            self.conversations = conversations.conversations
            self.profile = profile.profile
            self.memories = memories.memories
            self.activity = activity?.activity ?? []
            failed = false
        } catch {
            if request == latest, !(error is CancellationError) { failed = true }
        }
        if catalogs.isEmpty {
            struct Catalogs: Decodable { let agents: [AgentCatalog] }
            if let response: Catalogs = try? await API.shared.get("/api/kita/agents") { catalogs = response.agents }
        }
    }

    func conversation(_ id: String) -> KitaConversation? {
        conversations?.first { $0.id == id }
    }

    // 带身份的对话会想起的记忆条数
    var personalMemories: Int { memories?.count { $0.scope == "personal" } ?? 0 }

    // 喜多现在在做什么，按各个 app 里真实在回答的 session 说
    var status: (busy: Bool, label: String) {
        guard !activity.isEmpty else { return (false, "空闲") }
        var owners: [String] = []
        var counts: [String: Int] = [:]
        for item in activity {
            if counts[item.owner] == nil { owners.append(item.owner) }
            counts[item.owner, default: 0] += 1
        }
        let parts = owners.map { owner in
            let name = KitaAPI.appName(owner)
            return counts[owner]! > 1 ? "\(name)（\(counts[owner]!)）" : name
        }
        return (true, "回答中：\(parts.joined(separator: "、"))")
    }
}

// 喜多的写操作
enum KitaAPI {
    private static var api: API { API.shared }

    // 内置 app 的名字，和网页的 apps/builtins.ts 一致
    private static let appNames = ["code": "Code", "kita": "喜多", "music": "音乐", "browser": "浏览器", "terminal": "终端", "files": "文件", "calendar": "日历", "system": "系统", "builds": "构建", "devices": "设备"]
    static func appName(_ id: String) -> String { appNames[id] ?? id }

    static func photoURL(_ file: String) -> URL { api.url("/api/kita/profile/photos/\(file)") }

    struct MessageBody: Encodable {
        let text: String
        var temporary: Bool?
        var agent: String?
    }

    private static func unavailable(_ error: Error) -> Error {
        if case APIError.http(503, _) = error { return APIError.http(503, "消息没能发出，稍后再试") }
        return error
    }

    // 新对话，返回它的 id
    static func start(text: String, temporary: Bool, agent: String) async throws -> String {
        struct Response: Decodable { let id: String }
        do {
            let response: Response = try await api.send("POST", "/api/apps/kita/conversations", body: MessageBody(text: text, temporary: temporary, agent: agent))
            return response.id
        } catch {
            throw unavailable(error)
        }
    }

    // 正在回答时交给 agent，它在下一步看到
    static func send(_ id: String, text: String) async throws {
        do {
            try await api.post("/api/apps/kita/conversations/\(id)/messages", body: MessageBody(text: text))
        } catch {
            throw unavailable(error)
        }
    }

    static func stop(_ id: String) async {
        try? await api.post("/api/apps/kita/conversations/\(id)/stop")
    }

    // 只能删没在回答的
    static func delete(_ id: String) async throws {
        do {
            try await api.post("/api/apps/kita/conversations/\(id)/delete")
        } catch APIError.http(409, _) {
            throw APIError.http(409, "正在回答，停止后才能删除")
        }
    }

    static func saveDescription(_ description: String) async throws {
        struct Body: Encodable { let description: String }
        try await api.post("/api/kita/profile/description", body: Body(description: description))
    }

    // 请求体就是照片本身，原来的文件名 URL 编码后放在 X-File-Name 里
    static func upload(_ data: Data, name: String) async throws {
        struct Response: Decodable { let file: String }
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        let _: Response = try await api.upload("/api/kita/profile/photos", data: data, headers: ["X-File-Name": encoded])
    }

    static func removePhoto(_ file: String) async throws {
        try await api.post("/api/kita/profile/photos/\(file)/delete")
    }

    static func setAvatar(_ file: String) async throws {
        try await api.post("/api/kita/profile/photos/\(file)/avatar")
    }

    struct NewMemory: Encodable {
        let text: String
        let kind: String
        let scope: String
    }

    static func addMemory(_ memory: NewMemory) async throws {
        try await api.post("/api/kita/memories", body: memory)
    }

    struct MemoryChange: Encodable {
        var text: String?
        var kind: String?
    }

    static func updateMemory(_ id: String, _ change: MemoryChange) async throws {
        try await api.post("/api/kita/memories/\(id)", body: change)
    }

    static func removeMemory(_ id: String) async throws {
        try await api.post("/api/kita/memories/\(id)/delete")
    }

    // 恢复上一个版本
    static func revertMemory(_ id: String) async throws {
        do {
            try await api.post("/api/kita/memories/\(id)/revert")
        } catch APIError.http(409, _) {
            throw APIError.http(409, "没有可以恢复的版本")
        }
    }
}
