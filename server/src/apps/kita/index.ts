import type { ServerApp } from '../types.js'
import { kitaAppApi } from './api.js'

export const kitaApp: ServerApp = { id: 'kita', api: kitaAppApi }
