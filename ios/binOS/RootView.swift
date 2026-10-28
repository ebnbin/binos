import SwiftUI

// 桌面和尺寸调试页二选一，系统栏上的按钮切换，桌面上还可以换一组随机内容
struct RootView: View {
    @AppStorage("metrics") private var metrics = false
    @State private var scene = DesktopScene.random()
    @Environment(\.systemGeometry) private var geometry

    var body: some View {
        ZStack(alignment: .topLeading) {
            if metrics {
                MetricsView()
            } else {
                Color.black
                DesktopView(scene: scene)
                UnevenRoundedRectangle(cornerRadii: geometry.systemBar.area.cornerRadii)
                    .path(in: CGRect(origin: .zero, size: geometry.window))
                    .intersection(Path(geometry.systemBar.area.frame))
                    .fill(Color(white: 0.12))
            }
            controls
        }
        .ignoresSafeArea()
    }

    private var controls: some View {
        let bar = geometry.systemBar
        let layout = bar.edge == .leading || bar.edge == .trailing ? AnyLayout(VStackLayout(spacing: 16)) : AnyLayout(HStackLayout(spacing: 24))
        return layout {
            if !metrics {
                Button("换一组", systemImage: "shuffle") { scene = .random() }
            }
            Button(metrics ? "桌面" : "尺寸", systemImage: metrics ? "square.grid.2x2" : "ruler") { metrics.toggle() }
        }
        .labelStyle(.iconOnly)
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(.white)
        .frame(width: bar.area.frame.width, height: bar.area.frame.height)
        .offset(x: bar.area.frame.minX, y: bar.area.frame.minY)
    }
}
