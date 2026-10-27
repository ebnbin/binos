import Foundation
import Observation

// Code app 的列表数据：session、项目、agent 的模型和额度，随全局通知重新读取。
// 对话列表在连上时整份读取，之后收到 session 通知只更新那一个对话
@Observable
final class CodeStore {
    private(set) var sessions: [SessionSummary]?
    private(set) var projects: [Project] = []
    private(set) var catalogs: [AgentCatalog] = []
    private(set) var status: AgentStatus?
    private(set) var failed = false
    // 写操作没做成的原因，界面弹出提示
    var actionError: String?

    private let api = API.shared
    // 整份读取的轮次：这期间单个对话的更新以整份读到的为准
    @ObservationIgnored private var latest = 0
    // 同一个对话接连几次通知时只用最后一次读到的
    @ObservationIgnored private var pending: [Int: Int] = [:]

    init() {
        EventHub.shared.observeSessions(self) { [weak self] id in
            Task { await self?.refreshSession(id) }
        }
    }

    func refreshSessions() async {
        latest += 1
        let request = latest
        do {
            let response: SessionsResponse = try await api.get("/api/apps/code/sessions")
            guard request == latest else { return }
            sessions = response.sessions
            failed = false
        } catch {
            if request == latest, !(error is CancellationError) { failed = true }
        }
    }

    func refreshProjects() async {
        if let response: ProjectsResponse = try? await api.get("/api/apps/code/projects") { projects = response.projects }
    }

    func refreshSession(_ id: Int) async {
        let request = latest
        let own = (pending[id] ?? 0) + 1
        pending[id] = own
        let summary: SessionSummary?
        do {
            summary = try await api.get("/api/apps/code/sessions/\(id)")
        } catch APIError.http(404, _, _) {
            summary = nil
        } catch {
            return
        }
        guard request == latest, pending[id] == own else { return }
        apply(id, summary)
    }

    // 按最近有动静的排在前面，和服务端一致
    private func apply(_ id: Int, _ summary: SessionSummary?) {
        guard var list = sessions else { return }
        list.removeAll { $0.id == id }
        if let summary { list.append(summary) }
        sessions = list.sorted { $0.updatedAt > $1.updatedAt }
    }

    struct Edit: Encodable {
        var title: String?
        var pinned: Bool?
        var archived: Bool?
    }

    func edit(_ id: Int, _ edit: Edit) async {
        do {
            let summary: SessionSummary = try await api.send("PATCH", "/api/apps/code/sessions/\(id)", body: edit)
            apply(id, summary)
        } catch {
            actionError = error.localizedDescription
        }
    }

    // 撤回排队的消息，拿回它的文字；已经发出去了时是 nil
    func withdraw(_ id: Int, item: String) async -> String? {
        struct Response: Decodable { let text: String }
        do {
            let response: Response = try await api.send("DELETE", "/api/apps/code/sessions/\(id)/queue/\(item)")
            return response.text
        } catch {
            actionError = error.localizedDescription
            return nil
        }
    }

    func sendQueued(_ id: Int, item: String) async {
        do {
            try await api.post("/api/apps/code/sessions/\(id)/queue/\(item)/send")
        } catch {
            actionError = error.localizedDescription
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
        return try await api.send("POST", path, body: body)
    }

    static let maxUploadBytes = 50 * 1024 * 1024

    static func upload(data: Data, name: String) async throws -> Upload {
        guard data.count <= maxUploadBytes else { throw APIError.http(413, code: nil, message: "\(name) 太大，附件最大 50 MB") }
        struct Response: Decodable { let file: String }
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        let response: Response = try await api.upload("/api/apps/code/uploads", data: data, headers: ["X-File-Name": encoded])
        return Upload(file: response.file, name: name)
    }

    static func stop(_ id: Int) async {
        try? await api.post("/api/apps/code/sessions/\(id)/stop")
    }

    static func markRead(_ id: Int) async {
        try? await api.post("/api/apps/code/sessions/\(id)/read")
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
