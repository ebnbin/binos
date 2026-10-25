import Foundation
import Observation

// /api/events 推送的全局通知
nonisolated struct ChangeEvent: Decodable, Sendable {
    let type: String
    let id: Int?
}

// 整个 app 只连一条全局通知。各类数据有自己的版本号，收到对应的通知时加一，界面用 .task(id:) 跟着重新读取；
// 每次连上时全部加一，表示之前可能漏了通知
@Observable
final class EventHub {
    static let shared = EventHub()

    private(set) var connected = false
    // 连接过但已经断开了：刚启动还没连上时不算
    private(set) var everConnected = false
    private(set) var serverVersion: String?

    private(set) var sessions = 0
    private(set) var projects = 0
    private(set) var apps = 0
    private(set) var agent = 0
    private(set) var music = 0
    private(set) var devices = 0
    private(set) var kita = 0

    private var stream: EventStream?

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
        everConnected = false
        start()
    }

    func reconnectIfStale() {
        stream?.reconnectIfStale()
    }

    private func opened() {
        sessions += 1
        projects += 1
        apps += 1
        agent += 1
        music += 1
        devices += 1
        kita += 1
        Task { await readVersion() }
    }

    private struct Health: Decodable { let version: String }

    private func readVersion() async {
        guard let health: Health = try? await API.shared.get("/api/health") else { return }
        serverVersion = health.version
    }

    private func received(_ message: SSEMessage) {
        guard let event = try? JSONDecoder.api.decode(ChangeEvent.self, from: Data(message.data.utf8)) else { return }
        switch event.type {
        case "session": sessions += 1
        case "project": projects += 1
        case "apps": apps += 1
        case "agent": agent += 1
        case "music": music += 1
        case "devices": devices += 1
        case "kita": kita += 1
        default: break
        }
    }
}
