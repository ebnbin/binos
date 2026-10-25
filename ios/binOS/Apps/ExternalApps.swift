import SwiftUI
import WebKit

struct ExternalApp: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var icon: String
    var url: String

    // 网页用的图标名对应到系统图标
    static let symbols = [
        "app-window": "macwindow", "globe": "globe", "puzzle": "puzzlepiece", "swords": "figure.fencing", "gamepad-2": "gamecontroller",
        "book-open": "book", "newspaper": "newspaper", "graduation-cap": "graduationcap", "briefcase": "briefcase", "chart-line": "chart.xyaxis.line",
        "wallet": "wallet.bifold", "calculator": "plus.forwardslash.minus", "shopping-cart": "cart", "mail": "envelope", "message-circle": "message",
        "camera": "camera", "image": "photo", "film": "film", "music": "music.note", "code": "chevron.left.forwardslash.chevron.right",
        "terminal": "apple.terminal", "database": "cylinder", "cloud": "cloud", "lock": "lock", "house": "house", "map": "map",
        "plane": "airplane", "utensils": "fork.knife", "dumbbell": "dumbbell", "leaf": "leaf", "heart": "heart", "star": "star",
    ]

    var symbol: String { Self.symbols[icon] ?? "macwindow" }
}

// 编辑时整份写回服务端，所以不宽松解码：丢掉解不开的项再写回会删掉它们
struct AppRegistry: Codable {
    var external: [ExternalApp]
}

// 外部 app：独立部署的网页 app，在 app 里的网页视图打开；清单所有设备共用
struct ExternalAppsSection: View {
    @State private var registry: AppRegistry?
    @State private var editing: ExternalApp?
    @State private var error: String?
    private let hub = EventHub.shared

    var body: some View {
        Section {
            ForEach(registry?.external ?? []) { app in
                NavigationLink {
                    if let url = URL(string: app.url) { WebAppView(url: url, title: app.name) }
                } label: {
                    Label(app.name, systemImage: app.symbol)
                }
                .swipeActions {
                    Button("删除", systemImage: "trash", role: .destructive) { save { $0.external.removeAll { $0.id == app.id } } }
                    Button("编辑", systemImage: "pencil") { editing = app }
                }
                .contextMenu {
                    Button("编辑", systemImage: "pencil") { editing = app }
                    Button("删除", systemImage: "trash", role: .destructive) { save { $0.external.removeAll { $0.id == app.id } } }
                }
            }
            if let error { Text(error).foregroundStyle(.red).font(.footnote) }
        } header: {
            HStack {
                Text("外部 app")
                Spacer()
                Button("添加", systemImage: "plus") {
                    editing = ExternalApp(id: String(UUID().uuidString.lowercased().prefix(8)), name: "", icon: "app-window", url: "https://")
                }
                .labelStyle(.iconOnly)
            }
        }
        .task(id: hub.apps) { registry = try? await API.shared.get("/api/apps") }
        .sheet(item: $editing) { app in
            ExternalAppEditor(app: app) { updated in
                save { registry in
                    if let index = registry.external.firstIndex(where: { $0.id == updated.id }) {
                        registry.external[index] = updated
                    } else {
                        registry.external.append(updated)
                    }
                }
            }
        }
    }

    // 整份替换；失败时重新读取
    private func save(_ change: (inout AppRegistry) -> Void) {
        guard var next = registry else { return }
        change(&next)
        registry = next
        Task {
            do {
                let _: Ignored = try await API.shared.send("PUT", "/api/apps", body: next)
                error = nil
            } catch {
                self.error = "保存失败：\(error.localizedDescription)"
                registry = try? await API.shared.get("/api/apps")
            }
        }
    }
}

private struct ExternalAppEditor: View {
    @State var app: ExternalApp
    let onSave: (ExternalApp) -> Void
    @Environment(\.dismiss) private var dismiss

    private var valid: Bool {
        guard let url = URL(string: app.url.trimmingCharacters(in: .whitespaces)), ["http", "https"].contains(url.scheme), url.host() != nil else { return false }
        return !app.name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField("名称", text: $app.name)
                TextField("网址", text: $app.url)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Picker("图标", selection: $app.icon) {
                    ForEach(ExternalApp.symbols.keys.sorted(), id: \.self) { key in
                        Label(key, systemImage: ExternalApp.symbols[key]!).tag(key)
                    }
                }
            }
            .navigationTitle(app.name.isEmpty ? "添加 app" : app.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        app.name = app.name.trimmingCharacters(in: .whitespaces)
                        app.url = app.url.trimmingCharacters(in: .whitespaces)
                        onSave(app)
                        dismiss()
                    }
                    .disabled(!valid)
                }
            }
        }
    }
}

// 网页 app：全屏的网页视图，带前进后退
struct WebAppView: View {
    let url: URL
    let title: String
    @State private var page = WebPage()

    var body: some View {
        WebView(page)
            .navigationTitle(page.title.isEmpty ? title : page.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .tabBar)
            .toolbar {
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("后退", systemImage: "chevron.backward") {
                        if let item = page.backForwardList.backList.last { page.load(item) }
                    }
                    .disabled(page.backForwardList.backList.isEmpty)
                    Button("前进", systemImage: "chevron.forward") {
                        if let item = page.backForwardList.forwardList.first { page.load(item) }
                    }
                    .disabled(page.backForwardList.forwardList.isEmpty)
                    Spacer()
                    Button("刷新", systemImage: "arrow.clockwise") { page.reload() }
                    if let current = page.url { ShareLink(item: current) }
                }
            }
            .onAppear { if page.url == nil { page.load(URLRequest(url: url)) } }
    }
}
