import SwiftUI

// 桌面、窗口和系统栏：桌面上第一个图标打开尺寸调试页，盖在最上面，调试页上的按钮回到这里；第二个图标换一组随机内容；
// 其余的图标和小组件打开一个假 app 的窗口
struct RootView: View {
    @State private var metrics = false
    @State private var scene = DesktopScene.random()
    @State private var windows = WindowManager()

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black
            DesktopView(scene: scene, onOpen: open)
            WindowStage(windows: windows.windows, foreground: windows.foreground)
            SystemBarView(windows: windows)
            if metrics {
                MetricsView { metrics = false }
            }
        }
        .ignoresSafeArea()
    }

    private func open(_ sample: DesktopSample) {
        switch sample.action {
        case .metrics: metrics = true
        case .shuffle: scene = .random()
        case nil: windows.open(SampleApp(sample: sample, seed: scene.seed))
        }
    }
}
