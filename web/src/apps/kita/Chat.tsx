import type { Conversation } from '@binos/server/apps/kita/types'
import { agents, defaultAgent } from '@binos/server/services/kita/types'
import type { AgentId, Profile } from '@binos/server/services/kita/types'
import { ArrowUp, EyeOff } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useAgentCatalogs } from '../../services/kita/models.ts'
import { Transcript } from '../../services/kita/session/Transcript.tsx'
import { useFollowBottom } from '../../services/kita/session/useFollowBottom.ts'
import { useKitaSession } from '../../services/kita/session/useKitaSession.ts'
import { Alert } from '../../ui/Alert.tsx'
import { Select } from '../../ui/Select.tsx'
import { Spinner } from '../../ui/Spinner.tsx'
import { sendMessage, startConversation, stopConversation } from './api.ts'
import { Avatar } from './Avatar.tsx'
import styles from './Chat.module.css'

// 触屏设备上回车换行，用按钮发送；有键盘的设备上回车发送，Shift+回车换行
const enterSends = !window.matchMedia('(pointer: coarse)').matches

// 离底部不超过这个距离时，新内容到来会自动滚到底
const stickThreshold = 80

// id 为 undefined 是新对话，第一句发出后由 onCreated 换成它的 id；temporary 只对新对话有意义。
// memoryCount：带身份的对话会想起的记忆条数
export function Chat({
  id,
  temporary,
  conversation,
  profile,
  memoryCount,
  onCreated,
}: {
  id: string | undefined
  temporary: boolean
  conversation: Conversation | undefined
  profile: Profile | undefined
  memoryCount: number
  onCreated(id: string): void
}) {
  const { events, session, live, loadOlder } = useKitaSession(id)
  const running = live !== null
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useFollowBottom(scrollRef, stick)
  const isTemporary = conversation?.temporary ?? temporary
  // 新对话能选能用的 agent，已有的对话沿用它的
  const catalogs = useAgentCatalogs()
  const [agent, setAgent] = useState<AgentId>(defaultAgent)
  const choosable = catalogs.filter((catalog) => catalog.available || catalog.agent === agent)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [events, live, notice])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setNotice('')
    stick.current = true
    try {
      if (id === undefined) {
        const result = await startConversation(text, temporary, agent)
        if ('error' in result) setNotice(result.error)
        else {
          setInput('')
          onCreated(result.id)
        }
      } else {
        const error = await sendMessage(id, text)
        if (error) setNotice(error)
        else setInput('')
      }
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (enterSends && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className={styles.chat}>
      <div
        className={styles.scroll}
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < stickThreshold
        }}
      >
        <div className={styles.column}>
          {id === undefined ? (
            <div className={styles.empty}>
              {isTemporary ? (
                <>
                  <span className={styles.temporaryMark}>
                    <EyeOff size={28} strokeWidth={1.5} />
                  </span>
                  <h1>临时对话</h1>
                </>
              ) : (
                <>
                  <Avatar profile={profile} size={88} />
                  <h1>喜多</h1>
                </>
              )}
            </div>
          ) : (
            <Transcript thread={id} agent={session?.agent} events={events} live={live} scrollRef={scrollRef} loadOlder={loadOlder} />
          )}
          {notice && <Alert>{notice}</Alert>}
        </div>
      </div>
      <div className={styles.dock}>
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <textarea
            className={styles.input}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={running ? '补充或纠正' : '输入消息'}
            rows={1}
            readOnly={sending}
            aria-label="消息"
            autoFocus={enterSends}
          />
          {sending ? (
            <span className={styles.action}>
              <Spinner />
            </span>
          ) : running && !input.trim() ? (
            <button type="button" className={styles.action} onClick={() => id && void stopConversation(id)} aria-label="停止" title="停止">
              <span className={styles.stopIcon} />
            </button>
          ) : (
            <button type="submit" className={styles.action} disabled={!input.trim()} aria-label="发送" title="发送">
              <ArrowUp size={17} strokeWidth={2.2} />
            </button>
          )}
        </form>
        <div className={styles.context}>
          {id === undefined ? (
            <Select
              label="agent"
              value={agent}
              onValueChange={(value) => setAgent(value as AgentId)}
              options={(choosable.length > 0 ? choosable.map((catalog) => catalog.agent) : [agent]).map((value) => ({ value, label: agents[value].name }))}
              className={styles.agent}
            />
          ) : (
            conversation && <span>{agents[conversation.agent].name}</span>
          )}
          <span>{isTemporary ? '不带记忆' : `${memoryCount} 条记忆`}</span>
        </div>
      </div>
    </div>
  )
}
