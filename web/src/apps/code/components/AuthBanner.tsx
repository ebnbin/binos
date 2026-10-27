import { agentIds } from '@binos/server/services/kita/types'
import type { AgentId } from '@binos/server/services/kita/types'
import { WarningCircleIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { useHourlyNow } from '../../../services/kita/auth.ts'
import { useAgentStatus } from '../../../services/kita/status.ts'
import { agentView } from '../../../services/kita/views.ts'
import styles from './AuthBanner.module.css'

// agent 的登录要处理时（快到期、失效了、在用备用的登录……），列表上面一条提醒，点了就地登录。几个都要处理时按 agent 的顺序先处理前面的
export function AuthBanner() {
  const status = useAgentStatus()
  const now = useHourlyNow()
  const first = agentIds.flatMap((agent) => {
    const attention = agentView(agent, status).attention(now)
    return attention ? [{ agent, attention }] : []
  })[0]
  // 正在做的登录：登录好了提醒就没了，登录的过程还要留着显示结果
  const [open, setOpen] = useState<{ agent: AgentId; fix: string }>()
  if (!first && !open) {
    return null
  }
  const Login = open && agentView(open.agent, status).Login
  return (
    <div className={styles.banner} data-tone={first?.attention.tone}>
      {open && Login ? (
        <Login fix={open.fix} onClose={() => setOpen(undefined)} />
      ) : (
        first && (
          <button type="button" className={styles.row} onClick={() => setOpen({ agent: first.agent, fix: first.attention.fix })}>
            <WarningCircleIcon size={15} />
            <span>{first.attention.text}</span>
            <span className={styles.action}>{first.attention.action}</span>
          </button>
        )
      )}
    </div>
  )
}
