import * as Select from '@radix-ui/react-select'
import { Popover } from '../../../ui/Popover.tsx'
import type { Icon } from '@phosphor-icons/react'
import { ArrowUpIcon, CaretDownIcon, CheckIcon, ClockIcon, LightningIcon, ListPlusIcon, PaperclipIcon, SlidersHorizontalIcon, XIcon } from '@phosphor-icons/react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent, PointerEvent } from 'react'
import type { QueuedMessage, SessionSummary } from '@binos/server/apps/code/types'
import { agents } from '@binos/server/services/kita/types'
import { PendingAttachments } from '../../../services/kita/session/Attachments.tsx'
import { Usage } from './Usage.tsx'
import type { PendingFile } from '../../../services/kita/session/Attachments.tsx'
import type { Choice, SendMode } from './Conversation.tsx'
import { sendQueued, withdrawQueued } from '../api.ts'
import { effortName, useAgentCatalogs } from '../../../services/kita/models.ts'
import styles from './Composer.module.css'
import { IconButton } from '../../../ui/IconButton.tsx'
import { Spinner } from '../../../ui/Spinner.tsx'

// 触屏设备上回车换行，用按钮发送；有键盘的设备上回车发送，Shift+回车换行
const enterSends = !window.matchMedia('(pointer: coarse)').matches

let nextKey = 0

// 没发出去的文字按对话存在浏览器里，切走再回来、刷新页面都还在
const draftStorageKey = (key: number | string) => `code/draft/${key}`

const hasFiles = (event: { dataTransfer: DataTransfer | null }) => event.dataTransfer?.types.includes('Files') ?? false

// 有键盘的设备上 ⌘/Ctrl+回车：正在回答时排队，没在回答时发送
const queueShortcut = navigator.platform.startsWith('Mac') ? '⌘↩' : 'Ctrl+↩'

// queue：排着队、等这一轮答完再发的消息；draftKey：草稿属于哪个对话；agentFixed：已有的 session，agent 不能换
export function Composer({
  sessionId,
  session,
  queue,
  draftKey,
  running,
  choice,
  agentFixed,
  onChoice,
  onSend,
  onStop,
}: {
  sessionId: number | null
  // 列表里这个 session 的概况，新对话时没有
  session: SessionSummary | undefined
  queue: QueuedMessage[]
  draftKey: number | string
  running: boolean
  choice: Choice
  agentFixed: boolean
  onChoice: (choice: Choice) => void
  onSend: (text: string, files: File[], mode: SendMode) => Promise<boolean>
  onStop: () => void
}) {
  const [input, setInput] = useState(() => localStorage.getItem(draftStorageKey(draftKey)) ?? '')
  const [pending, setPending] = useState<PendingFile[]>([])
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hasContent = input.trim() !== '' || pending.length > 0
  const catalogs = useAgentCatalogs()
  // 能选的 agent：能用的，加上这个对话正在用的
  const choosable = catalogs.filter((catalog) => catalog.available || catalog.agent === choice.agent)
  const catalog = catalogs.find((item) => item.agent === choice.agent)
  const models = catalog?.models ?? []
  const defaultModel = models.find((model) => model.isDefault)
  const efforts = models.find((model) => model.id === (choice.model ?? defaultModel?.id))?.efforts ?? catalog?.efforts ?? []
  const selectedModel = models.find((model) => model.id === choice.model) ?? (!choice.model ? defaultModel : undefined)
  const modelValue = `${choice.agent}:${choice.model ?? defaultModel?.id ?? ''}`
  const modelOptions = choosable.flatMap((item) => item.models.map((model) => ({
    value: `${item.agent}:${model.id}`, agent: item.agent, model,
    disabled: agentFixed && item.agent !== choice.agent,
  })))
  const canSend = !sending && hasContent

  function addFiles(files: File[]) {
    if (!sending) {
      const added = files.map((file) => ({
        key: nextKey++,
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      }))
      setPending((prev) => [...prev, ...added])
    }
  }

  function clearPending(keep: (item: PendingFile) => boolean = () => false) {
    pending.filter((item) => !keep(item) && item.preview).forEach((item) => URL.revokeObjectURL(item.preview!))
    setPending(pending.filter(keep))
  }

  useEffect(() => {
    if (input) {
      localStorage.setItem(draftStorageKey(draftKey), input)
    } else {
      localStorage.removeItem(draftStorageKey(draftKey))
    }
  }, [draftKey, input])

  // 切到别的 session 时释放还没发出的预览
  const pendingRef = useRef(pending)
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(() => () => pendingRef.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)), [])

  // 文件拖到页面哪里都能放下，不让浏览器直接打开它
  const onWindowDrop = useEffectEvent((files: File[]) => addFiles(files))
  useEffect(() => {
    const onDragOver = (event: globalThis.DragEvent) => {
      if (hasFiles(event)) {
        event.preventDefault()
      }
    }
    const onDrop = (event: globalThis.DragEvent) => {
      if (hasFiles(event)) {
        event.preventDefault()
        setDragging(false)
        onWindowDrop([...(event.dataTransfer?.files ?? [])])
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // 正在回答时默认是插话，agent 在下一次工具调用之间看到
  async function send(mode: SendMode = 'send') {
    if (!hasContent || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      const ok = await onSend(
        input.trim(),
        pending.map((item) => item.file),
        running ? mode : 'send',
      )
      if (ok) {
        localStorage.removeItem(draftStorageKey(draftKey))
        setInput('')
        clearPending()
      }
    } finally {
      sendingRef.current = false
      setSending(false)
      const textarea = textareaRef.current
      if (enterSends && textarea?.closest('form')?.contains(document.activeElement)) {
        textarea.focus({ preventScroll: true })
      }
    }
  }

  // 撤回排队的消息：文字回到输入框，接在已经写的后面
  async function withdraw(item: string) {
    const text = sessionId !== null ? await withdrawQueued(sessionId, item) : undefined
    if (text) {
      setInput((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text))
      textareaRef.current?.focus()
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void send('queue')
      return
    }
    if (enterSends && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  // 粘贴截图之类的文件时当作附件；复制的是文字时照常粘贴文字
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files]
    if (files.length && !event.clipboardData.types.includes('text/plain')) {
      event.preventDefault()
      addFiles(files)
    }
  }

  function onDragOver(event: DragEvent) {
    if (hasFiles(event)) {
      setDragging(true)
    }
  }

  function onDragLeave(event: DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false)
    }
  }

  return (
    <div className={styles.dock}>
      <form
        className={`${styles.card} ${dragging ? styles.dragging : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            textareaRef.current?.focus()
          }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {queue.length > 0 && sessionId !== null && (
          <ul className={styles.queue} aria-label="排队的消息">
            {queue.map((item) => (
              <li key={item.id}>
                <ClockIcon size={13} className={styles.queueIcon} aria-label="排队中" />
                <span className={styles.queueText}>{item.text.trim() || item.attachments?.[0]?.name}</span>
                {item.attachments?.length ? (
                  <span className={styles.queueFiles}>
                    <PaperclipIcon size={12} />
                    {item.attachments.length}
                  </span>
                ) : null}
                {/* 被停止或出错后留下的，可以现在就发 */}
                {!running && (
                  <IconButton
                    icon={ArrowUpIcon}
                    label="现在发送"
                    className={styles.queueButton}
                    onClick={() => void sendQueued(sessionId, item.id)}
                  />
                )}
                <IconButton icon={XIcon} label="撤回到输入框" className={styles.queueButton} onClick={() => void withdraw(item.id)} />
              </li>
            ))}
          </ul>
        )}
        {pending.length > 0 && (
          <div className={styles.attachments}>
            <PendingAttachments files={pending} onRemove={sending ? undefined : (key) => clearPending((item) => item.key !== key)} />
          </div>
        )}
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={running ? '补充或纠正，agent 会在下一步看到' : '输入消息'}
          rows={1}
          readOnly={sending}
          aria-label="消息"
          aria-busy={sending}
          autoFocus={enterSends}
        />
        <div className={styles.bar}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])])
              // 清掉选择，移除后还能再选同一个文件
              event.target.value = ''
            }}
          />
          <IconButton
            icon={PaperclipIcon}
            label={enterSends ? '添加附件（也可以粘贴或拖进来）' : '添加附件'}
            className={styles.attach}
            disabled={sending}
            onClick={() => fileInputRef.current?.click()}
          />
          <Select.Root value={modelValue} disabled={running} onValueChange={(value) => {
            const option = modelOptions.find((item) => item.value === value)
            if (!option) return
            onChoice({ agent: option.agent, model: option.model.isDefault ? undefined : option.model.id,
              ...(option.agent === choice.agent && choice.effort && option.model.efforts.includes(choice.effort) && { effort: choice.effort }) })
          }}>
            <Select.Trigger className={styles.model} aria-label="模型" title={running ? '回答结束后可切换模型' : '选择模型'}>
              <span>{selectedModel?.name ?? choice.model ?? agents[choice.agent].name}</span>
              <CaretDownIcon size={12} weight="bold" />
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className={styles.modelMenu} position="popper" side="top" sideOffset={8} collisionPadding={12}>
                <Select.Viewport className={styles.modelList}>
                  {modelOptions.map((option) => (
                    <Select.Item key={option.value} value={option.value} disabled={option.disabled} className={styles.modelOption}>
                      <Select.ItemText>{option.model.name}</Select.ItemText>
                      <small>{agents[option.agent].name}{option.model.isDefault ? ' · 默认' : ''}</small>
                      <Select.ItemIndicator className={styles.selected}><CheckIcon size={16} /></Select.ItemIndicator>
                    </Select.Item>
                  ))}
                  {!modelOptions.some((option) => option.value === modelValue) && (
                    <Select.Item value={modelValue} className={styles.modelOption}>
                      <Select.ItemText>{choice.model ?? '模型信息暂不可用'}</Select.ItemText>
                    </Select.Item>
                  )}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen} label="思考程度" side="top" align="start" className={styles.settingsMenu} trigger={
            <button type="button" className={styles.settings} disabled={running} aria-label={`思考程度：${choice.effort ? effortName(choice.effort) : '默认'}`} title="思考程度">
              <SlidersHorizontalIcon size={16} />
              {choice.effort && <span>{effortName(choice.effort)}</span>}
            </button>
          }>
            <span className={styles.settingsTitle}>思考程度</span>
            <div role="group" aria-label="思考程度">
              {['', ...new Set([...efforts, ...(choice.effort ? [choice.effort] : [])])].map((effort) => (
                <button key={effort} type="button" disabled={running} aria-pressed={(choice.effort ?? '') === effort}
                  onClick={() => {
                    onChoice({ ...choice, effort: effort || undefined })
                    setSettingsOpen(false)
                  }}>
                  {effort ? effortName(effort) : '默认'}
                  {(choice.effort ?? '') === effort && <CheckIcon size={16} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </Popover>
          <div className={styles.actions}>
            {session && <Usage session={session} />}
            {sending ? (
              <span className={`${styles.action} ${styles.busy}`}>
                <Spinner />
              </span>
            ) : running && !hasContent ? (
              <button type="button" className={styles.action} onClick={onStop} aria-label="停止" title="停止">
                <span className={styles.stopIcon} />
              </button>
            ) : (
              <SendButton running={running} disabled={!canSend} onSend={(mode) => void send(mode)} />
            )}
          </div>
        </div>
      </form>
    </div>
  )
}

const holdDelay = 350

type HeldMode = Extract<SendMode, 'queue' | 'interrupt'>

const heldModes: { mode: HeldMode; icon: Icon; label: string; title: string }[] = [
  { mode: 'queue', icon: ListPlusIcon, label: '排队', title: enterSends ? `这一轮答完再发（${queueShortcut}）` : '这一轮答完再发' },
  { mode: 'interrupt', icon: LightningIcon, label: '打断', title: '打断正在做的事，马上处理这句话' },
]

const modeAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-held-mode]')?.dataset.heldMode as HeldMode | undefined)

// 发送按钮。正在回答时点按是插话；长按或右键在上方浮出排队和打断：手指不松开滑到一项上松手就执行，滑到别处松手取消，
// 没滑动就松手时菜单留着，可以再点
function SendButton({ running, disabled, onSend }: { running: boolean; disabled: boolean; onSend: (mode: SendMode) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState<HeldMode>()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<number>(undefined)
  // 这次按下已经打开了菜单，松手后的 click 不再发送
  const held = useRef(false)
  const start = useRef({ x: 0, y: 0, moved: false })
  const open = menuOpen && running && !disabled

  function close() {
    setMenuOpen(false)
    setActive(undefined)
  }

  function choose(mode: HeldMode) {
    close()
    onSend(mode)
  }

  // 点菜单和按钮以外的地方、按 Esc 时收起
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    held.current = false
    if (!running || disabled || event.button !== 0) return
    // 鼠标移出按钮后也继续收到移动和松开
    event.currentTarget.setPointerCapture(event.pointerId)
    start.current = { x: event.clientX, y: event.clientY, moved: false }
    timer.current = window.setTimeout(() => {
      held.current = true
      setMenuOpen(true)
      navigator.vibrate?.(10)
    }, holdDelay)
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!held.current) return
    if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 8) start.current.moved = true
    setActive(modeAt(event.clientX, event.clientY))
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    window.clearTimeout(timer.current)
    if (!held.current) return
    const mode = modeAt(event.clientX, event.clientY)
    if (mode) choose(mode)
    else if (start.current.moved) close()
  }

  return (
    <span ref={wrapRef} className={styles.send}>
      {open && (
        <span className={styles.heldMenu} role="menu" aria-label="发送方式">
          {heldModes.map(({ mode, icon: Icon, label, title }) => (
            <button key={mode} type="button" role="menuitem" data-held-mode={mode} data-active={active === mode || undefined} title={title} onClick={() => choose(mode)}>
              <Icon size={16} />
              {label}
            </button>
          ))}
        </span>
      )}
      <button
        type="submit"
        className={styles.action}
        disabled={disabled}
        aria-label={running ? '插话' : '发送'}
        aria-haspopup={running ? 'menu' : undefined}
        aria-expanded={running ? open : undefined}
        title={running ? '插话：agent 在下一步看到；长按可以排队或打断' : '发送'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => window.clearTimeout(timer.current)}
        onClick={(event) => {
          if (held.current) {
            event.preventDefault()
            held.current = false
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          if (running && !disabled) setMenuOpen(true)
        }}
      >
        <ArrowUpIcon size={16} weight="bold" />
      </button>
    </span>
  )
}
