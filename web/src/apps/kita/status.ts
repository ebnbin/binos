import type { Activity } from '@binos/server/services/kita/types'
import type { ApplicationDefinition } from '../types.ts'

// 喜多现在在做什么，按各个 app 里真实在回答的 session 说
export function kitaStatus(activity: Activity[], applications: ApplicationDefinition[]): { busy: boolean; label: string } {
  if (activity.length === 0) return { busy: false, label: '空闲' }
  const counts = new Map<string, number>()
  for (const item of activity) counts.set(item.owner, (counts.get(item.owner) ?? 0) + 1)
  const parts = [...counts].map(([owner, count]) => {
    const name = applications.find((app) => app.id === owner)?.name ?? owner
    return count > 1 ? `${name}（${count}）` : name
  })
  return { busy: true, label: `回答中：${parts.join('、')}` }
}
