import SwiftUI

// 调试桌面布局用的假内容：每次进来随机生成一组图标和小组件，覆盖数量、尺寸、文字长度的各种情况
struct DesktopSample: Identifiable {
    enum Kind { case icon, widget }

    // 测试用的入口，其余的点了打开一个假 app
    enum Action { case metrics, shuffle }

    let id: Int
    let kind: Kind
    let size: DesktopLayout.Size
    let label: String
    let symbol: String
    let colors: [Color]
    var action: Action?

    // 尺寸调试页和换一组随机内容的入口，总在桌面的最前面
    static let entries = [
        DesktopSample(id: 0, kind: .icon, size: DesktopLayout.Size(width: 1, height: 1), label: "尺寸", symbol: "ruler", colors: [Color(white: 0.1)], action: .metrics),
        DesktopSample(id: 1, kind: .icon, size: DesktopLayout.Size(width: 1, height: 1), label: "换一组", symbol: "shuffle", colors: [Color(white: 0.1)], action: .shuffle),
    ]
}

struct DesktopScene {
    let seed: UInt64
    let items: [DesktopSample]
    let wallpaper: [Color]

    static func random() -> DesktopScene {
        random(seed: UInt64.random(in: 0...UInt64.max))
    }

    static func random(seed: UInt64) -> DesktopScene {
        var rng = SplitMix64(seed: seed)
        let scenario = Scenario.allCases.randomElement(using: &rng)!
        let count = Int.random(in: scenario.count, using: &rng)
        var items = DesktopSample.entries
        while items.count < count + DesktopSample.entries.count {
            // 一段连续的图标，或者一段连续的小组件，长短不一，各种排列都会出现
            let widgets = Double.random(in: 0..<1, using: &rng) < scenario.widgetShare
            let run = Int.random(in: widgets ? 1...3 : 1...9, using: &rng)
            for _ in 0..<min(run, count + DesktopSample.entries.count - items.count) {
                items.append(sample(id: items.count, widget: widgets, scenario: scenario, using: &rng))
            }
        }
        return DesktopScene(seed: seed, items: items, wallpaper: wallpapers.randomElement(using: &rng)!)
    }

    private static func sample(id: Int, widget: Bool, scenario: Scenario, using rng: inout SplitMix64) -> DesktopSample {
        let color = palette.randomElement(using: &rng)!
        let size = widget ? (scenario == .large ? largeSizes : widgetSizes).randomElement(using: &rng)! : DesktopLayout.Size(width: 1, height: 1)
        return DesktopSample(
            id: id,
            kind: widget ? .widget : .icon,
            size: size,
            label: labels.randomElement(using: &rng)!,
            symbol: symbols.randomElement(using: &rng)!,
            colors: widget ? [color, palette.randomElement(using: &rng)!] : [color]
        )
    }

    private enum Scenario: CaseIterable {
        // 只有几个
        case few
        // 全是图标
        case icons
        // 图标和小组件混着
        case mixed
        // 很多，要滚动
        case many
        // 小组件为主
        case widgets
        // 只有大尺寸的小组件
        case large

        var count: ClosedRange<Int> {
            switch self {
            case .few: 1...6
            case .icons: 8...48
            case .mixed: 16...48
            case .many: 60...120
            case .widgets: 6...24
            case .large: 3...12
            }
        }

        var widgetShare: Double {
            switch self {
            case .icons: 0
            case .few, .mixed, .many: 0.25
            case .widgets: 0.8
            case .large: 1
            }
        }
    }

    // 宽 × 高，横竖都只能是 1、2、4 格，常见的尺寸多放几份
    private static let widgetSizes = [(1, 1), (2, 1), (1, 2), (2, 2), (2, 2), (2, 2), (4, 1), (1, 4), (4, 2), (4, 2), (2, 4), (4, 4), (4, 4)].map { DesktopLayout.Size(width: $0.0, height: $0.1) }
    private static let largeSizes = [(4, 2), (2, 4), (4, 4)].map { DesktopLayout.Size(width: $0.0, height: $0.1) }

    // 长短不一，最长的用来看省略号
    private static let labels = [
        "日历", "天气", "照片", "相机", "邮件", "音乐", "地图", "备忘录", "提醒事项", "文件", "终端", "浏览器",
        "设置", "钱包", "健康", "图书", "播客", "股市", "翻译", "计算器", "时钟", "通讯录", "Code", "Kita",
        "Safari", "GitHub", "Chrome", "Gmail", "Notes", "Xcode", "Figma", "TestFlight", "Instruments",
        "我", "A", "超级长的应用名称用来测试省略号", "An Extremely Long Application Name", "Photos & Videos", "设备 · 构建", "🎵 播放器",
    ]

    private static let symbols = [
        "star.fill", "heart.fill", "bolt.fill", "leaf.fill", "flame.fill", "drop.fill", "cloud.sun.fill", "moon.fill",
        "music.note", "camera.fill", "photo.fill", "map.fill", "calendar", "clock.fill", "bell.fill", "envelope.fill",
        "terminal.fill", "globe", "gearshape.fill", "folder.fill", "doc.text.fill", "chart.bar.fill", "cart.fill", "gamecontroller.fill",
    ]

    private static let palette: [Color] = [
        .red, .orange, .yellow, .green, .mint, .teal, .cyan, .blue, .indigo, .purple, .pink, .brown,
        Color(red: 0.95, green: 0.95, blue: 0.97), Color(white: 0.15),
    ]

    private static let wallpapers: [[Color]] = [
        [Color(red: 0.10, green: 0.12, blue: 0.30), Color(red: 0.45, green: 0.15, blue: 0.40)],
        [Color(red: 0.05, green: 0.25, blue: 0.25), Color(red: 0.10, green: 0.45, blue: 0.30)],
        [Color(red: 0.35, green: 0.10, blue: 0.10), Color(red: 0.60, green: 0.35, blue: 0.10)],
        [Color(red: 0.15, green: 0.15, blue: 0.18), Color(red: 0.30, green: 0.32, blue: 0.38)],
        [Color(red: 0.20, green: 0.05, blue: 0.35), Color(red: 0.05, green: 0.30, blue: 0.50)],
        [Color(red: 0.30, green: 0.40, blue: 0.55)],
        [Color(red: 0.25, green: 0.30, blue: 0.20)],
    ]
}

// 可以按种子重现的随机数
struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
