import SwiftUI

struct AgentAccount: Decodable, Hashable {
    struct Detail: Decodable, Hashable {
        @Default<Defaults.Empty> var label: String
        @Default<Defaults.Empty> var value: String
        let note: String?
    }

    struct Token: Decodable, Hashable {
        let expiresAt: String?
        let refreshedAt: String?
        @Default<Defaults.False> var refreshable: Bool
    }

    let agent: String
    let version: String?
    @Default<Defaults.False> var loggedIn: Bool
    let email: String?
    let plan: String?
    let token: Token?
    @Lossy var details: [Detail]
    @Default<Defaults.Empty> var configDir: String
    @Default<Defaults.ZeroInt> var running: Int
}

// agent 的账号、登录、额度；可以就地重新登录
struct AgentAccountsView: View {
    @State private var accounts: [AgentAccount]?
    @State private var status: AgentStatus?
    @State private var login: LoginKind?
    private let hub = EventHub.shared

    enum LoginKind: Identifiable {
        case claude(String)
        case codex
        var id: String {
            switch self {
            case .claude(let kind): "claude-\(kind)"
            case .codex: "codex"
            }
        }
    }

    private static let plans = ["max": "Max", "pro": "Pro", "prolite": "Pro Lite", "plus": "Plus", "team": "Team", "enterprise": "Enterprise", "free": "Free"]

    var body: some View {
        List {
            ForEach(accounts ?? [], id: \.agent) { account in
                Section(Agents.name(account.agent)) {
                    LabeledContent("状态", value: account.version == nil ? "没有安装" : account.loggedIn ? "已登录" : "没有登录")
                    if let version = account.version { LabeledContent("版本", value: version) }
                    if let email = account.email { LabeledContent("账号", value: email) }
                    if let plan = account.plan { LabeledContent("套餐", value: Self.plans[plan] ?? plan) }
                    ForEach(account.details, id: \.self) { detail in
                        LabeledContent {
                            Text(detail.value)
                        } label: {
                            Text(detail.label)
                            if let note = detail.note { Text(note) }
                        }
                    }
                    if account.agent == "claude", let auth = status?.auth.claude {
                        ClaudeAuthRows(auth: auth)
                    }
                    if let attention = account.agent == "claude" ? AgentAttention.claude(status?.auth.claude, now: .now) : AgentAttention.codex(status?.auth.codex) {
                        Label(attention.text, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(attention.bad ? .red : .orange)
                    }
                    if let token = account.token, let expiry = token.expiresAt.flatMap(Date.init(iso:)) {
                        LabeledContent {
                            Text(expiry, format: .relative(presentation: .named)).foregroundStyle(expiry < .now ? .red : .secondary)
                        } label: {
                            Text("访问令牌到期")
                            if token.refreshable { Text("到期前会自动续期") }
                        }
                    }
                    if let limits = status?.limits[account.agent] {
                        QuotaRow(agent: account.agent, limits: limits)
                    }
                    LabeledContent("正在回答", value: "\(account.running) 个对话")
                    LabeledContent("配置目录") {
                        Text(account.configDir).font(.caption.monospaced()).textSelection(.enabled)
                    }
                    if account.agent == "claude" {
                        Button("重新登录") { login = .claude("login") }
                        Button(status?.auth.claude?.backup != nil ? "更新备用 token" : "生成备用 token") { login = .claude("token") }
                    } else if account.agent == "codex" {
                        Button(account.loggedIn ? "重新登录" : "登录") { login = .codex }
                    }
                }
            }
        }
        .overlay { if accounts == nil { ProgressView() } }
        .navigationTitle("Agent 账号")
        .refreshable { await load() }
        .task { await load() }
        .task(id: hub.agent) { status = try? await API.shared.get("/api/kita/status") }
        .sheet(item: $login) { kind in
            NavigationStack {
                switch kind {
                case .claude(let mode): ClaudeLoginView(kind: mode)
                case .codex: CodexLoginView()
                }
            }
        }
    }

    private func load() async {
        struct Response: Decodable { @Lossy var accounts: [AgentAccount] }
        if let response: Response = try? await API.shared.get("/api/kita/accounts") { accounts = response.accounts }
    }
}

// Claude 的两份登录：正在用哪份、各自什么时候到期，和网页的 claude/view.tsx 的 authRows 一致
private struct ClaudeAuthRows: View {
    let auth: ClaudeAuth

    var body: some View {
        let now = Date.now
        let full = auth.login
        let fullExpiry = full?.expiresAt.flatMap(Date.init(iso:))
        let fullExpired = fullExpiry.map { $0 <= now } ?? false
        LabeledContent("正在用") {
            Text(["login": "完整登录", "token": "备用 token", "none": "没有能用的登录"][auth.mode] ?? auth.mode)
                .foregroundStyle(auth.mode == "none" ? .red : .secondary)
        }
        LabeledContent {
            Text(full == nil ? "没有" : full?.broken == true ? "已失效" : fullExpiry.map { fullExpired ? "已过期" : "还有 \(AgentAttention.daysLeft($0, now: now)) 天" } ?? "已登录")
                .foregroundStyle(full == nil || full?.broken == true || fullExpired ? .red : .secondary)
        } label: {
            Text("完整登录")
            if let fullExpiry, full?.broken != true {
                Text("\(fullExpiry.formatted(date: .abbreviated, time: .shortened))到期，之后只能重新登录")
            } else {
                Text("回答时认证失败了，重新登录后自动换回来")
            }
        }
        LabeledContent {
            Text(auth.backup.map { backup in backup.expiresAt.flatMap(Date.init(iso:)).map { "还有 \(AgentAttention.daysLeft($0, now: now)) 天" } ?? "已存好" } ?? "没有")
        } label: {
            Text("备用 token")
            Text("完整登录过期或失效时自动换用，只能回答，没有 claude.ai 的连接器")
        }
    }
}

// Claude 的登录：在浏览器里授权，把页面给的授权码贴回来
private struct ClaudeLoginView: View {
    let kind: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var flow: (id: String, url: URL)?
    @State private var code = ""
    @State private var error: String?
    @State private var working = false

    var body: some View {
        Form {
            if let flow {
                Section {
                    Button("在浏览器中授权", systemImage: "safari") { openURL(flow.url) }
                } footer: {
                    Text("授权后页面会显示一段授权码，复制后贴到下面")
                }
                Section {
                    TextField("授权码", text: $code)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("完成登录") { Task { await submit(flow.id) } }
                        .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || working)
                }
            } else if error == nil {
                ProgressView()
            }
            if let error {
                Text(error).foregroundStyle(.red)
            }
        }
        .navigationTitle(kind == "token" ? "生成备用 token" : "登录 Claude")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("取消") {
                    if let id = flow?.id { Task { try? await API.shared.post("/api/kita/claude/login/\(id)/cancel") } }
                    dismiss()
                }
            }
        }
        .task {
            struct Body: Encodable { let kind: String }
            struct Response: Decodable { let id: String; let url: String }
            do {
                let response: Response = try await API.shared.send("POST", "/api/kita/claude/login", body: Body(kind: kind))
                if let url = URL(string: response.url) { flow = (response.id, url) }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func submit(_ id: String) async {
        struct Body: Encodable { let code: String }
        working = true
        defer { working = false }
        do {
            try await API.shared.post("/api/kita/claude/login/\(id)", body: Body(code: code.trimmingCharacters(in: .whitespaces)))
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// Codex 的登录：在浏览器里输入设备码，这里等它完成
private struct CodexLoginView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var flow: (id: String, url: URL, code: String)?
    @State private var error: String?

    var body: some View {
        Form {
            if let flow {
                Section {
                    Text(flow.code).font(.title.monospaced().bold()).textSelection(.enabled)
                    Button("复制并在浏览器中打开", systemImage: "safari") {
                        UIPasteboard.general.string = flow.code
                        openURL(flow.url)
                    }
                } footer: {
                    Text("在打开的页面输入这段代码，完成后这里会自动关闭")
                }
                HStack { ProgressView(); Text("等待授权") }
            } else if error == nil {
                ProgressView()
            }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .navigationTitle("登录 Codex")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("取消") {
                    if let id = flow?.id { Task { try? await API.shared.post("/api/kita/codex/login/\(id)/cancel") } }
                    dismiss()
                }
            }
        }
        .task {
            struct Response: Decodable { let id: String; let url: String; let code: String }
            struct Poll: Decodable { let status: String; let error: String? }
            do {
                let response: Response = try await API.shared.send("POST", "/api/kita/codex/login")
                guard let url = URL(string: response.url) else { return }
                flow = (response.id, url, response.code)
                while !Task.isCancelled {
                    try await Task.sleep(for: .seconds(2))
                    let poll: Poll = try await API.shared.get("/api/kita/codex/login/\(response.id)")
                    if poll.status == "done" { dismiss(); return }
                    if poll.status == "failed" { error = poll.error ?? "登录失败"; return }
                }
            } catch is CancellationError {
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
