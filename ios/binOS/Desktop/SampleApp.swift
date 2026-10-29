import SwiftUI

// 从桌面打开的假 app：和图标一样的背景，中间写着窗口尺寸
struct SampleApp: Identifiable, Equatable {
    // 换一组随机内容后序号会重复，带上那一组的种子
    let id: String
    let sample: DesktopSample

    init(sample: DesktopSample, seed: UInt64) {
        id = Self.id(sample: sample, seed: seed)
        self.sample = sample
    }

    static func id(sample: DesktopSample, seed: UInt64) -> String { "\(seed)-\(sample.id)" }

    static func == (lhs: SampleApp, rhs: SampleApp) -> Bool { lhs.id == rhs.id }
}

// 窗口的位置和圆角，都在窗口坐标系里。显示时是内容区，收起时是它的图标
struct WindowFrame: Equatable {
    var frame: CGRect
    var radius: CGFloat
}

// 图标在窗口坐标系里的位置，窗口从这里展开、收回这里。键是桌面上的 app 序号，或者系统栏里的 dock 和 capsule。
// 只在动画开始时读，滚动和布局时的更新不触发重绘
final class IconFrames {
    var frames: [String: CGRect] = [:]

    static func dock(_ id: SampleApp.ID) -> String { "dock:\(id)" }
    // 收起的胶囊里那一个图标
    static let capsule = "capsule"
}

extension View {
    func reportsIconFrame(_ key: String, to frames: IconFrames) -> some View {
        onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frames.frames[key] = $0 }
            .onDisappear { frames.frames[key] = nil }
    }
}

// app 的窗口：在图标的位置时看起来就是这个图标，展开到内容区时显示内容，中间的过程连贯地变过去
struct SampleWindow: View {
    let app: SampleApp
    let window: WindowFrame
    // 是否展开在内容区
    let shown: Bool
    let content: CGSize

    var body: some View {
        let frame = window.frame
        SampleFill(colors: app.sample.colors)
            .overlay {
                Image(systemName: app.sample.symbol)
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(.white)
                    .scaleEffect(min(frame.width, frame.height) / DesktopLayout.icon)
                    .opacity(shown ? 0 : 1)
                Text("\(Self.format(content.width)) × \(Self.format(content.height))")
                    .font(.system(size: 28, weight: .semibold).monospacedDigit())
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.5), radius: 2)
                    .fixedSize()
                    .scaleEffect(content.width > 0 ? frame.width / content.width : 1)
                    .opacity(shown ? 1 : 0)
            }
            .frame(width: frame.width, height: frame.height)
            .clipShape(RoundedRectangle(cornerRadius: window.radius, style: .continuous))
            .position(x: frame.midX, y: frame.midY)
    }

    private static func format(_ value: CGFloat) -> String {
        Double(value).formatted(.number.precision(.fractionLength(0...1)))
    }
}

// 图标是纯色，小组件是从上到下的渐变
struct SampleFill: View {
    let colors: [Color]

    var body: some View {
        if colors.count > 1 { LinearGradient(colors: colors, startPoint: .top, endPoint: .bottom) } else { colors[0] }
    }
}

// app 的图标：底色上一个白色符号，圆角是边长的四分之一，符号大小随边长缩放。铺满给它的方块，大小在外面定
struct SampleIcon: View {
    let sample: DesktopSample

    var body: some View {
        GeometryReader { proxy in
            let size = min(proxy.size.width, proxy.size.height)
            SampleFill(colors: sample.colors)
                .overlay(Image(systemName: sample.symbol).font(.system(size: size * 26 / DesktopLayout.icon, weight: .semibold)).foregroundStyle(.white))
                .clipShape(RoundedRectangle(cornerRadius: size / 4, style: .continuous))
        }
    }
}
