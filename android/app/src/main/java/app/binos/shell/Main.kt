package app.binos.shell

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import app.binos.app
import app.binos.code.CodeHomeScreen
import app.binos.code.ConversationScreen
import app.binos.files.FilePreviewScreen
import app.binos.files.FilesScreen
import app.binos.kita.KitaChatScreen
import app.binos.kita.KitaMemoriesScreen
import app.binos.kita.KitaProfileScreen
import app.binos.kita.KitaScreen
import app.binos.more.BrowserScreen
import app.binos.more.BuildLogScreen
import app.binos.more.BuildsScreen
import app.binos.more.CalendarScreen
import app.binos.more.DevicesScreen
import app.binos.more.ExternalAppsScreen
import app.binos.more.MoreScreen
import app.binos.more.SettingsScreen
import app.binos.more.WebAppScreen
import app.binos.music.MiniPlayer
import app.binos.music.MusicPlayer
import app.binos.music.MusicScreen
import app.binos.system.AccountsScreen
import app.binos.system.SystemScreen
import app.binos.terminal.TerminalHomeScreen
import app.binos.terminal.TerminalScreen
import kotlin.reflect.KClass

val LocalNav = staticCompositionLocalOf<NavHostController> { error("没有导航") }

private data class TopLevel(val route: Any, val type: KClass<*>, val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

private val topLevels = listOf(
    TopLevel(CodeRoute, CodeRoute::class, "Code", Icons.Outlined.Code, Icons.Filled.Code),
    TopLevel(TerminalRoute, TerminalRoute::class, "终端", Icons.Outlined.Terminal, Icons.Filled.Terminal),
    TopLevel(MusicRoute, MusicRoute::class, "音乐", Icons.Outlined.MusicNote, Icons.Filled.MusicNote),
    TopLevel(FilesRoute, FilesRoute::class, "文件", Icons.Outlined.Folder, Icons.Filled.Folder),
    TopLevel(MoreRoute, MoreRoute::class, "更多", Icons.Outlined.GridView, Icons.Filled.GridView),
)

// 手机上是底部导航栏，平板和横屏是侧边导航栏；进入二级页面时隐藏
@Composable
fun MainScreen() {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val destination = entry?.destination
    val topLevel = topLevels.any { level -> destination?.hasRoute(level.type) == true }
    val adaptive = NavigationSuiteScaffoldDefaults.calculateFromAdaptiveInfo(currentWindowAdaptiveInfo())
    // 连上播放服务，其他页面也能看到迷你播放条
    LaunchedEffect(Unit) { MusicPlayer.connect() }
    CompositionLocalProvider(LocalNav provides nav) {
        NavigationSuiteScaffold(
            layoutType = if (topLevel) adaptive else NavigationSuiteType.None,
            navigationSuiteItems = {
                topLevels.forEach { level ->
                    val selected = destination?.hierarchy?.any { it.hasRoute(level.type) } == true
                    item(
                        selected = selected,
                        onClick = {
                            nav.navigate(level.route) {
                                popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(if (selected) level.selectedIcon else level.icon, null) },
                        label = { Text(level.label) },
                    )
                }
            },
        ) {
            Column {
                ConnectionBanner()
                // 提示条已经让开了状态栏，下面的页面不用再留
                val connected by app.events.connected.collectAsStateWithLifecycle()
                NavHost(
                    nav,
                    startDestination = CodeRoute,
                    modifier = Modifier.weight(1f).then(if (connected) Modifier else Modifier.consumeWindowInsets(WindowInsets.statusBars)),
                ) {
                    composable<CodeRoute> { CodeHomeScreen() }
                    composable<SessionRoute> { ConversationScreen(it.toRoute<SessionRoute>().id, null, it.toRoute<SessionRoute>().item.takeIf { item -> item >= 0 }) }
                    composable<NewSessionRoute> { ConversationScreen(null, it.toRoute<NewSessionRoute>().project.ifEmpty { null }, null) }
                    composable<KitaRoute> { KitaScreen() }
                    composable<KitaChatRoute> { it.toRoute<KitaChatRoute>().let { route -> KitaChatScreen(route.id.ifEmpty { null }, route.temporary) } }
                    composable<KitaMemoriesRoute> { KitaMemoriesScreen() }
                    composable<KitaProfileRoute> { KitaProfileScreen() }
                    composable<TerminalRoute> { TerminalHomeScreen() }
                    composable<TerminalSessionRoute> { TerminalScreen(it.toRoute<TerminalSessionRoute>().id) }
                    composable<MusicRoute> { MusicScreen() }
                    composable<FilesRoute> { FilesScreen(null) }
                    composable<FolderRoute> { FilesScreen(it.toRoute<FolderRoute>().path) }
                    composable<FilePreviewRoute> { it.toRoute<FilePreviewRoute>().let { route -> FilePreviewScreen(route.url, route.name) } }
                    composable<MoreRoute> { MoreScreen() }
                    composable<SystemRoute> { SystemScreen() }
                    composable<AccountsRoute> { AccountsScreen() }
                    composable<CalendarRoute> { CalendarScreen() }
                    composable<BuildsRoute> { BuildsScreen() }
                    composable<BuildLogRoute> { BuildLogScreen(it.toRoute<BuildLogRoute>().id) }
                    composable<DevicesRoute> { DevicesScreen() }
                    composable<BrowserRoute> { BrowserScreen(it.toRoute<BrowserRoute>().url) }
                    composable<ExternalAppsRoute> { ExternalAppsScreen() }
                    composable<WebAppRoute> { it.toRoute<WebAppRoute>().let { route -> WebAppScreen(route.name, route.url) } }
                    composable<SettingsRoute> { SettingsScreen() }
                }
                if (topLevel && destination?.hasRoute(MusicRoute::class) != true) {
                    MiniPlayer { nav.navigate(MusicRoute) { popUpTo(nav.graph.findStartDestination().id) { saveState = true }; launchSingleTop = true; restoreState = true } }
                }
            }
        }
    }
}

// 和后端的全局通知断开时在顶部提示，连上后消失
@Composable
private fun ConnectionBanner() {
    val connected by app.events.connected.collectAsStateWithLifecycle()
    AnimatedVisibility(!connected) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.errorContainer)
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onErrorContainer)
            Spacer(Modifier.width(10.dp))
            Text("与 binOS 的连接已断开，正在重连…", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onErrorContainer)
        }
    }
}
