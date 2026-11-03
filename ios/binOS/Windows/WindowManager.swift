import Foundation
import Observation

// 一个打开的 app 的窗口。每个 app 只有一个窗口
struct AppWindow: Identifiable, Equatable {
    let id = UUID()
    let app: SampleApp
}

// 打开了哪些窗口、哪个在前台。每个场景一份
@Observable
final class WindowManager {
    // 按打开的先后排
    private(set) var windows: [AppWindow] = []
    // 没有时在桌面
    private(set) var foreground: AppWindow.ID?

    // 已经打开的切到前台，不重复打开
    func open(_ app: SampleApp) {
        if let window = windows.first(where: { $0.app.id == app.id }) {
            foreground = window.id
        } else {
            let window = AppWindow(app: app)
            windows.append(window)
            foreground = window.id
        }
    }

    func activate(_ id: AppWindow.ID) {
        guard windows.contains(where: { $0.id == id }) else { return }
        foreground = id
    }

    func showDesktop() {
        foreground = nil
    }

    // 关掉前台的窗口后回到桌面
    func close(_ id: AppWindow.ID) {
        windows.removeAll { $0.id == id }
        if foreground == id { foreground = nil }
    }
}
