import CoreGraphics

// 桌面的分栏和格子。一栏宽 360～480，最多 3 栏，再宽的空间平分到左右两边。
// 一栏 4 格，图标和小组件横竖都只能占 1、2 或 4 格。
// 横向：一栏 4 个图标之外的宽度分成 5 份，图标之间、最外侧图标到栏边都隔一份，栏两边各留半份，4 格平分其余的宽度。
// 纵向：行高是栏宽的四分之一，比 360 宽时的 90 多出来的高度平分到上下两边。
// 图标的尺寸固定；小组件的宽和高都按行高算，占几格就是几格的高度，所以格子数和尺寸的对应关系不变。
// 小组件的上边和第一行图标齐平，文字和最后一行图标的文字在同一高度，横向在所占的格子里居中
enum DesktopLayout {
    static let columnMinWidth: CGFloat = 360
    static let columnMaxWidth: CGFloat = 480
    static let maxColumns = 3
    static let columnCells = 4
    static let icon: CGFloat = 60
    // 行高 90 时图标上面的距离
    static let top: CGFloat = 6
    // 图标和文字之间的距离
    static let spacing: CGFloat = 6
    static let labelHeight: CGFloat = 14
    // 文字左右各比所占的格子窄这么多，超出时用省略号
    static let labelInset: CGFloat = 6
    // 整个桌面最上面和最下面留的距离
    static let verticalInset: CGFloat = 24

    struct Size: Hashable, Sendable {
        var width: Int
        var height: Int
    }

    struct Placement: Equatable, Sendable {
        var row: Int
        var column: Int
    }

    struct Columns: Equatable {
        var count: Int
        var width: CGFloat
        // 左右两边各留的宽度
        var margin: CGFloat
    }

    static func columns(width: CGFloat) -> Columns {
        let count = max(1, min(maxColumns, Int(width / columnMinWidth)))
        let columnWidth = min(width / CGFloat(count), columnMaxWidth)
        return Columns(count: count, width: columnWidth, margin: (width - columnWidth * CGFloat(count)) / 2)
    }

    // 一栏里的格子
    struct Grid: Equatable {
        var cellWidth: CGFloat
        var rowHeight: CGFloat
        // 栏左右两边各留的宽度
        var inset: CGFloat
        // 主体顶边离所在行顶边的距离
        var top: CGFloat
    }

    static func grid(columnWidth: CGFloat) -> Grid {
        let gap = (columnWidth - icon * CGFloat(columnCells)) / CGFloat(columnCells + 1)
        let rowHeight = columnWidth / CGFloat(columnCells)
        return Grid(cellWidth: icon + gap, rowHeight: rowHeight, inset: gap / 2, top: top + (rowHeight - columnMinWidth / CGFloat(columnCells)) / 2)
    }

    // 图标或小组件本身。图标占 1 格，就是固定的图标大小
    static func body(_ size: Size, grid: Grid) -> CGSize {
        CGSize(width: CGFloat(size.width - 1) * grid.rowHeight + icon, height: CGFloat(size.height - 1) * grid.rowHeight + icon)
    }

    // 图标和有一边只占 1 格的小组件用图标边长的四分之一，两边都至少 2 格的小组件固定用大圆角
    static func cornerRadius(_ size: Size) -> CGFloat {
        min(size.width, size.height) < 2 ? icon / 4 : 25
    }

    static func labelWidth(_ size: Size, grid: Grid) -> CGFloat {
        CGFloat(size.width) * grid.cellWidth - labelInset * 2
    }

    // 按顺序放进一栏：每一个从上一个的后面开始，找第一个放得下的位置，不回头填前面的空，所以顺序不会变
    static func pack(_ sizes: some Collection<Size>) -> (placements: [Placement], rows: Int) {
        var taken: [[Bool]] = []
        func free(_ row: Int, _ column: Int, _ size: Size) -> Bool {
            for r in row..<row + size.height where r < taken.count {
                for c in column..<column + size.width where taken[r][c] { return false }
            }
            return true
        }
        var cursor = Placement(row: 0, column: 0)
        var rows = 0
        let placements = sizes.map { size in
            var row = cursor.row, column = cursor.column
            while column + size.width > columnCells || !free(row, column, size) {
                column += 1
                if column + size.width > columnCells {
                    row += 1
                    column = 0
                }
            }
            while taken.count < row + size.height { taken.append(Array(repeating: false, count: columnCells)) }
            for r in row..<row + size.height {
                for c in column..<column + size.width { taken[r][c] = true }
            }
            cursor = Placement(row: row, column: column + size.width)
            rows = max(rows, row + size.height)
            return Placement(row: row, column: column)
        }
        return (placements, rows)
    }

    // 按顺序把内容切成 count 段，第 1 段放第 1 栏，依次往右，返回每段的起点。
    // 选最高的那一栏最矮的切法；一样矮时选空格最少的，再一样时让前面的栏多放
    static func split(_ sizes: [Size], count: Int) -> [Int] {
        var rows: [Int: Int] = [:]
        func rowsOf(_ start: Int, _ end: Int) -> Int {
            let key = start * (sizes.count + 1) + end
            if let cached = rows[key] { return cached }
            let value = pack(sizes[start..<end]).rows
            rows[key] = value
            return value
        }
        func key(_ heights: [Int]) -> [Int] {
            [heights.max() ?? 0, heights.reduce(0, +)] + heights.map { -$0 }
        }
        var best: (starts: [Int], key: [Int])?
        func search(_ starts: [Int]) {
            if starts.count == count {
                let bounds = starts + [sizes.count]
                let heights = starts.indices.map { rowsOf(bounds[$0], bounds[$0 + 1]) }
                let candidate = key(heights)
                if best.map({ candidate.lexicographicallyPrecedes($0.key) }) ?? true { best = (starts, candidate) }
                return
            }
            for start in starts.last!...sizes.count { search(starts + [start]) }
        }
        search([0])
        return best?.starts ?? [0]
    }
}
