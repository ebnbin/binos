// 上线后旧版本的代码块会被删掉，一直开着的页面再打开 app 时加载不到，React.lazy 记住失败，重试也没用。
// 这时重新载入页面拿到新版本；刚为此重新载入过还失败，就不再重复，避免一直刷新
const reloadedKey = 'binos:stale-assets-reload'
const retryAfter = 10_000

export function reloadOnStaleAssets() {
  window.addEventListener('vite:preloadError', () => {
    const last = Number(sessionStorage.getItem(reloadedKey))
    if (Date.now() - last < retryAfter) {
      return
    }
    sessionStorage.setItem(reloadedKey, String(Date.now()))
    window.location.reload()
  })
}
