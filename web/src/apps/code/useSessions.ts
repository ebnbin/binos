import type { Project, SessionSummary } from '@binos/server/apps/code/types'
import { useEffect, useRef, useState } from 'react'
import { listProjects, listSessions, readSession } from './api.ts'
import { onChange } from '../../events.ts'

// 按最近有动静的排在前面，和后端一致
const byUpdated = (sessions: SessionSummary[]) => sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

// 对话列表和项目：第一次和重新连上时整份读取，之后收到 session 通知只更新那一个对话，收到 project 通知只读项目
export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[] | undefined>(undefined)
  const [projects, setProjects] = useState<Project[]>()
  const [failed, setFailed] = useState(false)
  // 整份读取的轮次：这期间单个对话的更新以整份读到的为准
  const latest = useRef(0)

  useEffect(() => {
    const refresh = () => {
      const request = ++latest.current
      Promise.all([listSessions(), listProjects()])
        .then(([result, projects]) => {
          if (request === latest.current) {
            setSessions(result)
            setProjects(projects)
            setFailed(false)
          }
        })
        .catch(() => {
          if (request === latest.current) {
            setFailed(true)
          }
        })
    }
    // 同一个对话接连几次通知时只用最后一次读到的
    const pending = new Map<number, number>()
    const refreshOne = (id: number) => {
      const request = latest.current
      const own = (pending.get(id) ?? 0) + 1
      pending.set(id, own)
      readSession(id)
        .then((summary) => {
          if (request !== latest.current || pending.get(id) !== own) return
          setSessions((list) => list && byUpdated([...list.filter((item) => item.id !== id), ...(summary ? [summary] : [])]))
        })
        .catch(() => {})
    }
    refresh()
    return onChange((event) => {
      if (event === null) refresh()
      else if (event.type === 'session') refreshOne(event.id)
      else if (event.type === 'project') void listProjects().then(setProjects).catch(() => {})
    })
  }, [])

  return { sessions, projects, failed }
}
