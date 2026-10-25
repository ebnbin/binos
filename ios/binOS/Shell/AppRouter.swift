import Foundation
import Observation

enum MoreRoute: Hashable {
    case system, accounts, browser, calendar, builds, devices, settings
    case kita, kitaProfile, kitaMemories
    case kitaMemory(String)
    // id 为 nil 是新对话
    case kitaChat(String?, temporary: Bool)
}

// 整个 app 的导航状态，深链接 binos://… 也走这里：
// binos://code/<id>、binos://code/new、binos://code/builds?ref=…、binos://terminal/<会话 id>、binos://music/now、binos://files?path=…、binos://more/<页面>、binos://more/browser?url=…、
// binos://kita、binos://kita/c/<id>、binos://kita/temporary、binos://kita/memories、binos://kita/profile
@Observable
final class AppRouter {
    static let shared = AppRouter()

    var tab = AppTab.code
    var code: CodeRoute?
    var terminal: String?
    var files: String?
    var nowPlaying = false
    var more: [MoreRoute] = []
    // 浏览器要打开的网址，打开后清空
    var browser: URL?

    private init() {}

    func open(_ url: URL) {
        guard url.scheme == "binos" else { return }
        let parts = url.pathComponents.filter { $0 != "/" }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        switch url.host() {
        case "code":
            tab = .code
            if parts.first == "new" {
                code = .new(project: query.first { $0.name == "project" }?.value ?? "binos")
            } else if let id = parts.first.flatMap(Int.init) {
                code = .session(id, item: query.first { $0.name == "item" }?.value.flatMap(Int.init))
            } else if parts.first == "builds" {
                code = .builds(ref: query.first { $0.name == "ref" }?.value ?? "main")
            } else if parts.first == "devices" {
                code = .devices
            } else {
                code = nil
            }
        case "terminal":
            tab = .terminal
            terminal = parts.first
        case "music":
            tab = .music
            nowPlaying = parts.first == "now"
        case "files":
            tab = .files
            files = query.first { $0.name == "path" }?.value
        case "more":
            tab = .more
            let routes: [String: MoreRoute] = ["system": .system, "accounts": .accounts, "browser": .browser, "calendar": .calendar, "builds": .builds, "devices": .devices, "settings": .settings]
            more = parts.first.flatMap { routes[$0] }.map { [$0] } ?? []
            browser = query.first { $0.name == "url" }?.value.flatMap(BrowserAddress.parse)
        case "kita":
            tab = .more
            switch parts.first {
            case "c": more = [.kita] + (parts.dropFirst().first.map { [.kitaChat($0, temporary: false)] } ?? [])
            case "temporary": more = [.kita, .kitaChat(nil, temporary: true)]
            case "new": more = [.kita, .kitaChat(nil, temporary: false)]
            case "memories": more = [.kita, .kitaMemories]
            case "profile": more = [.kita, .kitaProfile]
            default: more = [.kita]
            }
        default:
            break
        }
    }
}
