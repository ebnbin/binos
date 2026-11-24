import { errorMessage, request } from '../../../api.ts'

// 在网页上重新登录 Codex（设备码登录）：拿到网址和码，用户去授权，页面轮询结果
export async function startCodexLogin(): Promise<{ id: string; url: string; code: string } | { error: string }> {
  const res = await request('POST /api/kita/codex/login').catch(() => undefined)
  return res?.ok ? await res.json() : { error: await errorMessage(res, '没能开始登录') }
}

export async function codexLoginStatus(id: string): Promise<{ status: 'waiting' | 'done' } | { status: 'failed'; error: string } | undefined> {
  const res = await request('GET /api/kita/codex/login/:id', { params: { id } }).catch(() => undefined)
  return res?.ok ? await res.json() : undefined
}

export async function cancelCodexLogin(id: string) {
  await request('DELETE /api/kita/codex/login/:id', { params: { id } }).catch(() => undefined)
}
