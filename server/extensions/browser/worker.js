const clients = new Map()
let port
let reconnect

function emit(clientId, message) {
  port?.postMessage({ clientId, message })
}
function client(clientId) {
  if (!clients.has(clientId)) clients.set(clientId, { tabs: new Map(), sessions: new Map(), browserSessions: new Set() })
  return clients.get(clientId)
}
function session(clientId, sessionId) {
  const entry = client(clientId).sessions.get(sessionId)
  if (!entry) throw new Error('Unknown browser session')
  return entry
}
async function attach(clientId, tabId) {
  const state = client(clientId)
  await chrome.debugger.attach({ tabId }, '1.3')
  const { targetInfo } = await chrome.debugger.sendCommand({ tabId }, 'Target.getTargetInfo')
  const sessionId = crypto.randomUUID()
  state.tabs.set(tabId, { targetInfo, sessions: new Set([sessionId]) })
  state.sessions.set(sessionId, { tabId })
  emit(clientId, { method: 'Target.attachedToTarget', params: { sessionId, targetInfo: { ...targetInfo, attached: true }, waitingForDebugger: false } })
  return targetInfo.targetId
}
function remove(tabId) {
  for (const [clientId, state] of clients) {
    const tab = state.tabs.get(tabId)
    if (!tab) continue
    for (const sessionId of tab.sessions) {
      state.sessions.delete(sessionId)
      emit(clientId, { method: 'Target.detachedFromTarget', params: { sessionId, targetId: tab.targetInfo.targetId } })
    }
    for (const [id, entry] of state.sessions) if (entry.tabId === tabId) state.sessions.delete(id)
    state.tabs.delete(tabId)
  }
}
async function command(clientId, message) {
  const { method, params = {}, sessionId } = message
  const state = client(clientId)
  if (!sessionId || state.browserSessions.has(sessionId)) {
    switch (method) {
      case 'Browser.getVersion': return { protocolVersion: '1.3', product: 'Chrome/155.0.0.0', userAgent: navigator.userAgent, revision: '', jsVersion: '' }
      case 'Target.attachToBrowserTarget': { const id = crypto.randomUUID(); state.browserSessions.add(id); return { sessionId: id } }
      case 'Target.setAutoAttach': case 'Target.setDiscoverTargets': return {}
      case 'Target.getTargetInfo': return { targetInfo: { targetId: 'binos-browser', type: 'browser', title: '', url: '', attached: true } }
      case 'Target.getTargets': return { targetInfos: [...state.tabs.values()].map(tab => tab.targetInfo) }
      case 'Target.createTarget': {
        if (state.tabs.size >= 4) throw new Error('Too many remote browser tabs')
        const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
        try { return { targetId: await attach(clientId, tab.id) } }
        catch (error) { await chrome.tabs.remove(tab.id); throw error }
      }
      case 'Target.closeTarget': {
        const entry = [...state.tabs].find(([, tab]) => tab.targetInfo.targetId === params.targetId)
        if (!entry) throw new Error('Target is not owned by this binOS connection')
        await chrome.tabs.remove(entry[0])
        return { success: true }
      }
      case 'Target.attachToTarget': {
        const entry = [...state.tabs].find(([, tab]) => tab.targetInfo.targetId === params.targetId)
        if (!entry) throw new Error('Target is not owned by this binOS connection')
        const id = crypto.randomUUID()
        state.sessions.set(id, { tabId: entry[0] })
        entry[1].sessions.add(id)
        emit(clientId, { sessionId, method: 'Target.attachedToTarget', params: { sessionId: id, targetInfo: { ...entry[1].targetInfo, attached: true }, waitingForDebugger: false } })
        return { sessionId: id }
      }
      case 'Target.detachFromTarget': {
        const entry = session(clientId, params.sessionId)
        state.sessions.delete(params.sessionId)
        state.tabs.get(entry.tabId)?.sessions.delete(params.sessionId)
        return {}
      }
      default: throw new Error(`Unsupported browser command: ${method}`)
    }
  }
  const entry = session(clientId, sessionId)
  if (method === 'Browser.getWindowForTarget') {
    const tab = await chrome.tabs.get(entry.tabId)
    const window = await chrome.windows.get(tab.windowId)
    return { windowId: window.id, bounds: { left: window.left, top: window.top, width: window.width, height: window.height, windowState: window.state } }
  }
  if (method === 'Browser.setWindowBounds') return {}
  if (method === 'Target.setAutoAttach' && params.autoAttach === false) return {}
  if (method.startsWith('Target.') && !['Target.setAutoAttach', 'Target.getTargetInfo'].includes(method)) throw new Error('Target command is not allowed on a page session')
  if (method === 'Target.getTargetInfo' && params.targetId && params.targetId !== state.tabs.get(entry.tabId)?.targetInfo.targetId) throw new Error('Target is not owned by this binOS connection')
  return await chrome.debugger.sendCommand(entry, method, params)
}
async function closeClient(clientId) {
  const state = clients.get(clientId)
  if (!state) return
  clients.delete(clientId)
  await Promise.allSettled([...state.tabs.keys()].map(tabId => chrome.tabs.remove(tabId)))
}
function connect() {
  if (port) return
  clearTimeout(reconnect)
  const current = chrome.runtime.connectNative('app.binos.browser')
  port = current
  current.onMessage.addListener(async ({ clientId, message, close }) => {
    if (close) { await closeClient(clientId); return }
    try { emit(clientId, { id: message.id, sessionId: message.sessionId, result: await command(clientId, message) }) }
    catch (error) { emit(clientId, { id: message.id, sessionId: message.sessionId, error: { code: -32000, message: String(error.message ?? error) } }) }
  })
  current.onDisconnect.addListener(() => {
    void chrome.runtime.lastError
    if (port !== current) return
    port = undefined
    for (const id of clients.keys()) void closeClient(id)
    reconnect = setTimeout(connect, 2000)
  })
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  for (const [clientId, state] of clients) {
    const tab = state.tabs.get(source.tabId)
    if (!tab) continue
    if (source.sessionId) {
      emit(clientId, { sessionId: source.sessionId, method, params })
    } else {
      if (method === 'Target.attachedToTarget') state.sessions.set(params.sessionId, { tabId: source.tabId, sessionId: params.sessionId })
      if (method === 'Target.detachedFromTarget') state.sessions.delete(params.sessionId)
      for (const sessionId of tab.sessions) emit(clientId, { sessionId, method, params })
    }
  }
})
chrome.debugger.onDetach.addListener(source => remove(source.tabId))
chrome.tabs.onRemoved.addListener(remove)
chrome.tabs.onCreated.addListener(async tab => {
  if (!tab.openerTabId) return
  for (const [clientId, state] of clients) {
    if (!state.tabs.has(tab.openerTabId)) continue
    try { await attach(clientId, tab.id) } catch { await chrome.tabs.remove(tab.id) }
  }
})
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(connect)
chrome.runtime.onStartup.addListener(connect)
chrome.runtime.onInstalled.addListener(connect)
connect()
