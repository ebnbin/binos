import SwiftUI

// 内容区：从窗口里裁掉安全区和生效的遮挡区域所在的整条边，剩下一块完整的矩形。分隔区域（折痕）不参与。
// 竖向栏只在明确支持的设备上有：iPhone Duo 合上时，灵动岛所在的左侧或右侧裁下来的那条
extension SystemGeometry {
    init(proxy: GeometryProxy, screen: CGSize, scale: CGFloat, hinge: DeviceHinge.Status?) {
        let occlusions = proxy.reservedRegions(kind: .occlusion).filter(\.isActive).map(\.frame)
        let verticalBar = SystemDevice.current == .duo && hinge == .closed
        self.init(window: proxy.size, screen: screen, scale: scale, safeArea: proxy.safeAreaInsets, occlusions: occlusions, cornerRadii: proxy.concentricCornerRadii, verticalBar: verticalBar)
    }

    init(window size: CGSize, screen: CGSize, scale: CGFloat, safeArea: EdgeInsets, occlusions: [CGRect], cornerRadii: RectangleCornerRadii?, verticalBar wantsVerticalBar: Bool) {
        let bounds = CGRect(origin: .zero, size: size)
        var cuts = [Edge.top: safeArea.top, .leading: safeArea.leading, .bottom: safeArea.bottom, .trailing: safeArea.trailing]
        let obstacles = occlusions.map { $0.intersection(bounds) }.filter { !$0.isNull && !$0.isEmpty }
        for frame in obstacles {
            let edge = Self.edge(for: frame, in: size)
            cuts[edge] = max(cuts[edge] ?? 0, Self.thickness(of: frame, from: edge, in: size))
        }
        let top = cuts[.top] ?? 0, leading = cuts[.leading] ?? 0, bottom = cuts[.bottom] ?? 0, trailing = cuts[.trailing] ?? 0
        let contentRect = CGRect(x: leading, y: top, width: max(size.width - leading - trailing, 0), height: max(size.height - top - bottom, 0))
        // 内容区四个角用同一个半径：碰到的屏幕角里最大的物理圆角
        let radius = Self.touchedCorners(of: contentRect, in: size, radii: cornerRadii).max() ?? 0
        let content = SystemArea(frame: contentRect, cornerRadii: Self.fit(RectangleCornerRadii(topLeading: radius, bottomLeading: radius, bottomTrailing: radius, topTrailing: radius), in: contentRect))

        // 左右两侧裁得更宽的那条，去掉两头的遮挡和上下的裁切
        let side = [(Edge.leading, leading), (.trailing, trailing)].filter { $0.1 > 0 }.max { $0.1 < $1.1 }
        let verticalBar = wantsVerticalBar ? side.map { edge, thickness in
            var strip = CGRect(x: edge == .leading ? 0 : size.width - thickness, y: top, width: thickness, height: size.height - top - bottom)
            for frame in obstacles where frame.intersects(strip) {
                if frame.midY < strip.midY { strip = CGRect(x: strip.minX, y: frame.maxY, width: strip.width, height: strip.maxY - frame.maxY) }
                else { strip = CGRect(x: strip.minX, y: strip.minY, width: strip.width, height: frame.minY - strip.minY) }
            }
            return SystemArea(frame: strip, cornerRadii: Self.fit(Self.cornerRadii(of: strip, in: size, radii: cornerRadii), in: strip))
        } : nil
        self.init(window: size, screen: screen, scale: scale, content: content, verticalBar: verticalBar)
    }

    // 只贴一条边就裁那条边；贴着角落时裁左右两侧的那条，灵动岛扩展时总是沿界面的竖直方向变长；
    // 贴着三条边以上（比如整条边的长条）裁最薄的那条；都不贴时裁最近的边
    private static func edge(for frame: CGRect, in size: CGSize) -> Edge {
        let touching = Edge.allCases.filter { distance(of: frame, to: $0, in: size) < 0.5 }
        if touching.count == 2, !touching.contains(.top) || !touching.contains(.bottom), !touching.contains(.leading) || !touching.contains(.trailing) {
            return touching.first { $0 == .leading || $0 == .trailing } ?? touching[0]
        }
        if touching.isEmpty { return Edge.allCases.min { distance(of: frame, to: $0, in: size) < distance(of: frame, to: $1, in: size) }! }
        return touching.min { thickness(of: frame, from: $0, in: size) < thickness(of: frame, from: $1, in: size) }!
    }

    private static func distance(of frame: CGRect, to edge: Edge, in size: CGSize) -> CGFloat {
        switch edge {
        case .top: frame.minY
        case .leading: frame.minX
        case .bottom: size.height - frame.maxY
        case .trailing: size.width - frame.maxX
        }
    }

    private static func thickness(of frame: CGRect, from edge: Edge, in size: CGSize) -> CGFloat {
        switch edge {
        case .top: frame.maxY
        case .leading: frame.maxX
        case .bottom: size.height - frame.minY
        case .trailing: size.width - frame.minX
        }
    }

    // 区域的每个角碰到屏幕角时用那个角的物理圆角，否则是直角
    private static func cornerRadii(of rect: CGRect, in size: CGSize, radii: RectangleCornerRadii?) -> RectangleCornerRadii {
        guard let radii else { return RectangleCornerRadii() }
        let left = rect.minX < 0.5, right = rect.maxX > size.width - 0.5, top = rect.minY < 0.5, bottom = rect.maxY > size.height - 0.5
        return RectangleCornerRadii(
            topLeading: top && left ? radii.topLeading : 0,
            bottomLeading: bottom && left ? radii.bottomLeading : 0,
            bottomTrailing: bottom && right ? radii.bottomTrailing : 0,
            topTrailing: top && right ? radii.topTrailing : 0
        )
    }

    private static func touchedCorners(of rect: CGRect, in size: CGSize, radii: RectangleCornerRadii?) -> [CGFloat] {
        let corners = cornerRadii(of: rect, in: size, radii: radii)
        return [corners.topLeading, corners.bottomLeading, corners.bottomTrailing, corners.topTrailing].filter { $0 > 0 }
    }

    // 同一条边上两个角的半径之和不超过边长，超过时按比例缩小
    private static func fit(_ radii: RectangleCornerRadii, in rect: CGRect) -> RectangleCornerRadii {
        let sums = [
            (radii.topLeading + radii.topTrailing, rect.width), (radii.bottomLeading + radii.bottomTrailing, rect.width),
            (radii.topLeading + radii.bottomLeading, rect.height), (radii.topTrailing + radii.bottomTrailing, rect.height),
        ]
        let scale = sums.map { $0.0 > $0.1 && $0.0 > 0 ? $0.1 / $0.0 : 1 }.min() ?? 1
        return RectangleCornerRadii(topLeading: radii.topLeading * scale, bottomLeading: radii.bottomLeading * scale, bottomTrailing: radii.bottomTrailing * scale, topTrailing: radii.topTrailing * scale)
    }
}
