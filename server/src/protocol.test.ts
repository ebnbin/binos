import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

process.env.BINOS_ROOT = mkdtempSync(path.join(os.tmpdir(), 'binos-protocol-'))
process.env.BINOS_TEST_INSTANCE = '1'
const { api } = await import('./api.js')
const { schemaPath } = await import('./protocol-id.js')

// 挂上的每个路由（含各个 app 和 agent 的）都要登记在 protocol.ts 的 Http、Sse 或 WebSockets 里，登记的也都要真的有
it('协议登记了所有路由', () => {
  const { definitions } = JSON.parse(readFileSync(schemaPath, 'utf8')) as { definitions: Record<string, { properties?: Record<string, unknown> }> }
  const registered = new Set(['Http', 'Sse', 'WebSockets'].flatMap((name) => Object.keys(definitions[name]?.properties ?? {})))
  // ALL 是中间件和兜底的「没有这个接口」
  const mounted = new Set(api.routes.filter((route) => route.method !== 'ALL').map((route) => `${route.method} ${route.path}`))
  expect([...mounted].filter((route) => !registered.has(route)), '这些路由没有登记在 server/src/protocol.ts，登记后运行 pnpm protocol').toEqual([])
  expect([...registered].filter((route) => !mounted.has(route)), 'server/src/protocol.ts 里登记了这些不存在的路由').toEqual([])
})
