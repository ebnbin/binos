import Foundation

// 把对话的事件整理成显示的块，规则和网页的 Transcript 一致

// seq：调用事件的位置；itemId：调用和结果共用的；live：这一轮还在回答，没有结果的调用还在运行
struct CallState: Hashable, Identifiable {
    let seq: Int
    let itemId: String
    let call: ToolCallEntry
    let result: ToolResultEntry?
    let live: Bool
    var id: Int { seq }

    enum Status { case running, done, error, stopped }

    var status: Status {
        if let result { return result.status == "error" ? .error : .done }
        return live ? .running : .stopped
    }

    func duration(now: Date) -> TimeInterval? {
        guard let start = Date(iso: call.time) else { return nil }
        if let result, let end = Date(iso: result.time) { return end.timeIntervalSince(start) }
        return live ? max(now.timeIntervalSince(start), 0) : nil
    }
}

enum Step: Hashable, Identifiable {
    case thinking(seq: Int, time: String, text: String, durationMs: Double?)
    case tool(CallState)
    case subagent(CallState)

    var id: Int {
        switch self {
        case .thinking(let seq, _, _, _): seq
        case .tool(let state), .subagent(let state): state.seq
        }
    }

    var state: CallState? {
        switch self {
        case .thinking: nil
        case .tool(let state), .subagent(let state): state
        }
    }
}

// 块的 seq 是它对应的事件的位置，搜索结果按它定位
enum Block: Hashable, Identifiable {
    case time(seq: Int, date: Date)
    case input(seq: Int, entry: InputEntry)
    case attachments(seq: Int, attachments: [Attachment])
    case text(seq: Int, text: String, files: [String: String])
    case steps(seq: Int, steps: [Step])
    case divider(seq: Int, text: String)
    case turnEnd(seq: Int, entry: TurnEndEntry, reply: String, edits: [CallState])

    var id: String {
        switch self {
        case .time(let seq, _): "\(seq)-time"
        case .input(let seq, _): "\(seq)"
        case .attachments(let seq, _): "\(seq)-attachments"
        case .text(let seq, _, _): "\(seq)"
        case .steps(let seq, _): "\(seq)-steps"
        case .divider(let seq, _): "\(seq)-divider"
        case .turnEnd(let seq, _, _, _): "\(seq)"
        }
    }
}

// 一轮：turnId 相同的连续事件，第一条 session 条目自成一组（id 为空串）。
// 工具调用和结果按 itemId 对应，子 agent 的条目按 parentId 归到它所属的调用下
final class TranscriptTurn {
    let id: String
    let first: PageEvent
    let size: Int
    private(set) var results: [String: ToolResultEntry] = [:]
    private(set) var children: [String: [PageEvent]] = [:]
    private(set) var main: [PageEvent] = []
    // 答完的轮的块不会再变，算过就记下来
    private var settled: (previous: String?, blocks: [Block])?

    init(_ events: ArraySlice<PageEvent>) {
        first = events.first!
        id = first.turnId ?? ""
        size = events.count
        for event in events {
            if case .toolResult(let result) = event.data, let itemId = event.itemId {
                results[itemId] = result
            }
            if let parent = event.parentId {
                children[parent, default: []].append(event)
            } else {
                main.append(event)
            }
        }
    }

    // 事件只会在两头增加：和 previous 里同一段事件的轮沿用原来的对象，界面上这些轮可以跳过重新排版
    static func split(_ events: [PageEvent], previous: [TranscriptTurn] = []) -> [TranscriptTurn] {
        let reusable = Dictionary(previous.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var turns: [TranscriptTurn] = []
        var start = events.startIndex
        while start < events.endIndex {
            var end = start + 1
            while end < events.endIndex, events[end].turnId == events[start].turnId { end += 1 }
            if let old = reusable[events[start].turnId ?? ""], old.size == end - start, old.first == events[start] {
                turns.append(old)
            } else {
                turns.append(TranscriptTurn(events[start..<end]))
            }
            start = end
        }
        return turns
    }

    // 这一轮的块；previous 是上一轮最后一条的时间
    func blocks(live: Bool, previous: String?) -> [Block] {
        if !live, let settled, settled.previous == previous { return settled.blocks }
        let blocks = blocks(main, live: live, previous: previous)
        if !live { settled = (previous, blocks) }
        return blocks
    }

    func state(_ event: PageEvent, _ call: ToolCallEntry, live: Bool) -> CallState {
        let itemId = event.itemId ?? ""
        return CallState(seq: event.seq, itemId: itemId, call: call, result: results[itemId], live: live)
    }

    // 这次调用改了文件就是它自己；是子 agent 时，是子 agent 里改文件的调用
    func editCalls(_ state: CallState) -> [CallState] {
        if case .edit = state.call.tool { return [state] }
        return (children[state.itemId] ?? []).flatMap { event -> [CallState] in
            guard case .toolCall(let call) = event.data else { return [] }
            return editCalls(self.state(event, call, live: state.live))
        }
    }

    // 一轮开始时离上一条超过这么久或者跨了天，先显示一条时间
    private static let dividerGap: TimeInterval = 30 * 60

    func blocks(_ events: [PageEvent], live: Bool, previous: String? = nil) -> [Block] {
        var blocks: [Block] = []
        var replies: [String] = []
        var edits: [CallState] = []
        var lastTime = previous.flatMap(Date.init(iso:))
        func addStep(_ step: Step, at seq: Int) {
            if case .steps(let first, var steps) = blocks.last {
                steps.append(step)
                blocks[blocks.count - 1] = .steps(seq: first, steps: steps)
            } else {
                blocks.append(.steps(seq: seq, steps: [step]))
            }
        }
        for event in events {
            let seq = event.seq
            let previous = lastTime
            let time = Date(iso: event.data.time)
            if let time { lastTime = time }
            switch event.data {
            case .input(let input):
                if input.mode == "start" {
                    replies = []
                    edits = []
                    if let time, previous == nil || time.timeIntervalSince(previous!) > Self.dividerGap || !Calendar.current.isDate(time, inSameDayAs: previous!) {
                        blocks.append(.time(seq: seq, date: time))
                    }
                }
                if input.mode == "interrupt" {
                    blocks.append(.divider(seq: seq, text: "已打断"))
                }
                if !input.attachments.isEmpty {
                    blocks.append(.attachments(seq: seq, attachments: input.attachments))
                }
                if !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    blocks.append(.input(seq: seq, entry: input))
                }
            case .thinking(let time, let text, let durationMs):
                addStep(.thinking(seq: seq, time: time, text: text, durationMs: durationMs), at: seq)
            case .text(_, let text, let files):
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    replies.append(text)
                    blocks.append(.text(seq: seq, text: text, files: files))
                }
            case .toolCall(let call):
                let state = state(event, call, live: live)
                edits.append(contentsOf: editCalls(state))
                if case .subagent = call.tool {
                    addStep(.subagent(state), at: seq)
                } else {
                    addStep(.tool(state), at: seq)
                }
            case .compact(_, let trigger, let pre, let post):
                let sizes = pre.flatMap { pre in post.map { "（\(Format.tokens(pre)) → \(Format.tokens($0)) token）" } } ?? ""
                blocks.append(.divider(seq: seq, text: "\(trigger == "manual" ? "手动" : "自动")压缩了上下文\(sizes)"))
            case .turnEnd(let end):
                blocks.append(.turnEnd(seq: seq, entry: end, reply: replies.joined(separator: "\n\n"), edits: edits))
            default:
                break
            }
        }
        return blocks
    }
}

// 一组步骤的摘要，比如「运行 3 条命令，查看 2 个文件」；修改的文件按路径去重
enum StepSummary {
    private static let order: [(ToolCategory, (Int) -> String)] = [
        (.command, { "运行 \($0) 条命令" }),
        (.read, { "查看 \($0) 个文件" }),
        (.edit, { "修改 \($0) 个文件" }),
        (.search, { "搜索 \($0) 次" }),
        (.web, { "打开 \($0) 个网页" }),
        (.browser, { "操作浏览器 \($0) 次" }),
        (.subagent, { "启动 \($0) 个子 agent" }),
        (.other, { "调用 \($0) 次工具" }),
    ]

    static func text(_ steps: [Step]) -> String {
        var counts: [ToolCategory: Set<String>] = [:]
        for step in steps {
            guard let state = step.state else { continue }
            let label = ToolLabel(state.call)
            let key: String
            if case .edit(let path, _, _) = state.call.tool { key = path } else { key = state.itemId }
            counts[label.category, default: []].insert(key)
        }
        let parts = order.compactMap { category, text in counts[category].map { text($0.count) } }
        return parts.isEmpty ? "思考 \(steps.count) 次" : parts.joined(separator: "，")
    }
}

enum ToolCategory { case command, read, edit, search, web, browser, subagent, other }

// 一次调用显示成：图标、动作、对象（命令、路径、搜索词……）
struct ToolLabel {
    let icon: String
    let verb: String
    let category: ToolCategory
    let detail: String?

    // 浏览器操作（服务端归类的 operation）的说法，认不出的直接用工具名
    private static let browserVerbs = [
        "navigate": "浏览器打开", "interact": "操作浏览器", "script": "在浏览器里执行脚本", "read": "读取页面",
        "find": "在页面里查找", "fill": "填写表单", "console": "查看控制台", "network": "查看网络请求",
        "tabs": "查看标签页", "open-tab": "新建标签页", "close-tab": "关闭标签页",
    ]

    init(_ call: ToolCallEntry) {
        switch call.tool {
        case .command(let command): (icon, verb, category, detail) = ("apple.terminal", "运行", .command, command)
        case .read(let path): (icon, verb, category, detail) = ("doc.text", "查看", .read, path)
        case .edit(let path, let change, _):
            if case .write = change {
                (icon, verb, category, detail) = ("doc.badge.plus", "写入", .edit, path)
            } else {
                (icon, verb, category, detail) = ("pencil.line", "修改", .edit, path)
            }
        case .search(let pattern, let files): (icon, verb, category, detail) = ("magnifyingglass", files ? "查找文件" : "搜索", .search, pattern)
        case .webSearch(let query): (icon, verb, category, detail) = ("globe", "搜索网页", .search, query)
        case .webFetch(let url, _): (icon, verb, category, detail) = ("globe", "打开网页", .web, url)
        case .imageView(let path): (icon, verb, category, detail) = ("photo", "查看图片", .read, path)
        case .browser(let action, let target, let operation): (icon, verb, category, detail) = ("macwindow", operation.flatMap { Self.browserVerbs[$0] } ?? "浏览器 \(action)", .browser, target)
        case .mcp(let server, let tool, let target): (icon, verb, category, detail) = ("wrench.and.screwdriver", "\(server) \(tool)", .other, target)
        case .subagent(let description, _, _): (icon, verb, category, detail) = ("person.2", "子 agent", .subagent, description)
        case .toolSearch(let query): (icon, verb, category, detail) = ("shippingbox", "加载工具", .other, query)
        case .skill(let name): (icon, verb, category, detail) = ("sparkles", "使用技能", .other, name)
        case .todo: (icon, verb, category, detail) = ("checklist", "更新待办", .other, nil)
        case .other(let target): (icon, verb, category, detail) = ("wrench.and.screwdriver", call.name, .other, target)
        }
    }
}

// 改文件的显示：逐行的增删
struct DiffLine: Hashable, Identifiable {
    enum Kind { case context, added, removed, header }
    let id: Int
    let kind: Kind
    let text: String
}

enum Diff {
    static func lines(for change: FileChange) -> [DiffLine] {
        switch change {
        case .write(let content):
            return split(content).enumerated().map { DiffLine(id: $0, kind: .added, text: $1) }
        case .replace(let before, let after, _):
            return lineDiff(split(before), split(after))
        case .diff(let op, let diff):
            let lines = split(diff)
            if op == "add" { return lines.enumerated().map { DiffLine(id: $0, kind: .added, text: $1) } }
            if op == "delete" { return lines.enumerated().map { DiffLine(id: $0, kind: .removed, text: $1) } }
            return lines.enumerated().compactMap { index, line in
                if line.hasPrefix("+++") || line.hasPrefix("---") { return nil }
                let kind: DiffLine.Kind = line.hasPrefix("@@") ? .header : line.hasPrefix("+") ? .added : line.hasPrefix("-") ? .removed : .context
                let text = kind == .header ? line : String(line.dropFirst(min(1, line.count)))
                return DiffLine(id: index, kind: kind, text: text)
            }
        }
    }

    private static func split(_ text: String) -> [String] {
        guard !text.isEmpty else { return [] }
        var lines = text.components(separatedBy: "\n")
        if lines.last == "" { lines.removeLast() }
        return lines
    }

    private static func lineDiff(_ old: [String], _ new: [String]) -> [DiffLine] {
        let difference = new.difference(from: old)
        var removed = Set<Int>()
        var inserted = Set<Int>()
        for change in difference {
            switch change {
            case .remove(let offset, _, _): removed.insert(offset)
            case .insert(let offset, _, _): inserted.insert(offset)
            }
        }
        var result: [DiffLine] = []
        var i = 0, j = 0
        while i < old.count || j < new.count {
            if i < old.count, removed.contains(i) {
                result.append(DiffLine(id: result.count, kind: .removed, text: old[i]))
                i += 1
            } else if j < new.count, inserted.contains(j) {
                result.append(DiffLine(id: result.count, kind: .added, text: new[j]))
                j += 1
            } else {
                if j < new.count { result.append(DiffLine(id: result.count, kind: .context, text: new[j])) }
                i += 1
                j += 1
            }
        }
        return result
    }
}

// 一轮里改过的一个文件：增删的行数合计，op 是新建或删除了它
struct ChangedFile: Identifiable {
    let path: String
    var added = 0
    var removed = 0
    var op: String?
    var calls: [CallState] = []
    var id: String { path }

    static func collect(_ states: [CallState]) -> [ChangedFile] {
        var files: [ChangedFile] = []
        for state in states {
            guard state.result?.status == "done", case .edit(let path, let change, let lines) = state.call.tool else { continue }
            let index = files.firstIndex { $0.path == path } ?? {
                files.append(ChangedFile(path: path))
                return files.count - 1
            }()
            files[index].added += lines?.added ?? 0
            files[index].removed += lines?.removed ?? 0
            if case .diff(let op, _)? = change, op != "update" { files[index].op = op }
            files[index].calls.append(state)
        }
        return files
    }
}

enum Format {
    // 1234 → 1.2k，1234567 → 1.2M
    static func tokens(_ count: Int) -> String {
        if count < 1000 { return "\(count)" }
        if count < 1_000_000 { return String(format: "%.1fk", Double(count) / 1000).replacing(".0k", with: "k") }
        return String(format: "%.1fM", Double(count) / 1_000_000).replacing(".0M", with: "M")
    }

    // 用时：850 毫秒、12 秒、3 分 5 秒、1 小时 2 分
    static func duration(_ seconds: TimeInterval) -> String {
        if seconds < 1 { return "\(Int(seconds * 1000)) 毫秒" }
        let total = Int(seconds.rounded())
        if total < 60 { return "\(total) 秒" }
        if total < 3600 { return "\(total / 60) 分 \(total % 60) 秒" }
        return "\(total / 3600) 小时 \(total % 3600 / 60) 分"
    }

    static func bytes(_ count: Double) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(count), countStyle: .binary)
    }

    static func percent(_ value: Double) -> String {
        value < 0.01 && value > 0 ? String(format: "%.1f%%", value * 100) : "\(Int((value * 100).rounded()))%"
    }
}
