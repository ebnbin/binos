import { browserApi } from './browser/api.js'
import { stopBrowser } from './browser/session.js'
import { buildsApi } from './builds/api.js'
import { buildRequest } from './builds/client.js'
import { devicesApi } from './devices/api.js'
import { terminalApi } from './terminal/api.js'
import { systemApi } from './system/api.js'
import { monitor } from './system/monitor.js'
import { filesApi } from './files/api.js'
import { codeApp } from './code/index.js'
import { kitaApp } from './kita/index.js'
import type { ServerApp } from './types.js'
import { musicApi } from './music/api.js'

export const serverApps: ServerApp[] = [
  { id: 'browser', api: browserApi, stop: stopBrowser },
  { id: 'devices', api: devicesApi },
  { id: 'builds', api: buildsApi, start: () => { void buildRequest({ action: 'status' }).catch(console.error) } },
  codeApp,
  kitaApp,
  { id: 'terminal', api: terminalApi },
  { id: 'files', api: filesApi },
  { id: 'music', api: musicApi },
  { id: 'system', api: systemApi, start: () => monitor.start() },
]
