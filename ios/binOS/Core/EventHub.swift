import Foundation
import Observation

// /api/events 推送的全局通知
nonisolated struct ChangeEvent: Decodable, Sendable {
    let type: String
    let id: Int?
}

// 整个 app 只连一条全局通知。各类数据有自己的版本号，收到对应的通知时加一，界面用 .task(id:) 跟着重新读取；
// 每次连上时全部加一，表示之前可能漏了通知。session 通知带着对话的 id，Code 的列表按它只更新这一条（见 observeSessions）
@Observable
final class EventHub {
    static let shared = EventHub()

    private(set) var connected = false
    // 连接过但已经断开了：刚启动还没连上时不算
    private(set) var everConnected = false
    private(set) var serverVersion: String?
    // 服务端的接口标识，旧服务端没有
    private(set) var serverProtocol: String?
    // 服务端的接口和这个版本的 app 不一样：可能有部分内容显示不对，不影响使用
    var protocolMismatch: Bool { serverProtocol.map { $0 != BinOSProtocol.protocolID } ?? false }

    // 连上的次数
    private(set) var connections = 0
    private(set) var sessions = 0
    private(set) var projects = 0
    private(set) var apps = 0
    private(set) var agent = 0
    private(set) var music = 0
    private(set) var players = 0
    private(set) var devices = 0
    private(set) var builds = 0
    private(set) var kita = 0
    private(set) var terminal = 0

    private var stream: EventStream?
    @ObservationIgnored private var sessionObservers: [SessionObserver] = []

    private struct SessionObserver {
        weak var owner: AnyObject?
        let handler: (Int) -> Void
    }

    // 收到 session 通知时调用 handler，参数是变了的对话的 id；owner 释放后不再调用
    func observeSessions(_ owner: AnyObject, _ handler: @escaping (Int) -> Void) {
        sessionObservers.append(SessionObserver(owner: owner, handler: handler))
    }

    private init() {}

    func start() {
        stream?.stop()
        let stream = EventStream(
            url: { API.shared.url("/api/events") },
            onOpen: { [weak self] in self?.opened() },
            onMessage: { [weak self] message in self?.received(message) },
            onConnectedChange: { [weak self] connected in
                self?.connected = connected
                if connected { self?.everConnected = true }
            }
        )
        self.stream = stream
        stream.start()
    }

    // 换了服务器或者重新登录后
    func restart() {
        serverVersion = nil
        serverProtocol = nil
        everConnected = false
        start()
    }

    func reconnectIfStale() {
        stream?.reconnectIfStale()
    }

    private func opened() {
        connections += 1
        sessions += 1
        projects += 1
        apps += 1
        agent += 1
        music += 1
        players += 1
        devices += 1
        builds += 1
        kita += 1
        terminal += 1
        Task { await readVersion() }
    }

    private struct Health: Decodable {
        let version: String
        let `protocol`: String?
    }

    // 每次连上都重读：服务端上线新版本后会变
    private func readVersion() async {
        guard let health: Health = try? await API.shared.get("/api/health") else { return }
        serverVersion = health.version
        serverProtocol = health.protocol
    }

    private func received(_ message: SSEMessage) {
        guard let event = try? JSONDecoder.api.decode(ChangeEvent.self, from: Data(message.data.utf8)) else { return }
        switch event.type {
        case "session":
            sessions += 1
            if let id = event.id {
                sessionObservers.removeAll { $0.owner == nil }
                for observer in sessionObservers { observer.handler(id) }
            }
        case "project": projects += 1
        case "apps": apps += 1
        case "agent": agent += 1
        case "music": music += 1
        case "players": players += 1
        case "devices": devices += 1
        case "builds": builds += 1
        case "kita": kita += 1
        case "terminal": terminal += 1
        default: break
        }
    }
}
