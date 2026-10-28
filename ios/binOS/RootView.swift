import SwiftUI

// 桌面和尺寸调试页二选一：桌面上第一个图标打开调试页，调试页上的按钮回到桌面；第二个图标换一组随机内容
struct RootView: View {
    @State private var metrics = false
    @State private var scene = DesktopScene.random()
    @Environment(\.systemGeometry) private var geometry

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
                UnevenRoundedRectangle(cornerRadii: geometry.systemBar.area.cornerRadii)
                    .path(in: CGRect(origin: .zero, size: geometry.window))
                    .intersection(Path(geometry.systemBar.area.frame))
                    .fill(Color(white: 0.12))
            }
        }
        .ignoresSafeArea()
    }
}
