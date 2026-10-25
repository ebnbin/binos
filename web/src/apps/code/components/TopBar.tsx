import type { Build } from '@binos/server/apps/builds/types'
import type { PullRequest, SessionSummary } from '@binos/server/apps/code/types'
import { ChevronDown, ChevronLeft, GitMerge, GitPullRequest, GitPullRequestClosed, SquarePen } from 'lucide-react'
import { useState } from 'react'
import { RenameInput, SessionActions } from './SessionMenu.tsx'
import { Popover } from '../../../ui/Popover.tsx'
import styles from './TopBar.module.css'
import { IconButton } from '../../../ui/IconButton.tsx'
import { buildState, prBuilds, useBuilds } from '../../builds/useBuilds.ts'

// 一列时左边返回列表、右边新对话；两列时列表就在旁边，只显示标题，上下文的用量在输入框里。session：列表里这个 session 的概况，还没读到时没有。
// 点空白处回到对话顶部，和 iOS 点状态栏一样
export function TopBar({
  title,
  sessionId,
  session,
  onBack,
  onNew,
  onScrollTop,
  onNavigate,
}: {
  title: string
  sessionId: number | null
  session: SessionSummary | undefined
  onBack: () => void
  onNew: () => void
  onScrollTop: () => void
  onNavigate: (route: string) => void
}) {
  const prs = session?.prs ?? []
  // 构建服务只编 binOS 自己的仓库
  const builds = useBuilds(session?.project === 'binos' && prs.some((pr) => pr.state === 'open' || !pr.state)).data?.builds
  return (
    <header className={styles.bar} onClick={(event) => event.target === event.currentTarget && onScrollTop()}>
      <IconButton icon={ChevronLeft} label="返回对话列表" className={styles.singleColumnOnly} onClick={onBack} />
      <div className={styles.heading} onClick={(event) => event.target === event.currentTarget && onScrollTop()}>
        {sessionId === null ? (
          <span className={`${styles.title} ${styles.singleColumnOnly}`}>新对话</span>
        ) : (
          <>
            {session ? <SessionTitle key={session.id} session={session} /> : <span className={styles.title}>{title}</span>}
            <span className={styles.id}>#{sessionId}</span>
            {prs.length > 0 && <PrList prs={prs} builds={builds} onNavigate={onNavigate} />}
          </>
        )}
      </div>
      {sessionId !== null && <IconButton icon={SquarePen} label="新对话" className={styles.singleColumnOnly} onClick={onNew} />}
    </header>
  )
}

// 点标题打开这个会话的操作菜单，重命名时标题换成输入框
function SessionTitle({ session }: { session: SessionSummary }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  if (renaming) {
    return <RenameInput session={session} className={styles.rename} onDone={() => setRenaming(false)} />
  }
  return (
    <span className={styles.titleWrap}>
      <SessionActions session={session} onRename={() => setRenaming(true)} open={menuOpen} onOpenChange={setMenuOpen}>
        <button type="button" className={styles.titleButton} aria-expanded={menuOpen} aria-haspopup="menu">
          <span className={styles.title}>{session.title || '（无内容）'}</span>
          <ChevronDown size={14} strokeWidth={2} className={styles.titleChevron} />
        </button>
      </SessionActions>
    </span>
  )
}

// 开着的 PR 直接显示，结束了的收起来，点开再看
function PrList({ prs, builds, onNavigate }: { prs: PullRequest[]; builds: Build[] | undefined; onNavigate: (route: string) => void }) {
  const active = prs.filter((pr) => pr.state === 'open' || !pr.state)
  const finished = prs.filter((pr) => pr.state === 'merged' || pr.state === 'closed')
  return (
    <span className={styles.prs}>
      {active.map((pr) => (
        <PrLink key={pr.url} pr={pr} builds={builds} onNavigate={onNavigate} />
      ))}
      {finished.length > 0 && (
        <Popover
          label="对话的 PR"
          className={styles.prMenu}
          trigger={
            <button type="button" className={styles.finished} aria-label="查看对话的 PR">
              <GitMerge size={14} strokeWidth={2} />
              {finished.length}
            </button>
          }
        >
          {[...prs].reverse().map((pr) => (
            <a key={pr.url} href={pr.url} target="_blank" rel="noreferrer" data-state={pr.state}>
              <span className={styles.prNumber}>#{pr.number}</span>
              <span className={styles.prTitle}>{pr.title ?? pr.url}</span>
              <span className={styles.prState}>{pr.state && prStates[pr.state]}</span>
            </a>
          ))}
        </Popover>
      )}
    </span>
  )
}

const prIcons = { open: GitPullRequest, merged: GitMerge, closed: GitPullRequestClosed }
const prStates = { open: '开着', merged: '已合并', closed: '已关闭' }

const buildLabels = { running: '构建中', failed: '构建失败', success: '构建成功' }

// 这个 session 开的 PR：点编号去 GitHub，开着的有预览时另有预览链接，有构建时显示最新提交的构建结果
function PrLink({ pr, builds, onNavigate }: { pr: PullRequest; builds: Build[] | undefined; onNavigate: (route: string) => void }) {
  const Icon = prIcons[pr.state ?? 'open']
  const build = builds && buildState(prBuilds(builds, pr.number))
  return (
    <span className={styles.pr} data-state={pr.state}>
      <a href={pr.url} target="_blank" rel="noreferrer" title={[pr.title, pr.state && prStates[pr.state]].filter(Boolean).join(' · ')}>
        <Icon size={14} strokeWidth={2} />#{pr.number}
      </a>
      {pr.preview && (
        <a href={pr.preview} target="_blank" rel="noreferrer" className={styles.preview}>
          预览
        </a>
      )}
      {build && (
        <button type="button" className={styles.build} data-state={build} onClick={() => onNavigate(`/builds?ref=pr/${pr.number}`)}>
          {buildLabels[build]}
        </button>
      )}
    </span>
  )
}
