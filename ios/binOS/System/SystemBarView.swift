import SwiftUI
import UIKit.UIGestureRecognizerSubclass

// 系统栏：纯黑的底，看起来像屏幕可显示区域以外的部分；上面一颗透明的 Liquid Glass 胶囊，目前只放标志。
// 收起的系统栏点开后，胶囊从底边那一条里变成完整尺寸，升到这一条的上方，浮在内容区上面，内容区不变。
// 在胶囊以外按下、在胶囊上往下滑，或者一段时间没有操作就收起；手指按在胶囊上的时候，只有这根手指往下滑才收起
struct SystemBarView: View {
    static let compactCapsule = CGSize(width: 56, height: 28)
    static let compactLogo: CGFloat = 20
    static let fullCapsule = CGSize(width: 144, height: 72)
    static let fullLogo: CGFloat = 48
    static let idleDelay: Duration = .seconds(4)
    static let swipeDistance: CGFloat = 24

    @Environment(\.systemGeometry) private var geometry
    @State private var expanded = false
    @State private var holding = false
    // 每次操作加一，重新开始计时
    @State private var activity = 0

    var body: some View {
        let bar = geometry.systemBar
        let full = bar.form != .compact || expanded
        let capsule = Self.capsule(bar, expanded: expanded)
        ZStack(alignment: .topLeading) {
            // 系统栏的圆角可以比它的厚度大，按整个窗口画出圆角，再只留下系统栏的范围
            UnevenRoundedRectangle(cornerRadii: bar.area.cornerRadii)
                .path(in: CGRect(origin: .zero, size: geometry.window))
                .intersection(Path(bar.area.frame))
                .fill(.black)
            Image("Logo")
                .resizable()
                .frame(width: full ? Self.fullLogo : Self.compactLogo, height: full ? Self.fullLogo : Self.compactLogo)
                .frame(width: capsule.width, height: capsule.height)
                .glassEffect(.clear.interactive(), in: .capsule)
                .contentShape(.capsule)
                .gesture(CapsulePress(onChange: press))
                .position(x: capsule.midX, y: capsule.midY)
        }
        .frame(width: geometry.window.width, height: geometry.window.height, alignment: .topLeading)
        .background(TouchObserver { location in
            if expanded && !holding && !capsule.contains(location) { collapse() }
        })
        .task(id: Idle(expanded: expanded, holding: holding, activity: activity)) {
            guard expanded, !holding else { return }
            try? await Task.sleep(for: Self.idleDelay)
            if !Task.isCancelled { collapse() }
        }
        .onChange(of: bar.form) { expanded = false }
    }

    // 收起时点一下展开；展开后往下滑收起，其余的按下和松开都算一次操作。一直完整显示的系统栏不展开也不收起
    private func press(_ state: UIGestureRecognizer.State, _ translation: CGSize) {
        switch state {
        case .began:
            holding = true
        case .changed:
            if expanded, translation.height > Self.swipeDistance, translation.height > abs(translation.width) { collapse() }
        case .ended:
            holding = false
            activity += 1
            if geometry.systemBar.form == .compact, !expanded, hypot(translation.width, translation.height) < Self.swipeDistance {
                withAnimation(.bouncy) { expanded = true }
            }
        default:
            holding = false
            activity += 1
        }
    }

    private func collapse() {
        withAnimation(.bouncy) { expanded = false }
    }

    // 胶囊在窗口坐标系里的位置：在系统栏里居中；收起的系统栏展开后，胶囊在紧贴系统栏上方、完整系统栏厚度的一段里居中
    private static func capsule(_ bar: SystemBar, expanded: Bool) -> CGRect {
        let area = bar.area.frame
        let (center, size) = switch bar.form {
        case .compact where expanded: (CGPoint(x: area.midX, y: area.minY - SystemGeometry.fullBarThickness / 2), fullCapsule)
        case .compact: (CGPoint(x: area.midX, y: area.midY), compactCapsule)
        case .bottom: (CGPoint(x: area.midX, y: area.midY), fullCapsule)
        case .side: (CGPoint(x: area.midX, y: area.midY), CGSize(width: fullCapsule.height, height: fullCapsule.width))
        }
        return CGRect(x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height)
    }

    private struct Idle: Equatable {
        var expanded: Bool
        var holding: Bool
        var activity: Int
    }
}

// 胶囊上的按住和拖动。SwiftUI 的手势在别处有触摸开始时可能被取消，按着胶囊时另一只手的操作会打断它，
// 所以用 UIKit 的手势：和其他手势同时识别，也不会被其他手势阻止
private struct CapsulePress: UIGestureRecognizerRepresentable {
    // 手势的状态和从按下的位置算起的位移
    let onChange: (UIGestureRecognizer.State, CGSize) -> Void

    func makeUIGestureRecognizer(context: Context) -> Recognizer {
        let recognizer = Recognizer()
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: Recognizer, context: Context) {
        let location = recognizer.location(in: nil)
        if recognizer.state == .began { recognizer.start = location }
        onChange(recognizer.state, CGSize(width: location.x - recognizer.start.x, height: location.y - recognizer.start.y))
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }

    // 按下就开始，移动多远都不失败
    final class Recognizer: UILongPressGestureRecognizer {
        var start = CGPoint.zero

        init() {
            super.init(target: nil, action: nil)
            minimumPressDuration = 0
            allowableMovement = .greatestFiniteMagnitude
            cancelsTouchesInView = false
        }

        override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool {
            false
        }
    }
}

// 窗口里任何地方按下时报告位置（窗口坐标系），不影响这次触摸原本的处理
private struct TouchObserver: UIViewRepresentable {
    let onTouch: (CGPoint) -> Void

    func makeUIView(context: Context) -> ObserverView {
        let view = ObserverView()
        // 这一层盖在内容上面，自己不接收触摸，只借它找到窗口
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: ObserverView, context: Context) {
        view.recognizer.onTouch = onTouch
    }

    static func dismantleUIView(_ view: ObserverView, coordinator: ()) {
        view.recognizer.view?.removeGestureRecognizer(view.recognizer)
    }

    final class ObserverView: UIView {
        let recognizer = Recognizer()

        override func didMoveToWindow() {
            super.didMoveToWindow()
            recognizer.view?.removeGestureRecognizer(recognizer)
            window?.addGestureRecognizer(recognizer)
        }

    }

    // 只看按下，然后马上放弃识别，不取消也不推迟触摸
    final class Recognizer: UIGestureRecognizer {
        var onTouch: (CGPoint) -> Void = { _ in }

        init() {
            super.init(target: nil, action: nil)
            cancelsTouchesInView = false
            delaysTouchesBegan = false
            delaysTouchesEnded = false
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            for touch in touches { onTouch(touch.location(in: view)) }
            state = .failed
        }
    }
}
