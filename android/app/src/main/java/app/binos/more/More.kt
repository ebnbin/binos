@file:OptIn(ExperimentalMaterial3Api::class)

package app.binos.more

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Calculate
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.Eco
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.FitnessCenter
import androidx.compose.material.icons.outlined.Flight
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Newspaper
import androidx.compose.material.icons.outlined.Pets
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.School
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material.icons.outlined.SportsKabaddi
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Work
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Apps
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.binos.BuildConfig
import app.binos.app
import app.binos.net.json
import app.binos.shell.AccountsRoute
import app.binos.shell.BrowserRoute
import app.binos.shell.BuildsRoute
import app.binos.shell.CalendarRoute
import app.binos.shell.DevicesRoute
import app.binos.shell.ExternalAppsRoute
import app.binos.shell.KitaRoute
import app.binos.shell.LocalNav
import app.binos.shell.SettingsRoute
import app.binos.shell.SystemRoute
import app.binos.shell.WebAppRoute
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.put
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale
import java.util.UUID

// 外部 app：独立部署的 web app，在应用内的 WebView 里打开
@Serializable
data class ExternalApp(val id: String, val name: String, val icon: String, val url: String)

@Serializable
data class AppRegistry(val external: List<ExternalApp> = emptyList())

private data class Entry(val label: String, val icon: ImageVector, val route: Any)

private val builtins = listOf(
    Entry("喜多", Icons.Outlined.Pets, KitaRoute),
    Entry("系统", Icons.Outlined.Speed, SystemRoute),
    Entry("Agent", Icons.Outlined.SmartToy, AccountsRoute),
    Entry("日历", Icons.Outlined.CalendarMonth, CalendarRoute),
    Entry("构建", Icons.Outlined.Build, BuildsRoute),
    Entry("设备", Icons.Outlined.Smartphone, DevicesRoute),
    Entry("浏览器", Icons.Outlined.Language, BrowserRoute()),
    Entry("外部 app", Icons.Outlined.Apps, ExternalAppsRoute),
    Entry("设置", Icons.Outlined.Settings, SettingsRoute),
)

// 其余的 app 和外部 app，排成启动台
@Composable
fun MoreScreen() {
    val nav = LocalNav.current
    var registry by remember { mutableStateOf<AppRegistry?>(null) }
    LaunchedEffect(Unit) {
        app.events.of("apps").collect { runCatching { app.api.get<AppRegistry>("/api/apps") }.onSuccess { registry = it } }
    }
    LaunchedEffect(Unit) { runCatching { app.api.get<AppRegistry>("/api/apps") }.onSuccess { registry = it } }
    Scaffold(topBar = { TopAppBar(title = { Text("更多") }) }) { padding ->
        LazyVerticalGrid(
            columns = GridCells.Adaptive(84.dp),
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(builtins, key = { it.label }) { entry -> Launcher(entry.label, entry.icon) { nav.navigate(entry.route) } }
            items(registry?.external.orEmpty(), key = { "external-${it.id}" }) { external ->
                Launcher(external.name, externalIcon(external.icon)) { nav.navigate(WebAppRoute(external.name, external.url)) }
            }
        }
    }
}

@Composable
private fun Launcher(label: String, icon: ImageVector, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick).padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(56.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(icon, null, Modifier.size(28.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer) }
        }
        Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp), textAlign = TextAlign.Center)
    }
}

@Composable
fun BackBar(title: String, actions: @Composable () -> Unit = {}) {
    val nav = LocalNav.current
    TopAppBar(
        title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
        actions = { actions() },
    )
}

// 外部 app 的清单：整份读取，整份替换
@Composable
fun ExternalAppsScreen() {
    val nav = LocalNav.current
    var registry by remember { mutableStateOf<AppRegistry?>(null) }
    var editing by remember { mutableStateOf<ExternalApp?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { runCatching { app.api.get<AppRegistry>("/api/apps") }.onSuccess { registry = it }.onFailure { error = it.message } }

    fun save(apps: List<ExternalApp>) {
        val previous = registry
        registry = AppRegistry(apps)
        scope.launch {
            runCatching { app.api.putJson("/api/apps", buildJsonObject { put("external", json.encodeToJsonElement(apps)) }) }
                .onSuccess { error = null }
                .onFailure {
                    error = "保存失败：${it.message}"
                    registry = previous
                }
        }
    }

    Scaffold(
        topBar = { BackBar("外部 app") },
        floatingActionButton = { FloatingActionButton(onClick = { editing = ExternalApp(UUID.randomUUID().toString().take(8), "", "app-window", "https://") }) { Icon(Icons.Outlined.Add, "添加") } },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            error?.let { item { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error) } }
            items(registry?.external.orEmpty(), key = { it.id }) { external ->
                ListItem(
                    modifier = Modifier.clickable { nav.navigate(WebAppRoute(external.name, external.url)) },
                    leadingContent = { Icon(externalIcon(external.icon), null) },
                    headlineContent = { Text(external.name) },
                    supportingContent = { Text(external.url, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    trailingContent = {
                        Row {
                            IconButton(onClick = { editing = external }) { Icon(Icons.Outlined.Edit, "编辑") }
                            IconButton(onClick = { save(registry!!.external.filter { it.id != external.id }) }) { Icon(Icons.Outlined.Delete, "删除") }
                        }
                    },
                )
            }
        }
    }
    editing?.let { current ->
        var name by remember(current.id) { mutableStateOf(current.name) }
        var url by remember(current.id) { mutableStateOf(current.url) }
        var icon by remember(current.id) { mutableStateOf(current.icon) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text(if (current.name.isEmpty()) "添加外部 app" else "编辑外部 app") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(name, { name = it }, label = { Text("名称") }, singleLine = true)
                    OutlinedTextField(url, { url = it }, label = { Text("网址") }, singleLine = true)
                    OutlinedTextField(icon, { icon = it }, label = { Text("图标") }, supportingText = { Text("lucide 图标名，比如 globe、puzzle") }, singleLine = true)
                }
            },
            confirmButton = {
                TextButton(
                    enabled = name.isNotBlank() && Regex("^https?://.+").matches(url.trim()) && Regex("^[a-z0-9-]{1,40}$").matches(icon),
                    onClick = {
                        val updated = current.copy(name = name.trim(), url = url.trim(), icon = icon)
                        val list = registry?.external.orEmpty()
                        save(if (list.any { it.id == current.id }) list.map { if (it.id == current.id) updated else it } else list + updated)
                        editing = null
                    },
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("取消") } },
        )
    }
}

// 外部 app 的图标名是 web 用的 lucide 图标，换成相近的 Material 图标
private fun externalIcon(name: String): ImageVector = when (name) {
    "globe" -> Icons.Outlined.Language
    "puzzle" -> Icons.Outlined.Extension
    "swords" -> Icons.Outlined.SportsKabaddi
    "gamepad-2" -> Icons.Outlined.SportsEsports
    "book-open" -> Icons.AutoMirrored.Outlined.MenuBook
    "newspaper" -> Icons.Outlined.Newspaper
    "graduation-cap" -> Icons.Outlined.School
    "briefcase" -> Icons.Outlined.Work
    "chart-line" -> Icons.AutoMirrored.Outlined.ShowChart
    "wallet" -> Icons.Outlined.AccountBalanceWallet
    "calculator" -> Icons.Outlined.Calculate
    "shopping-cart" -> Icons.Outlined.ShoppingCart
    "mail" -> Icons.Outlined.Mail
    "message-circle" -> Icons.Outlined.ChatBubbleOutline
    "camera" -> Icons.Outlined.PhotoCamera
    "image" -> Icons.Outlined.Image
    "film" -> Icons.Outlined.Movie
    "music" -> Icons.Outlined.MusicNote
    "code" -> Icons.Outlined.Code
    "terminal" -> Icons.Outlined.Terminal
    "database" -> Icons.Outlined.Storage
    "cloud" -> Icons.Outlined.Cloud
    "lock" -> Icons.Outlined.Lock
    "house" -> Icons.Outlined.Home
    "map" -> Icons.Outlined.Map
    "plane" -> Icons.Outlined.Flight
    "utensils" -> Icons.Outlined.Restaurant
    "dumbbell" -> Icons.Outlined.FitnessCenter
    "leaf" -> Icons.Outlined.Eco
    "heart" -> Icons.Outlined.FavoriteBorder
    "star" -> Icons.Outlined.StarOutline
    else -> Icons.Outlined.Apps
}

// 网页：外部 app 和嵌入模式的浏览器都用应用内的 WebView，和原生网络层共用 cookie
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebPage(url: String, modifier: Modifier = Modifier, onState: (title: String, url: String) -> Unit = { _, _ -> }, onView: (WebView) -> Unit = {}) {
    var progress by remember { mutableIntStateOf(0) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    BackHandler(enabled = webView?.canGoBack() == true) { webView?.goBack() }
    Box(modifier) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    webViewClient = object : WebViewClient() {
                        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) = onState(view.title ?: "", url)
                        override fun onPageFinished(view: WebView, url: String) = onState(view.title ?: "", url)
                    }
                    webChromeClient = object : WebChromeClient() {
                        override fun onProgressChanged(view: WebView, newProgress: Int) {
                            progress = newProgress
                        }
                    }
                    loadUrl(url)
                    webView = this
                    onView(this)
                }
            },
        )
        if (progress in 1..99) LinearProgressIndicator(progress = { progress / 100f }, modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter))
    }
}

@Composable
fun WebAppScreen(name: String, url: String) {
    val uriHandler = LocalUriHandler.current
    var view by remember { mutableStateOf<WebView?>(null) }
    Scaffold(
        topBar = {
            BackBar(name) {
                IconButton(onClick = { view?.reload() }) { Icon(Icons.Outlined.Refresh, "刷新") }
                IconButton(onClick = { uriHandler.openUri(view?.url ?: url) }) { Icon(Icons.AutoMirrored.Outlined.OpenInNew, "在浏览器中打开") }
            }
        },
    ) { padding -> WebPage(url, Modifier.fillMaxSize().padding(padding), onView = { view = it }) }
}

// 月历：周一开头，今天高亮；左右翻月
@Composable
fun CalendarScreen() {
    var month by remember { mutableStateOf(YearMonth.now()) }
    val today = LocalDate.now()
    Scaffold(
        topBar = {
            BackBar("日历") {
                TextButton(onClick = { month = YearMonth.now() }) { Text("今天") }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { month = month.minusMonths(1) }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "上个月") }
                Text("${month.year} 年 ${month.monthValue} 月", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
                IconButton(onClick = { month = month.plusMonths(1) }) { Icon(Icons.AutoMirrored.Outlined.ArrowForward, "下个月") }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                DayOfWeek.entries.forEach { day ->
                    Text(day.getDisplayName(TextStyle.SHORT, Locale.CHINA).removePrefix("周"), Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            val first = month.atDay(1)
            val start = first.minusDays((first.dayOfWeek.value - 1).toLong())
            for (week in 0 until 6) {
                Row(Modifier.fillMaxWidth()) {
                    for (dayIndex in 0 until 7) {
                        val date = start.plusDays((week * 7 + dayIndex).toLong())
                        val isToday = date == today
                        Box(Modifier.weight(1f).aspectRatio(1f).padding(4.dp), contentAlignment = Alignment.Center) {
                            Surface(
                                shape = CircleShape,
                                color = if (isToday) MaterialTheme.colorScheme.primary else androidx.compose.ui.graphics.Color.Transparent,
                                modifier = Modifier.fillMaxSize(),
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        date.dayOfMonth.toString(),
                                        style = MaterialTheme.typography.bodyLarge,
                                        fontWeight = if (isToday) FontWeight.Bold else null,
                                        color = when {
                                            isToday -> MaterialTheme.colorScheme.onPrimary
                                            date.month != month.month -> MaterialTheme.colorScheme.outline
                                            date.dayOfWeek.value >= 6 -> MaterialTheme.colorScheme.primary
                                            else -> MaterialTheme.colorScheme.onSurface
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// 连接的 binOS、版本，换一个 binOS
@Composable
fun SettingsScreen() {
    val url by app.server.url.collectAsStateWithLifecycle()
    val version by app.events.version.collectAsStateWithLifecycle()
    val connected by app.events.connected.collectAsStateWithLifecycle()
    var confirm by remember { mutableStateOf(false) }
    Scaffold(topBar = { BackBar("设置") }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item { ListItem(headlineContent = { Text("连接的 binOS") }, supportingContent = { Text(url?.toString() ?: "") }) }
            item { ListItem(headlineContent = { Text("连接状态") }, supportingContent = { Text(if (connected) "已连接" else "正在重连") }) }
            item { ListItem(headlineContent = { Text("后端版本") }, supportingContent = { Text(version ?: "—") }) }
            item { ListItem(headlineContent = { Text("应用版本") }, supportingContent = { Text("${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）") }) }
            item { HorizontalDivider() }
            item {
                ListItem(
                    modifier = Modifier.clickable { confirm = true },
                    leadingContent = { Icon(Icons.AutoMirrored.Outlined.Logout, null, tint = MaterialTheme.colorScheme.error) },
                    headlineContent = { Text("换一个 binOS", color = MaterialTheme.colorScheme.error) },
                    supportingContent = { Text("断开后回到连接页面，登录状态保留") },
                )
            }
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("断开连接？") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    app.events.stop()
                    app.server.disconnect()
                }) { Text("断开") }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("取消") } },
        )
    }
}
