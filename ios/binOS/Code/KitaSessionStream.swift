import Foundation
import Observation

// 一个 thread 的内容，随推送更新。items 是从 offset 开始的连续条目，offset 大于 0 时前面还有更早的，由 loadOlder 往前补读；
// live 是回答进行中的临时内容，nil 表示没在回答
@Observable
final class KitaSessionStream {
    private(set) var items: [Entry] = []
    private(set) var offset = 0
    private(set) var live: Live?
    // 条目或回答状态变了才加一，界面据此重算对话的分块；临时文字的变化不影响它
    private(set) var revision = 0
    // 收到过内容（或者有缓存）之后才排版，初始位置才能直接落在底部
    private(set) var loaded = false
    private(set) var loadingOlder = false
    // 刚在前面补上了更早的条目，界面这时按底部对齐滚动位置
    private(set) var prepending = false
    // 第一条条目（session），只读最后几轮时由 window 带来
    private var head: Entry?

    let thread: String
    @ObservationIgnored private var stream: EventStream?
    // 已收到的条数；还没收到过时是 nil，连接时只要最后几轮
    @ObservationIgnored private var count: Int?

    // 打开时先读最后至少这么多条，往上翻时每次再读这么多
    static let pageSize = 300

    // 最近打开过的几个 thread 的内容：再打开时先显示它，再从它之后接着补发
    private static var cache: [String: Snapshot] = [:]
    private static var recent: [String] = []
    private static let cacheSize = 10

    private struct Snapshot {
        let items: [Entry]
        let offset: Int
        let head: Entry?
    }

    init(thread: String) {
        self.thread = thread
        if let cached = Self.cache[thread] {
            items = cached.items
            offset = cached.offset
            head = cached.head
            count = cached.offset + cached.items.count
            loaded = true
        }
    }

    func start() {
        guard stream == nil else { return }
        let stream = EventStream(
            url: { [weak self] in
                let thread = self?.thread ?? ""
                let query = self?.count.map { ["from": String($0)] } ?? ["tail": String(Self.pageSize)]
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
        guard count != nil else { return }
        Self.cache[thread] = Snapshot(items: items, offset: offset, head: head)
        Self.recent.removeAll { $0 == thread }
        Self.recent.append(thread)
        if Self.recent.count > Self.cacheSize { Self.cache[Self.recent.removeFirst()] = nil }
    }

    private func receive(_ message: SSEMessage) {
        guard let event = try? JSONDecoder.api.decode(KitaSessionEvent.self, from: Data(message.data.utf8)) else { return }
        switch event {
        case .window(let from, let session):
            // 从头补发，之前收到的都不要了
            items = []
            offset = from
            head = session
            live = nil
            count = from
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

    private func append(_ events: [PageEvent]) {
        guard let count, let first = events.first, first.seq == count + 1 else { return }
        self.count = count + events.count
        items.append(contentsOf: events.map(\.data))
        // 记成条目的思考和文字取代对应的临时内容
        for event in events where event.data.parent == nil {
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

    // 往前补读更早的轮；给出 until 时一直读到包含它
    func loadOlder(until: Int? = nil) async {
        guard offset > 0, !loadingOlder else { return }
        let before = offset
        loadingOlder = true
        defer { loadingOlder = false }
        struct Response: Decodable { let events: [PageEvent] }
        let limit = max(Self.pageSize, before - (until ?? before))
        guard let response: Response = try? await API.shared.get(
            "/api/kita/sessions/\(thread)/events", query: ["before": String(before), "limit": String(limit)]),
            let first = response.events.first, response.events.last?.seq == before,
            // 这期间重新补发过时位置对不上，不接
            offset == before
        else { return }
        prepending = true
        items.insert(contentsOf: response.events.map(\.data), at: 0)
        offset = first.seq - 1
        revision += 1
        try? await Task.sleep(for: .milliseconds(500))
        prepending = false
    }

    var agent: String? {
        if case .session(let agent, _) = head ?? (offset == 0 ? items.first : nil) { return agent }
        return nil
    }

    // index 处的工具调用和它的结果，完整的；读不到时是 nil
    static func fullCall(thread: String, index: Int) async -> (call: ToolCallEntry, result: ToolResultEntry?)? {
        struct Response: Decodable {
            let call: Entry
            let result: Entry?
        }
        guard let response: Response = try? await API.shared.get("/api/kita/sessions/\(thread)/calls/\(index)"),
              case .toolCall(let call) = response.call else { return nil }
        if case .toolResult(let result) = response.result { return (call, result) }
        return (call, nil)
    }
}
