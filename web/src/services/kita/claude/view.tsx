import type { ClaudeAuth } from '@binos/server/services/kita/types'
import { formatMoment } from '../../../ui/time.ts'
import { daysLeft } from '../auth.ts'
import type { AgentView } from '../views.ts'
import type { ClaudeLoginKind } from './api.ts'
import { ClaudeLogin } from './Login.tsx'

// Claude 的两份登录（见 ClaudeAuth）：正在用哪份、各自什么时候到期，可以重新登录、生成备用 token
export const claudeView: AgentView<ClaudeAuth> = {
  attention({ reason, usable, expiresAt }, now) {
    const tone = usable ? 'warn' : 'bad'
    const days = expiresAt ? daysLeft(expiresAt, now) : 0
    switch (reason) {
      case 'logged-out':
        return { text: 'Claude 没有能用的登录', tone, action: '重新登录', fix: 'login' }
      case 'login-broken':
        return { text: usable ? 'Claude 的登录失效了，正在用备用 token' : 'Claude 的登录失效了', tone, action: '重新登录', fix: 'login' }
      case 'login-expired':
        return { text: usable ? 'Claude 的登录过期了，正在用备用 token' : 'Claude 的登录过期了', tone, action: '重新登录', fix: 'login' }
      case 'login-expiring':
        return { text: `Claude 的登录${days === 0 ? '今天' : `还有 ${days} 天`}到期`, tone, action: '重新登录', fix: 'login' }
      case 'backup-expiring':
        return { text: `Claude 的备用 token ${days === 0 ? '今天' : `还有 ${days} 天`}到期`, tone, action: '更新', fix: 'token' }
    }
  },

  authRows(auth, now) {
    if (!auth) {
      return []
    }
    const { login: full, backup } = auth
    const fullExpired = full?.expiresAt !== undefined && Date.parse(full.expiresAt) <= now
    return [
      { label: '正在用', value: { login: '完整登录', token: '备用 token', none: '没有能用的登录' }[auth.mode], expired: auth.mode === 'none' },
      {
        label: '完整登录',
        value: !full ? '没有' : full.broken ? '已失效' : full.expiresAt ? (fullExpired ? '已过期' : `还有 ${daysLeft(full.expiresAt, now)} 天`) : '已登录',
        note: full?.expiresAt && !full.broken ? `${formatMoment(full.expiresAt, now)}到期，之后只能重新登录` : '回答时认证失败了，重新登录后自动换回来',
        expired: !full || Boolean(full.broken) || fullExpired,
      },
      {
        label: '备用 token',
        value: backup ? (backup.expiresAt ? `还有 ${daysLeft(backup.expiresAt, now)} 天` : '已存好') : '没有',
        note: '完整登录过期或失效时自动换用，只能回答，没有 claude.ai 的连接器',
      },
    ]
  },

  loginActions: (auth) =>
    auth
      ? [
          { label: '重新登录', fix: 'login' },
          { label: auth.backup ? '更新备用 token' : '生成备用 token', fix: 'token' },
        ]
      : [],

  Login: ({ fix, onClose }) => <ClaudeLogin kind={fix as ClaudeLoginKind} onClose={onClose} />,
}
