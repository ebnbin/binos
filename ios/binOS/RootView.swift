import SwiftUI

// 桌面和尺寸调试页二选一：桌面上第一个图标打开调试页，调试页上的按钮回到桌面；第二个图标换一组随机内容
struct RootView: View {
    @State private var metrics = false
    @State private var scene = DesktopScene.random()

    var body: some View {
        ZStack(alignment: .topLeading) {
            if metrics {
                MetricsView { metrics = false }
            } else {
                Color.black
                DesktopView(scene: scene) { action in
                    switch action {
                    case .metrics: metrics = true
                    case .shuffle: scene = .random()
                    }
                }
                SystemBarView()
            }
        }
        .ignoresSafeArea()
    }
}
