import SwiftUI
import UIKit

// 窗口层：铺满内容区，只显示前台的窗口。在桌面时不接收触摸，底下的桌面照常可以操作
struct WindowStage: View {
    let windows: [AppWindow]
    let foreground: AppWindow.ID?
    @Environment(\.systemGeometry) private var geometry

    var body: some View {
        let content = geometry.content
        WindowContainer(windows: windows, foreground: foreground)
            .frame(width: content.frame.width, height: content.frame.height)
            .clipShape(UnevenRoundedRectangle(cornerRadii: content.cornerRadii))
            .offset(x: content.frame.minX, y: content.frame.minY)
            .allowsHitTesting(foreground != nil)
    }
}

// 每个窗口是一个子控制器：打开时加进来，关闭时移除并释放；不在前台的隐藏起来，界面和状态都留着
private struct WindowContainer: UIViewControllerRepresentable {
    let windows: [AppWindow]
    let foreground: AppWindow.ID?

    func makeUIViewController(context: Context) -> Controller {
        Controller()
    }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.update(windows: windows, foreground: foreground)
    }

    final class Controller: UIViewController {
        private var hosted: [AppWindow.ID: UIViewController] = [:]

        func update(windows: [AppWindow], foreground: AppWindow.ID?) {
            for (id, child) in hosted where !windows.contains(where: { $0.id == id }) {
                child.willMove(toParent: nil)
                child.view.removeFromSuperview()
                child.removeFromParent()
                hosted[id] = nil
            }
            for window in windows where hosted[window.id] == nil {
                let child = UIHostingController(rootView: SampleAppView(app: window.app))
                // 内容区已经避开了该避开的部分，窗口里不再按系统的安全区退让
                child.safeAreaRegions = .keyboard
                addChild(child)
                child.view.frame = view.bounds
                child.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                view.addSubview(child.view)
                child.didMove(toParent: self)
                hosted[window.id] = child
            }
            for (id, child) in hosted {
                child.view.isHidden = id != foreground
            }
        }
    }
}
