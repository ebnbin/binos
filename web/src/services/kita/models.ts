import type { AgentCatalog } from '@binos/protocol/services/kita'
import { useEffect, useState } from 'react'
import { agentCatalogs } from './api.ts'

const effortNames: Record<string, string> = { minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '极高' }

export const effortName = (effort: string) => effortNames[effort] ?? effort

// 各个 agent 能不能用、有哪些模型；页面打开期间只问一次
let catalogs: Promise<AgentCatalog[]> | undefined

export function useAgentCatalogs(): AgentCatalog[] {
  const [result, setResult] = useState<AgentCatalog[]>([])
  useEffect(() => {
    catalogs ??= agentCatalogs()
    let active = true
    void catalogs.then((value) => active && setResult(value))
    return () => {
      active = false
    }
  }, [])
  return result
}
