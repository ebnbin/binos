import Foundation
import Observation

// Code app 的列表数据：session、项目、agent 的模型和额度，随全局通知重新读取
@Observable
final class CodeStore {
    private(set) var sessions: [SessionSummary]?
    private(set) var projects: [Project] = []
    private(set) var catalogs: [AgentCatalog] = []
    private(set) var status: AgentStatus?
    private(set) var failed = false

    private let api = API.shared
    private var latest = 0

    func refreshSessions() async {
        latest += 1
        let request = latest
        do {
            let s: SessionsResponse = try await api.get("/api/apps/code/sessions")
            let p: ProjectsResponse = try await api.get("/api/apps/code/projects")
            guard request == latest else { return }
            self.sessions = s.sessions
            self.projects = p.projects
            failed = false
        } catch {
            if request == latest, !(error is CancellationError) { failed = true }
        }
    }

    func refreshAgents() async {
        if let status: AgentStatus = try? await api.get("/api/kita/status") {
            self.status = status
        }
        if catalogs.isEmpty, let response: CatalogsResponse = try? await api.get("/api/kita/agents") {
            catalogs = response.agents
        }
    }

    func session(_ id: Int) -> SessionSummary? {
        sessions?.first { $0.id == id }
    }

    func projectName(_ id: String) -> String {
        projects.first { $0.id == id }?.name ?? (id == "binos" ? "binOS" : id)
    }

    private struct SessionsResponse: Decodable { @Lossy var sessions: [SessionSummary] }
    private struct ProjectsResponse: Decodable { @Lossy var projects: [Project] }
    private struct CatalogsResponse: Decodable { @Lossy var agents: [AgentCatalog] }
}

// Code app 的写操作
enum CodeAPI {
    private static var api: API { API.shared }

    struct MessageBody: Encodable {
        var project: String?
        var text: String
        var attachments: [Upload]
        var interrupt: Bool?
        var queue: Bool?
        var agent: String?
        var model: String?
        var effort: String?
    }

    struct Sent: Decodable {
        let id: Int
        let kitaSession: String
    }

    // sessionId 为空时新建 session
    static func send(sessionId: Int?, body: MessageBody) async throws -> Sent {
        let path = sessionId.map { "/api/apps/code/sessions/\($0)/messages" } ?? "/api/apps/code/sessions"
        do {
            return try await api.send("POST", path, body: body)
        } catch APIError.http(503, let message) where message.isEmpty || message == "unavailable" {
            throw APIError.http(503, "消息没能交给 agent，稍后再试")
        }
    }

    static let maxUploadBytes = 50 * 1024 * 1024

    static func upload(data: Data, name: String) async throws -> Upload {
        guard data.count <= maxUploadBytes else { throw APIError.http(413, "\(name) 太大，附件最大 50 MB") }
        struct Response: Decodable { let file: String }
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        do {
            let response: Response = try await api.upload("/api/apps/code/uploads", data: data, headers: ["X-File-Name": encoded])
            return Upload(file: response.file, name: name)
        } catch APIError.http(413, _) {
            throw APIError.http(413, "上传 \(name) 失败（文件太大）")
        }
    }

    static func stop(_ id: Int) async {
        try? await api.post("/api/apps/code/sessions/\(id)/stop")
    }

    static func markRead(_ id: Int) async {
        try? await api.post("/api/apps/code/sessions/\(id)/read")
    }

    struct Edit: Encodable {
        var title: String?
        var pinned: Bool?
        var archived: Bool?
    }

    static func edit(_ id: Int, _ edit: Edit) async {
        try? await api.post("/api/apps/code/sessions/\(id)/edit", body: edit)
    }

    // 撤回排队的消息，拿回它的文字；已经发出去了时是 nil
    static func withdraw(_ id: Int, item: String) async -> String? {
        struct Response: Decodable { let text: String }
        let response: Response? = try? await api.send("POST", "/api/apps/code/sessions/\(id)/queue/\(item)/withdraw")
        return response?.text
    }

    static func sendQueued(_ id: Int, item: String) async {
        try? await api.post("/api/apps/code/sessions/\(id)/queue/\(item)/send")
    }

    static func search(_ query: String) async throws -> SearchResponse {
        try await api.get("/api/apps/code/search", query: ["q": query])
    }

    static func usage() async -> CodeUsage? {
        struct Response: Decodable { let usage: CodeUsage? }
        let response: Response? = try? await api.get("/api/apps/code/usage")
        return response?.usage
    }

    struct ProjectBody: Encodable {
        let name: String
        let repository: String
        let create: Bool
    }

    static func createProject(name: String, repository: String, create: Bool) async throws -> Project {
        struct Response: Decodable { let project: Project }
        let response: Response = try await api.send("POST", "/api/apps/code/projects", body: ProjectBody(name: name, repository: repository, create: create))
        return response.project
    }

    static func sessionFileURL(thread: String, file: String) -> URL {
        api.url("/api/kita/sessions/\(thread)/files/\(file)")
    }
}
