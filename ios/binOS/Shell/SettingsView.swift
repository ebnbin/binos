import SwiftUI
import WebKit

// 连接哪个 binOS：正式版，或者 pnpm dev 启动的测试实例
struct SettingsView: View {
    @Bindable private var api = API.shared
    private let hub = EventHub.shared
    @State private var address = ""
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section {
                LabeledContent("状态", value: hub.connected ? "已连接" : "未连接")
                if let version = hub.serverVersion {
                    LabeledContent("版本", value: String(version.prefix(7)))
                }
                if let serverProtocol = hub.serverProtocol {
                    LabeledContent("接口", value: hub.protocolMismatch ? "\(serverProtocol)（app 是 \(BinOSProtocol.protocolID)）" : serverProtocol)
                }
            } header: {
                Text(api.server.name)
            }
            Section("服务器") {
                ForEach(api.recentServers) { server in
                    Button {
                        api.select(server)
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(server.name)
                                Text(server.requiresLogin ? "经 Cloudflare Access 登录" : "测试实例，无需登录")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if server == api.server {
                                Image(systemName: "checkmark").foregroundStyle(.tint)
                            }
                        }
                    }
                    .foregroundStyle(.primary)
                }
                HStack {
                    TextField("http://127.0.0.1:端口", text: $address)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(connect)
                    Button("连接", action: connect)
                        .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if let error {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
            }
            if api.server.requiresLogin {
                Section {
                    Button("重新登录") { api.needsLogin = true }
                    Button("退出登录", role: .destructive) {
                        Task { await logout() }
                    }
                }
            }
        }
        .navigationTitle("连接")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("完成") { dismiss() }
            }
        }
    }

    private func connect() {
        var text = address.trimmingCharacters(in: .whitespaces)
        if !text.contains("://") {
            let local = text.hasPrefix("localhost") || text.hasPrefix("127.") || text.first?.isNumber == true
            text = (local ? "http://" : "https://") + text
        }
        guard let url = URL(string: text), url.host() != nil, ["http", "https"].contains(url.scheme) else {
            error = "请输入有效的地址"
            return
        }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.path = ""
        components.query = nil
        error = nil
        address = ""
        api.select(ServerProfile(url: components.url!))
    }

    private func logout() async {
        let store = WKWebsiteDataStore.default()
        let records = await store.dataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes())
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: records)
        for cookie in HTTPCookieStorage.shared.cookies ?? [] {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
        api.needsLogin = true
    }
}
