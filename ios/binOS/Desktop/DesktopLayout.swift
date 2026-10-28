import CoreGraphics

// 桌面的分栏和格子。一栏宽 360～480，最多 3 栏，再宽的空间平分到左右两边。
// 一栏 4 格，格子是正方形，边长是栏宽的四分之一。图标和小组件横竖都只能占 1、2 或 4 格，
// 尺寸只由占几格决定，按一栏 360 宽、格子 90 时算，和栏宽无关，连同下面的文字在所占的格子里居中
enum DesktopLayout {
    static let columnMinWidth: CGFloat = 360
    static let columnMaxWidth: CGFloat = 480
    static let maxColumns = 3
    static let columnCells = 4
    static let cell = columnMinWidth / CGFloat(columnCells)
    // 格子 90 时上下的边距、主体和文字之间的距离都是 padding，最下面是文字
    static let padding: CGFloat = 6
    static let labelHeight: CGFloat = 12

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

    // 图标或小组件本身：90 的格子减去上下的边距、文字和它上面的间距，横向减去同样多
    static func body(_ size: Size) -> CGSize {
        let inset = padding * 3 + labelHeight
        return CGSize(width: cell * CGFloat(size.width) - inset, height: cell * CGFloat(size.height) - inset)
    }

    // 文字最多能用的宽度，超出时用省略号
    static func labelWidth(_ size: Size) -> CGFloat {
        cell * CGFloat(size.width) - padding * 2
    }

    // 主体、间距和文字合起来的高度
    static func itemHeight(_ size: Size) -> CGFloat {
        body(size).height + padding + labelHeight
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
