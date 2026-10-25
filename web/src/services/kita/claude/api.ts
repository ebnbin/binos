import type { ClaudeApi } from '@binos/server/services/kita/drivers/claude/api'
import { hc } from 'hono/client'
import { errorMessage } from '../../../api.ts'

const client = hc<ClaudeApi>(`${window.location.origin}/api/kita/claude`)

export type ClaudeLoginKind = 'login' | 'token'

// 在网页上登录 Claude：先拿到授权链接，用户授权后把代码贴回来
export async function startClaudeLogin(kind: ClaudeLoginKind): Promise<{ id: string; url: string } | { error: string }> {
  const res = await client.login.$post({ json: { kind } }).catch(() => undefined)
  return res?.ok ? await res.json() : { error: await errorMessage(res, '没能开始登录') }
}

export async function finishClaudeLogin(id: string, code: string): Promise<{ ok: true } | { error: string }> {
  const res = await client.login[':id'].$post({ param: { id }, json: { code } }).catch(() => undefined)
  return res?.ok ? { ok: true } : { error: await errorMessage(res, '登录没成功') }
}

export async function cancelClaudeLogin(id: string) {
  await client.login[':id'].$delete({ param: { id } }).catch(() => undefined)
}
