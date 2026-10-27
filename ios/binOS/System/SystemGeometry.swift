import SwiftUI

// binOS 自己的几何接口：应用层的尺寸和坐标都从这里取，不直接使用系统的安全区、保留区域等接口。
// 单位都是点，区域都在窗口坐标系里（原点是窗口左上角）
struct SystemGeometry: Equatable, Sendable {
    // app 可用的整个窗口，包括内容区和竖向栏以外的部分
    var window: CGSize
    var screen: CGSize
    // 一点等于几个物理像素
    var scale: CGFloat
    // 一块完整的矩形，应用层在这里自由绘制
    var content: SystemArea
    // 内容区旁边另外可用的长条，只有部分设备有
    var verticalBar: SystemArea?

    static let zero = SystemGeometry(window: .zero, screen: .zero, scale: 1, content: SystemArea(frame: .zero, cornerRadii: RectangleCornerRadii()), verticalBar: nil)
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
    @State private var screen = CGSize.zero
    @State private var hinge: DeviceHinge.Status?

    func body(content: Content) -> some View {
        GeometryReader { proxy in
            content.environment(\.systemGeometry, SystemGeometry(proxy: proxy, screen: screen, scale: scale, hinge: hinge))
        }
        .ignoresSafeArea()
        .onHingeChange { _, context in hinge = context.hinge?.status }
        .background(ScreenReader(size: $screen))
    }
}

// SwiftUI 没有屏幕尺寸，从窗口所在的屏幕读取。开合时窗口会换到另一块屏幕上
private struct ScreenReader: UIViewRepresentable {
    @Binding var size: CGSize

    func makeUIView(context: Context) -> ScreenView {
        let view = ScreenView()
        view.report = { size = $0 }
        return view
    }

    func updateUIView(_ view: ScreenView, context: Context) {}

    final class ScreenView: UIView {
        var report: (CGSize) -> Void = { _ in }
        private var last: CGSize?
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
            guard let size = window?.windowScene?.screen.bounds.size, size != last else { return }
            last = size
            // 布局过程中不直接改 SwiftUI 的状态
            DispatchQueue.main.async { [report] in report(size) }
        }
    }
}
