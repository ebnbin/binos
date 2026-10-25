import type { Project, SessionSummary } from '@binos/server/apps/code/types'
import { agents, defaultAgent } from '@binos/server/services/kita/types'
import {
  ChevronRight,
  CircleAlert,
  CircleStop,
  Clock,
  FolderPlus,
  Gauge,
  GitPullRequest,
  Hourglass,
  Hammer,
  Smartphone,
  MoreHorizontal,
  Search,
  SquarePen,
  X,
} from 'lucide-react'
import { Select } from '../../../ui/Select.tsx'
import { useEffect, useState } from 'react'
import { createProject, searchContent } from '../api.ts'
import { onChange } from '../../../events.ts'
import { formatQuota } from '../format.ts'
import { formatClock, formatTime } from '../../../ui/time.ts'
import { buildsSummary, useBuilds } from '../../builds/useBuilds.ts'
import { AuthBanner } from './AuthBanner.tsx'
import { Quota } from './Quota.tsx'
import { RenameInput, SessionActions } from './SessionMenu.tsx'
import { SearchResults } from './SearchResults.tsx'
import styles from './SessionList.module.css'

// 输入停下这么久才去搜
const searchDelay = 250

export function SessionList({
  sessions,
  projects,
  failed,
  current,
  currentTool,
  onNavigate,
}: {
  sessions: SessionSummary[] | undefined
  projects: Project[] | undefined
  failed: boolean
  current: number | null
  currentTool?: 'builds' | 'devices'
  onNavigate: (route: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [repository, setRepository] = useState('')
  const [mode, setMode] = useState('existing')
  const [connecting, setConnecting] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const search = useSearch(query.trim())
  const builds = useBuilds().data
  const summary = builds && buildsSummary(builds.builds)
  return (
    <div className={styles.pane}>
      <header className={styles.brand}>
        <span className={styles.wordmark}>Code</span>
        <Quota />
      </header>
      <AuthBanner />
      <button type="button" className={styles.newButton} onClick={() => onNavigate('/new')}>
        <SquarePen size={16} strokeWidth={1.75} className={styles.icon} />
        <span className={styles.title}>新对话</span>
      </button>
      <button type="button" className={styles.projectButton} disabled={saving} onClick={() => { setCreating(!creating); setConnecting(undefined); setMode('existing'); setName(''); setRepository(''); setError('') }}>
        <FolderPlus size={16} strokeWidth={1.75} className={styles.icon} />
        <span className={styles.title}>创建项目</span>
      </button>
      {creating && (
        <form
          className={styles.projectForm}
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim() || !repository.trim() || saving) return
            setSaving(true)
            setError('')
            void createProject(name.trim(), repository.trim(), mode === 'new', connecting)
              .then((project) => {
                setName('')
                setRepository('')
                setConnecting(undefined)
                setCreating(false)
                onNavigate(`/new?project=${project.id}`)
              })
              .catch((error: unknown) => setError(error instanceof Error ? error.message : '创建失败，请重试'))
              .finally(() => setSaving(false))
          }}
        >
          <input
            className={styles.field}
            autoFocus
            disabled={saving || !!connecting}
            aria-label="项目名称"
            placeholder="项目名称"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Select
            label="仓库来源"
            value={mode}
            disabled={saving}
            onValueChange={setMode}
            options={[{ value: 'existing', label: '关联已有仓库' }, { value: 'new', label: '创建私有 GitHub 仓库' }]}
          />
          <input
            className={styles.field}
            aria-label="GitHub 仓库"
            placeholder="owner/repository"
            value={repository}
            disabled={saving}
            onChange={(event) => setRepository(event.target.value)}
          />
          <button type="submit" className={styles.submit} disabled={!name.trim() || !repository.trim() || saving}>
            {saving ? '准备仓库中…' : connecting ? '关联' : '创建'}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      <label className={styles.search}>
        <Search size={14} strokeWidth={2} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索对话与消息"
          aria-label="搜索全部历史内容"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) setQuery('')
          }}
        />
        {query && (
          <button type="button" className={styles.clear} onClick={() => setQuery('')} aria-label="清除搜索">
            <X size={10} strokeWidth={3} />
          </button>
        )}
      </label>
      <nav className={styles.list}>
        <ul>
          {([['builds', 'binOS 构建', Hammer], ['devices', '设备', Smartphone]] as const).map(([name, label, Icon]) => (
            <li key={name}>
              <button type="button" className={styles.item} aria-current={currentTool === name ? 'page' : undefined} onClick={() => onNavigate(`/${name}`)}>
                <span className={styles.line}><Icon size={16} strokeWidth={1.75} className={styles.icon} /><span className={styles.title}>{label}</span>{name === 'builds' && summary && <span className={styles.buildSummary} data-state={summary.state}>{summary.text}</span>}</span>
              </button>
            </li>
          ))}
        </ul>
        {query.trim() ? (
          <SearchResults
            query={query.trim()}
            data={search.data}
            failed={search.failed}
            onRetry={search.retry}
            sessions={sessions}
            projects={projects}
            onNavigate={onNavigate}
          />
        ) : !projects || !sessions ? (
          failed && <p className={styles.placeholder}>读取失败</p>
        ) : (
          projects.map((project) => (
            <section key={project.id}>
              <div className={styles.projectHeader}>
                <span className={styles.projectName}>
                  {project.name}
                  {project.repository && <a className={styles.repository} href={`https://github.com/${project.repository}`} target="_blank" rel="noreferrer">{project.repository}</a>}
                </span>
                {project.id !== 'binos' && !project.repository && (
                  <button type="button" className={styles.headerLink} disabled={saving} onClick={() => {
                    setMode('existing')
                    setConnecting(project.id)
                    setName(project.name)
                    setRepository('')
                    setError('')
                    setCreating(true)
                  }}>关联仓库</button>
                )}
                <button type="button" className={styles.headerIcon} aria-label={`在 ${project.name} 中新建对话`} onClick={() => onNavigate(`/new?project=${project.id}`)}>
                  <SquarePen size={14} strokeWidth={2} />
                </button>
              </div>
              <Sections
                sessions={sessions.filter((session) => session.project === project.id)}
                searching={false}
                failed={failed}
                current={current}
                onNavigate={onNavigate}
              />
            </section>
          ))
        )}
      </nav>
    </div>
  )
}

function useSearch(query: string) {
  const [result, setResult] = useState<{ query: string; data?: Awaited<ReturnType<typeof searchContent>>; failed?: boolean }>()
  const [revision, setRevision] = useState(0)
  useEffect(
    () =>
      onChange((event) => {
        if (event === null || event.type === 'session') setRevision((value) => value + 1)
      }),
    [],
  )
  useEffect(() => {
    if (!query) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchContent(query)
        .then((data) => !cancelled && setResult({ query, data }))
        .catch(() => !cancelled && setResult({ query, failed: true }))
    }, searchDelay)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, revision])
  return {
    ...(result?.query === query ? result : { query }),
    retry: () => {
      setResult(undefined)
      setRevision((value) => value + 1)
    },
  }
}

// 每个项目内置顶的在最上面，其余按最近活动排序，归档的收在最下面
function Sections({
  sessions,
  searching,
  failed,
  current,
  onNavigate,
}: {
  sessions: SessionSummary[] | undefined
  searching: boolean
  failed: boolean
  current: number | null
  onNavigate: (route: string) => void
}) {
  const [showArchived, setShowArchived] = useState(false)
  if (!sessions) {
    return failed ? <p className={styles.placeholder}>读取失败</p> : null
  }
  if (sessions.length === 0) {
    return <p className={styles.placeholder}>{searching ? '没有找到' : '还没有对话'}</p>
  }
  const pinned = sessions.filter((session) => session.pinned && !session.archived)
  const others = sessions.filter((session) => !session.pinned && !session.archived)
  const archived = sessions.filter((session) => session.archived)
  const items = (list: SessionSummary[], clock = false) => (
    <ul>
      {list.map((session) => (
        <SessionItem key={session.id} session={session} current={session.id === current} clock={clock} onNavigate={onNavigate} />
      ))}
    </ul>
  )
  return (
    <>
      {pinned.length > 0 && (
        <>
          <div className={styles.label}>置顶</div>
          {items(pinned)}
        </>
      )}
      {items(others)}
      {archived.length > 0 && (
        <>
          <button
            type="button"
            className={styles.archivedToggle}
            onClick={() => setShowArchived(!showArchived)}
            aria-expanded={showArchived}
          >
            <ChevronRight size={12} strokeWidth={2.5} className={styles.toggleChevron} />
            已归档 {archived.length}
          </button>
          {(showArchived || searching) && items(archived)}
        </>
      )}
    </>
  )
}

function SessionItem({
  session,
  current,
  clock,
  onNavigate,
}: {
  session: SessionSummary
  current: boolean
  clock: boolean
  onNavigate: (route: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  return (
    <li className={styles.row} data-menu-open={menuOpen || undefined}>
      {renaming ? (
        <RenameInput session={session} onDone={() => setRenaming(false)} />
      ) : (
        <button
          type="button"
          className={styles.item}
          aria-current={current ? 'page' : undefined}
          onClick={() => onNavigate(`/${session.id}`)}
        >
          <span className={styles.line}>
            {session.running ? (
              <span className={styles.live} aria-label="正在回答" />
            ) : (
              session.unread && <span className={styles.unread} aria-label="有新回复" />
            )}
            <span className={styles.title} data-unread={session.unread || undefined}>
              {session.title || '（无内容）'}
            </span>
          </span>
          <SessionMeta session={session} clock={clock} />
        </button>
      )}
      {!renaming && (
        <SessionActions session={session} onRename={() => setRenaming(true)} open={menuOpen} onOpenChange={setMenuOpen}>
          <button type="button" className={styles.more} aria-label="更多操作" aria-expanded={menuOpen}>
            <MoreHorizontal size={16} strokeWidth={2} />
          </button>
        </SessionActions>
      )}
    </li>
  )
}

// 标题下面一行：编号、不是默认的 agent、轮数、大约占周额度多少、开着的 PR、排队的消息、停止或出错；最右边是在回答、在等后台任务，或者最后有动静的时间
function SessionMeta({ session, clock }: { session: SessionSummary; clock: boolean }) {
  const openPrs = session.prs.filter((pr) => pr.state === 'open')
  const date = new Date(session.updatedAt)
  return (
    <span className={styles.meta}>
      <span className={styles.facts}>
        <span>#{session.id}</span>
        {session.agent !== defaultAgent && <span>{agents[session.agent].name}</span>}
        {session.turns > 1 && <span>{session.turns} 轮</span>}
        {session.quota !== undefined && session.quota >= 0.005 && (
          <span title="大约占订阅周额度">
            <Gauge size={12} strokeWidth={2} />
            {formatQuota(session.quota)}
          </span>
        )}
        {openPrs.length > 0 && (
          <span className={styles.openPr} title="开着的 PR">
            <GitPullRequest size={12} strokeWidth={2} />
            {openPrs.map((pr) => `#${pr.number}`).join(' ')}
          </span>
        )}
        {session.queue.length > 0 && (
          <span title="排队的消息">
            <Clock size={12} strokeWidth={2} />
            {session.queue.length}
          </span>
        )}
        {session.outcome && !session.running && !session.waiting && (
          <span className={session.outcome === 'error' ? styles.error : undefined}>
            {session.outcome === 'error' ? <CircleAlert size={12} strokeWidth={2} /> : <CircleStop size={12} strokeWidth={2} />}
            {session.outcome === 'error' ? '出错' : '已停止'}
          </span>
        )}
      </span>
      <span className={styles.side}>
        {session.running ? (
          <span className={styles.busy}>回答中</span>
        ) : session.waiting ? (
          <span className={styles.busy} title="答完了，在等后台任务">
            <Hourglass size={12} strokeWidth={2} />
            后台任务
          </span>
        ) : (
          session.updatedAt && <time dateTime={session.updatedAt}>{clock ? formatClock(date) : formatTime(date)}</time>
        )}
      </span>
    </span>
  )
}
