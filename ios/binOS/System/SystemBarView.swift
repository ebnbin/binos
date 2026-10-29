import SwiftUI
import UIKit.UIGestureRecognizerSubclass

// 系统栏：纯黑的底，看起来像屏幕可显示区域以外的部分；上面一颗透明的 Liquid Glass 胶囊。
// 完整的胶囊里是标志和打开的 app，点标志回到桌面，点 app 切到前台，长按 app 可以关闭；放不下时可以滑动。
// 收起的胶囊里只有前台 app 的图标，在桌面时是标志。
// 收起的系统栏点开后，胶囊从底边那一条里变成完整尺寸，升到这一条的上方，浮在内容区上面，内容区不变。
// 在胶囊以外按下、在胶囊上往下滑，或者一段时间没有操作就收起；手指按在胶囊上的时候，只有这根手指往下滑才收起
struct SystemBarView: View {
    static let compactCapsule = CGSize(width: 56, height: 28)
    static let compactIcon: CGFloat = 20
    static let fullCapsule = CGSize(width: 144, height: 72)
    static let fullIcon: CGFloat = 48
    static let spacing: CGFloat = 12
    // 完整的胶囊两端离系统栏两头至少这么远，避开屏幕的圆角
    static let fullCapsuleMargin: CGFloat = 40
    static let idleDelay: Duration = .seconds(4)
    static let swipeDistance: CGFloat = 24

    let apps: [SampleApp]
    let front: SampleApp.ID?
    let onHome: () -> Void
    let onSelect: (SampleApp.ID) -> Void
    let onClose: (SampleApp.ID) -> Void
    // 报告图标的位置，app 的窗口收回这里
    let frames: IconFrames

    @Environment(\.systemGeometry) private var geometry
    @State private var expanded = false
    // 收起时的图标和完整胶囊里对应的那一个是同一个，展开收起时跟着胶囊移动缩放
    @Namespace private var icons
    // 手指按在胶囊上；手势被系统取消时也会复原
    @GestureState private var holding = false
    // 每次操作加一，重新开始计时
    @State private var activity = 0

    var body: some View {
        let bar = geometry.systemBar
        let full = bar.form != .compact || expanded
        let capsule = Self.capsule(bar, expanded: expanded, items: apps.count + 1)
        ZStack(alignment: .topLeading) {
            // 系统栏的圆角可以比它的厚度大，按整个窗口画出圆角，再只留下系统栏的范围
            UnevenRoundedRectangle(cornerRadii: bar.area.cornerRadii)
                .path(in: CGRect(origin: .zero, size: geometry.window))
                .intersection(Path(bar.area.frame))
                .fill(.black)
            // 收起和完整是同一颗玻璃，只改尺寸，切换时形状连贯地变过去；里面的内容盖在玻璃上，单独切换
            Color.clear
                .frame(width: capsule.width, height: capsule.height)
                .glassEffect(.clear.interactive(), in: .capsule)
                .overlay {
                    if full { dock(vertical: bar.form != .compact && bar.form != .bottom, length: max(capsule.width, capsule.height)) }
                    else if let app = apps.first(where: { $0.id == front }) { icon(app, Self.compactIcon).reportsIconFrame(IconFrames.capsule, to: frames) }
                    else { logo(Self.compactIcon) }
                }
                .contentShape(.capsule)
                .simultaneousGesture(press, isEnabled: bar.form == .compact)
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

    // 标志在最前面，后面是打开的 app；内容比胶囊短时居中，比胶囊长时可以滑动
    private func dock(vertical: Bool, length: CGFloat) -> some View {
        let padding = (Self.fullCapsule.height - Self.fullIcon) / 2
        let items = Group {
            Button(action: onHome) { logo(Self.fullIcon) }
            ForEach(apps) { app in
                Button { onSelect(app.id) } label: { icon(app, Self.fullIcon).reportsIconFrame(IconFrames.dock(app.id), to: frames) }
                    .contextMenu {
                        Button("关闭", systemImage: "xmark", role: .destructive) { onClose(app.id) }
                    }
            }
        }
        .buttonStyle(.plain)
        return ScrollView(vertical ? .vertical : .horizontal) {
            if vertical {
                VStack(spacing: Self.spacing) { items }.padding(.vertical, padding).frame(minHeight: length)
            } else {
                HStack(spacing: Self.spacing) { items }.padding(.horizontal, padding).frame(minWidth: length)
            }
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize)
        .clipShape(.capsule)
    }

    private func logo(_ size: CGFloat) -> some View {
        Image("Logo").resizable().matchedGeometryEffect(id: "logo", in: icons).frame(width: size, height: size)
    }

    private func icon(_ app: SampleApp, _ size: CGFloat) -> some View {
        SampleIcon(sample: app.sample).matchedGeometryEffect(id: app.id, in: icons).frame(width: size, height: size)
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

    // 胶囊在窗口坐标系里的位置：在系统栏里居中；收起的系统栏展开后，胶囊在紧贴系统栏上方、完整系统栏厚度的一段里居中。
    // 完整的胶囊随里面的个数变长，最短是只有标志时的长度，最长到离系统栏两头各留出边距
    private static func capsule(_ bar: SystemBar, expanded: Bool, items: Int) -> CGRect {
        let area = bar.area.frame
        let content = CGFloat(items) * fullIcon + CGFloat(items - 1) * spacing + fullCapsule.height - fullIcon
        func length(_ available: CGFloat) -> CGFloat { max(fullCapsule.width, min(content, available - fullCapsuleMargin * 2)) }
        let (center, size) = switch bar.form {
        case .compact where expanded: (CGPoint(x: area.midX, y: area.minY - SystemGeometry.fullBarThickness / 2), CGSize(width: length(area.width), height: fullCapsule.height))
        case .compact: (CGPoint(x: area.midX, y: area.midY), compactCapsule)
        case .bottom: (CGPoint(x: area.midX, y: area.midY), CGSize(width: length(area.width), height: fullCapsule.height))
        case .side: (CGPoint(x: area.midX, y: area.midY), CGSize(width: fullCapsule.height, height: length(area.height)))
        }
        return CGRect(x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height)
    }

    private struct Idle: Equatable {
        var expanded: Bool
        var holding: Bool
        var activity: Int
    }
}

// 窗口里任何地方按下时报告位置（窗口坐标系），不影响这次触摸原本的处理。
// 只报告 app 自己界面上的触摸，长按菜单这类系统加在界面以外的浮层不算
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
            let root = view?.window?.rootViewController?.view
            for touch in touches where root.map({ touch.view?.isDescendant(of: $0) ?? false }) ?? true {
                onTouch(touch.location(in: view))
            }
            state = .failed
        }
    }
}
