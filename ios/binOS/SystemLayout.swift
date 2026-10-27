import SwiftUI

// 系统可以自由绘制的区域：从窗口里裁掉安全区和生效的遮挡区域所在的整条边，剩下一块完整的矩形。
// 裁下来的长条够宽时给 Dock。分隔区域（折痕）不参与
struct SystemLayout: Equatable {
    struct Area: Equatable {
        var rect: CGRect
        var radius: CGFloat
    }

    var content: Area
    var dock: Area?

    // 低于这个宽度的长条只填黑
    static let dockThickness: CGFloat = 80

    init(size: CGSize, safeArea: EdgeInsets, occlusions: [CGRect], cornerRadii: RectangleCornerRadii?) {
        let bounds = CGRect(origin: .zero, size: size)
        var cuts = [Edge.top: safeArea.top, .leading: safeArea.leading, .bottom: safeArea.bottom, .trailing: safeArea.trailing]
        let obstacles = occlusions.map { $0.intersection(bounds) }.filter { !$0.isNull && !$0.isEmpty }
        for frame in obstacles {
            let edge = Self.edge(for: frame, in: size)
            cuts[edge] = max(cuts[edge] ?? 0, Self.thickness(of: frame, from: edge, in: size))
        }
        let top = cuts[.top] ?? 0, leading = cuts[.leading] ?? 0, bottom = cuts[.bottom] ?? 0, trailing = cuts[.trailing] ?? 0
        let contentRect = CGRect(x: leading, y: top, width: max(size.width - leading - trailing, 0), height: max(size.height - top - bottom, 0))
        content = Area(rect: contentRect, radius: Self.radius(for: contentRect, in: size, radii: cornerRadii))

        // 最宽的那条，去掉两头的遮挡和垂直方向上的裁切
        let widest = cuts.filter { $0.value >= Self.dockThickness }.max { $0.value < $1.value }
        dock = widest.map { edge, thickness in
            var strip: CGRect = switch edge {
            case .leading: CGRect(x: 0, y: top, width: thickness, height: size.height - top - bottom)
            case .trailing: CGRect(x: size.width - thickness, y: top, width: thickness, height: size.height - top - bottom)
            case .top: CGRect(x: leading, y: 0, width: size.width - leading - trailing, height: thickness)
            case .bottom: CGRect(x: leading, y: size.height - thickness, width: size.width - leading - trailing, height: thickness)
            }
            for frame in obstacles where frame.intersects(strip) {
                let vertical = edge == .leading || edge == .trailing
                if vertical {
                    if frame.midY < strip.midY { strip = CGRect(x: strip.minX, y: frame.maxY, width: strip.width, height: strip.maxY - frame.maxY) }
                    else { strip = CGRect(x: strip.minX, y: strip.minY, width: strip.width, height: frame.minY - strip.minY) }
                } else {
                    if frame.midX < strip.midX { strip = CGRect(x: frame.maxX, y: strip.minY, width: strip.maxX - frame.maxX, height: strip.height) }
                    else { strip = CGRect(x: strip.minX, y: strip.minY, width: frame.minX - strip.minX, height: strip.height) }
                }
            }
            return Area(rect: strip, radius: Self.radius(for: strip, in: size, radii: cornerRadii))
        }
    }

    // 只贴一条边就裁那条边；贴着角落时裁沿长边的那条；贴着三条边以上（比如整条边的长条）裁最薄的那条；都不贴时裁最近的边
    private static func edge(for frame: CGRect, in size: CGSize) -> Edge {
        let touching = Edge.allCases.filter { distance(of: frame, to: $0, in: size) < 0.5 }
        if touching.count == 2, !touching.contains(.top) || !touching.contains(.bottom), !touching.contains(.leading) || !touching.contains(.trailing) {
            let portrait = size.height >= size.width
            return touching.first { portrait ? ($0 == .leading || $0 == .trailing) : ($0 == .top || $0 == .bottom) } ?? touching[0]
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

    // 四个角用同一个半径：碰到的屏幕角里最大的物理圆角，不超过短边的一半
    private static func radius(for rect: CGRect, in size: CGSize, radii: RectangleCornerRadii?) -> CGFloat {
        guard let radii else { return 0 }
        let left = rect.minX < 0.5, right = rect.maxX > size.width - 0.5, top = rect.minY < 0.5, bottom = rect.maxY > size.height - 0.5
        let touched = [(top && left, radii.topLeading), (top && right, radii.topTrailing), (bottom && left, radii.bottomLeading), (bottom && right, radii.bottomTrailing)]
        let radius = touched.filter(\.0).map(\.1).max() ?? 0
        return min(radius, min(rect.width, rect.height) / 2)
    }
}
