import Foundation

// 把对话的条目整理成显示的块，规则和网页的 Transcript 一致

struct IndexedEntry: Hashable {
    let index: Int
    let entry: Entry
}

// live：这一轮还在回答，没有结果的调用还在运行
struct CallState: Hashable, Identifiable {
    let index: Int
    let call: ToolCallEntry
    let result: ToolResultEntry?
    let live: Bool
    var id: Int { index }

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
    case thinking(index: Int, time: String, text: String, durationMs: Double?)
    case tool(CallState)
    case subagent(CallState)

    var id: Int {
        switch self {
        case .thinking(let index, _, _, _): index
        case .tool(let state), .subagent(let state): state.index
        }
    }

    var state: CallState? {
        switch self {
        case .thinking: nil
        case .tool(let state), .subagent(let state): state
        }
    }
}

enum Block: Hashable, Identifiable {
    case time(index: Int, date: Date)
    case input(index: Int, entry: InputEntry)
    case attachments(index: Int, attachments: [Attachment])
    case text(index: Int, text: String, files: [String: String])
    case steps(index: Int, steps: [Step])
    case divider(index: Int, text: String)
    case turnEnd(index: Int, entry: TurnEndEntry, reply: String, edits: [CallState])

    var id: String {
        switch self {
        case .time(let index, _): "\(index)-time"
        case .input(let index, _): "\(index)"
        case .attachments(let index, _): "\(index)-attachments"
        case .text(let index, _, _): "\(index)"
        case .steps(let index, _): "\(index)-steps"
        case .divider(let index, _): "\(index)-divider"
        case .turnEnd(let index, _, _, _): "\(index)"
        }
    }
}

// 一轮：从 mode 为 start 的 input 到下一个之前，第一轮之前的条目单独成一组。start 和条目的 index 都是在整个 thread 里的位置。
// vendor 的调用 id 只在当前轮内唯一，按调用所在的位置关联结果和子 agent 的条目
final class TranscriptTurn {
    let start: Int
    let first: Entry
    let size: Int
    private(set) var results: [Int: ToolResultEntry] = [:]
    private(set) var children: [Int: [IndexedEntry]] = [:]
    private(set) var main: [IndexedEntry] = []
    // 答完的轮的块不会再变，算过就记下来
    private var settled: (previous: String?, blocks: [Block])?

    init(_ items: ArraySlice<Entry>, offset: Int) {
        start = offset + items.startIndex
        first = items.first!
        size = items.count
        var calls: [String: Int] = [:]
        for (index, entry) in zip(items.indices, items) {
            if case .toolCall(let call) = entry { calls[call.id] = offset + index }
        }
        for (index, entry) in zip(items.indices, items) {
            let item = IndexedEntry(index: offset + index, entry: entry)
            if case .toolResult(let result) = entry, let call = calls[result.callId] {
                results[call] = result
            }
            if let parent = entry.parent, let call = calls[parent] {
                children[call, default: []].append(item)
            } else {
                main.append(item)
            }
        }
    }

    // items 是从 offset 开始的条目。条目只会在两头增加：和 previous 里同一段条目的轮沿用原来的对象，界面上这些轮可以跳过重新排版
    static func split(_ items: [Entry], previous: [TranscriptTurn] = [], offset: Int = 0) -> [TranscriptTurn] {
        let reusable = Dictionary(previous.map { ($0.start, $0) }, uniquingKeysWith: { first, _ in first })
        var starts: [Int] = []
        for (index, entry) in items.enumerated() {
            if index == 0 { starts.append(index) } else if case .input(let input) = entry, input.mode == "start" { starts.append(index) }
        }
        return starts.enumerated().map { i, start in
            let end = i + 1 < starts.count ? starts[i + 1] : items.count
            if let old = reusable[offset + start], old.size == end - start, old.first == items[start] { return old }
            return TranscriptTurn(items[start..<end], offset: offset)
        }
    }

    // 这一轮的块；previous 是上一轮最后一条的时间
    func blocks(live: Bool, previous: String?) -> [Block] {
        if !live, let settled, settled.previous == previous { return settled.blocks }
        let blocks = blocks(main, live: live, previous: previous)
        if !live { settled = (previous, blocks) }
        return blocks
    }

    func state(_ index: Int, _ call: ToolCallEntry, live: Bool) -> CallState {
        CallState(index: index, call: call, result: results[index], live: live)
    }

    // 这次调用改了文件就是它自己；是子 agent 时，是子 agent 里改文件的调用
    func editCalls(_ state: CallState) -> [CallState] {
        if case .edit = state.call.tool { return [state] }
        return (children[state.index] ?? []).flatMap { item -> [CallState] in
            guard case .toolCall(let call) = item.entry else { return [] }
            return editCalls(self.state(item.index, call, live: state.live))
        }
    }

    // 一轮开始时离上一条超过这么久或者跨了天，先显示一条时间
    private static let dividerGap: TimeInterval = 30 * 60

    func blocks(_ entries: [IndexedEntry], live: Bool, previous: String? = nil) -> [Block] {
        var blocks: [Block] = []
        var replies: [String] = []
        var edits: [CallState] = []
        var lastTime = previous.flatMap(Date.init(iso:))
        func addStep(_ step: Step, at index: Int) {
            if case .steps(let first, var steps) = blocks.last {
                steps.append(step)
                blocks[blocks.count - 1] = .steps(index: first, steps: steps)
            } else {
                blocks.append(.steps(index: index, steps: [step]))
            }
        }
        for item in entries {
            let index = item.index
            let previous = lastTime
            let time = Date(iso: item.entry.time)
            if let time { lastTime = time }
            switch item.entry {
            case .input(let input):
                if input.mode == "start" {
                    replies = []
                    edits = []
                    if let time, previous == nil || time.timeIntervalSince(previous!) > Self.dividerGap || !Calendar.current.isDate(time, inSameDayAs: previous!) {
                        blocks.append(.time(index: index, date: time))
                    }
                }
                if input.mode == "interrupt" {
                    blocks.append(.divider(index: index, text: "已打断"))
                }
                if !input.attachments.isEmpty {
                    blocks.append(.attachments(index: index, attachments: input.attachments))
                }
                if !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    blocks.append(.input(index: index, entry: input))
                }
            case .thinking(let time, let text, let durationMs, _):
                addStep(.thinking(index: index, time: time, text: text, durationMs: durationMs), at: index)
            case .text(_, let text, let files, _):
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    replies.append(text)
                    blocks.append(.text(index: index, text: text, files: files))
                }
            case .toolCall(let call):
                let state = state(index, call, live: live)
                edits.append(contentsOf: editCalls(state))
                if case .subagent = call.tool {
                    addStep(.subagent(state), at: index)
                } else {
                    addStep(.tool(state), at: index)
                }
            case .compact(_, let trigger, let pre, let post, _):
                let sizes = pre.flatMap { pre in post.map { "（\(Format.tokens(pre)) → \(Format.tokens($0)) token）" } } ?? ""
                blocks.append(.divider(index: index, text: "\(trigger == "manual" ? "手动" : "自动")压缩了上下文\(sizes)"))
            case .turnEnd(let end):
                blocks.append(.turnEnd(index: index, entry: end, reply: replies.joined(separator: "\n\n"), edits: edits))
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
            if case .edit(let path, _) = state.call.tool { key = path } else { key = state.call.id + "\(state.index)" }
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

    private static let browserVerbs = [
        "navigate": "浏览器打开", "computer": "操作浏览器", "browser_batch": "操作浏览器", "javascript_tool": "在浏览器里执行脚本",
        "read_page": "读取页面", "get_page_text": "读取页面", "find": "在页面里查找", "form_input": "填写表单",
        "read_console_messages": "查看控制台", "read_network_requests": "查看网络请求", "tabs_context_mcp": "查看标签页",
        "tabs_create_mcp": "新建标签页", "tabs_close_mcp": "关闭标签页",
    ]

    init(_ call: ToolCallEntry) {
        let firstText: String? = {
            if case .object(let object) = call.input {
                return object.sorted { $0.key < $1.key }.lazy.compactMap { $0.value.stringValue }.first
            }
            return nil
        }()
        switch call.tool {
        case .command(let command): (icon, verb, category, detail) = ("apple.terminal", "运行", .command, command)
        case .read(let path): (icon, verb, category, detail) = ("doc.text", "查看", .read, path)
        case .edit(let path, let change):
            if case .write = change {
                (icon, verb, category, detail) = ("doc.badge.plus", "写入", .edit, path)
            } else {
                (icon, verb, category, detail) = ("pencil.line", "修改", .edit, path)
            }
        case .search(let pattern, let files): (icon, verb, category, detail) = ("magnifyingglass", files ? "查找文件" : "搜索", .search, pattern)
        case .webSearch(let query): (icon, verb, category, detail) = ("globe", "搜索网页", .search, query)
        case .webFetch(let url, _): (icon, verb, category, detail) = ("globe", "打开网页", .web, url)
        case .imageView(let path): (icon, verb, category, detail) = ("photo", "查看图片", .read, path)
        case .browser(let action, let target): (icon, verb, category, detail) = ("macwindow", Self.browserVerbs[action] ?? "浏览器 \(action)", .browser, target)
        case .mcp(let server, let tool): (icon, verb, category, detail) = ("wrench.and.screwdriver", "\(server) \(tool)", .other, firstText)
        case .subagent(let description, _, _): (icon, verb, category, detail) = ("person.2", "子 agent", .subagent, description)
        case .toolSearch(let query): (icon, verb, category, detail) = ("shippingbox", "加载工具", .other, query)
        case .skill(let name): (icon, verb, category, detail) = ("sparkles", "使用技能", .other, name)
        case .todo: (icon, verb, category, detail) = ("checklist", "更新待办", .other, nil)
        case .other:
            let name = call.name.replacing(/^mcp__/, with: "").replacing("__", with: " ")
            (icon, verb, category, detail) = ("wrench.and.screwdriver", name, .other, firstText)
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

    // 条目不会变，算过的记下来：每次排版都对整段内容做 diff 太慢
    private static var countCache: [FileChange: (added: Int, removed: Int)] = [:]

    static func counts(for change: FileChange) -> (added: Int, removed: Int) {
        if let cached = countCache[change] { return cached }
        let lines = lines(for: change)
        let counts = (lines.count { $0.kind == .added }, lines.count { $0.kind == .removed })
        if countCache.count > 2000 { countCache.removeAll() }
        countCache[change] = counts
        return counts
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
            guard state.result?.status == "done", case .edit(let path, let change) = state.call.tool else { continue }
            let index = files.firstIndex { $0.path == path } ?? {
                files.append(ChangedFile(path: path))
                return files.count - 1
            }()
            if let change {
                let counts = Diff.counts(for: change)
                files[index].added += counts.added
                files[index].removed += counts.removed
                if case .diff(let op, _) = change, op != "update" { files[index].op = op }
            }
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
