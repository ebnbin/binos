import SwiftUI
import WebKit

// 浏览器：本机的网页视图，或者远程操作宿主 Mac 上的 Chrome（画面是截图流，点击、滚动、输入转发过去）
struct BrowserView: View {
    @AppStorage("browser/remote") private var remote = false

    var body: some View {
        Group {
            if remote {
                RemoteBrowserView()
            } else {
                LocalBrowserView()
            }
        }
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("模式", selection: $remote) {
                    Text("本机").tag(false)
                    Text("远程 Chrome").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 200)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

enum BrowserAddress {
    // 没写协议时补上 https，本机地址补 http
    nonisolated static func parse(_ input: String) -> URL? {
        let text = input.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, !text.contains(" ") else { return nil }
        if text.contains("://") { return URL(string: text).flatMap { ["http", "https"].contains($0.scheme) ? $0 : nil } }
        let local = text.hasPrefix("localhost") || text.hasPrefix("127.") || text.hasPrefix("[::1]")
        return URL(string: (local ? "http://" : "https://") + text)
    }
}

private struct AddressBar: View {
    @Binding var address: String
    let onSubmit: (URL) -> Void

    var body: some View {
        TextField("输入网址", text: $address)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.go)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.quaternary, in: .capsule)
            .onSubmit {
                if let url = BrowserAddress.parse(address) { onSubmit(url) }
            }
    }
}

private struct LocalBrowserView: View {
    @State private var page = WebPage()
    @State private var address = ""

    var body: some View {
        VStack(spacing: 0) {
            AddressBar(address: $address) { page.load(URLRequest(url: $0)) }
                .padding(8)
            if page.url == nil {
                ContentUnavailableView("输入网址开始浏览", systemImage: "safari")
                    .frame(maxHeight: .infinity)
            } else {
                WebView(page)
                    .overlay(alignment: .top) {
                        if page.isLoading {
                            ProgressView(value: page.estimatedProgress).progressViewStyle(.linear)
                        }
                    }
            }
            HStack {
                Button("后退", systemImage: "chevron.backward") {
                    if let item = page.backForwardList.backList.last { page.load(item) }
                }
                .disabled(page.backForwardList.backList.isEmpty)
                Spacer()
                Button("前进", systemImage: "chevron.forward") {
                    if let item = page.backForwardList.forwardList.first { page.load(item) }
                }
                .disabled(page.backForwardList.forwardList.isEmpty)
                Spacer()
                Button("刷新", systemImage: "arrow.clockwise") { page.reload() }
                Spacer()
                if let url = page.url { ShareLink(item: url) } else { Image(systemName: "square.and.arrow.up").foregroundStyle(.tertiary) }
            }
            .labelStyle(.iconOnly)
            .padding(.horizontal, 24)
            .padding(.vertical, 10)
        }
        .onChange(of: page.url) { _, url in address = url?.absoluteString ?? address }
        .onChange(of: AppRouter.shared.browser, initial: true) { _, url in
            if let url {
                AppRouter.shared.browser = nil
                page.load(URLRequest(url: url))
            }
        }
    }
}

// 远程浏览器：宿主 Mac 上 Chrome 的一个标签页
private struct RemoteBrowserView: View {
    @State private var connection = RemoteBrowserConnection()
    @State private var address = ""
    @State private var typing = ""
    @FocusState private var keyboard: Bool
    @State private var dragLast: CGPoint?
    // 按键栏上按下的修饰键，和下一个键一起发出去
    @State private var modifiers: KeyModifiers = []

    var body: some View {
        VStack(spacing: 0) {
            AddressBar(address: $address) { connection.send(["type": "navigate", "url": $0.absoluteString]) }
                .padding(8)
            GeometryReader { geometry in
                ZStack {
                    Color(.secondarySystemBackground)
                    if let image = connection.image {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                    } else {
                        VStack(spacing: 8) {
                            ProgressView()
                            Text(connection.status).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                .contentShape(.rect)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            let point = connection.map(value.location, in: geometry.size)
                            if let last = dragLast {
                                connection.send(["type": "wheel", "x": point.x, "y": point.y, "deltaX": last.x - value.location.x, "deltaY": last.y - value.location.y])
                            } else if value.translation.width.magnitude + value.translation.height.magnitude > 8 {
                                dragLast = value.startLocation
                            }
                            if dragLast != nil { dragLast = value.location }
                        }
                        .onEnded { value in
                            if dragLast == nil {
                                let point = connection.map(value.location, in: geometry.size)
                                for action in ["down", "up"] {
                                    connection.send(["type": "pointer", "action": action, "x": point.x, "y": point.y, "button": "left", "buttons": action == "down" ? 1 : 0, "clickCount": 1])
                                }
                            }
                            dragLast = nil
                        }
                )
                .onChange(of: geometry.size, initial: true) { _, size in connection.resize(size) }
            }
            // 键盘输入：文字整段发过去，回车和退格单独发按键；按着修饰键时（按键栏上的或者外接键盘的）字母、数字作为组合键发
            TextField("", text: $typing)
                .focused($keyboard)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .onChange(of: typing) { old, new in
                    if new.count > old.count, new.hasPrefix(old) {
                        let added = String(new.dropFirst(old.count))
                        if !modifiers.isEmpty, added.count == 1, let key = RemoteKey.character(added.first!) {
                            connection.key(key.key, code: key.code, modifiers: modifiers.union(key.shift ? .shift : []))
                            modifiers = []
                        } else {
                            connection.send(["type": "text", "text": added])
                        }
                    } else if new.count < old.count {
                        connection.key("Backspace", code: "Backspace", modifiers: modifiers)
                        modifiers = []
                    }
                    if new.count > 200 { typing = " " }
                }
                .onSubmit {
                    connection.key("Enter", code: "Enter", modifiers: modifiers)
                    modifiers = []
                    keyboard = true
                }
                .onKeyPress(phases: .down) { press in
                    let held = KeyModifiers(press.modifiers)
                    if let special = RemoteKey.special(press.key) {
                        connection.key(special.key, code: special.code, modifiers: held.union(modifiers))
                        modifiers = []
                        return .handled
                    }
                    guard !held.subtracting(.shift).isEmpty, let character = press.characters.first, let key = RemoteKey.character(character) else { return .ignored }
                    connection.key(key.key, code: key.code, modifiers: held.union(modifiers))
                    modifiers = []
                    return .handled
                }
            if keyboard {
                KeyBar(modifiers: $modifiers) { key in
                    connection.key(key.key, code: key.code, modifiers: modifiers)
                    modifiers = []
                }
            }
            HStack {
                Button("后退", systemImage: "chevron.backward") { connection.send(["type": "back"]) }.disabled(!connection.state.canBack)
                Spacer()
                Button("前进", systemImage: "chevron.forward") { connection.send(["type": "forward"]) }.disabled(!connection.state.canForward)
                Spacer()
                Button("刷新", systemImage: "arrow.clockwise") { connection.send(["type": "reload"]) }
                Spacer()
                Button("键盘", systemImage: "keyboard") {
                    typing = " "
                    keyboard.toggle()
                }
                Spacer()
                Button("关闭标签页", systemImage: "xmark.square") { connection.close() }
            }
            .labelStyle(.iconOnly)
            .padding(.horizontal, 24)
            .padding(.vertical, 10)
        }
        .onAppear {
            connection.pending = AppRouter.shared.browser
            AppRouter.shared.browser = nil
            connection.connect()
        }
        .onDisappear { connection.disconnect() }
        .onChange(of: connection.state.url) { _, url in address = url }
    }
}

@Observable
final class RemoteBrowserConnection {
    struct State: Decodable, Equatable {
        var url = ""
        var title = ""
        var canBack = false
        var canForward = false
    }

    private(set) var image: UIImage?
    private(set) var state = State()
    private(set) var status = "正在连接 Chrome"
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var session: String?
    @ObservationIgnored private var frame = 0
    @ObservationIgnored private var chunks: [String] = []
    @ObservationIgnored private var viewport = CGSize(width: 390, height: 700)
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var size = CGSize.zero
    @ObservationIgnored private var ready = false
    @ObservationIgnored private var closed = false
    // 连上后要打开的网址
    @ObservationIgnored var pending: URL?

    func connect() {
        generation += 1
        let current = generation
        closed = false
        ready = false
        let api = API.shared
        var request = api.request(api.webSocketURL("/api/apps/browser/socket", query: session.map { ["session": $0] } ?? [:]))
        request.setValue(api.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        let task = api.session.webSocketTask(with: request)
        task.maximumMessageSize = 1 << 20
        self.task = task
        task.resume()
        Task { await receive(task, current) }
    }

    func disconnect() {
        generation += 1
        task?.cancel(with: .goingAway, reason: nil)
    }

    func close() {
        closed = true
        send(["type": "close"])
        session = nil
        image = nil
        status = "标签页已关闭"
    }

    private func receive(_ task: URLSessionWebSocketTask, _ current: Int) async {
        var attempts = 0
        do {
            while true {
                let message = try await task.receive()
                attempts = 0
                guard current == generation, case .string(let text) = message,
                      let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                      let type = object["type"] as? String else { continue }
                handle(type, object)
            }
        } catch {
            guard current == generation, !closed else { return }
            attempts += 1
            status = "连接断开，正在重连"
            try? await Task.sleep(for: .seconds(1.5))
            if current == generation { connect() }
        }
    }

    private func handle(_ type: String, _ object: [String: Any]) {
        switch type {
        case "ready":
            session = object["id"] as? String
            ready = true
            status = "已连接"
            resize(size)
            if let pending {
                self.pending = nil
                send(["type": "navigate", "url": pending.absoluteString])
            }
        case "state":
            if let data = try? JSONSerialization.data(withJSONObject: object["state"] ?? [:]), let decoded = try? JSONDecoder.api.decode(State.self, from: data) {
                state = decoded
            }
        case "frame":
            guard let number = object["frame"] as? Int, let data = object["data"] as? String else { return }
            if number != frame {
                frame = number
                chunks = []
            }
            chunks.append(data)
            if let width = object["width"] as? Double, let height = object["height"] as? Double { viewport = CGSize(width: width, height: height) }
            if object["more"] as? Bool == true {
                send(["type": "ack", "frame": number])
            } else {
                if let bytes = Data(base64Encoded: chunks.joined()), let decoded = UIImage(data: bytes) { image = decoded }
                chunks = []
                send(["type": "ack", "frame": number])
            }
        case "ping":
            send(["type": "ping"])
        case "error":
            status = object["message"] as? String ?? "出错了"
        case "replaced":
            status = "已在别处打开"
            generation += 1
        case "closed":
            generation += 1
        default:
            break
        }
    }

    func send(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(text)) { _ in }
    }

    func key(_ key: String, code: String, modifiers: KeyModifiers = []) {
        for action in ["down", "up"] { send(["type": "key", "action": action, "key": key, "code": code, "modifiers": modifiers.rawValue]) }
    }

    func resize(_ size: CGSize) {
        self.size = size
        guard ready, size.width > 0, size.height > 0 else { return }
        send(["type": "resize", "width": Int(min(size.width, 4096)), "height": Int(min(size.height, 4096)), "scale": 2])
    }

    // 视图里的点换算成页面的坐标：画面按比例缩放居中
    func map(_ point: CGPoint, in container: CGSize) -> CGPoint {
        let scale = min(container.width / viewport.width, container.height / viewport.height)
        let offsetX = (container.width - viewport.width * scale) / 2
        let offsetY = (container.height - viewport.height * scale) / 2
        let x = min(max((point.x - offsetX) / scale, 0), viewport.width)
        let y = min(max((point.y - offsetY) / scale, 0), viewport.height)
        return CGPoint(x: x.rounded(), y: y.rounded())
    }
}
