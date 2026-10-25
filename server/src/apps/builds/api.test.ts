import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import type { BuildsSnapshot } from './types.js'
const root = mkdtempSync(path.join(os.tmpdir(), 'binos-build-api-'))
process.env.BINOS_ROOT = root; process.env.BINOS_TEST_INSTANCE = '1'
process.execArgv.push('--import', import.meta.resolve('tsx'))
const { api } = await import('../../api.js')
const { buildRequest } = await import('./client.js')
const base = '/api/apps/builds'
const post = (body: unknown) => api.request(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
afterAll(async () => {
  for (let i = 0; i < 50; i++) { try { await buildRequest({ action: 'stop' }); break } catch { await new Promise((r) => setTimeout(r, 100)) } }
  await new Promise((r) => setTimeout(r, 200))
  rmSync(root, { recursive: true, force: true })
})
it('HTTP 页面可触发构建和下载产物，拒绝停止服务、无效目标和任意文件', async () => {
  expect((await api.request(base)).status).toBe(200)
  expect((await post({ action: 'stop' })).status).toBe(403)
  expect((await post({ action: 'enqueue', ref: '--evil', targets: ['android'] })).status).toBe(409)
  const response = await post({ action: 'enqueue', ref: 'main', targets: ['android'] })
  expect(response.status).toBe(200)
  const id = ((await response.json()) as BuildsSnapshot).builds[0].id
  let snapshot: BuildsSnapshot | undefined
  for (let i = 0; i < 100; i++) { snapshot = await buildRequest<BuildsSnapshot>({ action: 'status' }); if (snapshot.builds[0].status === 'success') break; await new Promise((r) => setTimeout(r, 100)) }
  expect(snapshot!.builds[0].status).toBe('success')
  const artifact = await api.request(`${base}/${id}/artifacts/binos-android-debug.apk`)
  expect(artifact.status).toBe(200); expect(artifact.headers.get('Content-Disposition')).toContain('attachment'); expect(await artifact.text()).toContain('预览构建')
  expect((await api.request(`${base}/${id}/artifacts/state.json`)).status).toBe(404)
  expect((await api.request(`${base}/${id}/artifacts/%2e%2e%2fstate.json`)).status).toBe(404)
  expect((await api.request(`${base}/${id}/log?download=1`)).status).toBe(200)
}, 20_000)
