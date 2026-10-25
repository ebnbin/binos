import { ChevronLeft } from 'lucide-react'
import { IconButton } from '../../ui/IconButton.tsx'
import { BuildsPage } from '../builds/BuildsPage.tsx'
import { DevicesApp } from '../devices/DevicesApp.tsx'
import { useEffect, useRef, useState } from 'react'
import type { WindowContext } from '../types.ts'
import styles from './CodeApp.module.css'
import { Conversation } from './components/Conversation.tsx'
import { SessionList } from './components/SessionList.tsx'
import { TopBar } from './components/TopBar.tsx'
import { useSessions } from './useSessions.ts'

type Route = { name: 'builds' } | { name: 'devices' } | { name: 'home' } | { name: 'new'; project?: string } | { name: 'session'; id: number; seq?: number }

function parseRoute(route: string): Route {
  const path = route.split('?')[0]
  if (path === '/builds' || path === '/devices') return { name: path.slice(1) as 'builds' | 'devices' }
  if (route.split('?')[0] === '/new') {
    return { name: 'new', project: new URLSearchParams(route.split('?')[1]).get('project') ?? undefined }
  }
  const match = /^\/(\d+)(?:\?seq=(\d+))?$/.exec(route)
  return match ? { name: 'session', id: Number(match[1]), ...(match[2] !== undefined && { seq: Number(match[2]) }) } : { name: 'home' }
}

const sessionRoute = (id: number) => `/${id}`

export function CodeApp({ ctx }: { ctx: WindowContext }) {
  const route = parseRoute(ctx.route)
  const { sessions, projects, failed } = useSessions()
  // 刚建好的 session 可能还没出现在列表里，不能当成不存在
  const [created, setCreated] = useState<{ id: number; kitaSession: string; project: string }>()
  const conversationScroll = useRef<HTMLDivElement>(null)

  const sessionId = route.name === 'session' ? route.id : null
  const session = sessions?.find((item) => item.id === sessionId)
  const project = session?.project ?? (sessionId === created?.id ? created.project : undefined) ?? (route.name === 'new' ? route.project : undefined) ?? 'binos'
  const missing = sessionId !== null && sessions !== undefined && !session && sessionId !== created?.id
  const tool = route.name === 'builds' || route.name === 'devices' ? route.name : undefined
  const title = tool ? (tool === 'builds' ? '构建' : '设备') : missing ? '对话不存在' : (session?.title ?? '')

  const { setTitle } = ctx
  useEffect(() => setTitle(title), [setTitle, title])

  return (
    <div className={styles.app}>
      <div className={styles.layout} data-view={route.name === 'home' ? 'list' : 'conversation'}>
        <div className={styles.listPane}>
          <SessionList projects={projects} sessions={sessions} failed={failed} current={sessionId} currentTool={tool} onNavigate={ctx.navigate} />
        </div>
        <main className={styles.conversationPane}>
          {tool ? (
            <>
              <header className={styles.toolBar}>
                <IconButton icon={ChevronLeft} label="返回对话列表" onClick={() => ctx.navigate('/')} />
                <span>{title}</span>
              </header>
              <div className={styles.content}>
                {tool === 'builds' ? <BuildsPage key={ctx.route} initialRef={new URLSearchParams(ctx.route.split('?')[1]).get('ref') ?? 'main'} /> : <DevicesApp ctx={ctx} />}
              </div>
            </>
          ) : (
            <>
              <TopBar
                title={title}
                sessionId={sessionId}
                session={session}
                onBack={ctx.back}
                onScrollTop={() => conversationScroll.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                onNavigate={ctx.navigate}
              />
              {missing ? (
                <div className={styles.missing}>
                  <p>这个对话不存在</p>
                  <button type="button" className={styles.missingButton} onClick={() => ctx.navigate('/')}>
                    返回对话列表
                  </button>
                </div>
              ) : (
                <Conversation
                  project={project}
                  projects={projects}
                  onProject={(id) => ctx.navigate(`/new?project=${encodeURIComponent(id)}`, { replace: true })}
                  key={`${sessionId ?? 'new'}-${project}-${route.name === 'session' ? route.seq ?? '' : ''}`}
                  targetSeq={route.name === 'session' ? route.seq : undefined}
                  sessionId={sessionId}
                  session={session}
                  thread={session?.kitaSession ?? (sessionId === created?.id ? created.kitaSession : undefined)}
                  scrollRef={conversationScroll}
                  onCreated={(id, thread) => {
                    setCreated({ id, kitaSession: thread, project })
                    ctx.navigate(sessionRoute(id), { replace: true })
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
