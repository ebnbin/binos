import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const source = path.resolve(import.meta.dirname, '..')
const target = process.env.BINOS_BROWSER_EXTENSION_DIR ?? path.join(homedir(), 'Library', 'Application Support', 'binOS', 'browser')
const manifest = JSON.parse(readFileSync(path.join(source, 'extensions/browser/manifest.json'), 'utf8')) as { key: string }
const id = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('')
const extension = path.join(target, 'extension')
const host = path.join(target, 'native-host')
const nativeDirectory = process.env.BINOS_BROWSER_NATIVE_DIR ?? path.join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
if (!process.argv.includes('--install')) {
  console.log(JSON.stringify({ extension, host, nativeManifest: path.join(nativeDirectory, 'app.binos.browser.json'), extensionId: id }, null, 2))
  console.log('运行时加 --install，安装扩展文件和本机通信宿主。随后在 chrome://extensions 加载 extension 目录一次。')
  process.exit(0)
}
mkdirSync(target, { recursive: true, mode: 0o700 })
cpSync(path.join(source, 'extensions/browser'), extension, { recursive: true })
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
for (const file of ['native-host.js', 'relay-path.js']) cpSync(path.join(source, 'dist/apps/browser', file), path.join(target, file))
mkdirSync(path.join(target, 'node_modules'), { recursive: true })
cpSync(realpathSync(path.join(source, 'server/node_modules/ws')), path.join(target, 'node_modules/ws'), { recursive: true })
writeFileSync(path.join(target, 'package.json'), JSON.stringify({ type: 'module' }))
const script = path.join(target, 'native-host.js')
const node = existsSync('/opt/homebrew/bin/node') ? '/opt/homebrew/bin/node' : process.execPath
writeFileSync(host, `#!/bin/sh\nexport BINOS_BROWSER_RELAY_DIR=${quote(target)}\nexec ${quote(node)} ${quote(script)} "$@"\n`, { mode: 0o700 })
chmodSync(host, 0o700)
mkdirSync(nativeDirectory, { recursive: true })
writeFileSync(path.join(nativeDirectory, 'app.binos.browser.json'), JSON.stringify({ name: 'app.binos.browser', description: 'binOS personal Chrome bridge', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }, null, 2) + '\n')
console.log(`扩展目录：${extension}\n扩展 ID：${id}\n在 chrome://extensions 加载扩展目录一次，即可使用个人 Chrome 的现有登录状态。`)
