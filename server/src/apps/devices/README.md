# Devices

设备管理服务独立于网页后端，按需启动并持续处理队列、租约和回收。数据在 `BINOS_ROOT/Library/Services/devices/`，登记簿由服务单独写入。普通请求与管理请求使用不同的 `0600` Unix socket。

## 设备池

正式实例初始为空，总容量为 4 台，不固定平台比例。申请支持 Android、iOS 和双端，可以按平台指定机型。已有健康闲置设备会先检查再复用，指定了机型时只复用同一机型；容量不足时销毁不匹配的闲置设备，腾出位置创建。全局按申请顺序安排容量，已开始准备的组不会被后续请求抢走。双端全部 ready 后才生成一份可领取租约。

创建、检查、预留、使用、清理、销毁和故障设备都占容量。创建意图先落盘，销毁确认成功才释放名额。归还后清理应用及数据，再保持启动供复用；闲置一小时后关闭并删除专属设备。状态读取、截图、健康检查和服务重启不延长闲置时间。

需要已安装的 Xcode、iOS runtime、Android SDK platform-tools、emulator 和系统镜像。不需要来源 AVD，也不自动安装 SDK 或镜像。默认 Android 镜像为 `system-images;android-36;google_apis_playstore;arm64-v8a`，iOS 不指定机型时优先使用 iPhone 18 Pro，未安装该机型对应 runtime 时选择可用 iPhone；指定机型时用支持它的最新可用 runtime。显式指定的机型和 runtime 必须兼容，否则返回明确错误。服务启动环境可设置 `ANDROID_HOME`、`BINOS_ANDROID_IMAGE`、`BINOS_IOS_DEVICE_TYPE` 和 `BINOS_IOS_RUNTIME`，改变后需重启服务。

真实设备使用专属 Android AVD 目录和 iOS device set，默认无窗口。Android 各实例使用独立临时目录和 HCI 端口，网络服务保持默认实例编号以匹配模拟器客户端的发现文件，进程身份包含 PID 与启动时间。已有模拟器只读发现，不参与分配或销毁。

`BINOS_TEST_INSTANCE=1` 的开发与 PR 预览默认使用模拟设备，执行完整调度流程但不操作实际模拟器。真实模式为 `BINOS_DEVICES_MODE=real`；同一数据目录不能混用模式。

## 机型

`binos devices models` 列出本机可以申请的机型：iOS 是可用 runtime 支持的所有模拟器机型，带名称、标识、设备族和可选的系统版本，不指定时用的那个标为 `default`。申请时用 `--ios-model` 填名称（不区分大小写）或标识，服务换成标识后记在申请上，本机没有的机型直接报错。设备创建时记下实际的机型标识和名称。Android 的硬件配置目前固定，指定 Android 机型会返回错误。

## 会话使用

每个 session 只能有一份申请，选择 `android`、`ios` 或 `both`，可以另外指定机型；修改平台或机型必须先归还或取消。相同组合重试返回原申请，不能增加设备或改变队列位置。

```sh
binos devices acquire --platform both --reason '双端验证' --wait 60
binos devices acquire --platform ios --ios-model 'iPhone Duo' --reason '折叠屏布局' --wait 60
binos devices run --lease <租约ID> -- <命令> [参数]
binos devices screenshot <设备ID> --lease <租约ID> --output /tmp/screen.png
binos devices release --lease <租约ID>
```

会话身份来自 `BINOS_THREAD_ID`；终端手动使用时加 `--session <身份>`。等待响应包含申请编号、位置和准备状态，退出码为 2；失败响应保留申请编号和原因，退出码为 1。可用 `acquire --request <申请编号>` 重试，或 `cancel --request <申请编号>` 取消等待、准备、失败或尚未领取的申请。已结束申请编号保留 24 小时，拒绝迟到的重复请求。旧租约的重复归还不影响新租约。

`run` 注入 `ANDROID_SERIAL`、`ANDROID_HOME`、`ANDROID_AVD_HOME`、`BINOS_IOS_UDID` 和 `BINOS_IOS_DEVICE_SET`。iOS 必须显式指定设备集与 UDID：

```sh
xcrun simctl --set "$BINOS_IOS_DEVICE_SET" install "$BINOS_IOS_UDID" /path/to/App.app
```

命令最长运行 30 分钟，执行期间保活且不能普通归还；每个输出流上限 1 MiB。无命令运行时，租约 15 分钟未续期会回收；有人等待时连续占用上限为 1 小时。长间隔使用 `renew --lease <ID>`。等待申请 3 分钟失联会取消；整组就绪后的领取期限为 3 分钟，与准备耗时分开计算。状态查询和截图不续租。

## 回收与恢复

session 不能创建、启动、销毁、维护设备或强制回收。设备页面通过管理入口发起销毁；使用中的设备需二次确认。强制回收先撤销整组租约、终止并等待受管理命令退出，再销毁指定设备，其余组员清理后转闲置。旧租约不能续期或执行新命令。

设备操作有独立编号和执行进程，取消后旧结果不能覆盖新状态。准备失败不交付半份租约，成功组员回到闲置；故障资源自动尝试销毁，总失败次数达到 3 次后隔离，仍占容量，可从设备页面重新回收。销毁失败保留资源登记，不通过删除记录腾出虚假容量。

服务重启核对并终止遗留操作，继续未完成的创建、检查、清理和销毁，保留有效租约及闲置起点。系统重启则撤销旧租约并清理设备。旧版登记簿自动迁移到版本 2。新构建通过内部管理入口停止旧服务，执行中的命令和设备操作完成前不升级。

截图按需获取，5 秒内复用；状态改变后旧截图失效。管理事件最多保存 200 条。管理日志为 `manager.log`，Android 输出在 `emulator/<设备ID>.log`。同一 macOS 用户的 shell 仍能直接访问系统工具，租约和入口分离是调度与防误用机制，不构成进程权限隔离。
