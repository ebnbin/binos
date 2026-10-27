import { isTestInstance } from '../../paths.js'

// 安装和设备登记用的独立域名；隔离的开发实例用本机地址
export function installationOrigin(requestUrl: string) {
  const url = new URL(requestUrl)
  if (isTestInstance && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin
  return 'https://downloads.binos.app'
}
