import SwiftUI

// 桌面：铺满内容区，内容按顺序分到各栏，超出一屏时整个桌面一起上下滚动
struct DesktopView: View {
    let scene: DesktopScene
    let onOpen: (DesktopSample) -> Void
    @Environment(\.systemGeometry) private var geometry

    var body: some View {
        let content = geometry.content
        let columns = DesktopLayout.columns(width: content.frame.width)
        let sizes = scene.items.map(\.size)
        let starts = DesktopLayout.split(sizes, count: columns.count)
        ScrollView {
            HStack(alignment: .top, spacing: 0) {
                ForEach(starts.indices, id: \.self) { index in
                    let end = index + 1 < starts.count ? starts[index + 1] : scene.items.count
                    DesktopColumn(items: Array(scene.items[starts[index]..<end]), width: columns.width, onOpen: onOpen)
                }
            }
            .padding(.horizontal, columns.margin)
            .padding(.vertical, DesktopLayout.verticalInset)
        }
        .frame(width: content.frame.width, height: content.frame.height)
        .background(LinearGradient(colors: scene.wallpaper.count > 1 ? scene.wallpaper : scene.wallpaper + scene.wallpaper, startPoint: .topLeading, endPoint: .bottomTrailing))
        .clipShape(UnevenRoundedRectangle(cornerRadii: content.cornerRadii))
        .offset(x: content.frame.minX, y: content.frame.minY)
    }
}

private struct DesktopColumn: View {
    let items: [DesktopSample]
    let width: CGFloat
    let onOpen: (DesktopSample) -> Void

    var body: some View {
        let (placements, rows) = DesktopLayout.pack(items.map(\.size))
        let grid = DesktopLayout.grid(columnWidth: width)
        ZStack(alignment: .topLeading) {
            ForEach(items.indices, id: \.self) { index in
                let item = items[index], place = placements[index]
                let x = grid.inset + CGFloat(place.column) * grid.cellWidth, y = CGFloat(place.row) * grid.rowHeight
                DesktopItem(item: item, size: DesktopLayout.body(item.size, grid: grid), labelWidth: DesktopLayout.labelWidth(item.size, grid: grid))
                    .frame(width: CGFloat(item.size.width) * grid.cellWidth)
                    .contentShape(Rectangle())
                    .onTapGesture { onOpen(item) }
                    .offset(x: x, y: y + grid.top)
            }
        }
        .frame(width: width, height: CGFloat(rows) * grid.rowHeight, alignment: .topLeading)
    }
}

// 图标是纯色、中间一个符号；小组件是渐变色、写着占几格
private struct DesktopItem: View {
    let item: DesktopSample
    let size: CGSize
    let labelWidth: CGFloat

    var body: some View {
        VStack(spacing: DesktopLayout.spacing) {
            Group {
                switch item.kind {
                case .icon:
                    RoundedRectangle(cornerRadius: DesktopLayout.cornerRadius(item.size), style: .continuous)
                        .fill(item.colors[0])
                        .overlay(Image(systemName: item.symbol).font(.system(size: 26, weight: .semibold)).foregroundStyle(.white))
                case .widget:
                    RoundedRectangle(cornerRadius: DesktopLayout.cornerRadius(item.size), style: .continuous)
                        .fill(LinearGradient(colors: item.colors, startPoint: .top, endPoint: .bottom))
                        .overlay(RoundedRectangle(cornerRadius: DesktopLayout.cornerRadius(item.size), style: .continuous).strokeBorder(.white.opacity(0.6), lineWidth: 1.5))
                        .overlay {
                            VStack(spacing: 4) {
                                Image(systemName: item.symbol).font(.system(size: 20, weight: .semibold))
                                Text("\(item.size.width)×\(item.size.height)").font(.system(size: 15, weight: .bold).monospacedDigit())
                            }
                            .foregroundStyle(.white)
                            .shadow(radius: 2)
                        }
                }
            }
            .frame(width: size.width, height: size.height)
            Text(item.label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.5), radius: 1)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: labelWidth)
                .frame(height: DesktopLayout.labelHeight)
        }
    }
}
