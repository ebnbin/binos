import { useState } from 'react'
import { FloatingPlayer, MusicStatusButton } from '../apps/music/FloatingPlayer.tsx'
import { useApplicationsLoaded } from '../apps/index.ts'
import { useElementSize } from '../ui/useElementSize.ts'
import { useBarPlacement } from './bar-placement.ts'
import { ConnectionStatus } from './ConnectionStatus.tsx'
import { useDockCapsule } from './dock-capsule.ts'
import { useShellController } from './controller/useShellController.ts'
import { Desktop } from './Desktop.tsx'
import styles from './Shell.module.css'
import { TaskBar } from './TaskBar.tsx'
import { Workspace } from './Workspace.tsx'

export function Shell() {
  const loaded = useApplicationsLoaded()
  const [main, size] = useElementSize<HTMLDivElement>()
  const controller = useShellController(size)
  const placement = useBarPlacement()
  const compact = placement === 'bottom' && window.matchMedia('(pointer: coarse)').matches
  const { collapsed, dock, expand, touch, onPointerDown, onPointerMove, onPointerEnd } = useDockCapsule(compact, controller.home)
  const focusedWindow = controller.windows.find(item => item.id === controller.focused)
  const [musicCollapsed, setMusicCollapsed] = useState(false)
  const musicVisible = !controller.home && controller.windows.some(item => item.window.applicationId === 'music' && controller.panes.includes(item.id))
  const [previousMusicVisible, setPreviousMusicVisible] = useState(musicVisible)
  if (previousMusicVisible !== musicVisible) {
    setPreviousMusicVisible(musicVisible)
    setMusicCollapsed(false)
  }

  return (
    <div className={styles.shell} data-bar={placement} data-compact={compact}>
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
      </div>
      {placement !== 'hidden' && (
        <TaskBar
          ref={dock}
          placement={placement}
          capsule={compact ? { collapsed, current: focusedWindow, onExpand: expand, onActivity: touch, onPointerDown, onPointerMove, onPointerEnd } : undefined}
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
          onHome={controller.toggleHome}
          onShow={controller.show}
          onSplit={controller.split}
          onClose={controller.close}
        />
      )}
      <ConnectionStatus />
    </div>
  )
}
