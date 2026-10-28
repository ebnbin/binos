import SwiftUI

// binOS 自己的几何接口：应用层的尺寸和坐标都从这里取，不直接使用系统的安全区、保留区域等接口。
// 单位都是点，区域都在窗口坐标系里（原点是窗口左上角）
struct SystemGeometry: Equatable, Sendable {
    // app 可用的整个窗口，包括内容区和系统栏以外的部分
    var window: CGSize
    var screen: CGSize
    // 一点等于几个物理像素
    var scale: CGFloat
    // 一块完整的矩形，应用层在这里自由绘制
    var content: SystemArea
    // 贴着窗口一条边的长条，同时承担状态栏和 Dock，每块屏幕上都有
    var systemBar: SystemBar

    static let zero = SystemGeometry(window: .zero, screen: .zero, scale: 1, content: SystemArea(frame: .zero, cornerRadii: RectangleCornerRadii()), systemBar: SystemBar(area: SystemArea(frame: .zero, cornerRadii: RectangleCornerRadii()), form: .compact))
}

struct SystemBar: Equatable, Sendable {
    var area: SystemArea
    var form: Form

    enum Form: Equatable, Sendable {
        // 在底边收起成一条，点开后完整的内容浮在内容区上面
        case compact
        // 在底边完整显示
        case bottom
        // 在左侧或右侧完整显示
        case side(Side)
    }

    // 窗口坐标系里的左右，不随书写方向变
    enum Side: Equatable, Sendable {
        case left
        case right
    }
}

struct SystemArea: Equatable, Sendable {
    var frame: CGRect
    var cornerRadii: RectangleCornerRadii
}

extension EnvironmentValues {
    @Entry var systemGeometry = SystemGeometry.zero
}

extension View {
    // 在 app 的根视图上调用一次，下层通过 @Environment(\.systemGeometry) 读取；窗口、方向、所在屏幕变化时随之更新
    func providesSystemGeometry() -> some View {
        modifier(SystemGeometryProvider())
    }
}

private struct SystemGeometryProvider: ViewModifier {
    @Environment(\.displayScale) private var scale
    @State private var scene = SceneState()
    @State private var hinge: DeviceHinge.Status?
    // 拖动调整窗口大小的过程中，系统栏保持开始拖动前的形态，松手后再按新的尺寸判断
    @State private var form: SystemBar.Form?

    func body(content: Content) -> some View {
        GeometryReader { proxy in
            let geometry = SystemGeometry(proxy: proxy, screen: scene.screen, scale: scale, orientation: scene.orientation, hinge: hinge, keeping: scene.resizing ? form : nil)
            content
                .environment(\.systemGeometry, geometry)
                .onChange(of: geometry.systemBar.form, initial: true) { form = geometry.systemBar.form }
        }
        .ignoresSafeArea()
        .onHingeChange { _, context in hinge = context.hinge?.status }
        .background(SceneReader(state: $scene))
    }
}

private struct SceneState: Equatable {
    var screen = CGSize.zero
    var orientation = UIInterfaceOrientation.unknown
    var resizing = false
}

// SwiftUI 拿不到的屏幕尺寸、界面方向和是否正在调整大小，从窗口所在的场景读取。开合时窗口会换到另一块屏幕上
private struct SceneReader: UIViewRepresentable {
    @Binding var state: SceneState

    func makeUIView(context: Context) -> SceneView {
        let view = SceneView()
        view.report = { state = $0 }
        return view
    }

    func updateUIView(_ view: SceneView, context: Context) {}

    final class SceneView: UIView {
        var report: (SceneState) -> Void = { _ in }
        private var last: SceneState?
        private var geometry: NSKeyValueObservation?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            geometry = window?.windowScene?.observe(\.effectiveGeometry) { [weak self] _, _ in
                MainActor.assumeIsolated { self?.read() }
            }
            read()
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            read()
        }

        private func read() {
            guard let scene = window?.windowScene else { return }
            let state = SceneState(screen: scene.screen.bounds.size, orientation: scene.effectiveGeometry.interfaceOrientation, resizing: scene.effectiveGeometry.isInteractivelyResizing)
            guard state != last else { return }
            last = state
            // 布局过程中不直接改 SwiftUI 的状态
            DispatchQueue.main.async { [report] in report(state) }
        }
    }
}
