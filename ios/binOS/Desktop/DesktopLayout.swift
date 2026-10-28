import CoreGraphics

// 桌面的分栏和格子。一栏宽 360～480，最多 3 栏，再宽的空间平分到左右两边。
// 一栏 4 格，格子是正方形，边长是栏宽的四分之一。图标和小组件横竖都只能占 1、2 或 4 格。
// 图标的尺寸固定，连同下面的文字在格子里居中；小组件的四边对齐到它覆盖的那些格子里图标的位置：
// 左右对齐最外侧图标的左右边，上边对齐第一行图标的顶边，文字和最后一行图标的文字在同一高度
enum DesktopLayout {
    static let columnMinWidth: CGFloat = 360
    static let columnMaxWidth: CGFloat = 480
    static let maxColumns = 3
    static let columnCells = 4
    static let icon: CGFloat = 60
    // 图标和文字之间的距离
    static let spacing: CGFloat = 6
    static let labelHeight: CGFloat = 12
    // 文字最多能用的宽度，超出时用省略号
    static let labelWidth: CGFloat = 78

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

    // 图标或小组件本身。图标占 1 格，就是固定的图标大小
    static func body(_ size: Size, cell: CGFloat) -> CGSize {
        CGSize(width: CGFloat(size.width - 1) * cell + icon, height: CGFloat(size.height - 1) * cell + icon)
    }

    // 文字最多能用的宽度，对齐到最外侧图标的文字
    static func labelWidth(_ size: Size, cell: CGFloat) -> CGFloat {
        CGFloat(size.width - 1) * cell + labelWidth
    }

    // 主体顶边离所占格子顶边的距离：一格里的图标和文字上下居中
    static func top(cell: CGFloat) -> CGFloat {
        (cell - icon - spacing - labelHeight) / 2
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
