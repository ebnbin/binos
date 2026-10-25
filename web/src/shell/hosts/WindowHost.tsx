import { Suspense, useMemo } from 'react'
import { findApplication, useApplications, windowView } from '../../apps/index.ts'
import type { WindowContext } from '../../apps/types.ts'
import { ErrorBoundary } from '../../ui/ErrorBoundary.tsx'
import styles from './WindowHost.module.css'
import { createWindowContext } from '../controller/navigation.ts'
import type { WindowInstance } from '../state/types.ts'

// 一个窗口里的 app。出错时只影响这个窗口
export function WindowHost({ window: win, onTitle, onOpen }: { window: WindowInstance; onOpen?: WindowContext['openApplication']; onTitle: (id: string, title: string) => void }) {
  const { id, route } = win
  const apps = useApplications()
  const ctx = useMemo<WindowContext>(() => createWindowContext(id, route, onTitle, onOpen), [id, route, onTitle, onOpen])

  const App = windowView(findApplication(apps, win.applicationId), win.viewId)?.component
  if (!App) {
    return <div className={styles.message}>找不到 app「{win.applicationId}」</div>
  }
  return (
    <ErrorBoundary
      fallback={(retry) => (
        <div className={styles.message}>
          <p>这个 app 出错了</p>
          <button type="button" className={styles.retry} onClick={retry}>
            重新打开
          </button>
        </div>
      )}
    >
      <Suspense>
        <App ctx={ctx} />
      </Suspense>
    </ErrorBoundary>
  )
}
