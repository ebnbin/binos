import SwiftUI

@main
struct binOSApp: App {
    var body: some Scene {
        WindowGroup {
            // 系统手势只能推迟：每条边第一次滑动交给 app，第二次才由系统处理。
            // 不隐藏 Home 指示条：隐藏它会让底边的推迟失效
            MetricsView()
                .providesSystemGeometry()
                .statusBarHidden()
                .defersSystemGestures(on: .all)
        }
    }
}
