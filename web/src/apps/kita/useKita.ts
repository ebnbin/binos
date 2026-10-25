import type { Conversation } from '@binos/server/apps/kita/types'
import type { Activity, Memory, Profile } from '@binos/server/services/kita/types'
import { useEffect, useRef, useState } from 'react'
import { onChange } from '../../events.ts'
import { kitaActivity, listMemories, readProfile } from '../../services/kita/api.ts'
import { listConversations } from './api.ts'

export type KitaData = {
  conversations?: Conversation[]
  profile?: Profile
  memories?: Memory[]
  activity: Activity[]
  failed: boolean
}

// 喜多 app 用到的全部数据，有变化时重新读取；Code 的对话开始、结束时 activity 也会变
export function useKita(): KitaData {
  const [data, setData] = useState<KitaData>({ activity: [], failed: false })
  const latest = useRef(0)

  useEffect(() => {
    const refresh = () => {
      const request = ++latest.current
      Promise.all([listConversations(), readProfile(), listMemories(), kitaActivity()])
        .then(([conversations, profile, memories, activity]) => {
          if (request === latest.current) setData({ conversations, profile, memories, activity: activity ?? [], failed: false })
        })
        .catch(() => {
          if (request === latest.current) setData((prev) => ({ ...prev, failed: true }))
        })
    }
    refresh()
    return onChange((event) => {
      if (event === null || event.type === 'kita' || event.type === 'session') refresh()
    })
  }, [])

  return data
}
