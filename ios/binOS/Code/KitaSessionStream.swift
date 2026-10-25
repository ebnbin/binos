import Foundation
import Observation

// 一个 thread 的内容，随推送更新。events 是连续的一段事件，第一条的 seq 大于 1 时前面还有更早的，由 loadOlder 往前补读；
// live 是回答进行中的临时内容，nil 表示没在回答
@Observable
final class KitaSessionStream {
    private(set) var events: [PageEvent] = []
    private(set) var live: Live?
    // 事件或回答状态变了才加一，界面据此重算对话的分块；临时文字的变化不影响它
    private(set) var revision = 0
    // 收到过内容（或者有缓存）之后才排版，初始位置才能直接落在底部
    private(set) var loaded = false
    private(set) var loadingOlder = false
    // 刚在前面补上了更早的事件，界面这时按底部对齐滚动位置
    private(set) var prepending = false
    @ObservationIgnored private var prependings = 0

    let thread: String
    @ObservationIgnored private var stream: EventStream?
    // 收到的最后一条的 seq，重连时从它之后接着补发；还没收到过时是 nil，连接时只要最后几轮
    @ObservationIgnored private var last: Int?

    // 打开时先读最后至少这么多条，往上翻时每次再读这么多
    static let pageSize = 300

    // 最近打开过的几个 thread 的内容：再打开时先显示它，再从它之后接着补发
    private static var cache: [String: [PageEvent]] = [:]
    private static var recent: [String] = []
    private static let cacheSize = 10

    var firstSeq: Int? { events.first?.seq }
    var hasOlder: Bool { (firstSeq ?? 1) > 1 }

    init(thread: String) {
        self.thread = thread
        if let cached = Self.cache[thread] {
            events = cached
            last = cached.last?.seq
            loaded = true
        }
    }

    // 订阅跟着对象走，不跟界面的出现和消失：导航切换时界面会消失了又没再出现，却还显示着
    isolated deinit {
        stop()
    }

    func start() {
        guard stream == nil else { return }
        let stream = EventStream(
            url: { [weak self] in
                let thread = self?.thread ?? ""
                let query = self?.last.map { ["from": String($0)] } ?? ["tail": String(Self.pageSize)]
                return API.shared.url("/api/kita/sessions/\(thread)/stream", query: query)
            },
            onMessage: { [weak self] message in self?.receive(message) }
        )
        self.stream = stream
        stream.start()
    }

    func stop() {
        stream?.stop()
        stream = nil
        remember()
    }

    func reconnectIfStale() {
        stream?.reconnectIfStale()
    }

    private func remember() {
        guard last != nil else { return }
        Self.cache[thread] = events
        Self.recent.removeAll { $0 == thread }
        Self.recent.append(thread)
        if Self.recent.count > Self.cacheSize { Self.cache[Self.recent.removeFirst()] = nil }
    }

    private func receive(_ message: SSEMessage) {
        guard let event = try? JSONDecoder.api.decode(KitaSessionEvent.self, from: Data(message.data.utf8)) else { return }
        switch event {
        case .window(let window):
            // 重新给出最后几轮，之前收到的都不要了
            events = window
            live = nil
            last = window.last?.seq
            revision += 1
        case .events(let events):
            append(events)
        case .event(let event):
            append([event])
        case .live(let value):
            let toggled = (live == nil) != (value == nil)
            live = value
            if !loaded || toggled { revision += 1 }
            loaded = true
        case .thinking(let text):
            live?.thinking += text
        case .text(let text):
            live?.text += text
        case .status(let status):
            live?.status = status
        case .task(let callId, let progress):
            live?.tasks[callId] = progress
        case .file(let path, let name):
            live?.files[path] = name
        case .unknown:
            break
        }
    }

    private func append(_ added: [PageEvent]) {
        guard let last, let first = added.first, first.seq == last + 1 else { return }
        self.last = added.last?.seq
        events.append(contentsOf: added)
        // 记成条目的思考和文字取代对应的临时内容
        for event in added where event.parentId == nil {
            switch event.data {
            case .text:
                live?.text = ""
                live?.files = [:]
            case .thinking:
                live?.thinking = ""
            default: break
            }
        }
        revision += 1
    }

    // 往前补读更早的轮；给出 until 时一直读到包含这个 seq
    func loadOlder(until: Int? = nil) async {
        guard let first = firstSeq, first > 1, !loadingOlder else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        struct Response: Decodable { let events: [PageEvent] }
        let limit = max(Self.pageSize, first - (until ?? first))
        guard let response: Response = try? await API.shared.get(
            "/api/kita/sessions/\(thread)/events", query: ["before": String(first), "limit": String(limit)]),
            response.events.last?.seq == first - 1,
            // 这期间重新给出过最后几轮时位置对不上，不接
            firstSeq == first
        else { return }
        events.insert(contentsOf: response.events, at: 0)
        revision += 1
        // 接着往前读的下一段不用等这段排版完
        prependings += 1
        let current = prependings
        prepending = true
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            if current == prependings { prepending = false }
        }
    }

    // seq 处的工具调用和它的结果，完整的；读不到时是 nil
    static func fullCall(thread: String, seq: Int) async -> (call: ToolCallEntry, result: ToolResultEntry?)? {
        struct Response: Decodable {
            let call: PageEvent
            let result: PageEvent?
        }
        guard let response: Response = try? await API.shared.get("/api/kita/sessions/\(thread)/calls/\(seq)"),
              case .toolCall(let call) = response.call.data else { return nil }
        if case .toolResult(let result) = response.result?.data { return (call, result) }
        return (call, nil)
    }
}
