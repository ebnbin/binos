import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

function bridge() {
  const replies: { clientId: string; message: { id?: number; result?: unknown; error?: unknown; method?: string } }[] = []
  let receive!: (value: unknown) => Promise<void>
  let next = 10
  const port = { postMessage: (value: typeof replies[number]) => replies.push(value), onMessage: { addListener: (fn: typeof receive) => { receive = fn } }, onDisconnect: { addListener: vi.fn<() => void>() } }
  const chrome = {
    runtime: { connectNative: () => port, onStartup: { addListener: vi.fn<() => void>() }, onInstalled: { addListener: vi.fn<() => void>() } },
    alarms: { create: vi.fn<() => void>(), onAlarm: { addListener: vi.fn<() => void>() } },
    tabs: { create: vi.fn<() => Promise<{ id: number }>>(async () => ({ id: next++ })), remove: vi.fn<() => void>(), onRemoved: { addListener: vi.fn<() => void>() }, onCreated: { addListener: vi.fn<() => void>() } },
    debugger: { attach: vi.fn<() => void>(), sendCommand: async ({ tabId }: { tabId: number }) => ({ targetInfo: { targetId: `target-${tabId}`, browserContextId: 'default', type: 'page' } }), onEvent: { addListener: vi.fn<() => void>() }, onDetach: { addListener: vi.fn<() => void>() } },
  }
  vm.runInNewContext(readFileSync(new URL('../../../extensions/browser/worker.js', import.meta.url), 'utf8'), { chrome, crypto: webcrypto, navigator: { userAgent: 'Chrome/155' }, setTimeout: vi.fn<() => void>(), clearTimeout: vi.fn<() => void>() })
  let id = 0
  async function command(clientId: string, method: string, params = {}, sessionId?: string) {
    const current = ++id
    await receive({ clientId, message: { id: current, method, params, sessionId } })
    return replies.find(reply => reply.clientId === clientId && reply.message.id === current)!.message
  }
  return { chrome, replies, command, receive }
}

describe('personal Chrome extension ownership', () => {
  it('creates remote tabs in the existing profile without enumerating existing personal tabs', async () => {
    const b = bridge()
    const result = await b.command('one', 'Target.createTarget')
    expect(result.result).toEqual({ targetId: 'target-10' })
    expect(b.chrome.tabs.create).toHaveBeenCalledWith({ url: 'about:blank', active: false })
    expect(b.chrome.debugger.attach).toHaveBeenCalledWith({ tabId: 10 }, '1.3')
    expect((await b.command('one', 'Target.getTargets')).result).toEqual({ targetInfos: [{ targetId: 'target-10', browserContextId: 'default', type: 'page' }] })
  })

  it('rejects attempts to attach to or close another connection or personal target', async () => {
    const b = bridge()
    await b.command('one', 'Target.createTarget')
    for (const targetId of ['target-10', 'personal-tab']) {
      expect((await b.command('two', 'Target.closeTarget', { targetId })).error).toBeDefined()
      expect((await b.command('two', 'Target.attachToTarget', { targetId })).error).toBeDefined()
    }
    expect(b.chrome.tabs.remove).not.toHaveBeenCalled()
  })

  it('cleans up only the disconnected backend connection tabs', async () => {
    const b = bridge()
    await b.command('one', 'Target.createTarget')
    await b.command('two', 'Target.createTarget')
    await b.receive({ clientId: 'one', close: true })
    expect(b.chrome.tabs.remove).toHaveBeenCalledExactlyOnceWith(10)
    expect((await b.command('two', 'Target.closeTarget', { targetId: 'target-11' })).error).toBeUndefined()
  })
})
