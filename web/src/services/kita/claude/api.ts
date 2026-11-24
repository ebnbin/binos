import type { ClaudeLoginKind } from '@binos/protocol/services/kita'
import { errorMessage, request } from '../../../api.ts'

export type { ClaudeLoginKind } from '@binos/protocol/services/kita'

// 在网页上登录 Claude：先拿到授权链接，用户授权后把代码贴回来
export async function startClaudeLogin(kind: ClaudeLoginKind): Promise<{ id: string; url: string } | { error: string }> {
  const res = await request('POST /api/kita/claude/login', { json: { kind } }).catch(() => undefined)
  return res?.ok ? await res.json() : { error: await errorMessage(res, '没能开始登录') }
}

export async function finishClaudeLogin(id: string, code: string): Promise<{ ok: true } | { error: string }> {
  const res = await request('POST /api/kita/claude/login/:id', { params: { id }, json: { code } }).catch(() => undefined)
  return res?.ok ? { ok: true } : { error: await errorMessage(res, '登录没成功') }
}

export async function cancelClaudeLogin(id: string) {
  await request('DELETE /api/kita/claude/login/:id', { params: { id } }).catch(() => undefined)
}
