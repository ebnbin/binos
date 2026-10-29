import SwiftUI

// 桌面、打开的 app 和尺寸调试页：桌面上第一个图标打开调试页，调试页上的按钮回到桌面；第二个图标换一组随机内容；
// 其余的图标和小组件打开一个假 app，显示在系统栏上，点标志回到桌面。
// app 的窗口从点到的图标展开到内容区。回到桌面时收回桌面上的图标，图标不在屏幕上时收回系统栏里的图标；
// 在系统栏上切换时，前一个收回它在系统栏里的图标，后一个从它在系统栏里的图标展开；关闭时收回图标并淡出
struct RootView: View {
    static let windowAnimation = Animation.spring(duration: 0.5, bounce: 0.15)

    @State private var metrics = false
    @State private var scene = DesktopScene.random()
    // 按打开的先后排
    @State private var apps: [SampleApp] = []
    // 显示在前台的 app，没有时显示桌面
    @State private var front: SampleApp.ID?
    // 不在前台的窗口收在哪个图标上
    @State private var anchors: [SampleApp.ID: WindowFrame] = [:]
    // 正在展开或收起的窗口，动画结束前一直画出来
    @State private var moving: Set<SampleApp.ID> = []
    // 正在关闭的 app：系统栏上已经不显示，窗口收回图标后才移除
    @State private var closing: Set<SampleApp.ID> = []
    // 每次切换加一，只有最后一次切换的动画结束时才清掉 moving
    @State private var transition = 0
    @State private var frames = IconFrames()
    @Environment(\.systemGeometry) private var geometry

    var body: some View {
        let content = geometry.content
        ZStack(alignment: .topLeading) {
            if metrics {
                MetricsView { metrics = false }
            } else {
                Color.black
                DesktopView(scene: scene, frames: frames, onOpen: open)
                ZStack(alignment: .topLeading) {
                    ForEach(apps) { app in
                        let shown = app.id == front
                        if shown || moving.contains(app.id), let window = shown ? WindowFrame(frame: content.frame, radius: content.cornerRadii.topLeading) : anchors[app.id] {
                            SampleWindow(app: app, window: window, shown: shown, content: content.frame.size)
                                .opacity(closing.contains(app.id) ? 0 : 1)
                                .allowsHitTesting(shown)
                                .zIndex(shown ? 1 : 0)
                        }
                    }
                }
                .frame(width: geometry.window.width, height: geometry.window.height, alignment: .topLeading)
                SystemBarView(apps: apps.filter { !closing.contains($0.id) }, front: front, onHome: { show(nil) }, onSelect: select, onClose: close, frames: frames)
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
            anchors[app.id] = resting(app.id, onDesktop: true)
            show(app.id)
        }
    }

    private func select(_ id: SampleApp.ID) {
        anchors[id] = resting(id, onDesktop: false)
        show(id)
    }

    private func close(_ id: SampleApp.ID) {
        guard front == id else {
            apps.removeAll { $0.id == id }
            anchors[id] = nil
            return
        }
        show(nil, closing: id) {
            apps.removeAll { $0.id == id }
            anchors[id] = nil
            closing.remove(id)
        }
    }

    // 先不带动画把要动的窗口画在起点，下一轮再带动画切换前台，窗口才会从起点变过去
    private func show(_ target: SampleApp.ID?, closing closed: SampleApp.ID? = nil, then done: @escaping () -> Void = {}) {
        let previous = front
        guard previous != target else { return }
        if let previous { anchors[previous] = resting(previous, onDesktop: target == nil) }
        moving.formUnion([previous, target].compactMap(\.self))
        transition += 1
        let current = transition
        DispatchQueue.main.async {
            withAnimation(Self.windowAnimation, completionCriteria: .logicallyComplete) {
                front = target
                if let closed { closing.insert(closed) }
            } completion: {
                if transition == current { moving = [] }
                done()
            }
        }
    }

    // 窗口不在前台时收在哪里：回到桌面时是桌面上完整露出来的图标，否则是系统栏里的图标，系统栏收起时是胶囊里的那一个
    private func resting(_ id: SampleApp.ID, onDesktop: Bool) -> WindowFrame {
        let content = geometry.content.frame
        if onDesktop, let app = apps.first(where: { $0.id == id }), let frame = frames.frames[id], content.insetBy(dx: -1, dy: -1).contains(frame) {
            return WindowFrame(frame: frame, radius: DesktopLayout.cornerRadius(app.sample.size))
        }
        if let frame = frames.frames[IconFrames.dock(id)] ?? frames.frames[IconFrames.capsule] {
            return WindowFrame(frame: frame, radius: frame.width / 4)
        }
        return WindowFrame(frame: CGRect(x: content.midX, y: content.maxY, width: 0, height: 0), radius: 0)
    }
}
