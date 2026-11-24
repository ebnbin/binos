# 个人 Chrome 远程浏览

远程模式通过 binOS Browser 扩展在已安装扩展的 Chrome 个人资料中创建页面，共享该资料已有的登录状态。扩展只允许 binOS 控制它创建的标签；连接断开时清理该连接的标签，不枚举或关闭用户原有标签。

## 一次性安装

在 worktree 根目录运行：

```sh
pnpm --filter @binos/server build
node server/scripts/browser-extension.ts --install
```

安装器把扩展、本机通信宿主和依赖放入当前用户的 Application Support，并注册 Chrome Native Messaging。安装内容独立于 worktree，上线清理 worktree 不会影响连接。运行安装器不加 `--install` 可查看目标路径。

在要使用的 Chrome 个人资料中打开 `chrome://extensions`，开启开发者模式，加载安装器输出的扩展目录一次。扩展的 debugger 权限在安装时授予；运行时 Chrome 会显示非阻塞的调试提示条，连接不调用外部远程调试授权接口。

## 运行与恢复

扩展启动本机宿主，宿主只监听回环地址。连接地址使用随机令牌，保存在仅当前用户可读的文件中；拒绝带网页 Origin 的连接。后端通过该地址使用 CDP，更新后端不会卸载扩展。Chrome 启动时扩展自动连接，宿主断开后扩展自动重试。远程请求发现 Chrome 未运行时会在后台启动 Chrome。

专用的测试 Chrome 资料可将 NativeMessagingHosts 放在自己的 user-data-dir，并设置 `BINOS_BROWSER_RELAY_DIR` 隔离连接文件。`BINOS_BROWSER_CDP_ENDPOINT` 仅用于显式指定测试或外部 CDP 连接。
