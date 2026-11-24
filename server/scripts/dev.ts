import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { rootLayout } from '../src/layout.ts'
import { freePort } from './net.ts'

const serverDir = path.resolve(import.meta.dirname, '..')
const webDir = path.resolve(serverDir, '../web')
const rootDir = path.join(serverDir, '.test-instance')

const production = process.env.BINOS_ROOT ? rootLayout(process.env.BINOS_ROOT) : undefined
const agentsDir = process.env.BINOS_AGENTS_DIR ?? production?.agentsDir
if (!agentsDir) {
  throw new Error('需要 BINOS_ROOT（正式版的根目录）或 BINOS_AGENTS_DIR，用来借用正式版 agent 的登录')
}

mkdirSync(rootDir, { recursive: true })
const serverPort = await freePort()
const webPort = await freePort()

const children = [
  spawn('pnpm', ['watch'], {
    cwd: serverDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      BINOS_ROOT: rootDir,
      BINOS_TEST_INSTANCE: '1',
      BINOS_AGENTS_DIR: agentsDir,
      PORT: String(serverPort),
    },
  }),
  spawn('pnpm', ['dev', '--port', String(webPort), '--strictPort'], {
    cwd: webDir,
    stdio: 'inherit',
    env: { ...process.env, BINOS_SERVER_PORT: String(serverPort) },
  }),
]

console.log(`测试实例：页面 http://localhost:${webPort}，接口 http://127.0.0.1:${serverPort}/api，数据 ${rootDir}`)

const stop = () => {
  for (const child of children) {
    child.kill('SIGTERM')
  }
}
for (const child of children) {
  child.on('exit', stop)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
