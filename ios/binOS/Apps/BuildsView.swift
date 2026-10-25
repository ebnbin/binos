import SwiftUI

struct BuildsSnapshot: Decodable {
    struct Artifact: Decodable, Hashable {
        let name: String
        let size: Double
        let sha256: String
    }

    struct Build: Decodable, Hashable, Identifiable {
        let id: String
        let commit: String
        let target: String
        let trigger: String
        let pr: Int?
        let status: String
        let createdAt: String
        let startedAt: String?
        let endedAt: String?
        let error: String?
        let artifacts: [Artifact]
    }

    struct Settings: Decodable {
        let automatic: Bool
        let adhoc: Bool
    }

    let builds: [Build]
    let settings: Settings
    let pollError: String?
    let checkedAt: String?
    let mode: String
}

enum BuildsAPI {
    static let base = "/api/apps/builds"

    struct Request: Encodable {
        let action: String
        var ref: String?
        var targets: [String]?
        var id: String?
        var automatic: Bool?
        var adhoc: Bool?
    }

    static func send(_ request: Request) async throws -> BuildsSnapshot {
        try await API.shared.send("POST", base, body: request)
    }

    static let targetNames = ["android": "Android APK", "ios-simulator": "iOS 模拟器", "ios-adhoc": "iOS Ad Hoc"]
    static let statusNames = ["queued": "排队中", "running": "构建中", "success": "成功", "failed": "失败", "cancelled": "已取消", "interrupted": "已中断"]
}

// 构建：移动端构建的队列和产物，每 4 秒更新
struct BuildsView: View {
    @State private var snapshot: BuildsSnapshot?
    @State private var error: String?
    @State private var filter = "all"
    @State private var ref = "main"
    @State private var targets = "both"

    var body: some View {
        List {
            Section {
                TextField("main、pr/编号或完整提交号", text: $ref)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Picker("目标", selection: $targets) {
                    Text("Android + iOS 模拟器").tag("both")
                    Text("Android APK").tag("android")
                    Text("iOS 模拟器").tag("ios-simulator")
                    Text("iOS Ad Hoc").tag("ios-adhoc")
                }
                Button("开始构建", systemImage: "hammer") {
                    let list = targets == "both" ? ["android", "ios-simulator"] : [targets]
                    run(.init(action: "enqueue", ref: ref.trimmingCharacters(in: .whitespaces), targets: list))
                }
                .disabled(ref.trimmingCharacters(in: .whitespaces).isEmpty)
            } header: {
                Text("新构建")
            } footer: {
                if let current = snapshot {
                    VStack(alignment: .leading) {
                        if current.mode == "mock" { Text("预览模式：模拟构建，与正式构建及签名隔离。") }
                        if let checked = current.checkedAt.flatMap(Date.init(iso:)) { Text("上次检查 \(checked.formatted(.relative(presentation: .named)))") }
                        if let pollError = current.pollError { Text(pollError).foregroundStyle(.red) }
                    }
                }
            }
            if let current = snapshot {
                Section {
                    Toggle("main 和 PR 有新提交时自动构建", isOn: Binding(get: { current.settings.automatic }, set: { run(.init(action: "settings", automatic: $0, adhoc: current.settings.adhoc)) }))
                    Toggle("自动构建包含 iOS Ad Hoc", isOn: Binding(get: { current.settings.adhoc }, set: { run(.init(action: "settings", automatic: current.settings.automatic, adhoc: $0)) }))
                }
                Section {
                    Picker("筛选", selection: $filter) {
                        Text("全部").tag("all")
                        Text("main").tag("main")
                        Text("PR").tag("pr")
                        Text("手动").tag("manual")
                    }
                    .pickerStyle(.segmented)
                    ForEach(current.builds.filter { filter == "all" || $0.trigger == filter }) { build in
                        NavigationLink { BuildDetail(build: build, mode: current.mode, onChange: { snapshot = $0 }) } label: { BuildRow(build: build) }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .overlay { if snapshot == nil && error == nil { ProgressView() } }
        .navigationTitle("构建")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("检查更新", systemImage: "arrow.clockwise") { run(.init(action: "poll")) }
            }
        }
        .task {
            while !Task.isCancelled {
                do {
                    snapshot = try await API.shared.get(BuildsAPI.base)
                    error = nil
                } catch is CancellationError {
                } catch {
                    self.error = error.localizedDescription
                }
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    private func run(_ request: BuildsAPI.Request) {
        Task {
            do {
                snapshot = try await BuildsAPI.send(request)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

private struct BuildRow: View {
    let build: BuildsSnapshot.Build

    var body: some View {
        HStack(spacing: 12) {
            StatusIcon(status: build.status)
            VStack(alignment: .leading, spacing: 3) {
                Text(BuildsAPI.targetNames[build.target] ?? build.target)
                HStack(spacing: 6) {
                    Text(String(build.commit.prefix(7))).monospaced()
                    Text(build.pr.map { "PR #\($0)" } ?? (build.trigger == "manual" ? "手动" : "main"))
                    if let created = Date(iso: build.createdAt) { Text(created, format: .relative(presentation: .named)) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
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
        case "failed": Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        case "queued": Image(systemName: "clock").foregroundStyle(.secondary)
        default: Image(systemName: "minus.circle").foregroundStyle(.secondary)
        }
    }
}

private struct BuildDetail: View {
    let build: BuildsSnapshot.Build
    let mode: String
    let onChange: (BuildsSnapshot) -> Void
    @State private var log = ""
    @State private var error: String?
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            Section {
                LabeledContent("状态", value: BuildsAPI.statusNames[build.status] ?? build.status)
                LabeledContent("提交") { Text(build.commit).font(.caption.monospaced()).textSelection(.enabled) }
                if let start = build.startedAt.flatMap(Date.init(iso:)) {
                    let end = build.endedAt.flatMap(Date.init(iso:)) ?? .now
                    LabeledContent("用时", value: Format.duration(end.timeIntervalSince(start)))
                }
                if build.status == "queued" || build.status == "running" {
                    Button("取消构建", role: .destructive) { run(.init(action: "cancel", id: build.id)) }
                } else {
                    Button("重新构建") { run(.init(action: "retry", id: build.id)) }
                }
                if mode == "real", build.status == "success", build.target == "ios-adhoc" {
                    Button("安装到这台设备", systemImage: "arrow.down.app") { Task { await install() } }
                }
            } footer: {
                if mode == "real", build.status == "success", build.target == "ios-adhoc" {
                    Text("仅限描述文件内已注册的设备，安装链接有效期 24 小时")
                }
            }
            if !build.artifacts.isEmpty {
                Section("产物") {
                    ForEach(build.artifacts, id: \.name) { artifact in
                        Button {
                            FilePresenter.shared.present(url: API.shared.url("\(BuildsAPI.base)/\(build.id)/artifacts/\(artifact.name)"), name: artifact.name)
                        } label: {
                            LabeledContent(artifact.name, value: Format.bytes(artifact.size))
                        }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
            Section {
                Text(log.isEmpty ? "等待构建日志…" : log)
                    .font(.system(.caption2, design: .monospaced))
                    .textSelection(.enabled)
            } header: {
                HStack {
                    Text("日志")
                    Spacer()
                    Button("下载完整日志") {
                        FilePresenter.shared.present(url: API.shared.url("\(BuildsAPI.base)/\(build.id)/log", query: ["download": "1"]), name: "build.log")
                    }
                    .font(.footnote)
                }
            }
        }
        .navigationTitle(BuildsAPI.targetNames[build.target] ?? build.target)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            while !Task.isCancelled {
                if let data = try? await API.shared.data(API.shared.request(API.shared.url("\(BuildsAPI.base)/\(build.id)/log"))) {
                    // 只显示末尾，避免太长的日志拖慢列表
                    log = String(String(decoding: data, as: UTF8.self).suffix(60_000))
                }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private func run(_ request: BuildsAPI.Request) {
        Task {
            do { onChange(try await BuildsAPI.send(request)) } catch { self.error = error.localizedDescription }
        }
    }

    private func install() async {
        struct Response: Decodable { let url: String }
        do {
            let response: Response = try await API.shared.send("POST", "\(BuildsAPI.base)/\(build.id)/install")
            if let url = URL(string: response.url) { openURL(url) }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
