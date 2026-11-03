import SwiftUI

// 从桌面打开的假 app，样子取自桌面上的那一项
struct SampleApp: Identifiable, Equatable {
    // 换一组随机内容后序号会重复，带上那一组的种子
    let id: String
    let sample: DesktopSample

    init(sample: DesktopSample, seed: UInt64) {
        id = "\(seed)-\(sample.id)"
        self.sample = sample
    }

    static func == (lhs: SampleApp, rhs: SampleApp) -> Bool { lhs.id == rhs.id }
}

// 假 app 的界面：和图标一样的背景，中间写着窗口给它的尺寸
struct SampleAppView: View {
    let app: SampleApp

    var body: some View {
        GeometryReader { proxy in
            Text("\(Self.format(proxy.size.width)) × \(Self.format(proxy.size.height))")
                .font(.system(size: 28, weight: .semibold).monospacedDigit())
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.5), radius: 2)
                .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .background(SampleFill(colors: app.sample.colors))
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
