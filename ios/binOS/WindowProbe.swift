import SwiftUI
import UIKit

// SwiftUI 拿不到的窗口和屏幕信息
struct WindowMetrics: Equatable {
    var screenSize: CGSize?
    var nativeSize: CGSize?
    var scale: CGFloat?
    var nativeScale: CGFloat?
    var orientation: UIInterfaceOrientation?
    // app 通过 prefersInterfaceOrientationLocked 请求的锁定，不是控制中心的竖排方向锁定
    var orientationLocked = false
    var resizing = false
    var layoutMargins: NSDirectionalEdgeInsets?
    var readableWidth: CGFloat?
}

struct WindowProbe: UIViewRepresentable {
    @Binding var metrics: WindowMetrics

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.report = { metrics = $0 }
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {}
}

// 窗口大小变化时会重新布局；方向翻转 180°、开始或结束调整大小时窗口尺寸不变，要另外监听场景的几何信息
final class ProbeView: UIView {
    var report: (WindowMetrics) -> Void = { _ in }
    private var last: WindowMetrics?
    private var geometry: NSKeyValueObservation?

    override func layoutSubviews() {
        super.layoutSubviews()
        read()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        geometry = window?.windowScene?.observe(\.effectiveGeometry) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.read() }
        }
        read()
    }

    private func read() {
        guard let window, let scene = window.windowScene, let root = window.rootViewController?.view else { return }
        let screen = scene.screen
        let geometry = scene.effectiveGeometry
        let metrics = WindowMetrics(
            screenSize: screen.bounds.size,
            nativeSize: screen.nativeBounds.size,
            scale: screen.scale,
            nativeScale: screen.nativeScale,
            orientation: geometry.interfaceOrientation,
            orientationLocked: geometry.isInterfaceOrientationLocked,
            resizing: geometry.isInteractivelyResizing,
            layoutMargins: root.directionalLayoutMargins,
            readableWidth: root.readableContentGuide.layoutFrame.width
        )
        guard metrics != last else { return }
        last = metrics
        // 布局过程中不直接改 SwiftUI 的状态
        DispatchQueue.main.async { [report] in report(metrics) }
    }
}
