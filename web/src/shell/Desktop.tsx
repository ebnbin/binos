import type { CSSProperties } from 'react'
import { findApplication, useApplications } from '../apps/index.ts'
import type { ApplicationDefinition } from '../apps/types.ts'
import { AppIcon } from './AppIcon.tsx'
import { WidgetHost } from './hosts/WidgetHost.tsx'
import styles from './Desktop.module.css'
import { desktopItems, itemSize } from './desktop-items.ts'
import type { DesktopItem } from './desktop-items.ts'
import { column, desktopColumns, packColumn, splitColumns } from './layout.ts'

// 一栏 360 时的格子：两边 16，格子 70，间隔 16
const cell = 70
const gap = 16
const margin = (column.min - cell * 4 - gap * 3) / 2

export function Desktop({ width, onOpen }: { width: number; onOpen: (app: string, route?: string) => void }) {
  const apps = useApplications()
  const items = desktopItems(apps)
  const { count, columnWidth, scale } = desktopColumns(width)
  const sizes = items.map(itemSize)
  const starts = splitColumns(sizes, count)
  const columns = starts.map((start, index) => {
    const end = starts[index + 1] ?? items.length
    return { items: items.slice(start, end), ...packColumn(sizes.slice(start, end)) }
  })

  const vars = {
    '--column': `${columnWidth}px`,
    '--count': count,
    '--cell': `${cell * scale}px`,
    '--gap': `${gap * scale}px`,
    '--margin': `${margin * scale}px`,
  } as CSSProperties

  return (
    <div className={styles.desktop} style={vars}>
      <div className={styles.columns}>
        {columns.map((column, index) => (
          <div key={index} className={styles.grid} style={{ gridTemplateRows: `repeat(${column.rows}, var(--cell))` }}>
            {column.items.map((item, itemIndex) => {
              const place = column.placements[itemIndex]
              return (
                <Entry
                  key={item.id}
                  item={item}
                  apps={apps}
                  style={{ gridArea: `${place.row + 1} / ${place.column + 1} / span ${place.height} / span ${place.width}` }}
                  onOpen={onOpen}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Entry({
  item,
  apps,
  style,
  onOpen,
}: {
  item: DesktopItem
  apps: ApplicationDefinition[]
  style: CSSProperties
  onOpen: (app: string, route?: string) => void
}) {
  const app = findApplication(apps, item.applicationId)
  if (!app) {
    return null
  }
  if (item.kind === 'shortcut') {
    return (
      <button type="button" className={styles.icon} style={style} onClick={() => onOpen(app.id)}>
        <AppIcon app={app} className={styles.glyph} />
        <span className={styles.label}>{app.name}</span>
      </button>
    )
  }
  return <WidgetHost item={item} application={app} style={style} onOpen={onOpen} />
}
