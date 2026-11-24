import path from 'node:path'
import { localApiSocketPath } from './local-api-path.js'
import { rootFromEnv, rootLayout } from './layout.js'

const layout = rootLayout(rootFromEnv())
export const apiSocketPath = localApiSocketPath(layout.rootDir)

export const isTestInstance = process.env.BINOS_TEST_INSTANCE === '1'

export const { accessPath, devicesServiceDir, kitaServiceDir, libraryDir, previewsDir, registryPath, serverLockPath, webDir } = layout
// 内置 app 的数据目录，每个 app 一个，里面怎么组织由 app 自己决定
export const appDir = (id: string) => path.join(layout.appsDir, id)
// 当前运行的代码：测试实例是被测试的 worktree，正式版是 System/binos
export const codeDir = path.resolve(import.meta.dirname, '../..')
// agent 的登录和配置，每个 agent 一个子目录。测试实例和预览借用正式版的，沿用它们的登录。
// Claude Code 按配置目录路径的字符串区分钥匙串里的凭证，所以要规范成同一种写法
export const agentsDir = process.env.BINOS_AGENTS_DIR ? path.resolve(process.env.BINOS_AGENTS_DIR) : layout.agentsDir
