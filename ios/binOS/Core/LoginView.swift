import SwiftUI
import WebKit

// 正式版前面有 Cloudflare Access：在网页里走完它的登录，回到 binOS 的域名后，把网页拿到的 cookie 交给原生的网络层
struct LoginView: View {
    let server: ServerProfile
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var page = WebPage(configuration: LoginView.configuration)
    @State private var checking = false

    private static var configuration: WebPage.Configuration {
        var configuration = WebPage.Configuration()
        configuration.websiteDataStore = .default()
        return configuration
    }

    var body: some View {
        NavigationStack {
            WebView(page)
                .ignoresSafeArea(edges: .bottom)
                .overlay {
                    if page.isLoading && page.url == nil { ProgressView() }
                }
                .navigationTitle("登录 \(server.name)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消", role: .cancel) { dismiss() }
                    }
                    ToolbarItem(placement: .status) {
                        if checking { ProgressView() }
                    }
                }
        }
        .task {
            // Google 等登录方式不接受内嵌网页的默认 User-Agent
            page.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1"
            page.load(URLRequest(url: server.url))
            do {
                for try await event in page.navigations {
                    if case .finished = event, page.url?.host() == server.url.host() {
                        await syncCookies()
                    }
                }
            } catch {
                // 导航失败（比如网络断开）时停在当前页，用户可以取消重来
            }
        }
    }

    private func syncCookies() async {
        checking = true
        defer { checking = false }
        await LoginView.copyWebCookies(for: server)
        do {
            let _: Ignored = try await API.shared.get("/api/apps")
            API.shared.needsLogin = false
            onDone()
            dismiss()
        } catch {
            // 还在登录流程中间，等下一次跳转
        }
    }

    // 网页登录留下的 cookie（包括 HttpOnly 的 CF_Authorization）复制到原生网络层；启动时也调用一次，接上上次的登录
    static func copyWebCookies(for server: ServerProfile) async {
        guard let host = server.url.host() else { return }
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        for cookie in cookies where host.hasSuffix(cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) {
            HTTPCookieStorage.shared.setCookie(cookie)
        }
    }
}
