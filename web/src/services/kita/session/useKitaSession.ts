import type { PageEvent } from '@binos/server/services/kita/journal'
import type { Entry, Live, KitaSessionEvent } from '@binos/server/services/kita/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { connectEventSource } from '../../../eventSource.ts'
import { readOlderEvents, sessionStreamUrl } from '../api.ts'

// events 是连续的一段事件，第一条的 seq 大于 1 时前面还有更早的；session 是第一条条目，连上之前是 undefined；
// live 是回答进行中的临时内容，null 表示没在回答
export type KitaSessionContent = {
  events: PageEvent[]
  session: Extract<Entry, { type: 'session' }> | undefined
  live: Live | null
}

const initialContent: KitaSessionContent = { events: [], session: undefined, live: null }

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

function applyEvents(content: KitaSessionContent, messages: KitaSessionEvent[]): KitaSessionContent {
  let { events, session, live } = content
  let added: PageEvent[] = []
  for (const message of messages) {
    if (message.type === 'window') {
      // 重新给出最后几轮，之前收到的都不要了
      events = []
      added = [...message.events]
      session = message.session
      live = null
    } else if (message.type === 'event' || message.type === 'events') {
      for (const event of message.type === 'event' ? [message.event] : message.events) {
        added.push(event)
        live = applyItem(live, event.data)
      }
    } else {
      live = applyEvent(live, message)
    }
  }
  return { events: added.length ? [...events, ...added] : events, session, live }
}

// thread 的内容，随推送更新；thread 为 undefined 时是空的。先读最后几轮，loadOlder 往前补读更早的轮，给出 until 时一直读到包含这个 seq
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
    // 浏览器自己重连时用 Last-Event-ID 接着补发；由 connectEventSource 重连时从收到的最后一条接着补发，还没收到过时重新读最后几轮。
    // 打开过的从缓存的之后接着补发
    let last = cached(thread)?.events.at(-1)?.seq
    const close = connectEventSource(() => sessionStreamUrl(thread, last, pageSize), {
      onMessage: (data) => {
        const message: KitaSessionEvent = JSON.parse(data)
        if (message.type === 'window') {
          last = message.events.at(-1)?.seq
        } else if (message.type === 'event' || message.type === 'events') {
          const events = message.type === 'event' ? [message.event] : message.events
          if (last === undefined || events[0]?.seq !== last + 1) {
            return
          }
          last = events.at(-1)!.seq
        }
        queue.push(message)
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
  const first = content.events[0]?.seq
  const loadOlder = useCallback(
    (until?: number) => {
      if (thread === undefined || first === undefined || first <= 1 || loading.current === thread) {
        return
      }
      loading.current = thread
      void readOlderEvents(thread, first, Math.max(pageSize, first - (until ?? first))).then((events) => {
        if (loading.current === thread) {
          loading.current = undefined
        }
        if (!events?.length || events.at(-1)!.seq !== first - 1) {
          return
        }
        // 这期间重新给出过最后几轮时位置对不上，不接
        update(thread, (prev) => (prev.events[0]?.seq === first ? { ...prev, events: [...events, ...prev.events] } : prev))
      })
    },
    [thread, first, update],
  )

  return { ...content, loadOlder }
}
