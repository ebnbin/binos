import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// node-pty 1.1.0 的 macOS 预编译包没有给 spawn-helper 执行权限。
// pnpm deploy 重新从包缓存复制依赖，因此开发安装和生产打包后都要处理。
export function preparePty(serverPackage: string) {
  if (process.platform !== 'darwin') return
  const require = createRequire(serverPackage)
  const dir = path.dirname(require.resolve('node-pty/package.json'))
  for (const location of [`prebuilds/darwin-${process.arch}`, 'build/Release']) {
    const helper = path.join(dir, location, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  preparePty(fileURLToPath(new URL('../package.json', import.meta.url)))
}
