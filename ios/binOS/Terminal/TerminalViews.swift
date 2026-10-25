import SwiftTerm
import SwiftUI

struct TerminalSession: Decodable, Hashable, Identifiable {
    let id: String
    @Default<Defaults.Zero> var created: Double
    @Default<Defaults.Empty> var cwd: String
    @Default<Defaults.Empty> var command: String
}

enum TerminalAPI {
    static let base = "/api/apps/terminal"

    struct List: Decodable {
        @Default<Defaults.False> var available: Bool
        @Lossy var sessions: [TerminalSession]
    }

    static func list() async throws -> List {
        try await API.shared.get(base)
    }

    static func create() async throws -> TerminalSession {
        try await API.shared.send("POST", "\(base)/sessions")
    }

    static func close(_ id: String) async throws {
        let _: Ignored = try await API.shared.send("DELETE", "\(base)/sessions/\(id)")
    }
}

// 终端：宿主 Mac 上的 tmux 会话，断开后会话还在，下次接着用
struct TerminalRootView: View {
    @State private var list: TerminalAPI.List?
    @State private var path: [TerminalSession] = []
    @State private var error: String?
    @State private var creating = false
    @Bindable private var router = AppRouter.shared

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let list, !list.available {
                    Text("宿主 Mac 尚未安装 tmux").foregroundStyle(.secondary)
                }
                ForEach(list?.sessions ?? []) { session in
                    NavigationLink(value: session) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text((session.cwd as NSString).abbreviatingWithTildeInPath)
                                .font(.body.monospaced())
                                .lineLimit(1)
                                .truncationMode(.head)
                            Text(Date(timeIntervalSince1970: session.created / 1000), format: .relative(presentation: .named))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions {
                        Button("结束", systemImage: "xmark", role: .destructive) {
                            Task { await close(session) }
                        }
                    }
                    .contextMenu {
                        Button("复制 tmux 连接命令", systemImage: "doc.on.doc") { UIPasteboard.general.string = session.command }
                        Button("结束会话", systemImage: "xmark", role: .destructive) { Task { await close(session) } }
                    }
                }
                if let error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
            }
            .overlay {
                if list == nil {
                    ProgressView()
                } else if list?.sessions.isEmpty == true {
                    ContentUnavailableView {
                        Label("没有终端", systemImage: "apple.terminal")
                    } actions: {
                        Button("新建终端") { Task { await create() } }.buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("终端")
            .navigationDestination(for: TerminalSession.self) { session in
                TerminalScreen(session: session)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("新建终端", systemImage: "plus") { Task { await create() } }
                        .disabled(creating || list?.available == false)
                }
            }
            .refreshable { await load() }
            .onChange(of: router.terminal) { Task { await load() } }
            .task {
                // 列表没有推送，每 5 秒读一次
                while !Task.isCancelled {
                    await load()
                    try? await Task.sleep(for: .seconds(5))
                }
            }
        }
    }

    private func load() async {
        do {
            let loaded = try await TerminalAPI.list()
            list = loaded
            error = nil
            if let target = router.terminal, let session = loaded.sessions.first(where: { $0.id == target }) {
                router.terminal = nil
                path = [session]
            }
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func create() async {
        creating = true
        defer { creating = false }
        do {
            let session = try await TerminalAPI.create()
            await load()
            path = [session]
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func close(_ session: TerminalSession) async {
        try? await TerminalAPI.close(session.id)
        await load()
    }
}

struct TerminalScreen: View {
    let session: TerminalSession
    @State private var connection = TerminalConnection()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        TerminalHost(connection: connection)
            .background(Color.black)
            .ignoresSafeArea(.container, edges: .bottom)
            .navigationTitle(connection.title.isEmpty ? (session.cwd as NSString).lastPathComponent : connection.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar(.hidden, for: .tabBar)
            .toolbar {
                ToolbarItem(placement: .status) {
                    switch connection.state {
                    case .connecting: Label("正在连接", systemImage: "circle.dotted").labelStyle(.titleOnly).font(.caption)
                    case .reconnecting: Label("正在重连…", systemImage: "arrow.clockwise").font(.caption)
                    case .exited: Label("会话已结束", systemImage: "xmark.circle").font(.caption)
                    case .failed(let message): Text(message).font(.caption).foregroundStyle(.red)
                    case .connected: EmptyView()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("重新连接", systemImage: "arrow.clockwise") { connection.connect(session.id) }
                        Button("粘贴", systemImage: "doc.on.clipboard") {
                            if let text = UIPasteboard.general.string { connection.send(text) }
                        }
                        Button("结束会话", systemImage: "xmark", role: .destructive) {
                            Task {
                                try? await TerminalAPI.close(session.id)
                                dismiss()
                            }
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                }
            }
            .onAppear { connection.connect(session.id) }
            .onDisappear { connection.disconnect() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, connection.state != .connected, connection.state != .exited { connection.connect(session.id) }
            }
    }
}

private struct TerminalHost: UIViewRepresentable {
    let connection: TerminalConnection

    func makeUIView(context: Context) -> TerminalView {
        let view = TerminalView(frame: .zero)
        view.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        view.nativeBackgroundColor = .black
        view.nativeForegroundColor = UIColor(white: 0.92, alpha: 1)
        view.terminalDelegate = connection
        connection.view = view
        DispatchQueue.main.async { _ = view.becomeFirstResponder() }
        return view
    }

    func updateUIView(_ view: TerminalView, context: Context) {}
}

// 一条到 tmux 会话的 WebSocket 连接：输出写进终端，按收到的长度回 ack，服务端据此控制输出的速度
@Observable
final class TerminalConnection: NSObject, TerminalViewDelegate {
    enum State: Equatable {
        case connecting, connected, reconnecting, exited
        case failed(String)
    }

    private(set) var state = State.connecting
    private(set) var title = ""
    @ObservationIgnored weak var view: TerminalView?
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var sessionId: String?
    @ObservationIgnored private var unacked = 0
    @ObservationIgnored private var ackTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var ready = false

    func connect(_ id: String) {
        sessionId = id
        generation += 1
        let current = generation
        task?.cancel(with: .goingAway, reason: nil)
        ready = false
        unacked = 0
        if state != .connected { state = state == .connecting ? .connecting : .reconnecting }
        let api = API.shared
        var request = api.request(api.webSocketURL("\(TerminalAPI.base)/sessions/\(id)/socket"))
        // 服务端要求 Origin 和 Host 一致
        request.setValue(api.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        let task = api.session.webSocketTask(with: request)
        task.maximumMessageSize = 4 * 1024 * 1024
        self.task = task
        task.resume()
        Task { await receive(task, generation: current) }
    }

    func disconnect() {
        generation += 1
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func receive(_ task: URLSessionWebSocketTask, generation current: Int) async {
        do {
            while true {
                let message = try await task.receive()
                guard current == generation else { return }
                guard case .string(let text) = message, let data = text.data(using: .utf8),
                      let parsed = try? JSONDecoder.api.decode(ServerMessage.self, from: data) else { continue }
                handle(parsed)
            }
        } catch {
            guard current == generation, state != .exited else { return }
            if case .failed = state { return }
            state = .reconnecting
            try? await Task.sleep(for: .seconds(2))
            if current == generation, let sessionId { connect(sessionId) }
        }
    }

    private struct ServerMessage: Decodable {
        let type: String
        let data: String?
        let message: String?
    }

    private func handle(_ message: ServerMessage) {
        switch message.type {
        case "ready":
            ready = true
            unacked = 0
            state = .connected
            view?.getTerminal().resetToInitialState()
            if let terminal = view?.getTerminal() {
                sendJSON(["type": "resize", "cols": terminal.cols, "rows": terminal.rows])
            }
        case "output":
            guard let data = message.data else { return }
            view?.feed(text: data)
            unacked += data.utf16.count
            scheduleAck()
        case "ping":
            sendJSON(["type": "ping"])
        case "exit":
            state = .exited
            generation += 1
            task?.cancel(with: .normalClosure, reason: nil)
        case "error":
            state = .failed(message.message ?? "连接失败")
            generation += 1
        default:
            break
        }
    }

    // 攒够 32K 立刻回，否则 20 毫秒后回
    private func scheduleAck() {
        guard ready else { return }
        if unacked >= 32768 {
            flushAck()
            return
        }
        ackTask?.cancel()
        ackTask = Task {
            try? await Task.sleep(for: .milliseconds(20))
            if !Task.isCancelled { flushAck() }
        }
    }

    private func flushAck() {
        ackTask?.cancel()
        guard unacked > 0 else { return }
        var remaining = unacked
        unacked = 0
        while remaining > 0 {
            let size = min(remaining, 1_048_576)
            sendJSON(["type": "ack", "size": size])
            remaining -= size
        }
    }

    func send(_ text: String) {
        var rest = Substring(text)
        while !rest.isEmpty {
            let chunk = rest.prefix(8192)
            sendJSON(["type": "input", "data": String(chunk)])
            rest = rest.dropFirst(chunk.count)
        }
    }

    private func sendJSON(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { _ in }
    }

    // MARK: TerminalViewDelegate

    nonisolated func send(source: TerminalView, data: ArraySlice<UInt8>) {
        let text = String(decoding: data, as: UTF8.self)
        // 窗口像素尺寸的查询回复晚到时会被 tmux 当成键盘输入，不转发
        if text.wholeMatch(of: /\e\[\d+;\d+;\d+t/) != nil { return }
        Task { @MainActor in self.send(text) }
    }

    nonisolated func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
        Task { @MainActor in
            guard self.ready else { return }
            self.sendJSON(["type": "resize", "cols": min(max(newCols, 2), 500), "rows": min(max(newRows, 1), 200)])
        }
    }

    nonisolated func setTerminalTitle(source: TerminalView, title: String) {
        Task { @MainActor in self.title = title }
    }

    nonisolated func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
    nonisolated func scrolled(source: TerminalView, position: Double) {}
    nonisolated func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
        if let url = URL(string: link) {
            Task { @MainActor in UIApplication.shared.open(url) }
        }
    }
    nonisolated func bell(source: TerminalView) {}
    nonisolated func clipboardCopy(source: TerminalView, content: Data) {
        if let text = String(data: content, encoding: .utf8) {
            Task { @MainActor in UIPasteboard.general.string = text }
        }
    }
    nonisolated func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
    nonisolated func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}
