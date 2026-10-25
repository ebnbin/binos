import { browserApi } from './browser/api.js'
import { stopBrowser } from './browser/session.js'
import { buildsApi } from './builds/api.js'
import { buildRequest } from './builds/client.js'
import { watchBuilds } from './builds/watch.js'
import { devicesApi } from './devices/api.js'
import { watchDevices } from './devices/watch.js'
import { terminalApi } from './terminal/api.js'
import { stopWatchingTerminals, watchTerminals } from './terminal/watch.js'
import { systemApi } from './system/api.js'
import { monitor } from './system/monitor.js'
import { filesApi } from './files/api.js'
import { codeApp } from './code/index.js'
import { kitaApp } from './kita/index.js'
import type { ServerApp } from './types.js'
import { musicApi } from './music/api.js'

export const serverApps: ServerApp[] = [
  { id: 'browser', api: browserApi, stop: stopBrowser },
  { id: 'devices', api: devicesApi, start: watchDevices },
  { id: 'builds', api: buildsApi, start: () => { watchBuilds(); void buildRequest({ action: 'status' }).catch(console.error) } },
  codeApp,
  kitaApp,
  { id: 'terminal', api: terminalApi, start: watchTerminals, stop: stopWatchingTerminals },
  { id: 'files', api: filesApi },
  { id: 'music', api: musicApi },
  { id: 'system', api: systemApi, start: () => monitor.start() },
]
