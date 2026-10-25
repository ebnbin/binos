package app.binos.shell

import kotlinx.serialization.Serializable

// 底部导航的几个入口
@Serializable data object CodeRoute
@Serializable data object TerminalRoute
@Serializable data object MusicRoute
@Serializable data object FilesRoute
@Serializable data object MoreRoute

// Code
@Serializable data class SessionRoute(val id: Int, val item: Int = -1)
@Serializable data class NewSessionRoute(val project: String = "")

// 喜多：id 为空是新对话，temporary 只对新对话有意义
@Serializable data object KitaRoute
@Serializable data class KitaChatRoute(val id: String = "", val temporary: Boolean = false)
@Serializable data object KitaMemoriesRoute
@Serializable data object KitaProfileRoute

// 终端里的一个会话
@Serializable data class TerminalSessionRoute(val id: String)

// 文件：目录和预览
@Serializable data class FolderRoute(val path: String)
// url 是 binOS 上的文件地址（文件 app 的下载地址、会话里的文件快照）
@Serializable data class FilePreviewRoute(val url: String, val name: String)

// 更多
@Serializable data object SystemRoute
@Serializable data object AccountsRoute
@Serializable data object CalendarRoute
@Serializable data class BuildsRoute(val ref: String = "main")
@Serializable data class BuildLogRoute(val id: String)
@Serializable data object DevicesRoute
@Serializable data class BrowserRoute(val url: String = "")
@Serializable data object ExternalAppsRoute
@Serializable data class WebAppRoute(val name: String, val url: String)
@Serializable data object SettingsRoute
