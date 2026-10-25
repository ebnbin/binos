import type { Conversation } from '@binos/server/apps/kita/types'
import type { Memory, MemorySource } from '@binos/server/services/kita/types'
import { Check, Pencil, Trash, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { addMemory, removeMemory, revertMemory, updateMemory } from '../../services/kita/api.ts'
import { IconButton } from '../../ui/IconButton.tsx'
import { formatMoment } from '../../ui/time.ts'
import { useApplications } from '../registry.ts'
import styles from './MemoriesPage.module.css'

// 长期记忆：已确认的和推测的分开放
export function MemoriesPage({ memories, conversations, onOpen }: { memories: Memory[] | undefined; conversations: Conversation[] | undefined; onOpen(id: string): void }) {
  const [draft, setDraft] = useState('')
  const stated = memories?.filter((memory) => memory.kind === 'stated') ?? []
  const inferred = memories?.filter((memory) => memory.kind === 'inferred') ?? []

  async function add() {
    if (draft.trim() && (await addMemory(draft.trim()))) setDraft('')
  }

  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <form
          className={styles.add}
          onSubmit={(event) => {
            event.preventDefault()
            void add()
          }}
        >
          <input className={styles.field} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="添加记忆" aria-label="添加记忆" />
          <button type="submit" className={styles.prominent} disabled={!draft.trim()}>
            添加
          </button>
        </form>
        {inferred.length > 0 && (
          <section>
            <h2 className={styles.heading}>待确认</h2>
            <ul className={styles.list}>
              {inferred.map((memory) => (
                <MemoryItem key={memory.id} memory={memory} conversations={conversations} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className={styles.heading}>已确认</h2>
          {memories && stated.length === 0 ? (
            <p className={styles.hint}>无</p>
          ) : (
            <ul className={styles.list}>
              {stated.map((memory) => (
                <MemoryItem key={memory.id} memory={memory} conversations={conversations} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function MemoryItem({ memory, conversations, onOpen }: { memory: Memory; conversations: Conversation[] | undefined; onOpen(id: string): void }) {
  const [editing, setEditing] = useState<string>()
  const previous = memory.history.at(-1)

  async function save() {
    if (editing?.trim() && (editing.trim() === memory.text || (await updateMemory(memory.id, { text: editing.trim() })))) setEditing(undefined)
  }

  return (
    <li className={styles.item}>
      {editing === undefined ? (
        <p className={styles.text}>{memory.text}</p>
      ) : (
        <form
          className={styles.edit}
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <textarea className={styles.textarea} value={editing} onChange={(event) => setEditing(event.target.value)} aria-label="记忆的内容" autoFocus rows={2} />
          <div>
            <button type="button" className={styles.button} onClick={() => setEditing(undefined)}>
              取消
            </button>
            <button type="submit" className={styles.prominent} disabled={!editing.trim()}>
              保存
            </button>
          </div>
        </form>
      )}
      <div className={styles.meta}>
        <span>
          <Source source={memory.source} conversations={conversations} onOpen={onOpen} /> · {formatMoment(memory.updatedAt)}
          {memory.scope !== 'personal' && ` · ${memory.scope}`}
        </span>
        <span className={styles.actions}>
          {memory.kind === 'inferred' && <IconButton icon={Check} label="确认" onClick={() => void updateMemory(memory.id, { kind: 'stated' })} />}
          {previous && <IconButton icon={Undo2} label="恢复上一版" onClick={() => void revertMemory(memory.id)} />}
          {editing === undefined && <IconButton icon={Pencil} label="修改" onClick={() => setEditing(memory.text)} />}
          <IconButton icon={Trash} label="删除" onClick={() => void removeMemory(memory.id)} />
        </span>
      </div>
    </li>
  )
}

function Source({ source, conversations, onOpen }: { source: MemorySource; conversations: Conversation[] | undefined; onOpen(id: string): void }) {
  const applications = useApplications()
  if (source.type === 'user') return <>手动添加</>
  const conversation = source.owner === 'kita' ? conversations?.find((item) => item.id === source.session) : undefined
  if (conversation) {
    return (
      <button type="button" className={styles.source} onClick={() => onOpen(conversation.id)}>
        {conversation.title || '对话'}
      </button>
    )
  }
  return <>{applications.find((app) => app.id === source.owner)?.name ?? source.owner}</>
}
