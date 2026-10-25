# 移动端构建

Code 的「构建」页面管理 binOS 的 Android 和 iOS 构建，「设备」页面管理测试模拟器。构建服务在后端启动时按需拉起，独立运行，无需额外 launchd 配置。构建不申请模拟器，也不改变正式版 Web/server 的上线流程。

## 构建目标

- `android`：Debug APK，并执行单元测试和 lint。调试签名使用构建机用户的 Android debug keystore，同一构建机生成的包可覆盖安装。
- `ios`：先关闭开发者签名编译模拟器版，确认代码能编译；再 Release archive 并导出 Ad Hoc IPA。需要本机 Xcode 已配置开发者账号、可用签名证书、`app.binos` 的标识和描述文件，安装设备 UDID 必须包含在描述文件中。导出选项为 `ios/ExportOptions-AdHoc.plist`，允许 Xcode 更新描述文件。不自动注册设备或上传 TestFlight。

构建机需要 Xcode 27.1 及 iOS 27 SDK、Android SDK 37 和兼容 Gradle 9.6/AGP 9.4 的 JDK。Android 使用 `ANDROID_HOME`，默认 `~/Library/Android/sdk`；使用 `JAVA_HOME`，默认 Homebrew 的 OpenJDK。临时 worktree 内移除生成的 daemon JVM 下载配置，使用构建机 JDK，并生成仅该次构建使用的 local.properties。版本名沿用工程配置，构建号由服务持久化的递增序号注入两端。

构建命令保存在 `scripts/mobile-build.sh`，在指定提交的干净 worktree 中执行。脚本接收目标参数，`BINOS_BUILD_OUTPUT` 指定产物目录，`BINOS_BUILD_NUMBER` 指定构建号。每个目标在 `types.ts` 的 `targetArtifacts` 中声明产物的文件名、类型和平台，目前只有安装包（`install`）一种类型；只有声明的文件算产物，脚本留下的其他文件不记录。退出码为零且声明的产物都已生成才算成功。

## 调度与数据

每个平台一个目标，自动构建时两个目标都编。正式环境每 60 秒检查 origin/main 和最多 100 个打开的同仓库 PR；跨仓库 PR 不自动执行。只构建包含构建脚本的提交。同一提交、同一目标自动构建一次，失败、取消和中断都不会自动重新构建。新提交替换相同来源尚未开始的旧任务，PR 关闭或合并后移除它尚未开始的任务；运行中的任务继续。全局一次执行一个目标，各目标独立成功或失败。网页可关闭自动构建，手动检查更新、指定 main/PR/完整提交构建、取消和重试。手动检查更新即使关闭自动构建也会检查并入队。

服务使用权限 0600 的 Unix socket。数据保存在 `Library/Apps/builds/`：`state.json` 为登记簿，`results/<构建ID>/` 包含日志、runner 身份、结果和 outputs，`work/` 是临时源码。构建删除后只能重编，因此 main 最近 5 个提交和每个打开的 PR 最新提交的构建一直保留，其余构建结束满 3 天后删除，排队和运行中的任务不清除。日志网页显示末尾 512 KiB，可下载完整日志。产物记录大小与 SHA-256，通过已有用户认证下载。iOS 安装包可在 iPhone / iPad 上点击安装，通过 `itms-services` 获取安装清单和 IPA；链接有效期 24 小时，绑定构建 ID，后端重启即失效。系统安装器不携带浏览器凭据，因此 `/install/` 路径独立校验签名令牌，失效、被篡改、已删除构建均返回 404。仅已登录用户可签发安装链接。

runner 独立于管理服务和后端，管理服务重启后接续读取运行状态与结果。取消、60 分钟超时会结束构建进程组；runner 意外退出时管理服务核对遗留子进程身份后回收，并标记中断。失败与中断可手动重试。没有构建任务时服务可停止，下一请求重新启动。

构建脚本以当前 macOS 用户权限运行，只应构建自己信任的代码。worktree 提供源码隔离，不是权限沙箱。证书、密钥不写入仓库或构建产物。

## CLI 与验证

```sh
binos builds status
binos builds enqueue main android,ios
binos builds enqueue pr/123 ios
binos builds retry <构建ID>
binos builds cancel <构建ID>
binos builds log <构建ID> [行数]
binos builds poll
binos builds stop
```

开发和 PR 预览默认模拟构建、关闭自动检查，声明的产物为标记清楚的文本文件，不访问真实签名。真实验证必须同时使用独立 `BINOS_ROOT`、`BINOS_TEST_INSTANCE=1`、`BINOS_BUILDS_MODE=real`；`BINOS_BUILDS_REPO` 可指向待测仓库。删除隔离根目录前先停止服务并结束所有构建。

## 无线安装的入口配置

安装清单和 IPA 固定使用 `https://downloads.binos.app/install/`。该域名的所有请求先进入独立分发路由，普通网页、API 和其他路径返回 404。主站与 PR 预览没有匿名安装路径例外。开发实例仅允许在本机地址验证安装链路。

在现有 Cloudflare Tunnel 添加 Published application route：主机名 `downloads.binos.app`，Service 为 `http://127.0.0.1:24667`，Path 留空，HTTP Host Header 留空以保留原始域名。路由应位于可能覆盖它的通配符路由之前。保存时由控制台创建对应 DNS 记录。

Cloudflare Access 为 `downloads.binos.app` 创建独立的 Self-hosted 应用，Path 留空，策略为 Bypass / Include Everyone。主站原有登录规则保留。有效签名令牌是下载资源的访问凭据，不应公开分享安装链接。不再需要主站 `/install/*` 的 Access Bypass 规则。

网页下载 IPA 不等于安装。无线安装的设备必须包含在 Ad Hoc 描述文件中，满足应用的最低系统版本，并按 iOS 提示启用开发者模式。
