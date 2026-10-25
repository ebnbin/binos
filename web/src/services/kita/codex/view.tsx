import type { CodexAuth } from '@binos/server/services/kita/types'
import type { AgentView } from '../views.ts'
import { CodexLogin } from './Login.tsx'

export const codexView: AgentView<CodexAuth> = {
  attention: ({ reason, usable }) => ({
    text: reason === 'login-broken' ? 'Codex 的登录失效了，回答时认证失败了' : 'Codex 的登录要重新处理',
    tone: usable ? 'warn' : 'bad',
    action: '重新登录',
    fix: 'login',
  }),
  authRows: () => [],
  loginActions: (auth) => [{ label: auth?.loggedIn ? '重新登录' : '登录', fix: 'login' }],
  Login: ({ onClose }) => <CodexLogin onClose={onClose} />,
}
