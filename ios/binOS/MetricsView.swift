import SwiftUI

// 系统给这个窗口的所有尺寸：画在窗口上，数值列在安全区里
struct MetricsView: View {
    @State private var window = WindowMetrics()
    @State private var hinge: DeviceHinge?
    @Environment(\.displayScale) private var displayScale
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let safe = proxy.safeAreaInsets
            let margins = proxy.contentMargins(for: .container)
            let regions = [ReservedRegion.Kind.occlusion, .division].flatMap { proxy.reservedRegions(kind: $0, options: .includeInactive) }
            ZStack(alignment: .topLeading) {
                Color(.systemBackground)
                if let radii = proxy.concentricCornerRadii {
                    UnevenRoundedRectangle(cornerRadii: radii).stroke(.purple, lineWidth: 2)
                }
                corners(proxy.containerCornerInsets, in: size)
                inset(margins, in: size).stroke(.blue, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
                inset(safe, in: size).stroke(.green, lineWidth: 2)
                edgeLabels(safe, in: size)
                // 浅色是整个范围，深色是去掉边距后的核心
                ForEach(regions) { region in
                    let color: Color = region.kind == .division ? .yellow : .red
                    let core = self.core(of: region)
                    Rectangle()
                        .fill(color.opacity(region.isActive ? 0.15 : 0.06))
                        .overlay(Rectangle().stroke(color, style: StrokeStyle(lineWidth: 1, dash: region.isActive ? [] : [4, 3])))
                        .frame(width: max(region.frame.width, 2), height: max(region.frame.height, 2))
                        .offset(x: region.frame.minX, y: region.frame.minY)
                    Rectangle()
                        .fill(color.opacity(region.isActive ? 0.55 : 0.2))
                        .frame(width: max(core.width, 0), height: max(core.height, 0))
                        .offset(x: core.minX, y: core.minY)
                }
                ScrollView {
                    panel(size: size, safe: safe, margins: margins, corners: proxy.containerCornerInsets, radii: proxy.concentricCornerRadii, regions: regions)
                        .padding(16)
                }
                .frame(width: max(size.width - safe.leading - safe.trailing, 0), height: max(size.height - safe.top - safe.bottom, 0))
                .offset(x: safe.leading, y: safe.top)
            }
        }
        .ignoresSafeArea()
        .background(WindowProbe(metrics: $window))
        .onHingeChange { _, context in hinge = context.hinge }
    }

    private func inset(_ insets: EdgeInsets, in size: CGSize) -> Path {
        Path(CGRect(x: insets.leading, y: insets.top, width: max(size.width - insets.leading - insets.trailing, 0), height: max(size.height - insets.top - insets.bottom, 0)))
    }

    private func corners(_ insets: RectangleCornerInsets, in size: CGSize) -> some View {
        Path { path in
            path.addRect(CGRect(origin: .zero, size: insets.topLeading))
            path.addRect(CGRect(x: size.width - insets.topTrailing.width, y: 0, width: insets.topTrailing.width, height: insets.topTrailing.height))
            path.addRect(CGRect(x: 0, y: size.height - insets.bottomLeading.height, width: insets.bottomLeading.width, height: insets.bottomLeading.height))
            path.addRect(CGRect(x: size.width - insets.bottomTrailing.width, y: size.height - insets.bottomTrailing.height, width: insets.bottomTrailing.width, height: insets.bottomTrailing.height))
        }
        .fill(.orange.opacity(0.3))
    }

    // 安全区四边的缩进写在对应的边上
    private func edgeLabels(_ safe: EdgeInsets, in size: CGSize) -> some View {
        ZStack(alignment: .topLeading) {
            tag(format(safe.top)).position(x: size.width / 2, y: max(safe.top / 2, 10))
            tag(format(safe.bottom)).position(x: size.width / 2, y: size.height - max(safe.bottom / 2, 10))
            tag(format(safe.leading)).position(x: max(safe.leading / 2, 16), y: size.height / 2)
            tag(format(safe.trailing)).position(x: size.width - max(safe.trailing / 2, 16), y: size.height / 2)
        }
        .frame(width: size.width, height: size.height)
    }

    private func tag(_ text: String) -> some View {
        Text(text).font(.caption2.monospacedDigit()).padding(.horizontal, 4).background(.green, in: Capsule()).foregroundStyle(.white)
    }

    private func panel(size: CGSize, safe: EdgeInsets, margins: EdgeInsets, corners: RectangleCornerInsets, radii: RectangleCornerRadii?, regions: [ReservedRegion]) -> some View {
        // 宽的窗口分成多列，横屏和展开时不用滚动也能看全
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 24, alignment: .top)], alignment: .leading, spacing: 16) {
            section("窗口", .primary, [
                ("尺寸", "\(dimensions(size)) pt"),
                ("像素", "\(dimensions(CGSize(width: size.width * displayScale, height: size.height * displayScale))) px"),
                ("尺寸类型", "宽 \(sizeClass(horizontalSizeClass)) · 高 \(sizeClass(verticalSizeClass))"),
                ("界面方向", window.orientation.map(orientation) ?? "未知"),
                ("app 锁定方向", window.orientationLocked ? "是" : "否"),
                ("正在调整大小", window.resizing ? "是" : "否"),
            ])
            section("屏幕", .primary, [
                ("尺寸", window.screenSize.map { "\(dimensions($0)) pt" } ?? "未知"),
                ("物理像素", window.nativeSize.map { "\(dimensions($0)) px" } ?? "未知"),
                ("缩放", [window.scale, window.nativeScale].compactMap { $0 }.map(format).joined(separator: " · 原生 ")),
            ])
            section("安全区", .green, [("上 · 左 · 下 · 右", edges(safe))])
            section("内容边距", .blue, [("上 · 左 · 下 · 右", edges(margins))])
            section("系统布局边距", .primary, [
                ("上 · 左 · 下 · 右", window.layoutMargins.map { edges(EdgeInsets(top: $0.top, leading: $0.leading, bottom: $0.bottom, trailing: $0.trailing)) } ?? "未知"),
                ("可读内容宽度", window.readableWidth.map { "\(format($0)) pt" } ?? "未知"),
            ])
            section("角落避让", .orange, [
                ("左上", dimensions(corners.topLeading)),
                ("右上", dimensions(corners.topTrailing)),
                ("左下", dimensions(corners.bottomLeading)),
                ("右下", dimensions(corners.bottomTrailing)),
            ])
            section("同心圆角", .purple, [("左上 · 右上 · 左下 · 右下", radii.map { [$0.topLeading, $0.topTrailing, $0.bottomLeading, $0.bottomTrailing].map(format).joined(separator: " · ") } ?? "无")])
            section("保留区域", .red, regions.isEmpty ? [("", "无")] : regions.flatMap { region in
                let name = "\(region.kind == .division ? "分隔" : "遮挡")\(region.isActive ? "" : "（未生效）")"
                return [
                    ("\(name) · 范围", rect(region.frame)),
                    ("\(name) · 核心", rect(core(of: region))),
                    ("\(name) · 边距", edges(region.margins)),
                ]
            })
            section("铰链", .yellow, [
                ("状态", hinge.map { hingeStatus($0.status) } ?? "没有报告"),
                ("角度", hinge.map { "\(format($0.angle.degrees))°" } ?? "没有报告"),
            ])
        }
        .font(.footnote.monospacedDigit())
    }

    private func section(_ title: String, _ color: Color, _ rows: [(String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(color).frame(width: 8, height: 8)
                Text(title).font(.subheadline.bold())
            }
            ForEach(rows.indices, id: \.self) { index in
                HStack(alignment: .firstTextBaseline) {
                    Text(rows[index].0).foregroundStyle(.secondary)
                    Spacer(minLength: 12)
                    Text(rows[index].1).multilineTextAlignment(.trailing)
                }
            }
        }
    }

    private func format(_ value: CGFloat) -> String {
        Double(value).formatted(.number.precision(.fractionLength(0...1)))
    }

    // 范围包含边距，去掉边距才是真正被保留的部分
    private func core(of region: ReservedRegion) -> CGRect {
        let m = region.margins
        let frame = region.frame
        return CGRect(x: frame.minX + m.leading, y: frame.minY + m.top, width: frame.width - m.leading - m.trailing, height: frame.height - m.top - m.bottom)
    }

    private func rect(_ rect: CGRect) -> String {
        "\(format(rect.minX)), \(format(rect.minY)) · \(format(rect.width)) × \(format(rect.height))"
    }

    private func dimensions(_ size: CGSize) -> String {
        "\(format(size.width)) × \(format(size.height))"
    }

    private func edges(_ insets: EdgeInsets) -> String {
        [insets.top, insets.leading, insets.bottom, insets.trailing].map(format).joined(separator: " · ")
    }

    private func sizeClass(_ value: UserInterfaceSizeClass?) -> String {
        switch value {
        case .compact: "紧凑"
        case .regular: "常规"
        default: "未知"
        }
    }

    private func orientation(_ value: UIInterfaceOrientation) -> String {
        switch value {
        case .portrait: "竖屏"
        case .portraitUpsideDown: "竖屏倒置"
        case .landscapeLeft: "横屏（向左）"
        case .landscapeRight: "横屏（向右）"
        default: "未知"
        }
    }

    private func hingeStatus(_ status: DeviceHinge.Status) -> String {
        switch status {
        case .closed: "合上"
        case .partiallyOpen: "半开"
        case .fullyOpen: "完全展开"
        default: "未知"
        }
    }
}
