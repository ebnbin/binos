import path from 'node:path'

export function rootLayout(root: string) {
  const rootDir = path.resolve(root)
  const libraryDir = path.join(rootDir, 'Library')
  // binOS 系统自己的数据
  const systemDataDir = path.join(libraryDir, 'binos')
  return {
    rootDir,
    // 正在运行的 binOS：上线服务装进来的构建，launchd 运行其中的 bin/binos
    binosDir: path.join(rootDir, 'System', 'binos'),
    // 正式版的页面：和后端分开上线，后端从这里提供
    webDir: path.join(rootDir, 'System', 'web'),
    previewsDir: path.join(rootDir, 'System', 'previews'),
    libraryDir,
    // 第三方 agent 自己的目录，每个 agent 一个子目录
    agentsDir: path.join(rootDir, 'Agents'),
    // launchd 服务的输出，一个服务一个文件
    logsDir: path.join(systemDataDir, 'logs'),
    // app 注册表：装了哪些外部 app
    registryPath: path.join(systemDataDir, 'apps.json'),
    // 访问控制：Cloudflare Access 的设置和主人的邮箱，手动填写
    accessPath: path.join(systemDataDir, 'access.json'),
    // 后端的根目录锁
    serverLockPath: path.join(systemDataDir, 'server.lock'),
    dataRevisionPath: path.join(systemDataDir, 'data-revision.json'),
    appsDir: path.join(libraryDir, 'Apps'),
    // agent 服务的数据：thread、额度和登录的状况
    kitaServiceDir: path.join(libraryDir, 'Services', 'kita'),
    devicesServiceDir: path.join(libraryDir, 'Services', 'devices'),
    // 上线服务的数据：已经上线的提交、各端的上一个版本、上线过程中的临时文件、上线失败的提交和锁
    deployDir: path.join(libraryDir, 'Services', 'deploy'),
  }
}

// 根目录由启动方式指定，不根据代码所在位置推断
export function rootFromEnv(): string {
  const root = process.env.BINOS_ROOT
  if (!root) {
    throw new Error('BINOS_ROOT is not set')
  }
  return root
}
