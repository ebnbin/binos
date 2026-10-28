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
    // 手指按在胶囊上；手势被系统取消时也会复原
    @GestureState private var holding = false
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
                .gesture(press, isEnabled: bar.form == .compact)
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

    // 收起时点一下展开；展开后往下滑收起，其余的按下和松开都算一次操作
    private var press: some Gesture {
        DragGesture(minimumDistance: 0)
            .updating($holding) { _, holding, _ in holding = true }
            .onChanged { value in
                let dy = value.translation.height
                if expanded, dy > Self.swipeDistance, dy > abs(value.translation.width) { collapse() }
            }
            .onEnded { value in
                activity += 1
                if !expanded, hypot(value.translation.width, value.translation.height) < Self.swipeDistance {
                    withAnimation(.bouncy) { expanded = true }
                }
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
