import { Select } from '../../../ui/Select.tsx'
import type { Project, SessionSummary, Upload } from '@binos/server/apps/code/types'
import { defaultAgent } from '@binos/server/services/kita/types'
import type { AgentId } from '@binos/server/services/kita/types'
import { ArrowDownIcon, FolderIcon } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Transcript } from '../../../services/kita/session/Transcript.tsx'
import { useFollowBottom } from '../../../services/kita/session/useFollowBottom.ts'
import { useKitaSession } from '../../../services/kita/session/useKitaSession.ts'
import { Alert } from '../../../ui/Alert.tsx'
import { BrandMark } from '../../../ui/BrandMark.tsx'
import { markRead, maxUploadBytes, sendMessage, stopSession, uploadFile } from '../api.ts'
import { Composer } from './Composer.tsx'
import styles from './Conversation.module.css'

// 离底部不超过这个距离时，新内容到来会自动滚到底；往上翻看时不打扰
const stickThreshold = 80

// 正在回答时：插话（agent 在下一步看到）、先打断再说、排到这一轮答完之后
export type SendMode = 'send' | 'interrupt' | 'queue'

// agent 只在新对话时能选，已有的 session 沿用它的
export type Choice = { agent: AgentId; model?: string; effort?: string }

// session：列表里这个 session 的概况，新对话时没有；thread：对话的内容所在的 thread，刚建好、列表里还没有时由建它的地方给出
// scrollRef：对话滚动的那一层，顶栏用它回到顶部
export function Conversation({
  project,
  projects,
  onProject,
  sessionId,
  session,
  thread,
  scrollRef,
  onCreated,
  targetSeq,
}: {
  project: string
  projects: Project[] | undefined
  onProject: (id: string) => void
  // 要定位到的事件的 seq
  targetSeq?: number
  sessionId: number | null
  session: SessionSummary | undefined
  thread: string | undefined
  scrollRef: RefObject<HTMLDivElement | null>
  onCreated: (id: number, thread: string) => void
}) {
  const { events, session: head, live, loadOlder } = useKitaSession(thread)
  const first = events[0]?.seq
  const running = live !== null
  // 下一轮用的模型和思考程度，没选过就沿用这个 session 最近一轮的
  const [picked, setPicked] = useState<Choice>()
  const choice = picked ?? { agent: session?.agent ?? defaultAgent, model: session?.model, effort: session?.effort }

  // 正在看、又没在回答：记为已读（打开时，以及这一轮答完时）
  useEffect(() => {
    if (sessionId !== null && !running) {
      void markRead(sessionId)
    }
  }, [sessionId, running])
  const [notice, setNotice] = useState('')
  const stick = useRef(targetSeq === undefined)
  const located = useRef(false)
  useFollowBottom(scrollRef, stick)
  // 往上翻看时，下方出现回到底部的按钮
  const [awayFromBottom, setAwayFromBottom] = useState(false)

  // 要定位的条目在已读到的之前时，一直补读到它
  useEffect(() => {
    if (targetSeq !== undefined && !located.current && head && first !== undefined && targetSeq < first) {
      loadOlder(targetSeq)
    }
  }, [targetSeq, head, first, loadOlder])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && targetSeq !== undefined && !located.current) {
      const target = el.querySelector<HTMLElement>(`[data-thread-item="${targetSeq}"]`)
      if (target) {
        target.scrollIntoView({ block: 'center' })
        target.animate([{ backgroundColor: 'Highlight' }, { backgroundColor: 'transparent' }], { duration: 1800 })
        located.current = true
      }
    }
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [scrollRef, events, live, notice, targetSeq])

  function stop() {
    if (sessionId !== null) {
      void stopSession(sessionId)
    }
  }

  async function send(text: string, files: File[], mode: SendMode) {
    setNotice('')
    stick.current = true
    try {
      const tooLarge = files.find((file) => file.size > maxUploadBytes)
      if (tooLarge) {
        setNotice(`${tooLarge.name} 太大，附件最大 ${maxUploadBytes / 1024 / 1024} MB`)
        return false
      }
      const uploads = await Promise.all(files.map(uploadFile))
      const attachments: Upload[] = []
      for (const upload of uploads) {
        if ('error' in upload) {
          setNotice(upload.error)
          return false
        }
        attachments.push(upload)
      }
      const result = await sendMessage(sessionId, text, attachments, {
        project,
        ...(mode === 'interrupt' && { interrupt: true }),
        ...(mode === 'queue' && { queue: true }),
        ...choice,
      })
      if ('error' in result) {
        setNotice(result.error)
        return false
      }
      if (sessionId === null) {
        onCreated(result.id, result.kitaSession)
      }
      return true
    } catch {
      setNotice('发送失败，请重试')
      return false
    }
  }

  function scrollToBottom() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }

  return (
    <>
      <div className={styles.viewport}>
        <div
          className={styles.scroll}
          ref={scrollRef}
          onScroll={(event) => {
            const el = event.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < stickThreshold
            setAwayFromBottom(!stick.current)
          }}
        >
          <div className={styles.column}>
            {sessionId === null ? (
              <div className={styles.empty}>
                <BrandMark size={48} />
                <h1>开始新对话</h1>
                <div className={styles.projectChoice}>
                  <FolderIcon size={16} aria-hidden="true" />
                  <Select
                    label="对话所属项目"
                    value={project}
                    onValueChange={onProject}
                    options={projects?.map((item) => ({ value: item.id, label: item.name })) ?? []}
                  />
                </div>
              </div>
            ) : (
              thread && (
                <Transcript thread={thread} events={events} live={live} scrollRef={scrollRef} loadOlder={loadOlder} />
              )
            )}
            {notice && <Alert>{notice}</Alert>}
          </div>
        </div>
        {awayFromBottom && (
          <button type="button" className={styles.toBottom} onClick={scrollToBottom} aria-label="回到底部" title="回到底部">
            <ArrowDownIcon size={18} />
          </button>
        )}
      </div>
      <Composer
        sessionId={sessionId}
        session={session}
        queue={session?.queue ?? []}
        draftKey={sessionId ?? `new-${project}`}
        running={running}
        choice={choice}
        agentFixed={sessionId !== null}
        onChoice={setPicked}
        onSend={send}
        onStop={stop}
      />
    </>
  )
}
