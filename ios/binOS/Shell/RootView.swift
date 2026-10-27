import SwiftUI

enum AppTab: Hashable {
    case code, terminal, music, files, more
}

// 外壳：底部标签切换各个 app，顶部显示连接状态，正式版需要时弹出登录
struct RootView: View {
    @Bindable private var router = AppRouter.shared
    @State private var ready = false
    @Bindable private var api = API.shared
    private let hub = EventHub.shared
    private let player = MusicPlayer.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if ready {
                tabs
            } else {
                ProgressView()
            }
        }
        .modifier(FilePresenterModifier())
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                ConnectionBanner()
                ProtocolBanner()
            }
        }
        .fullScreenCover(isPresented: $api.needsLogin) {
            LoginView(server: api.server) { hub.restart() }
        }
        .task {
            await LoginView.copyWebCookies(for: api.server)
            ready = true
            // 启动参数 -openURL binos://… 直接打开某个页面
            if let link = UserDefaults.standard.string(forKey: "openURL").flatMap(URL.init(string:)) { router.open(link) }
            hub.start()
            player.start()
        }
        .onOpenURL { router.open($0) }
        .task(id: hub.music) {
            await player.refreshQueue()
            await player.refreshProviders()
        }
        .task(id: hub.apps) { await AppsStore.shared.refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { hub.reconnectIfStale() }
        }
        .onChange(of: api.server) {
            Task {
                await LoginView.copyWebCookies(for: api.server)
                hub.restart()
                player.restart()
            }
        }
    }

    private var tabs: some View {
        TabView(selection: $router.tab) {
            Tab("Code", systemImage: "chevron.left.forwardslash.chevron.right", value: .code) {
                CodeRootView()
            }
            Tab("终端", systemImage: "apple.terminal", value: .terminal) {
                TerminalRootView()
            }
            Tab("音乐", systemImage: "music.note", value: .music) {
                MusicRootView()
            }
            Tab("文件", systemImage: "folder", value: .files) {
                FilesRootView()
            }
            Tab("更多", systemImage: "square.grid.2x2", value: .more) {
                MoreView()
            }
        }
        .tabViewBottomAccessory(isEnabled: player.current != nil) {
            MiniPlayer { router.tab = .music }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
    }
}

// 服务端的接口和这个版本的 app 不一样时提示更新，可以关掉；服务端再换版本时重新提示
struct ProtocolBanner: View {
    private let hub = EventHub.shared
    @State private var dismissed: String?

    var body: some View {
        Group {
            if hub.protocolMismatch, let current = hub.serverProtocol, dismissed != current {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.down.app")
                    Text("服务端已更新，这个版本的 app 可能有部分内容显示不正确，请更新 app")
                    Button("关闭", systemImage: "xmark") { dismissed = current }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.plain)
                }
                .font(.footnote)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .glassEffect()
                .padding(.horizontal)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: hub.protocolMismatch)
    }
}

// 全局通知断开时提示正在重连；连不上时可以去设置里换服务器
struct ConnectionBanner: View {
    private let hub = EventHub.shared
    @State private var showSettings = false
    @State private var waited = false

    var body: some View {
        Group {
            if !hub.connected && (hub.everConnected || waited) && !API.shared.needsLogin {
                Button { showSettings = true } label: {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text(hub.everConnected ? "连接已断开，正在重连…" : "无法连接 \(API.shared.server.name)")
                    }
                    .font(.footnote)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                .glassEffect()
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: hub.connected)
        .task {
            try? await Task.sleep(for: .seconds(4))
            waited = true
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack { SettingsView() }
        }
    }
}
