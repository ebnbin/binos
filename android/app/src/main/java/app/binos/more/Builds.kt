@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package app.binos.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.binos.app
import app.binos.code.encode
import app.binos.code.parseTime
import app.binos.net.LossyList
import app.binos.net.StreamSignal
import app.binos.net.eventStream
import app.binos.net.json
import app.binos.shell.BuildLogRoute
import app.binos.shell.LocalNav
import app.binos.ui.codeStyle
import app.binos.ui.download
import app.binos.ui.formatBytes
import app.binos.ui.formatDuration
import app.binos.ui.formatFull
import app.binos.ui.rememberNow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.transformWhile
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

// 和 server/src/apps/builds/types.ts 对应。产物在服务端是 install 和 link 的联合类型，这里合成一个类

@Serializable
data class Artifact(
    val name: String,
    val kind: String = "",
    val platform: String = "",
    val size: Long = 0,
    val sha256: String = "",
    val url: String = "",
)

@Serializable
data class Build(
    val id: String,
    val commit: String,
    val target: String,
    val trigger: String = "manual",
    val pr: Int? = null,
    val status: String,
    val createdAt: String = "",
    val startedAt: String? = null,
    val endedAt: String? = null,
    val error: String? = null,
    @Serializable(LossyList::class) val artifacts: List<Artifact> = emptyList(),
)

@Serializable
data class BuildSettings(val automatic: Boolean = false)

@Serializable
data class OpenPr(val number: Int, val title: String = "")

@Serializable
data class BuildsSnapshot(
    @Serializable(LossyList::class) val builds: List<Build> = emptyList(),
    val settings: BuildSettings = BuildSettings(),
    val pollError: String? = null,
    val checkedAt: String? = null,
    @Serializable(LossyList::class) val prs: List<OpenPr>? = null,
    val mode: String = "real",
)

private const val base = "/api/apps/builds"
private val targetLabels = mapOf("web" to "Web", "android" to "Android", "ios" to "iOS")
private val statusLabels = mapOf("queued" to "排队中", "running" to "构建中", "success" to "成功", "failed" to "失败", "cancelled" to "已取消", "interrupted" to "已中断")
private fun live(status: String) = status == "queued" || status == "running"

enum class BuildState(val label: String) { Running("构建中"), Failed("构建失败"), Success("构建成功") }

// 一组构建合起来的状态：还有没编完的算构建中，有失败或中断的算失败；只有取消的不算
fun buildState(builds: List<Build>): BuildState? = when {
    builds.any { live(it.status) } -> BuildState.Running
    builds.any { it.status == "failed" || it.status == "interrupted" } -> BuildState.Failed
    builds.any { it.status == "success" } -> BuildState.Success
    else -> null
}

// 这个 PR 最新提交的构建，包括手动指定 pr/编号 的
fun prBuilds(builds: List<Build>, pr: Int): List<Build> {
    val commit = builds.firstOrNull { it.pr == pr }?.commit
    return builds.filter { it.pr == pr && it.commit == commit }
}

// 构建入口的概况：有在编的显示个数；否则显示最近编完的那个提交的结果
fun buildsSummary(builds: List<Build>): Pair<String, BuildState>? {
    val running = builds.count { it.status == "running" }
    val queued = builds.count { it.status == "queued" }
    if (running > 0 || queued > 0) {
        return listOfNotNull(running.takeIf { it > 0 }?.let { "$it 个构建中" }, queued.takeIf { it > 0 }?.let { "$it 个排队" }).joinToString(" · ") to BuildState.Running
    }
    val last = builds.filter { it.endedAt != null && it.status != "cancelled" }.maxByOrNull { it.endedAt!! } ?: return null
    val state = buildState(builds.filter { it.commit == last.commit && it.trigger == last.trigger && it.pr == last.pr }) ?: return null
    val source = if (last.trigger == "main") "main" else last.pr?.let { "PR #$it" } ?: "手动"
    return "$source ${if (state == BuildState.Failed) "构建失败" else "构建成功"}" to state
}

data class BuildGroup(val key: String, val kind: String, val pr: Int?, val commits: List<List<Build>>)

// 按来源分组：main、每个 PR（包括手动指定 pr/编号 的）、其余手动构建；组内按提交分，最新的在前
fun groupBuilds(builds: List<Build>): List<BuildGroup> {
    val groups = LinkedHashMap<String, Pair<BuildGroup, LinkedHashMap<String, MutableList<Build>>>>()
    for (build in builds) {
        val kind = if (build.trigger == "main") "main" else if (build.pr != null) "pr" else "manual"
        val key = if (kind == "pr") "pr-${build.pr}" else kind
        val (_, commits) = groups.getOrPut(key) { BuildGroup(key, kind, build.pr, emptyList()) to LinkedHashMap() }
        commits.getOrPut(build.commit) { mutableListOf() } += build
    }
    return groups.values.map { (group, commits) -> group.copy(commits = commits.values.toList()) }
}

// 预览链接指向 PR 当前的预览，只在开着的 PR 最新一次成功的 Web 构建上显示
fun livePreviews(snapshot: BuildsSnapshot): Set<String> = snapshot.prs.orEmpty().mapNotNullTo(HashSet()) { pr ->
    snapshot.builds.firstOrNull { it.target == "web" && it.pr == pr.number && it.status == "success" }?.id
}

// 构建状态变化时后端发 builds 通知；重新连上和回到前台时也重读，补上可能漏掉的通知。
// 操作的结果直接替换快照，在这之前发出、之后才返回的读取不再采用
@Stable
class BuildsData {
    var snapshot by mutableStateOf<BuildsSnapshot?>(null)
        private set
    var error by mutableStateOf<String?>(null)
    private var version = 0

    suspend fun load() {
        val current = ++version
        try {
            val result = app.api.get<BuildsSnapshot>(base)
            if (version == current) {
                snapshot = result
                error = null
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (version == current) error = e.message
        }
    }

    fun update(result: BuildsSnapshot) {
        version++
        snapshot = result
        error = null
    }
}

@Composable
fun rememberBuilds(enabled: Boolean = true): BuildsData {
    val data = remember { BuildsData() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(enabled) {
        if (!enabled) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            app.events.of("builds").onStart { emit(null) }.collectLatest { data.load() }
        }
    }
    return data
}

@Composable
fun buildStateColor(state: BuildState): Color = when (state) {
    BuildState.Running -> MaterialTheme.colorScheme.primary
    BuildState.Failed -> MaterialTheme.colorScheme.error
    BuildState.Success -> MaterialTheme.colorScheme.onSurfaceVariant
}

// binOS 自己的 Web、Android、iOS 构建：按来源分组的列表、手动构建、日志和产物。Android 的 APK 下载后安装，iOS 的 IPA 只能在 iPhone 上装
@Composable
fun BuildsScreen(initialRef: String = "main") {
    val builds = rememberBuilds()
    val data = builds.snapshot
    var busy by remember { mutableStateOf(false) }
    var ref by rememberSaveable { mutableStateOf(initialRef) }
    var targets by rememberSaveable { mutableStateOf(setOf("android", "ios")) }
    var filter by rememberSaveable { mutableStateOf(if (initialRef.startsWith("pr/")) "pr" else "all") }
    var expanded by rememberSaveable { mutableStateOf(setOf<String>()) }
    val scope = rememberCoroutineScope()
    val now = rememberNow(active = data?.builds.orEmpty().any { it.status == "running" }, intervalMs = 1000)
    // 操作都返回最新的快照
    fun act(operation: suspend () -> JsonElement) {
        busy = true
        scope.launch {
            runCatching { json.decodeFromJsonElement(BuildsSnapshot.serializer(), operation()) }.onSuccess { builds.update(it) }.onFailure { builds.error = it.message }
            busy = false
        }
    }
    Scaffold(
        topBar = {
            BackBar("构建") {
                IconButton(onClick = { act { app.api.postJson("$base/poll") } }, enabled = !busy) { Icon(Icons.Outlined.Sync, "检查更新") }
            }
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (data?.mode == "mock") item { Text("预览模式：模拟构建，与正式构建及签名隔离。", color = MaterialTheme.colorScheme.tertiary) }
            builds.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
            data?.pollError?.let { item { Text("检查仓库失败：$it", color = MaterialTheme.colorScheme.error) } }
            data?.let { snapshot ->
                item {
                    Column {
                        ListItem(headlineContent = { Text("自动构建 main 和 PR") }, trailingContent = {
                            Switch(snapshot.settings.automatic, enabled = !busy, onCheckedChange = { act { app.api.putJson("$base/settings", buildJsonObject { put("automatic", it) }) } })
                        })
                        snapshot.checkedAt?.let { Text("上次检查：${formatFull(parseTime(it))}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp)) }
                    }
                }
            }
            item {
                ElevatedCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("手动构建", style = MaterialTheme.typography.titleMedium)
                        OutlinedTextField(ref, { ref = it }, label = { Text("构建来源") }, placeholder = { Text("main、pr/编号、完整提交号") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            targetLabels.forEach { (target, label) ->
                                FilterChip(target in targets, onClick = { targets = if (target in targets) targets - target else targets + target }, label = { Text(label) })
                            }
                        }
                        if ("web" in targets) Text("Web 只构建 PR 的提交，来源请写 pr/编号", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Button(
                            onClick = {
                                act {
                                    app.api.postJson(base, buildJsonObject {
                                        put("ref", ref.trim())
                                        putJsonArray("targets") { targetLabels.keys.filter { it in targets }.forEach { add(it) } }
                                    })
                                }
                            },
                            enabled = !busy && data != null && ref.isNotBlank() && targets.isNotEmpty(),
                        ) { Text("开始构建") }
                    }
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("all" to "全部", "main" to "main", "pr" to "PR", "manual" to "手动").forEach { (key, label) ->
                        FilterChip(filter == key, onClick = { filter = key }, label = { Text(label) })
                    }
                }
            }
            if (data == null) {
                item { CircularProgressIndicator() }
                return@LazyColumn
            }
            if (data.builds.isEmpty()) item { Text("暂无构建。提交包含构建脚本后将自动构建，也可以手动指定来源。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            val previews = livePreviews(data)
            for (group in groupBuilds(data.builds).filter { filter == "all" || it.kind == filter }) {
                val title = data.prs?.find { it.number == group.pr }?.title
                val closed = group.pr != null && data.prs != null && title == null
                item(key = "group-${group.key}") {
                    Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            when (group.kind) {
                                "main" -> "main"
                                "manual" -> "手动"
                                else -> listOfNotNull("PR #${group.pr}", title?.takeIf { it.isNotEmpty() }).joinToString(" ")
                            },
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (closed) Text("已合并或关闭", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                val latest = group.commits.first()
                val older = group.commits.drop(1)
                items(latest, key = { it.id }) { BuildCard(it, it.id in previews, busy, now, ::act) }
                if (older.isNotEmpty()) {
                    val open = group.key in expanded
                    item(key = "older-${group.key}") {
                        TextButton(onClick = { expanded = if (open) expanded - group.key else expanded + group.key }) {
                            Text(if (open) "收起更早的提交" else "更早的 ${older.size} 个提交")
                        }
                    }
                    if (open) items(older.flatten(), key = { it.id }) { BuildCard(it, it.id in previews, busy, now, ::act) }
                }
            }
        }
    }
}

@Composable
private fun BuildCard(build: Build, preview: Boolean, busy: Boolean, now: Long, act: (suspend () -> JsonElement) -> Unit) {
    val nav = LocalNav.current
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(targetLabels[build.target] ?: build.target, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(
                    statusLabels[build.status] ?: build.status,
                    color = when (build.status) {
                        "success" -> MaterialTheme.colorScheme.primary
                        "failed", "interrupted" -> MaterialTheme.colorScheme.error
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.weight(1f),
                )
                Text(build.commit.take(7), style = codeStyle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (build.trigger == "manual" && build.pr != null) Text("手动", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val meta = listOfNotNull(
                build.createdAt.takeIf { it.isNotEmpty() }?.let { formatFull(parseTime(it)) },
                build.startedAt?.let { "用时 ${formatDuration((build.endedAt?.let(::parseTime) ?: now) - parseTime(it))}" },
                *build.artifacts.mapNotNull { artifact ->
                    when (artifact.kind) {
                        "link" -> artifact.url.toHttpUrlOrNull()?.host
                        "install" -> "${artifact.name} · ${formatBytes(artifact.size)}"
                        else -> null
                    }
                }.toTypedArray(),
            ).joinToString(" · ")
            if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            build.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.Center) {
                TextButton(onClick = { nav.navigate(BuildLogRoute(build.id)) }) { Text("查看日志") }
                if (live(build.status)) {
                    TextButton(onClick = { act { app.api.postJson("$base/${encode(build.id)}/cancel") } }, enabled = !busy) { Text("取消") }
                } else {
                    TextButton(onClick = { act { app.api.postJson("$base/${encode(build.id)}/retry") } }, enabled = !busy) { Text("重新构建") }
                }
                // Web 打开预览；Android 下载 APK，下载完在通知栏里点开安装；iOS 的 IPA 装不到这台设备上，只显示信息
                build.artifacts.forEach { artifact ->
                    when {
                        artifact.kind == "link" && preview -> FilledTonalButton(onClick = { uriHandler.openUri(artifact.url) }) {
                            Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.padding(end = 6.dp))
                            Text("打开预览")
                        }
                        artifact.kind == "install" && artifact.platform == "android" -> FilledTonalButton(onClick = {
                            download(context, app.api.url("$base/${build.id}/artifacts/${encode(artifact.name)}").toString(), artifact.name)
                        }) {
                            Icon(Icons.Outlined.Download, null, Modifier.padding(end = 6.dp))
                            Text("下载")
                        }
                    }
                }
            }
        }
    }
}

@Serializable
private data class BuildLogMessage(val type: String, val offset: Long = 0, val text: String = "")

// 构建日志的末尾，随日志流接着显示新写的部分，断线后从读到的位置接着读；构建结束、读完了流就结束。新内容出现时滚到底部
@Composable
fun BuildLogScreen(id: String) {
    val context = LocalContext.current
    val builds = rememberBuilds()
    val build = builds.snapshot?.builds?.find { it.id == id }
    var text by remember { mutableStateOf("读取日志…") }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(id) {
        // 读到的字节位置，断线重连时从这里接着读
        var position: String? = null
        var received = false
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            app.api.eventStream {
                app.api.url("$base/${encode(id)}/log/stream").newBuilder().apply { position?.let { addQueryParameter("from", it) } }.build().toString()
            }.transformWhile { signal ->
                val message = (signal as? StreamSignal.Message)?.message?.takeIf { it.event == null }
                    ?.let { runCatching { json.decodeFromString<BuildLogMessage>(it.data) }.getOrNull() to it.id }
                if (message != null) emit(message)
                message?.first?.type != "end"
            }.collect { (message, sseId) ->
                if (message?.type != "log") return@collect
                text = (if (received) text else if (message.offset > 0) "[仅显示日志末尾]\n" else "") + message.text
                received = true
                sseId?.let { position = it }
            }
            if (!received) text = "还没有日志"
        }
    }
    val lines = remember(text) { text.lines() }
    val list = rememberLazyListState()
    LaunchedEffect(lines.size) { if (lines.isNotEmpty()) list.scrollToItem(lines.size - 1) }
    Scaffold(
        topBar = {
            BackBar(build?.let { "${targetLabels[it.target] ?: it.target} · ${it.commit.take(7)}" } ?: "构建日志") {
                IconButton(onClick = { download(context, app.api.url("$base/${encode(id)}/log").toString(), "build-$id.log") }) { Icon(Icons.Outlined.Download, "下载完整日志") }
            }
        },
    ) { padding ->
        SelectionContainer(Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp)) {
                items(lines.size) { index -> Text(lines[index], style = codeStyle.copy(fontFamily = FontFamily.Monospace)) }
            }
        }
    }
}
