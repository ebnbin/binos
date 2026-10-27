import { BrainIcon, CaretLeftIcon, EyeSlashIcon, NotePencilIcon, SpinnerIcon, TrashIcon } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { IconButton } from '../../ui/IconButton.tsx'
import { formatTime } from '../../ui/time.ts'
import { useApplications } from '../registry.ts'
import type { WindowContext } from '../types.ts'
import { deleteConversation } from './api.ts'
import { Avatar } from './Avatar.tsx'
import { Chat } from './Chat.tsx'
import styles from './KitaApp.module.css'
import { MemoriesPage } from './MemoriesPage.tsx'
import { ProfilePage } from './ProfilePage.tsx'
import { kitaStatus } from './status.ts'
import { useKita } from './useKita.ts'

type Route = { name: 'new'; temporary: boolean } | { name: 'conversation'; id: string } | { name: 'memories' } | { name: 'profile' }

function parseRoute(route: string): Route {
  if (route === '/memories') return { name: 'memories' }
  if (route === '/profile') return { name: 'profile' }
  if (route === '/temporary') return { name: 'new', temporary: true }
  const match = /^\/c\/([\w-]+)$/.exec(route)
  return match ? { name: 'conversation', id: match[1] } : { name: 'new', temporary: false }
}

export function KitaApp({ ctx }: { ctx: WindowContext }) {
  const route = parseRoute(ctx.route)
  const { conversations, profile, memories, activity, failed } = useKita()
  const status = kitaStatus(activity, useApplications())
  const id = route.name === 'conversation' ? route.id : undefined
  const conversation = conversations?.find((item) => item.id === id)
  // 刚建好的对话可能还没出现在列表里，不能当成不存在
  const [created, setCreated] = useState<string>()
  const missing = id !== undefined && conversations !== undefined && !conversation && id !== created
  // 窄的时候一次只显示一页：从首页打开时先显示列表
  const [showList, setShowList] = useState(route.name === 'new' && !route.temporary)
  const title =
    route.name === 'memories' ? '记忆' : route.name === 'profile' ? '喜多' : route.name === 'new' ? (route.temporary ? '临时对话' : '新对话') : missing ? '对话不存在' : (conversation?.title ?? '')

  const { setTitle } = ctx
  useEffect(() => setTitle(title), [setTitle, title])

  function open(path: string) {
    setShowList(false)
    ctx.navigate(path)
  }

  return (
    <div className={styles.app}>
      <div className={styles.layout} data-view={showList ? 'list' : 'page'}>
        <nav className={styles.sidebar} aria-label="喜多">
          <button type="button" className={styles.identity} onClick={() => open('/profile')} aria-current={route.name === 'profile' ? 'page' : undefined}>
            <Avatar profile={profile} size={40} busy={status.busy} />
            <span>
              <strong>喜多</strong>
              <small>{status.label}</small>
            </span>
          </button>
          <div className={styles.actions}>
            <button type="button" className={styles.action} onClick={() => open('/')} aria-current={route.name === 'new' && !route.temporary ? 'page' : undefined}>
              <NotePencilIcon size={16} />
              新对话
            </button>
            <button type="button" className={styles.action} onClick={() => open('/temporary')} aria-current={route.name === 'new' && route.temporary ? 'page' : undefined}>
              <EyeSlashIcon size={16} />
              临时对话
            </button>
            <button type="button" className={styles.action} onClick={() => open('/memories')} aria-current={route.name === 'memories' ? 'page' : undefined}>
              <BrainIcon size={16} />
              记忆{memories?.length ? <small>{memories.length}</small> : null}
            </button>
          </div>
          <div className={styles.label}>对话</div>
          <ul className={styles.list}>
            {failed && !conversations && <li className={styles.placeholder}>读取失败</li>}
            {conversations?.length === 0 && <li className={styles.placeholder}>还没有对话</li>}
            {conversations?.map((item) => (
              <li key={item.id}>
                <button type="button" className={styles.conversation} aria-current={item.id === id ? 'page' : undefined} onClick={() => open(`/c/${item.id}`)}>
                  {item.temporary && <EyeSlashIcon size={13} aria-label="临时对话" className={styles.badge} />}
                  <span className={styles.title}>{item.title || '对话'}</span>
                  {item.state !== 'idle' ? <SpinnerIcon size={13} className={styles.running} aria-label="正在回答" /> : <time dateTime={item.updatedAt}>{formatTime(new Date(item.updatedAt))}</time>}
                </button>
                {item.state === 'idle' && (
                  <IconButton
                    icon={TrashIcon}
                    label="删除对话"
                    className={styles.delete}
                    onClick={() => {
                      void deleteConversation(item.id)
                      if (item.id === id) ctx.navigate('/', { replace: true })
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </nav>
        <main className={styles.main}>
          <header className={styles.bar}>
            <IconButton icon={CaretLeftIcon} label="返回" onClick={() => setShowList(true)} />
            <span>{title}</span>
          </header>
          {route.name === 'memories' ? (
            <MemoriesPage memories={memories} conversations={conversations} onOpen={(conversationId) => open(`/c/${conversationId}`)} />
          ) : route.name === 'profile' ? (
            <ProfilePage profile={profile} />
          ) : missing ? (
            <div className={styles.missing}>
              <p>这个对话不存在</p>
              <button type="button" className={styles.restart} onClick={() => open('/')}>
                开始新对话
              </button>
            </div>
          ) : (
            <Chat
              key={id ?? (route.name === 'new' && route.temporary ? 'temporary' : 'new')}
              id={id}
              temporary={route.name === 'new' && route.temporary}
              conversation={conversation}
              profile={profile}
              memoryCount={memories?.filter((memory) => memory.scope === 'personal').length ?? 0}
              onCreated={(newId) => {
                setCreated(newId)
                ctx.navigate(`/c/${newId}`, { replace: true })
              }}
            />
          )}
        </main>
      </div>
    </div>
  )
}
