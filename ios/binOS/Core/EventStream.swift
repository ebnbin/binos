import Foundation

nonisolated struct SSEMessage: Sendable {
    var event = "message"
    var data = ""
    var id: String?
}

nonisolated enum SSEEvent: Sendable {
    case open(HTTPURLResponse)
    case message(SSEMessage)
}

// 按 Server-Sent Events 的格式逐行解析。URLSession 的 lines 会丢掉空行，而空行正是一条消息的结尾，所以自己按字节切行
nonisolated func serverSentEvents(_ request: URLRequest, session: URLSession) -> AsyncThrowingStream<SSEEvent, Error> {
    AsyncThrowingStream { continuation in
        let task = Task.detached {
            do {
                let (bytes, response) = try await session.bytes(for: request)
                guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
                continuation.yield(.open(http))
                var line: [UInt8] = []
                var message = SSEMessage()
                func handle(_ raw: [UInt8]) {
                    var text = String(decoding: raw, as: UTF8.self)
                    if text.hasSuffix("\r") { text.removeLast() }
                    if text.isEmpty {
                        if !message.data.isEmpty {
                            if message.data.hasSuffix("\n") { message.data.removeLast() }
                            continuation.yield(.message(message))
                        }
                        message = SSEMessage()
                        return
                    }
                    if text.hasPrefix(":") { return }
                    let field: Substring
                    var value: Substring
                    if let colon = text.firstIndex(of: ":") {
                        field = text[..<colon]
                        value = text[text.index(after: colon)...]
                        if value.hasPrefix(" ") { value = value.dropFirst() }
                    } else {
                        field = Substring(text)
                        value = ""
                    }
                    switch field {
                    case "data": message.data += value + "\n"
                    case "event": message.event = String(value)
                    case "id": message.id = String(value)
                    default: break
                    }
                }
                for try await byte in bytes {
                    if byte == UInt8(ascii: "\n") {
                        handle(line)
                        line.removeAll(keepingCapacity: true)
                    } else {
                        line.append(byte)
                    }
                }
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
        continuation.onTermination = { _ in task.cancel() }
    }
}

// 一条自动重连的 SSE 连接。后端每 15 秒发一次 ping，这么久什么都没收到，说明连接已经断了却没有报错（比如手机切换网络、睡眠后）
@MainActor
final class EventStream {
    private static let silenceLimit: TimeInterval = 45
    private static let retryDelay: Duration = .seconds(1)

    private let url: () -> URL
    private let onOpen: () -> Void
    private let onMessage: (SSEMessage) -> Void
    private let onConnectedChange: (Bool) -> Void
    private var task: Task<Void, Never>?
    private var lastActivity = Date()

    init(url: @escaping () -> URL, onOpen: @escaping () -> Void = {}, onMessage: @escaping (SSEMessage) -> Void, onConnectedChange: @escaping (Bool) -> Void = { _ in }) {
        self.url = url
        self.onOpen = onOpen
        self.onMessage = onMessage
        self.onConnectedChange = onConnectedChange
    }

    func start() {
        task?.cancel()
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.connectOnce()
                if Task.isCancelled { return }
                self.onConnectedChange(false)
                try? await Task.sleep(for: Self.retryDelay)
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    // 回到前台时，超过一次 ping 的间隔没有收到数据，就不等 silenceLimit，立刻重连
    func reconnectIfStale() {
        if task == nil || Date().timeIntervalSince(lastActivity) > 20 {
            start()
        }
    }

    private func connectOnce() async {
        let api = API.shared
        var request = api.request(url())
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 60
        lastActivity = Date()
        let reading = Task { @MainActor [weak self] in
            for try await event in serverSentEvents(request, session: api.session) {
                guard let self else { return }
                self.lastActivity = Date()
                switch event {
                case .open(let response):
                    _ = try api.check(response, data: nil)
                    self.onConnectedChange(true)
                    self.onOpen()
                case .message(let message):
                    if message.event == "message" { self.onMessage(message) }
                }
            }
        }
        let watchdog = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard let self else { return }
                if Date().timeIntervalSince(self.lastActivity) > Self.silenceLimit {
                    reading.cancel()
                    return
                }
            }
        }
        await withTaskCancellationHandler {
            _ = await reading.result
        } onCancel: {
            reading.cancel()
        }
        watchdog.cancel()
        // 需要登录时不要每秒重连，等登录完成后由界面重新连接
        while api.needsLogin && !Task.isCancelled {
            try? await Task.sleep(for: .seconds(1))
        }
    }
}
