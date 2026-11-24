import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { rootFromEnv, rootLayout } from '../server/src/layout.ts'
import { serverPort } from '../server/src/production.ts'

const { deployDir, logsDir } = rootLayout(rootFromEnv())
const repoDir = path.resolve(import.meta.dirname, '..')
const deployLog = path.join(logsDir, 'deploy.log')

const git = (...args: string[]) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim()
const short = (commit: string) => commit.slice(0, 7)

// binos.app 前面有 Cloudflare 登录，命令行只能查本机的正式版
git('fetch', '--quiet', 'origin', 'main')
const target = git('rev-parse', process.argv[2] ?? 'origin/main')
console.log(`等待正式版包含 ${short(target)}`)

const deadline = Date.now() + 3 * 60_000
while (Date.now() < deadline) {
  const version = deployedVersion()
  if (version && contains(version, target)) {
    const [server, web] = await runningVersions()
    console.log(`✓ 正式版已经上线 ${short(version)}，包含 ${short(target)}。后端运行 ${server ? short(server) : '没有响应'}，页面是 ${web ? short(web) : '读不到'}`)
    process.exit(0)
  }
  if (deployLogTail().some((line) => line.includes(`✗ ${short(target)}`))) {
    console.log(`✗ ${short(target)} 上线失败，已自动切回原版本。deploy.log 最后几行：`)
    console.log(deployLogTail().slice(-10).join('\n'))
    console.log(`服务日志见 ${path.join(logsDir, 'server.log')}`)
    process.exit(1)
  }
  await sleep(2000)
}
const running = deployedVersion()
console.log(`✗ 3 分钟内没有上线 ${short(target)}，正式版${running ? `已经上线的是 ${short(running)}` : '没有上线记录'}。deploy.log 最后几行：`)
console.log(deployLogTail().slice(-10).join('\n'))
process.exit(1)

// 两端各自上线，已经上线的 main 的提交由上线服务记下
function deployedVersion() {
  try {
    return readFileSync(path.join(deployDir, 'deployed'), 'utf8').trim()
  } catch {
    return undefined
  }
}

// 后端和页面各自正在运行的提交，只改了一端的提交不换另一端
async function runningVersions() {
  const read = async (url: string) => {
    try {
      return ((await (await fetch(`http://127.0.0.1:${serverPort}${url}`)).json()) as { version?: string }).version
    } catch {
      return undefined
    }
  }
  return Promise.all([read('/api/health'), read('/version.json')])
}

function contains(version: string, commit: string) {
  try {
    git('merge-base', '--is-ancestor', commit, version)
    return true
  } catch {
    return false
  }
}

function deployLogTail() {
  try {
    return readFileSync(deployLog, 'utf8').trimEnd().split('\n').slice(-200)
  } catch {
    return []
  }
}
