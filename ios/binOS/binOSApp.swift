import SwiftUI

@main
struct binOSApp: App {
    var body: some Scene {
        WindowGroup {
            // 系统手势只能推迟：每条边第一次滑动交给 app，第二次才由系统处理
            MetricsView()
                .statusBarHidden()
                .persistentSystemOverlays(.hidden)
                .defersSystemGestures(on: .all)
        }
    }
}
