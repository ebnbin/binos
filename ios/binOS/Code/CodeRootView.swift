import SwiftUI

enum CodeRoute: Hashable {
    case session(Int, item: Int? = nil)
    case new(project: String)
    // ref：构建页预填的构建来源
    case builds(ref: String = "main")
    case devices
}

// Code app：左边是 session 列表，右边是对话；手机上收成一层层推进的导航
struct CodeRootView: View {
    @State private var store = CodeStore()
    @Bindable private var router = AppRouter.shared
    @State private var columns = NavigationSplitViewVisibility.automatic
    private let hub = EventHub.shared

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            SessionListView(store: store, route: $router.code)
        } detail: {
            NavigationStack {
                switch router.code {
                case .session(let id, let item):
                    ConversationView(store: store, sessionId: id, targetItem: item)
                        .id(router.code)
                case .new(let project):
                    ConversationView(store: store, sessionId: nil, project: project) { id, _ in
                        router.code = .session(id)
                    }
                    .id(router.code)
                case .builds(let ref):
                    BuildsView(ref: ref)
                        .id(ref)
                case .devices:
                    DevicesView()
                case nil:
                    ContentUnavailableView("选择一个对话", systemImage: "bubble.left.and.bubble.right", description: Text("或者开始新对话"))
                }
            }
        }
        .task(id: hub.sessions + hub.projects) { await store.refreshSessions() }
        .task(id: hub.agent) { await store.refreshAgents() }
        .task(id: hub.builds) { await BuildsStore.shared.refresh() }
    }
}

struct SessionListView: View {
    let store: CodeStore
    @Binding var route: CodeRoute?
    @State private var query = ""
    @State private var results: SearchResponse?
    @State private var showArchived = false
    @State private var creatingProject = false
    @State private var renaming: SessionSummary?
    @State private var title = ""
    private let builds = BuildsStore.shared

    var body: some View {
        List(selection: $route) {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                sessionSections
            } else {
                searchSection
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Code")
        .searchable(text: $query, prompt: "搜索对话与消息")
        .task(id: query) {
            let needle = query.trimmingCharacters(in: .whitespaces)
            guard !needle.isEmpty else {
                results = nil
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            results = try? await CodeAPI.search(needle)
        }
        .refreshable { await store.refreshSessions() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("新对话", systemImage: "square.and.pencil") { route = .new(project: "binos") }
            }
            ToolbarItem(placement: .secondaryAction) {
                Toggle("显示已归档", systemImage: "archivebox", isOn: $showArchived)
            }
            ToolbarItem(placement: .secondaryAction) {
                Button("创建项目", systemImage: "folder.badge.plus") { creatingProject = true }
            }
            ToolbarItem(placement: .secondaryAction) {
                Button { route = .builds() } label: {
                    Label("构建", systemImage: "hammer")
                    if let summary = builds.summary { Text(summary.text) }
                }
            }
            ToolbarItem(placement: .secondaryAction) {
                Button("设备", systemImage: "iphone") { route = .devices }
            }
        }
        .sheet(isPresented: $creatingProject) {
            NewProjectSheet { project in route = .new(project: project.id) }
        }
        .alert("重命名", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("标题", text: $title)
            Button("取消", role: .cancel) {}
            Button("保存") {
                if let id = renaming?.id, !title.trimmingCharacters(in: .whitespaces).isEmpty {
                    Task { await CodeAPI.edit(id, .init(title: title)) }
                }
            }
        }
        .overlay {
            if store.sessions == nil {
                if store.failed {
                    ContentUnavailableView("读取对话失败", systemImage: "wifi.exclamationmark", description: Text("下拉重试"))
                } else {
                    ProgressView()
                }
            }
        }
    }

    @ViewBuilder
    private var sessionSections: some View {
        Section {
            AgentStatusHeader(store: store)
        }
        let sessions = (store.sessions ?? []).filter { showArchived || !$0.archived }
        let pinned = sessions.filter(\.pinned)
        if !pinned.isEmpty {
            Section("置顶") {
                ForEach(pinned) { row($0) }
            }
        }
        ForEach(projectOrder(sessions), id: \.self) { project in
            Section {
                ForEach(sessions.filter { $0.project == project && !$0.pinned }) { row($0) }
            } header: {
                HStack {
                    Text(store.projectName(project))
                    Spacer()
                    Button("在 \(store.projectName(project)) 中新对话", systemImage: "plus") { route = .new(project: project) }
                        .labelStyle(.iconOnly)
                }
            }
        }
    }

    // 有对话的项目按最近的对话排，没有对话的项目排在后面
    private func projectOrder(_ sessions: [SessionSummary]) -> [String] {
        var order: [String] = []
        for session in sessions where !session.pinned && !order.contains(session.project) {
            order.append(session.project)
        }
        for project in store.projects where !order.contains(project.id) {
            order.append(project.id)
        }
        return order
    }

    private func row(_ session: SessionSummary) -> some View {
        NavigationLink(value: CodeRoute.session(session.id)) {
            SessionRow(session: session)
        }
        .swipeActions(edge: .trailing) {
            Button(session.archived ? "取消归档" : "归档", systemImage: "archivebox") {
                Task { await CodeAPI.edit(session.id, .init(archived: !session.archived)) }
            }
            .tint(.indigo)
        }
        .swipeActions(edge: .leading) {
            Button(session.pinned ? "取消置顶" : "置顶", systemImage: session.pinned ? "pin.slash" : "pin") {
                Task { await CodeAPI.edit(session.id, .init(pinned: !session.pinned)) }
            }
            .tint(.orange)
        }
        .contextMenu {
            Button("重命名", systemImage: "pencil") {
                title = session.title
                renaming = session
            }
            Button(session.pinned ? "取消置顶" : "置顶", systemImage: "pin") {
                Task { await CodeAPI.edit(session.id, .init(pinned: !session.pinned)) }
            }
            Button(session.archived ? "取消归档" : "归档", systemImage: "archivebox") {
                Task { await CodeAPI.edit(session.id, .init(archived: !session.archived)) }
            }
        }
    }

    @ViewBuilder
    private var searchSection: some View {
        if let results {
            Section(results.total > results.results.count ? "找到 \(results.total) 处，显示前 \(results.results.count) 处" : "找到 \(results.total) 处") {
                ForEach(Array(results.results.enumerated()), id: \.offset) { _, result in
                    NavigationLink(value: CodeRoute.session(result.id, item: result.item)) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(result.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                                if result.archived { Image(systemName: "archivebox").foregroundStyle(.secondary) }
                            }
                            if result.kind != "title" {
                                Text("\(result.before)\(Text(result.match).bold().foregroundStyle(.tint))\(result.after)")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                            }
                        }
                    }
                }
            }
        } else {
            HStack { Spacer(); ProgressView(); Spacer() }
        }
    }
}

private struct SessionRow: View {
    let session: SessionSummary

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            statusIcon
                .frame(width: 18)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(session.title.isEmpty ? "新对话" : session.title)
                    .font(.body.weight(session.unread ? .semibold : .regular))
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(session.updated, format: .relative(presentation: .named))
                    if let model = session.model {
                        Text(Agents.modelName(session.agent, model))
                    }
                    if let pr = session.prs.last {
                        Label("#\(pr.number)", systemImage: pr.state == "merged" ? "arrow.triangle.merge" : "arrow.triangle.pull")
                            .foregroundStyle(pr.state == "merged" ? .purple : pr.state == "closed" ? .secondary : .green)
                    }
                    if !session.queue.isEmpty {
                        Label("\(session.queue.count)", systemImage: "clock")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
    }

    @ViewBuilder
    private var statusIcon: some View {
        if session.running {
            ProgressView().controlSize(.small)
        } else if session.waiting {
            Image(systemName: "hourglass").foregroundStyle(.orange)
        } else if session.unread {
            Circle().fill(.tint).frame(width: 9, height: 9).padding(.top, 4)
        } else if session.outcome == "error" {
            Image(systemName: "exclamationmark.circle").foregroundStyle(.red)
        } else if session.outcome == "stopped" {
            Image(systemName: "stop.circle").foregroundStyle(.secondary)
        } else if session.pinned {
            Image(systemName: "pin.fill").foregroundStyle(.orange).font(.caption)
        } else {
            Color.clear
        }
    }
}

// 列表顶部：各个 agent 的额度，以及登录需要处理的提醒，点提醒去账号页处理
struct AgentStatusHeader: View {
    let store: CodeStore

    var body: some View {
        if let status = store.status {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(status.limits.keys.sorted(), id: \.self) { agent in
                    if let limits = status.limits[agent] {
                        QuotaRow(agent: agent, limits: limits)
                    }
                }
                ForEach(AgentAttention.all(status.auth), id: \.text) { attention in
                    Button {
                        AppRouter.shared.tab = .more
                        AppRouter.shared.more = [.accounts]
                    } label: {
                        HStack {
                            Label(attention.text, systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(attention.bad ? .red : .orange)
                            Spacer(minLength: 4)
                            Text(attention.action).foregroundStyle(.tint)
                        }
                        .font(.footnote)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

// 一个 agent 的订阅额度：每个窗口用了多少、多久重置，进度条上的竖线是匀速用到现在该到的位置，
// 下面一行是比匀速多用还是省、按现在的速度能不能撑到重置；被限流时先说卡在哪个窗口、什么时候恢复
struct QuotaRow: View {
    let agent: String
    let limits: Limits

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let now = timeline.date
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(Agents.name(agent)).font(.footnote.weight(.semibold))
                    if limits.limited { Text("已限流").font(.caption).foregroundStyle(.red) }
                }
                if limits.limited {
                    Text(Quota.blockingText(limits, now: now))
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                ForEach(limits.windows, id: \.id) { window in
                    let state = Quota.state(window, now: now)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 8) {
                            Text(Quota.name(window))
                            Text("\(Int((state.used * 100).rounded()))%").monospacedDigit()
                            Spacer(minLength: 4)
                            Text(Quota.reset(window.resetsAt, now: now))
                        }
                        QuotaBar(used: state.used, expected: state.left == nil ? nil : state.expected, alert: state.used >= 0.95 || limits.limited)
                        if state.left != nil {
                            HStack {
                                Text(state.pace > 0.005 ? "比匀速多用 \(Int((state.pace * 100).rounded()))%" : "比匀速省 \(Int((-state.pace * 100).rounded()))%")
                                Spacer(minLength: 4)
                                if let runsOut = state.runsOut {
                                    Text(runsOut == 0 ? "已经用完" : "按现在的速度 \(Quota.span(runsOut))后用完").foregroundStyle(.red)
                                } else {
                                    Text("够用到重置")
                                }
                            }
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct QuotaBar: View {
    let used: Double
    // 匀速用到现在该到的位置，窗口已经重置时没有
    let expected: Double?
    let alert: Bool

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(.quaternary)
                Capsule().fill(alert ? Color.red : used >= 0.8 ? Color.orange : Color.accentColor)
                    .frame(width: geometry.size.width * min(used, 1))
                if let expected {
                    Rectangle().fill(.primary.opacity(0.6))
                        .frame(width: 1.5, height: 10)
                        .offset(x: geometry.size.width * expected - 0.75)
                }
            }
        }
        .frame(height: 6)
    }
}

// 和网页的 services/kita/quota.ts 一致
enum Quota {
    // 5 小时、7 天，同样长的窗口不止一个时带上它的 label
    static func name(_ window: QuotaWindow) -> String {
        let minutes = window.minutes
        let length = minutes % (24 * 60) == 0 ? "\(minutes / 24 / 60) 天" : minutes % 60 == 0 ? "\(minutes / 60) 小时" : "\(minutes) 分钟"
        return window.label.map { "\($0) \(length)" } ?? length
    }

    // 多久：45 分钟、3 小时、2 天
    static func span(_ seconds: TimeInterval) -> String {
        let minutes = max(Int((seconds / 60).rounded()), 1)
        if minutes < 60 { return "\(minutes) 分钟" }
        return minutes < 48 * 60 ? "\(Int((Double(minutes) / 60).rounded())) 小时" : "\(Int((Double(minutes) / 60 / 24).rounded())) 天"
    }

    // 什么时候重置：一天以内写还有多久，再远写哪天几点
    static func reset(_ resetsAt: Double, now: Date) -> String {
        let left = resetsAt - now.timeIntervalSince1970
        if left <= 0 { return "已重置" }
        if left < 86400 { return "\(span(left))后重置" }
        let date = Date(timeIntervalSince1970: resetsAt)
        return "\(date.formatted(.dateTime.weekday(.abbreviated).hour(.twoDigits(amPM: .omitted)).minute())) 重置"
    }

    // used 用了多少；left 还有多久重置（过了重置时间的没有）；expected 匀速用的话这时该用到多少；
    // pace 比匀速多用（正）或少用（负）了多少；runsOut 按到现在为止的速度还有多久用完（重置前用不完时没有）
    struct State {
        var used = 0.0
        var left: TimeInterval?
        var expected = 0.0
        var pace = 0.0
        var runsOut: TimeInterval?
    }

    static func state(_ window: QuotaWindow, now: Date) -> State {
        let length = Double(window.minutes) * 60
        let left = window.resetsAt - now.timeIntervalSince1970
        guard left > 0 else { return State() }
        let used = min(window.utilization, 1)
        let elapsed = min(max(length - left, 1), length)
        let expected = elapsed / length
        let rate = used / elapsed
        let runsOut: TimeInterval? = used >= 1 ? 0 : rate > 0 && (1 - used) / rate < left ? (1 - used) / rate : nil
        return State(used: used, left: left, expected: expected, pace: used - expected, runsOut: runsOut)
    }

    // 被限流时卡住的那个窗口：还没重置的窗口里用得最满的
    static func blockingText(_ limits: Limits, now: Date) -> String {
        let blocking = limits.windows.filter { $0.resetsAt > now.timeIntervalSince1970 }.max { $0.utilization < $1.utilization }
        guard let blocking else { return "已被限流" }
        return "已被限流：\(name(blocking))额度用满了，\(reset(blocking.resetsAt, now: now).replacing("重置", with: "恢复"))"
    }
}

// 登录要留意的事，和网页的 services/kita/claude/view.tsx、codex/view.tsx 一致。bad：用不了了；action：处理它的按钮上的字
struct AgentAttention: Hashable {
    let text: String
    let bad: Bool
    let action: String

    // 完整登录剩不到这么多天时提醒重新登录，备用 token 剩不到这么多天时提醒更新
    private static let loginWarnDays = 7.0
    private static let backupWarnDays = 30.0

    static func all(_ auth: AgentAuths, now: Date = .now) -> [AgentAttention] {
        [claude(auth.claude, now: now), codex(auth.codex)].compactMap { $0 }
    }

    // 还剩几天，不足一天按 0
    static func daysLeft(_ date: Date, now: Date) -> Int { max(Int((date.timeIntervalSince(now) / 86400).rounded(.down)), 0) }

    static func claude(_ auth: ClaudeAuth?, now: Date) -> AgentAttention? {
        guard let auth else { return nil }
        if auth.mode == "none" { return AgentAttention(text: "Claude 没有能用的登录", bad: true, action: "重新登录") }
        if auth.mode == "token" {
            return AgentAttention(text: auth.login?.broken == true ? "Claude 的登录失效了，正在用备用 token" : "Claude 的登录过期了，正在用备用 token", bad: false, action: "重新登录")
        }
        if let expiry = auth.login?.expiresAt.flatMap(Date.init(iso:)), expiry.timeIntervalSince(now) < loginWarnDays * 86400 {
            let days = daysLeft(expiry, now: now)
            return AgentAttention(text: "Claude 的登录\(days == 0 ? "今天" : "还有 \(days) 天")到期", bad: false, action: "重新登录")
        }
        if let expiry = auth.backup?.expiresAt.flatMap(Date.init(iso:)), expiry.timeIntervalSince(now) < backupWarnDays * 86400 {
            return AgentAttention(text: "Claude 的备用 token 还有 \(daysLeft(expiry, now: now)) 天到期", bad: false, action: "更新")
        }
        return nil
    }

    // Codex 只在回答时认证失败过才提醒：没登录过 Codex 也照样能用别的 agent
    static func codex(_ auth: CodexAuth?) -> AgentAttention? {
        auth?.broken == true ? AgentAttention(text: "Codex 的登录失效了，回答时认证失败了", bad: true, action: "重新登录") : nil
    }
}

private struct NewProjectSheet: View {
    let onCreated: (Project) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var repository = ""
    @State private var create = false
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("项目名称", text: $name)
                Picker("仓库来源", selection: $create) {
                    Text("关联已有仓库").tag(false)
                    Text("创建私有 GitHub 仓库").tag(true)
                }
                TextField("owner/repository", text: $repository)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if let error {
                    Text(error).foregroundStyle(.red)
                }
            }
            .navigationTitle("创建项目")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView()
                    } else {
                        Button("创建") { save() }
                            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || repository.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
    }

    private func save() {
        saving = true
        error = nil
        Task {
            do {
                let project = try await CodeAPI.createProject(name: name.trimmingCharacters(in: .whitespaces), repository: repository.trimmingCharacters(in: .whitespaces), create: create)
                dismiss()
                onCreated(project)
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}
