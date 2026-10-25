import type { Entry, Live, KitaSessionEvent } from '@binos/server/services/kita/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { connectEventSource } from '../../../eventSource.ts'
import { readOlderEvents, sessionStreamUrl } from '../api.ts'

// items 是从 offset 开始的连续条目，offset 大于 0 时前面还有更早的；session 是第一条条目，连上之前是 undefined；
// live 是回答进行中的临时内容，null 表示没在回答
export type KitaSessionContent = {
  items: Entry[]
  offset: number
  session: Extract<Entry, { type: 'session' }> | undefined
  live: Live | null
}

const initialContent: KitaSessionContent = { items: [], offset: 0, session: undefined, live: null }

// 打开时先读最后至少这么多条，往上翻时每次再读这么多
const pageSize = 300

// 最近打开过的几个 thread 的内容：再打开时先显示它，再从它之后接着补发
const cache = new Map<string, KitaSessionContent>()
const cacheSize = 10

function remember(thread: string, content: KitaSessionContent) {
  cache.delete(thread)
  cache.set(thread, content)
  if (cache.size > cacheSize) {
    cache.delete(cache.keys().next().value!)
  }
}

const cached = (thread: string | undefined) => (thread === undefined ? undefined : cache.get(thread))

// 记成条目的思考和文字取代对应的临时内容，和后端一致
function applyItem(live: Live | null, item: Entry): Live | null {
  if (!live || ('parent' in item && item.parent)) {
    return live
  }
  if (item.type === 'text') {
    return { ...live, text: '', files: {} }
  }
  if (item.type === 'thinking') {
    return { ...live, thinking: '' }
  }
  return live
}

function applyEvent(live: Live | null, event: Exclude<KitaSessionEvent, { type: 'event' | 'events' | 'window' }>): Live | null {
  if (event.type === 'live') {
    return event.live
  }
  if (!live) {
    return live
  }
  switch (event.type) {
    case 'thinking':
      return { ...live, thinking: live.thinking + event.text }
    case 'text':
      return { ...live, text: live.text + event.text }
    case 'file':
      return { ...live, files: { ...live.files, [event.path]: event.name } }
    case 'status':
      return { ...live, status: event.status }
    case 'task': {
      const { [event.callId]: _previous, ...tasks } = live.tasks
      return { ...live, tasks: event.progress ? { ...tasks, [event.callId]: event.progress } : tasks }
    }
  }
}

function applyEvents(content: KitaSessionContent, events: KitaSessionEvent[]): KitaSessionContent {
  let { items, offset, session, live } = content
  let added: Entry[] = []
  for (const event of events) {
    if (event.type === 'window') {
      // 从头补发，之前收到的都不要了
      items = []
      added = []
      offset = event.from
      session = event.session
      live = null
    } else if (event.type === 'event' || event.type === 'events') {
      for (const { data } of event.type === 'event' ? [event.event] : event.events) {
        added.push(data)
        live = applyItem(live, data)
      }
    } else {
      live = applyEvent(live, event)
    }
  }
  return { items: added.length ? [...items, ...added] : items, offset, session, live }
}

// thread 的内容，随推送更新；thread 为 undefined 时是空的。先读最后几轮，loadOlder 往前补读更早的轮，给出 until 时一直读到包含它
export function useKitaSession(thread: string | undefined): KitaSessionContent & { loadOlder: (until?: number) => void } {
  const [state, setState] = useState<{ thread?: string; content: KitaSessionContent }>({ content: initialContent })
  const content = state.thread === thread ? state.content : (cached(thread) ?? initialContent)
  const update = useCallback(
    (target: string, change: (content: KitaSessionContent) => KitaSessionContent) =>
      setState((prev) => ({ thread: target, content: change(prev.thread === target ? prev.content : (cached(target) ?? initialContent)) })),
    [],
  )
  useEffect(() => {
    if (state.thread !== undefined) {
      remember(state.thread, state.content)
    }
  }, [state])

  useEffect(() => {
    if (thread === undefined) {
      return
    }
    // 打开时补发的历史和回答中的文字都来得很密，攒到下一帧一起交给页面，一帧只重新渲染一次
    let queue: KitaSessionEvent[] = []
    let frame = 0
    const flush = () => {
      frame = 0
      const events = queue
      queue = []
      update(thread, (prev) => applyEvents(prev, events))
    }
    // 浏览器自己重连时用 Last-Event-ID 接着补发；由 connectEventSource 重连时从已收到的位置接着补发，还没收到过时重新读最后几轮。
    // 打开过的从缓存的之后接着补发
    const known = cached(thread)
    let count = known && known.offset + known.items.length
    const close = connectEventSource(() => sessionStreamUrl(thread, count, pageSize), {
      onMessage: (data) => {
        const event: KitaSessionEvent = JSON.parse(data)
        if (event.type === 'window') {
          count = event.from
        } else if (event.type === 'event' || event.type === 'events') {
          const events = event.type === 'event' ? [event.event] : event.events
          if (count === undefined || events[0]?.seq !== count + 1) {
            return
          }
          count += events.length
        }
        queue.push(event)
        frame ||= requestAnimationFrame(flush)
      },
    })
    return () => {
      cancelAnimationFrame(frame)
      close()
    }
  }, [thread, update])

  // 正在读更早的条目的 thread，同时只读一段
  const loading = useRef<string>(undefined)
  const { offset } = content
  const loadOlder = useCallback(
    (until?: number) => {
      if (thread === undefined || offset === 0 || loading.current === thread) {
        return
      }
      loading.current = thread
      void readOlderEvents(thread, offset, Math.max(pageSize, offset - (until ?? offset))).then((events) => {
        if (loading.current === thread) {
          loading.current = undefined
        }
        if (!events?.length || events.at(-1)!.seq !== offset) {
          return
        }
        // 这期间重新补发过时位置对不上，不接
        update(thread, (prev) =>
          prev.offset === offset ? { ...prev, offset: events[0].seq - 1, items: [...events.map((event) => event.data), ...prev.items] } : prev,
        )
      })
    },
    [thread, offset, update],
  )

  return { ...content, loadOlder }
}
