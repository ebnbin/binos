import SwiftUI

// 桌面、打开的 app 和尺寸调试页：桌面上第一个图标打开调试页，调试页上的按钮回到桌面；第二个图标换一组随机内容；
// 其余的图标和小组件打开一个假 app，显示在系统栏上，点标志回到桌面
struct RootView: View {
    @State private var metrics = false
    @State private var scene = DesktopScene.random()
    // 按打开的先后排
    @State private var apps: [SampleApp] = []
    // 显示在前台的 app，没有时显示桌面
    @State private var front: SampleApp.ID?

    var body: some View {
        ZStack(alignment: .topLeading) {
            if metrics {
                MetricsView { metrics = false }
            } else {
                Color.black
                // app 盖在桌面上，桌面的滚动位置留着
                DesktopView(scene: scene, onOpen: open)
                if let app = apps.first(where: { $0.id == front }) {
                    SampleAppView(app: app)
                }
                SystemBarView(apps: apps, front: front, onHome: { front = nil }, onSelect: { front = $0 }, onClose: close)
            }
        }
        .ignoresSafeArea()
    }

    private func open(_ sample: DesktopSample) {
        switch sample.action {
        case .metrics: metrics = true
        case .shuffle: scene = .random()
        case nil:
            let app = SampleApp(sample: sample, seed: scene.seed)
            if !apps.contains(app) { apps.append(app) }
            front = app.id
        }
    }

    private func close(_ id: SampleApp.ID) {
        apps.removeAll { $0.id == id }
        if front == id { front = nil }
    }
}
