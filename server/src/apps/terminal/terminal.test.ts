import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = mkdtempSync(path.join(os.tmpdir(), 'binos-terminal-test-'))
process.env.BINOS_ROOT = root
process.env.BINOS_TEST_INSTANCE = '1'
const { createSession, listSessions, runTmux, tmux } = await import('./sessions.js')
const { connectTerminal, parseMessage } = await import('./connection.js')
const { terminalApi } = await import('./api.js')

afterAll(async () => {
  if (tmux) await runTmux(['kill-server']).catch(() => {})
  rmSync(root, { recursive: true, force: true })
})

it('拒绝非法尺寸、超大输入和伪造 ACK', () => {
  for (const value of [
    null,
    { type: 'resize', cols: 0, rows: 24 },
    { type: 'resize', cols: 80, rows: 201 },
    { type: 'resize', cols: 80.1, rows: 24 },
    { type: 'input', data: 'x'.repeat(16385) },
    { type: 'ack', size: -1 },
    { type: 'ack', size: 2 ** 31 },
    { type: 'unknown' },
  ])
    expect(parseMessage(value)).toBeUndefined()
})

describe.skipIf(!tmux)('宿主终端会话', () => {
  it('断开 PTY 后保留 shell 状态，重连恢复，Ctrl+C 中断并响应窗口尺寸', async () => {
    const session = await createSession()
    let output = ''
    let connection: ReturnType<typeof connectTerminal>
    const attach = () =>
      connectTerminal(
        session.id,
        (message) => {
          if (message.type === 'output') {
            output += message.data
            queueMicrotask(() => connection.receive({ type: 'ack', size: message.data.length }))
          }
        },
        () => {},
      )
    try {
      connection = attach()
      await expect.poll(() => output.length, { timeout: 5000 }).toBeGreaterThan(0)
      connection.receive({ type: 'input', data: 'export BINOS_TERMINAL_TEST=kept; printf "first-%s\\n" "$BINOS_TERMINAL_TEST"\r' })
      await expect.poll(() => output, { timeout: 5000 }).toContain('first-kept')
      connection.dispose()
      expect((await listSessions()).map((item) => item.id)).toContain(session.id)
      output = ''
      connection = attach()
      await expect.poll(() => output.length, { timeout: 5000 }).toBeGreaterThan(0)
      connection.receive({ type: 'resize', cols: 100, rows: 35 })
      connection.receive({ type: 'input', data: 'printf "second-%s\\n" "$BINOS_TERMINAL_TEST"; stty size; sleep 30\r' })
      await expect.poll(() => output, { timeout: 5000 }).toContain('second-kept')
      await expect.poll(() => output, { timeout: 5000 }).toContain('35 100')
      connection.receive({ type: 'input', data: '\x03' })
      connection.receive({ type: 'input', data: 'printf "interrupt-%s\\n" ok\r' })
      await expect.poll(() => output, { timeout: 5000 }).toContain('interrupt-ok')
      connection.dispose()
    } finally {
      await runTmux(['kill-session', '-t', session.id])
    }
  }, 20_000)

  it('拒绝跨站 WebSocket 和不存在的会话，不带 Origin 的原生客户端不算跨站', async () => {
    const session = await createSession()
    try {
      const connect = (origin?: string) =>
        terminalApi.request(`http://localhost/sessions/${session.id}/socket`, {
          headers: { host: 'localhost', ...(origin && { origin }), upgrade: 'websocket' },
        })
      for (const origin of ['https://other.example', 'null']) {
        expect((await connect(origin)).status).toBe(403)
      }
      expect((await connect()).status).not.toBe(403)
      expect((await terminalApi.request('/sessions/invalid/stream')).status).toBe(404)
    } finally {
      await runTmux(['kill-session', '-t', session.id])
    }
  })
})
