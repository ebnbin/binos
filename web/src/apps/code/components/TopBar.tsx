import type { PullRequest, SessionSummary } from '@binos/server/apps/code/types'
import { ChevronDown, ChevronLeft, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react'
import { useState } from 'react'
import { RenameInput, SessionActions } from './SessionMenu.tsx'
import { Popover } from '../../../ui/Popover.tsx'
import styles from './TopBar.module.css'
import { IconButton } from '../../../ui/IconButton.tsx'
import { type BuildState, buildState, prBuilds, useBuilds } from '../../builds/useBuilds.ts'

// 一列时左边返回列表；两列时列表就在旁边，只显示标题，上下文的用量在输入框里。对话开过 PR 时右边是 PR 按钮。session：列表里这个 session 的概况，还没读到时没有。
// 点空白处回到对话顶部，和 iOS 点状态栏一样
export function TopBar({
  title,
  sessionId,
  session,
  onBack,
  onScrollTop,
  onNavigate,
}: {
  title: string
  sessionId: number | null
  session: SessionSummary | undefined
  onBack: () => void
  onScrollTop: () => void
  onNavigate: (route: string) => void
}) {
  const prs = session?.prs ?? []
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
          </>
        )}
      </div>
      {sessionId !== null && prs.length > 0 && <PrMenu prs={prs} project={session?.project} onNavigate={onNavigate} />}
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

const isOpen = (pr: PullRequest) => pr.state === 'open' || !pr.state

// 对话开的 PR 收在一个按钮里：角标是开着的个数，颜色是它们最新提交的构建结果；点开是全部 PR，开着的在前
function PrMenu({ prs, project, onNavigate }: { prs: PullRequest[]; project: string | undefined; onNavigate: (route: string) => void }) {
  const [open, setOpen] = useState(false)
  const active = prs.filter(isOpen)
  const newest = [...prs].reverse()
  // 构建服务只编 binOS 自己的仓库
  const builds = useBuilds(project === 'binos' && active.length > 0).data?.builds
  const states = builds ? active.map((pr) => buildState(prBuilds(builds, pr.number))) : []
  const state = (['failed', 'running', 'success'] as const).find((s) => states.includes(s))
  return (
    <Popover
      label="对话的 PR"
      className={styles.prMenu}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={styles.prButton} aria-label={`对话的 PR，${active.length} 个开着`} title="对话的 PR">
          {active.length > 0 ? <GitPullRequest size={19} strokeWidth={1.75} /> : <GitMerge size={19} strokeWidth={1.75} />}
          {active.length > 0 && (
            <span className={styles.badge} data-state={state}>
              {active.length}
            </span>
          )}
        </button>
      }
    >
      {[...newest.filter(isOpen), ...newest.filter((pr) => !isOpen(pr))].map((pr) => (
        <PrRow
          key={pr.url}
          pr={pr}
          build={builds && isOpen(pr) ? buildState(prBuilds(builds, pr.number)) : undefined}
          onBuilds={() => {
            setOpen(false)
            onNavigate(`/builds?ref=pr/${pr.number}`)
          }}
        />
      ))}
    </Popover>
  )
}

const prIcons = { open: GitPullRequest, merged: GitMerge, closed: GitPullRequestClosed }
const prStates = { open: '开着', merged: '已合并', closed: '已关闭' }

const buildLabels = { running: '构建中', failed: '构建失败', success: '构建成功' }

// 弹层里的一行：点编号和标题去 GitHub；开着的有预览时另有预览链接，有构建时显示最新提交的构建结果，点了去构建页
function PrRow({ pr, build, onBuilds }: { pr: PullRequest; build: BuildState | undefined; onBuilds: () => void }) {
  const Icon = prIcons[pr.state ?? 'open']
  return (
    <div className={styles.prRow} data-state={pr.state ?? 'open'}>
      <a href={pr.url} target="_blank" rel="noreferrer" className={styles.prLink}>
        <Icon size={14} strokeWidth={2} className={styles.prIcon} />
        <span className={styles.prNumber}>#{pr.number}</span>
        <span className={styles.prTitle}>{pr.title ?? pr.url}</span>
      </a>
      {isOpen(pr) ? (
        <>
          {pr.preview && (
            <a href={pr.preview} target="_blank" rel="noreferrer" className={styles.prAction}>
              预览
            </a>
          )}
          {build && (
            <button type="button" className={styles.prAction} data-build={build} onClick={onBuilds}>
              {buildLabels[build]}
            </button>
          )}
        </>
      ) : (
        <span className={styles.prState}>{pr.state && prStates[pr.state]}</span>
      )}
    </div>
  )
}
