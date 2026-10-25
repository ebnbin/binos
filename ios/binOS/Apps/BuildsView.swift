import Observation
import SwiftUI

// 与 server/src/apps/builds/types.ts 对应
struct BuildsSnapshot: Decodable {
    // install：装到设备上的安装包，从 /:id/artifacts/:name 下载；link：外部打开的链接（Web 的 PR 预览）
    enum Artifact: Decodable, Hashable {
        case install(name: String, platform: String, size: Double?, sha256: String?)
        case link(name: String, platform: String, url: URL)
        case other(name: String)

        private enum Keys: String, CodingKey { case kind, name, platform, size, sha256, url }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Keys.self)
            let name = try c.decode(String.self, forKey: .name)
            let platform = (try? c.decode(String.self, forKey: .platform)) ?? ""
            switch try? c.decode(String.self, forKey: .kind) {
            case "install":
                self = .install(name: name, platform: platform, size: try? c.decode(Double.self, forKey: .size), sha256: try? c.decode(String.self, forKey: .sha256))
            case "link":
                guard let url = (try? c.decode(String.self, forKey: .url)).flatMap(URL.init(string:)) else { self = .other(name: name); return }
                self = .link(name: name, platform: platform, url: url)
            default:
                self = .other(name: name)
            }
        }

        var name: String {
            switch self {
            case .install(let name, _, _, _), .link(let name, _, _), .other(let name): name
            }
        }
    }

    struct Build: Decodable, Hashable, Identifiable {
        let id: String
        let commit: String
        let target: String
        let trigger: String
        let pr: Int?
        let status: String
        @Default<Defaults.Empty> var createdAt: String
        let startedAt: String?
        let endedAt: String?
        let error: String?
        @Lossy var artifacts: [Artifact]

        var live: Bool { status == "queued" || status == "running" }
        var targetName: String { BuildsAPI.targetNames[target] ?? target }
    }

    struct Settings: Decodable {
        @Default<Defaults.False> var automatic: Bool
    }

    struct OpenPR: Decodable, Hashable {
        let number: Int
        @Default<Defaults.Empty> var title: String
    }

    @Lossy var builds: [Build]
    let settings: Settings?
    let pollError: String?
    let checkedAt: String?
    // 上次检查时开着的 PR；还没检查过时没有，这时不知道哪些 PR 已经结束
    private let prs: Lossy<OpenPR>?
    @Default<Defaults.Empty> var mode: String

    var openPRs: [OpenPR]? { prs?.wrappedValue }
}

enum BuildsAPI {
    static let base = "/api/apps/builds"

    // 构建的操作：route 是 base 之后的部分，都返回操作后的快照
    struct Action {
        var method = "POST"
        let route: String
        var body: (any Encodable)?

        struct Enqueue: Encodable {
            let ref: String
            let targets: [String]
        }

        struct Settings: Encodable {
            let automatic: Bool
        }

        static func enqueue(ref: String, targets: [String]) -> Action { Action(route: "", body: Enqueue(ref: ref, targets: targets)) }
        static func settings(automatic: Bool) -> Action { Action(method: "PUT", route: "/settings", body: Settings(automatic: automatic)) }
        static let poll = Action(route: "/poll")
        static func cancel(_ id: String) -> Action { Action(route: "/\(id)/cancel") }
        static func retry(_ id: String) -> Action { Action(route: "/\(id)/retry") }
    }

    static let targetNames = ["web": "Web", "android": "Android", "ios": "iOS"]
    static let statusNames = ["queued": "排队中", "running": "构建中", "success": "成功", "failed": "失败", "cancelled": "已取消", "interrupted": "已中断"]
}

// 构建服务的状态：状态变化时后端发 builds 通知，用到它的界面跟着 hub.builds 重新读取
@Observable
final class BuildsStore {
    static let shared = BuildsStore()

    private(set) var snapshot: BuildsSnapshot?
    private(set) var error: String?
    private var latest = 0

    private init() {}

    func refresh() async {
        latest += 1
        let version = latest
        do {
            let result: BuildsSnapshot = try await API.shared.get(BuildsAPI.base)
            guard version == latest else { return }
            snapshot = result
            error = nil
        } catch is CancellationError {
        } catch {
            if version == latest { self.error = error.localizedDescription }
        }
    }

    func send(_ action: BuildsAPI.Action) async {
        do {
            let result: BuildsSnapshot = try await API.shared.send(action.method, BuildsAPI.base + action.route, body: action.body)
            latest += 1
            snapshot = result
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func build(_ id: String) -> BuildsSnapshot.Build? { snapshot?.builds.first { $0.id == id } }

    // 预览链接指向 PR 当前的预览，只在开着的 PR 最新一次成功的 Web 构建上有效
    func previewIsLive(_ build: BuildsSnapshot.Build) -> Bool {
        guard let snapshot, let pr = build.pr, snapshot.openPRs?.contains(where: { $0.number == pr }) == true else { return false }
        return snapshot.builds.first { $0.target == "web" && $0.pr == pr && $0.status == "success" }?.id == build.id
    }

    enum State { case running, failed, success }

    // 一组构建合起来的状态：还有没编完的算构建中，有失败或中断的算失败；只有取消的不算
    static func state(_ builds: [BuildsSnapshot.Build]) -> State? {
        if builds.contains(where: \.live) { return .running }
        if builds.contains(where: { $0.status == "failed" || $0.status == "interrupted" }) { return .failed }
        if builds.contains(where: { $0.status == "success" }) { return .success }
        return nil
    }

    // 这个 PR 最新提交的构建，包括手动指定 pr/编号 的
    func prState(_ pr: Int) -> State? {
        guard let builds = snapshot?.builds, let commit = builds.first(where: { $0.pr == pr })?.commit else { return nil }
        return Self.state(builds.filter { $0.pr == pr && $0.commit == commit })
    }

    // 入口旁的概况：有在编的显示个数；否则显示最近编完的那个提交的结果
    var summary: (text: String, state: State)? {
        guard let builds = snapshot?.builds else { return nil }
        let running = builds.count(where: { $0.status == "running" })
        let queued = builds.count(where: { $0.status == "queued" })
        if running + queued > 0 {
            return ([running > 0 ? "\(running) 个构建中" : nil, queued > 0 ? "\(queued) 个排队" : nil].compactMap(\.self).joined(separator: " · "), .running)
        }
        guard let last = builds.filter({ $0.endedAt != nil && $0.status != "cancelled" }).max(by: { $0.endedAt! < $1.endedAt! }),
              let state = Self.state(builds.filter { $0.commit == last.commit && $0.trigger == last.trigger && $0.pr == last.pr }) else { return nil }
        let source = last.trigger == "main" ? "main" : last.pr.map { "PR #\($0)" } ?? "手动"
        return ("\(source) \(state == .failed ? "构建失败" : "构建成功")", state)
    }
}

extension BuildsStore.State {
    var label: String {
        switch self {
        case .running: "构建中"
        case .failed: "构建失败"
        case .success: "构建成功"
        }
    }

    var color: Color {
        switch self {
        case .running: .accentColor
        case .failed: .red
        case .success: .secondary
        }
    }
}

// 构建：main、每个 PR、手动构建分组显示，组内最新的提交在前；状态随 builds 通知更新
struct BuildsView: View {
    @State private var ref: String
    @State private var filter: String
    @State private var targets = "both"
    @State private var busy = false
    private let store = BuildsStore.shared
    private let hub = EventHub.shared

    init(ref: String = "main") {
        _ref = State(initialValue: ref)
        _filter = State(initialValue: ref.hasPrefix("pr/") ? "pr" : "all")
    }

    private struct Source: Identifiable {
        let id: String
        let kind: String
        let pr: Int?
        var commits: [[BuildsSnapshot.Build]]
    }

    // 按来源分组：main、每个 PR（包括手动指定 pr/编号 的）、其余手动构建；组内按提交分
    private func groups(_ builds: [BuildsSnapshot.Build]) -> [Source] {
        var groups: [Source] = []
        for build in builds {
            let kind = build.trigger == "main" ? "main" : build.pr != nil ? "pr" : "manual"
            let id = kind == "pr" ? "pr-\(build.pr!)" : kind
            let index = groups.firstIndex { $0.id == id } ?? {
                groups.append(Source(id: id, kind: kind, pr: build.pr, commits: []))
                return groups.count - 1
            }()
            if let commit = groups[index].commits.firstIndex(where: { $0[0].commit == build.commit }) {
                groups[index].commits[commit].append(build)
            } else {
                groups[index].commits.append([build])
            }
        }
        return groups
    }

    var body: some View {
        List {
            Section {
                TextField("main、pr/编号或完整提交号", text: $ref)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Picker("目标", selection: $targets) {
                    Text("Android + iOS").tag("both")
                    ForEach(["web", "android", "ios"], id: \.self) { Text(BuildsAPI.targetNames[$0]!).tag($0) }
                }
                Button("开始构建", systemImage: "hammer") {
                    run(.enqueue(ref: ref.trimmingCharacters(in: .whitespaces), targets: targets == "both" ? ["android", "ios"] : [targets]))
                }
                .disabled(busy || store.snapshot == nil || ref.trimmingCharacters(in: .whitespaces).isEmpty)
            } header: {
                Text("新构建")
            } footer: {
                VStack(alignment: .leading) {
                    // 请求失败的原因放在操作旁边，不在列表末尾
                    if let error = store.error { Text(error).foregroundStyle(.red) }
                    if let current = store.snapshot {
                        if current.mode == "mock" { Text("预览模式：模拟构建，与正式构建及签名隔离。") }
                        if let checked = current.checkedAt.flatMap(Date.init(iso:)) { Text("上次检查 \(checked.formatted(.relative(presentation: .named)))") }
                        if let pollError = current.pollError { Text("检查仓库失败：\(pollError)").foregroundStyle(.red) }
                    }
                }
            }
            if let current = store.snapshot {
                if let settings = current.settings {
                    Section {
                        Toggle("自动构建 main 和 PR", isOn: Binding(get: { settings.automatic }, set: { run(.settings(automatic: $0)) }))
                            .disabled(busy)
                    }
                }
                Section {
                    Picker("筛选", selection: $filter) {
                        Text("全部").tag("all")
                        Text("main").tag("main")
                        Text("PR").tag("pr")
                        Text("手动").tag("manual")
                    }
                    .pickerStyle(.segmented)
                    if current.builds.isEmpty {
                        Text("暂无构建。提交包含构建脚本后将自动构建，也可以手动指定来源。").foregroundStyle(.secondary)
                    }
                }
                ForEach(groups(current.builds).filter { filter == "all" || $0.kind == filter }) { group in
                    Section {
                        ForEach(group.commits[0]) { BuildLink(build: $0) }
                        if group.commits.count > 1 {
                            DisclosureGroup("更早的 \(group.commits.count - 1) 个提交") {
                                ForEach(group.commits.dropFirst().flatMap(\.self)) { BuildLink(build: $0) }
                            }
                        }
                    } header: {
                        header(group, prs: current.openPRs)
                    }
                }
            }
        }
        .overlay { if store.snapshot == nil && store.error == nil { ProgressView() } }
        .navigationTitle("构建")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("检查更新", systemImage: "arrow.clockwise") { run(.poll) }
                    .disabled(busy)
            }
        }
        .refreshable { await store.refresh() }
        .task(id: hub.builds) { await store.refresh() }
    }

    @ViewBuilder
    private func header(_ group: Source, prs: [BuildsSnapshot.OpenPR]?) -> some View {
        switch group.kind {
        case "main": Text("main")
        case "manual": Text("手动")
        default:
            let title = prs?.first { $0.number == group.pr }?.title
            HStack(spacing: 6) {
                Text("PR #\(group.pr ?? 0)\(title.map { " \($0)" } ?? "")").lineLimit(1)
                if prs != nil, title == nil { Text("已合并或关闭").foregroundStyle(.secondary) }
            }
        }
    }

    private func run(_ action: BuildsAPI.Action) {
        busy = true
        Task {
            await store.send(action)
            busy = false
        }
    }
}

private struct BuildLink: View {
    let build: BuildsSnapshot.Build

    var body: some View {
        NavigationLink { BuildDetail(id: build.id, initial: build) } label: { BuildRow(build: build) }
    }
}

private struct BuildRow: View {
    let build: BuildsSnapshot.Build

    var body: some View {
        HStack(spacing: 12) {
            StatusIcon(status: build.status)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(build.targetName)
                    Text(BuildsAPI.statusNames[build.status] ?? build.status).foregroundStyle(.secondary)
                    if build.trigger == "manual", build.pr != nil { Text("手动").font(.caption).foregroundStyle(.secondary) }
                }
                HStack(spacing: 6) {
                    Text(String(build.commit.prefix(7))).monospaced()
                    if let created = Date(iso: build.createdAt) { Text(created, format: .relative(presentation: .named)) }
                    ForEach(build.artifacts, id: \.self) { artifact in
                        switch artifact {
                        case .install(let name, _, let size, _): Text(size.map { "\(name) · \(Format.bytes($0))" } ?? name)
                        case .link(_, _, let url): Text(url.host() ?? url.absoluteString)
                        case .other: EmptyView()
                        }
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                if let error = build.error {
                    Text(error).font(.caption).foregroundStyle(.red).lineLimit(2)
                }
            }
        }
    }
}

private struct StatusIcon: View {
    let status: String

    var body: some View {
        switch status {
        case "running": ProgressView()
        case "success": Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case "failed", "interrupted": Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        case "queued": Image(systemName: "clock").foregroundStyle(.secondary)
        default: Image(systemName: "minus.circle").foregroundStyle(.secondary)
        }
    }
}

private struct BuildDetail: View {
    let id: String
    // 构建结束满 3 天后会被删掉，删掉后仍显示最后看到的样子
    let initial: BuildsSnapshot.Build
    @State private var log = BuildLog()
    @State private var error: String?
    @State private var busy = false
    @Environment(\.openURL) private var openURL
    private let store = BuildsStore.shared
    private let hub = EventHub.shared

    private var build: BuildsSnapshot.Build { store.build(id) ?? initial }

    var body: some View {
        let build = build
        List {
            Section {
                LabeledContent("状态", value: BuildsAPI.statusNames[build.status] ?? build.status)
                LabeledContent("来源", value: build.trigger == "main" ? "main" : build.pr.map { "PR #\($0)\(build.trigger == "manual" ? "（手动）" : "")" } ?? "手动")
                LabeledContent("提交") { Text(build.commit).font(.caption.monospaced()).textSelection(.enabled) }
                if let created = Date(iso: build.createdAt) {
                    LabeledContent("创建", value: created.formatted(date: .abbreviated, time: .standard))
                }
                if let start = build.startedAt.flatMap(Date.init(iso:)) {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let end = build.endedAt.flatMap(Date.init(iso:)) ?? context.date
                        LabeledContent("用时", value: Format.duration(max(0, end.timeIntervalSince(start))))
                    }
                }
                if let message = build.error {
                    Text(message).foregroundStyle(.red)
                }
                if build.live {
                    Button("取消构建", role: .destructive) { run(.cancel(build.id)) }.disabled(busy)
                } else {
                    Button("重新构建") { run(.retry(build.id)) }.disabled(busy)
                }
            }
            let artifacts = build.artifacts.filter { if case .other = $0 { false } else { true } }
            if !artifacts.isEmpty {
                Section {
                    ForEach(artifacts, id: \.self) { artifact(build, $0) }
                } header: {
                    Text("产物")
                } footer: {
                    if artifacts.contains(where: { if case .install(_, "ios", _, _) = $0 { true } else { false } }), store.snapshot?.mode == "real" {
                        Text("仅限描述文件内已注册的设备，安装链接有效期 24 小时")
                    }
                }
            }
            if let message = error ?? store.error { Text(message).foregroundStyle(.red) }
            Section {
                Text(log.text.isEmpty ? (log.ended ? "没有日志" : "等待构建日志…") : log.text)
                    .font(.system(.caption2, design: .monospaced))
                    .textSelection(.enabled)
            } header: {
                HStack {
                    Text("日志")
                    Spacer()
                    Button("下载完整日志") {
                        FilePresenter.shared.present(url: API.shared.url("\(BuildsAPI.base)/\(build.id)/log"), name: "build.log")
                    }
                    .font(.footnote)
                }
            }
        }
        .navigationTitle(build.targetName)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: hub.builds) { await store.refresh() }
        .onAppear { log.start(build.id) }
        .onDisappear { log.stop() }
    }

    // Android 下载安装包；iOS 无线安装（下载的 IPA 在设备上装不上）；Web 打开 PR 预览
    @ViewBuilder
    private func artifact(_ build: BuildsSnapshot.Build, _ artifact: BuildsSnapshot.Artifact) -> some View {
        switch artifact {
        case .install(let name, "ios", let size, _):
            if store.snapshot?.mode == "real", build.status == "success" {
                Button("安装到这台设备", systemImage: "arrow.down.app") { Task { await install(build) } }.disabled(busy)
            } else {
                LabeledContent(name, value: size.map { Format.bytes($0) } ?? "")
            }
        case .install(let name, _, let size, let sha256):
            Button {
                FilePresenter.shared.present(url: API.shared.url("\(BuildsAPI.base)/\(build.id)/artifacts/\(name)"), name: name)
            } label: {
                LabeledContent {
                    Text(size.map { Format.bytes($0) } ?? "")
                } label: {
                    Text(name)
                    if let sha256 { Text("SHA-256 \(sha256.prefix(16))…").monospaced() }
                }
            }
        case .link(_, _, let url):
            if store.previewIsLive(build) {
                Link(destination: url) { Label("打开预览", systemImage: "safari") }
                NavigationLink { WebAppView(url: url, title: "PR #\(build.pr ?? 0) 预览") } label: { Label("在应用内打开预览", systemImage: "macwindow") }
            } else {
                LabeledContent("预览", value: url.host() ?? url.absoluteString)
            }
        case .other:
            EmptyView()
        }
    }

    private func run(_ action: BuildsAPI.Action) {
        busy = true
        Task {
            await store.send(action)
            busy = false
        }
    }

    private func install(_ build: BuildsSnapshot.Build) async {
        struct Response: Decodable { let url: String }
        busy = true
        defer { busy = false }
        do {
            let response: Response = try await API.shared.send("POST", "\(BuildsAPI.base)/\(build.id)/install")
            if let url = URL(string: response.url) { openURL(url) }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// 构建日志由服务端按字节偏移推送：断线后从读到的位置接着读，构建结束、读完了收到 end 就关上
@Observable
private final class BuildLog {
    private(set) var text = ""
    private(set) var ended = false
    @ObservationIgnored private var stream: EventStream?
    @ObservationIgnored private var offset: Int?

    // 只显示末尾，避免太长的日志拖慢列表
    private static let shownLimit = 60_000

    private struct Message: Decodable {
        let type: String
        let offset: Int?
        let text: String?
    }

    func start(_ id: String) {
        guard stream == nil, !ended else { return }
        let stream = EventStream(
            url: { [weak self] in
                API.shared.url("\(BuildsAPI.base)/\(id)/log/stream", query: self?.offset.map { ["from": String($0)] } ?? [:])
            },
            onMessage: { [weak self] message in self?.receive(message) },
            onRejected: { [weak self] error in
                self?.ended = true
                self?.text += "\n日志读取失败：\(error.localizedDescription)"
            }
        )
        self.stream = stream
        stream.start()
    }

    func stop() {
        stream?.stop()
        stream = nil
    }

    private func receive(_ message: SSEMessage) {
        guard let value = try? JSONDecoder.api.decode(Message.self, from: Data(message.data.utf8)) else { return }
        if value.type == "end" {
            ended = true
            stop()
            return
        }
        guard let chunk = value.text else { return }
        if offset == nil, (value.offset ?? 0) > 0 { text = "[仅显示日志末尾]\n" }
        if let id = message.id.flatMap(Int.init) { offset = id }
        text += chunk
        if text.count > Self.shownLimit { text = String(text.suffix(Self.shownLimit)) }
    }
}
