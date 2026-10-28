import SwiftUI

// 系统给这个窗口的所有尺寸：画在窗口上，数值列在安全区里。白底，挖孔和保留区域一眼能看出来
struct MetricsView: View {
    let onExit: () -> Void
    @AppStorage("systemArea") private var systemArea = false
    @State private var window = WindowMetrics()
    @State private var hinge: DeviceHinge?
    @Environment(\.displayScale) private var displayScale
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @Environment(\.toolbarVerticalEdge) private var toolbarVerticalEdge
    @Environment(\.systemGeometry) private var geometry

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let safe = proxy.safeAreaInsets
            let margins = proxy.contentMargins(for: .container)
            let regions = [ReservedRegion.Kind.occlusion, .division].flatMap { proxy.reservedRegions(kind: $0, options: .includeInactive) }
            // 系统区域只用 binOS 自己的几何接口画
            if systemArea {
                ZStack(alignment: .topLeading) {
                    Color.black
                    area(geometry.content, .white)
                    bar(geometry.systemBar, in: geometry.window)
                    VStack(alignment: .leading, spacing: 8) {
                        exit
                        toggle("显示系统区域", $systemArea)
                        Text("窗口 \(dimensions(geometry.window)) · 屏幕 \(dimensions(geometry.screen)) · 缩放 \(format(geometry.scale))")
                        Text("内容区 \(describe(geometry.content))")
                        Text("系统栏 \(form(geometry.systemBar.form)) · \(describe(geometry.systemBar.area))")
                    }
                    .font(.footnote.monospacedDigit())
                    .padding(16)
                    .frame(width: geometry.content.frame.width)
                    .offset(x: geometry.content.frame.minX, y: geometry.content.frame.minY)
                }
            } else {
                ZStack(alignment: .topLeading) {
                    Color.white
                    if let radii = proxy.concentricCornerRadii {
                        UnevenRoundedRectangle(cornerRadii: radii).stroke(.purple, lineWidth: 2)
                    }
                    corners(proxy.containerCornerInsets, in: size)
                    inset(margins, in: size).stroke(.blue, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
                    inset(safe, in: size).stroke(.green, lineWidth: 2)
                    edgeLabels(safe, in: size)
                    ForEach(regions) { region in
                        let color: Color = region.kind == .division ? .cyan : .red
                        Rectangle()
                            .fill(color.opacity(region.isActive ? 0.45 : 0.15))
                            .overlay(Rectangle().stroke(color, style: StrokeStyle(lineWidth: 1, dash: region.isActive ? [] : [4, 3])))
                            .frame(width: max(region.frame.width, 2), height: max(region.frame.height, 2))
                            .offset(x: region.frame.minX, y: region.frame.minY)
                    }
                    ScrollView {
                        panel(size: size, safe: safe, margins: margins, corners: proxy.containerCornerInsets, radii: proxy.concentricCornerRadii, regions: regions)
                            .padding(16)
                    }
                    .frame(width: max(size.width - safe.leading - safe.trailing, 0), height: max(size.height - safe.top - safe.bottom, 0))
                    .offset(x: safe.leading, y: safe.top)
                }
            }
        }
        .ignoresSafeArea()
        .environment(\.colorScheme, .light)
        .background(WindowProbe(metrics: $window))
        .onHingeChange { _, context in hinge = context.hinge }
    }

    private func area(_ area: SystemArea, _ color: Color) -> some View {
        UnevenRoundedRectangle(cornerRadii: area.cornerRadii)
            .fill(color)
            .frame(width: area.frame.width, height: area.frame.height)
            .offset(x: area.frame.minX, y: area.frame.minY)
    }

    // 系统栏的圆角可以比它的厚度大，按整个窗口画出圆角，再只留下系统栏的范围
    private func bar(_ bar: SystemBar, in window: CGSize) -> some View {
        UnevenRoundedRectangle(cornerRadii: bar.area.cornerRadii)
            .path(in: CGRect(origin: .zero, size: window))
            .intersection(Path(bar.area.frame))
            .fill(bar.form == .compact ? .orange : .blue)
    }

    // 四个角一样时只写一个半径，否则写出带圆角的那几个角
    private func describe(_ area: SystemArea) -> String {
        let r = area.cornerRadii
        let corners = [("左上", r.topLeading), ("右上", r.topTrailing), ("左下", r.bottomLeading), ("右下", r.bottomTrailing)]
        let radius = Set(corners.map(\.1)).count == 1 ? format(r.topLeading) : corners.filter { $0.1 > 0 }.map { "\($0.0) \(format($0.1))" }.joined(separator: " · ")
        return "\(dimensions(area.frame.size)) · 圆角 \(radius)"
    }

    private var exit: some View {
        Button("回到桌面", systemImage: "chevron.backward", action: onExit)
            .font(.subheadline.bold())
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // 开关在文字左边：右上角常常是灵动岛的保留区域
    private func toggle(_ title: String, _ isOn: Binding<Bool>) -> some View {
        HStack {
            Toggle(title, isOn: isOn).labelsHidden().fixedSize()
            Text(title).font(.subheadline.bold())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
            exit
            toggle("显示系统区域", $systemArea)
            section("窗口", .primary, [
                ("尺寸", "\(dimensions(size)) pt"),
                ("像素", "\(dimensions(CGSize(width: size.width * displayScale, height: size.height * displayScale))) px"),
                ("界面方向", window.orientation.map(orientation) ?? "未知"),
                ("尺寸类型", "宽 \(sizeClass(horizontalSizeClass)) · 高 \(sizeClass(verticalSizeClass))"),
                ("app 锁定方向", window.orientationLocked ? "是" : "否"),
                ("正在调整大小", window.resizing ? "是" : "否"),
            ])
            section("屏幕", .primary, [
                ("型号", SystemDevice.modelIdentifier),
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
            section("保留区域", .red, regions.isEmpty ? [("", "无")] : regions.map { region in
                ("\(region.kind == .division ? "分隔" : "遮挡")\(region.isActive ? "" : "（未生效）")", "\(format(region.frame.minX)), \(format(region.frame.minY)) · \(dimensions(region.frame.size)) · 边距 \(edges(region.margins))")
            })
            // 系统认为竖向栏（状态栏、标签栏、工具栏合成的一条）应该放在哪一侧，不管它有没有显示
            section("竖向栏", .primary, [
                ("UIKit verticalBarEdge", barEdge(window.verticalBarEdge)),
                ("SwiftUI toolbarVerticalEdge", toolbarVerticalEdge.map { $0 == .leading ? "前侧（左）" : "后侧（右）" } ?? "未指定"),
            ])
            section("铰链", .cyan, [
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

    private func form(_ form: SystemBar.Form) -> String {
        switch form {
        case .compact: "底边收起"
        case .bottom: "底边完整"
        case .side(.left): "左侧完整"
        case .side(.right): "右侧完整"
        }
    }

    private func barEdge(_ edge: UIVerticalBarEdge) -> String {
        switch edge {
        case .leading: "前侧（左）"
        case .trailing: "后侧（右）"
        default: "未指定"
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
