import { useState } from 'react'
import { FloatingPlayer, MusicStatusButton } from '../apps/music/FloatingPlayer.tsx'
import { useApplicationsLoaded } from '../apps/index.ts'
import { useElementSize } from '../ui/useElementSize.ts'
import { useBarPlacement } from './bar-placement.ts'
import { ConnectionStatus } from './ConnectionStatus.tsx'
import { useShellController } from './controller/useShellController.ts'
import { Desktop } from './Desktop.tsx'
import styles from './Shell.module.css'
import { Switcher } from './Switcher.tsx'
import { TaskBar } from './TaskBar.tsx'
import { Workspace } from './Workspace.tsx'

export function Shell() {
  const loaded = useApplicationsLoaded()
  const [main, size] = useElementSize<HTMLDivElement>()
  const controller = useShellController(size)
  const placement = useBarPlacement()
  // 放不下分屏的屏幕上，Dock 不排开所有 app，用多任务视图切换
  const compact = controller.allowed.length === 1
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcher = compact && switcherOpen && controller.windows.length > 0
  const [musicCollapsed, setMusicCollapsed] = useState(false)
  const musicVisible = !controller.home && controller.windows.some(item => item.window.applicationId === 'music' && controller.panes.includes(item.id))
  const [previousMusicVisible, setPreviousMusicVisible] = useState(musicVisible)
  if (previousMusicVisible !== musicVisible) {
    setPreviousMusicVisible(musicVisible)
    setMusicCollapsed(false)
  }

  return (
    <div className={styles.shell} data-bar={placement}>
      <div className={styles.titleBar} />
      <div ref={main} className={styles.screen}>
        {loaded && size && (
          <>
            <Workspace
              windows={controller.windows}
              panes={controller.panes}
              layout={controller.layout}
              hidden={controller.home}
              onFocus={controller.focus}
              onLayout={controller.chooseLayout}
              onExit={controller.exitSplit}
              onPick={controller.pick}
              picking={controller.picking}
              unavailableApps={controller.unavailableApps}
              onSwap={controller.swap}
              onCancel={controller.cancel}
              size={size}
              portrait={controller.portrait}
              onTitle={controller.onTitle}
              onOpen={controller.open}
            />
            {controller.home && <Desktop width={size.width} onOpen={controller.open} />}
          </>
        )}
        {loaded && size && !musicVisible && (
          <FloatingPlayer screen={size} collapsed={musicCollapsed} onCollapse={() => setMusicCollapsed(true)} onOpen={() => controller.open('music')} locked={controller.picking} />
        )}
        {size && compact && (
          <Switcher
            open={switcher}
            windows={controller.windows}
            groups={controller.groups}
            order={controller.order}
            aspect={size.width / size.height}
            onShow={(id) => { controller.show(id); setSwitcherOpen(false) }}
            onRemove={controller.remove}
            onClose={() => setSwitcherOpen(false)}
          />
        )}
      </div>
      {placement !== 'hidden' && (
        <TaskBar
          placement={placement}
          accessory={!musicVisible && <MusicStatusButton collapsed={musicCollapsed} onToggle={() => setMusicCollapsed(value => !value)} />}
          windows={controller.windows}
          groups={controller.groups}
          locked={controller.picking}
          panes={controller.panes}
          focused={controller.focused}
          focusedSlot={controller.slot}
          home={controller.home}
          layout={controller.layout}
          allowed={controller.allowed}
          portrait={controller.portrait}
          compact={compact}
          switcher={switcher}
          onHome={() => {
            setSwitcherOpen(false)
            if (!switcher || !controller.home) controller.toggleHome()
          }}
          onShow={controller.show}
          onSplit={controller.split}
          onClose={() => { setSwitcherOpen(false); controller.close() }}
          onSwitcher={() => setSwitcherOpen(!switcher)}
        />
      )}
      <ConnectionStatus />
    </div>
  )
}
