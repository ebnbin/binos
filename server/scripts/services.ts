// 生成并加载 launchd 服务的配置，根目录搬家或换宿主后重新运行一次。
// 每个服务都只运行 System/binos/bin/binos 的一个子命令，具体怎么做由随版本上线的 bin/binos 决定，这里的配置不随版本变
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rootFromEnv, rootLayout } from '../src/layout.ts'
import { serverLabel } from '../src/production.ts'

const { rootDir, binosDir, logsDir } = rootLayout(rootFromEnv())
const agentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents')
const domain = `gui/${os.userInfo().uid}`
const binos = path.join(binosDir, 'bin', 'binos')

// command：运行的子命令，输出写进日志目录下的 <command>.log；interval：每隔多少秒运行一次，没有的是常驻服务，退出后自动拉起
type Service = { label: string; command: string; interval?: number }

const services: Service[] = [
  { label: serverLabel, command: 'server' },
  { label: 'app.binos.tunnel', command: 'tunnel' },
  { label: 'app.binos.deploy', command: 'deploy', interval: 60 },
]

// 改了名的服务，卸载后删掉配置
const retired = ['app.binos.deployer']

mkdirSync(logsDir, { recursive: true })
for (const label of retired) {
  unload(label)
  const plistPath = path.join(agentsDir, `${label}.plist`)
  if (existsSync(plistPath)) {
    rmSync(plistPath)
    console.log(`已删除 ${label}`)
  }
}
for (const service of services) {
  const plistPath = path.join(agentsDir, `${service.label}.plist`)
  writeFileSync(plistPath, plist(service))
  execFileSync('plutil', ['-lint', '-s', plistPath])
  unload(service.label)
  execFileSync('launchctl', ['bootstrap', domain, plistPath])
  console.log(`已加载 ${service.label}`)
}

function plist(service: Service) {
  const logPath = path.join(logsDir, `${service.command}.log`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- 由 binOS 仓库的 server/scripts/services.ts 生成，不要手动修改 -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(service.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(binos)}</string>
    <string>${xml(service.command)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${xml(os.homedir())}</string>
    <key>BINOS_ROOT</key>
    <string>${xml(rootDir)}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(rootDir)}</string>
  <key>RunAtLoad</key>
  <true/>
${service.interval ? `  <key>StartInterval</key>\n  <integer>${service.interval}</integer>` : '  <key>KeepAlive</key>\n  <true/>'}
  <!-- 不设置时 launchd 会把它当后台任务压低优先级，它启动的 agent 也会变慢 -->
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`
}

function xml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function isLoaded(label: string) {
  try {
    execFileSync('launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// bootout 返回时服务可能还没卸载完，要等它真正卸载后才能再 bootstrap
function unload(label: string) {
  if (!isLoaded(label)) {
    return
  }
  execFileSync('launchctl', ['bootout', `${domain}/${label}`])
  for (let i = 0; i < 50 && isLoaded(label); i++) {
    execFileSync('sleep', ['0.2'])
  }
}
