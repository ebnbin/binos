@file:OptIn(ExperimentalMaterial3Api::class)

package app.binos.kita

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.AddComment
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Pets
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import app.binos.code.CodeStore
import app.binos.code.ThreadCache
import app.binos.code.Transcript
import app.binos.code.agentName
import app.binos.code.defaultAgent
import app.binos.code.isImage
import app.binos.code.parseTime
import app.binos.shell.FilePreviewRoute
import app.binos.shell.KitaChatRoute
import app.binos.shell.KitaMemoriesRoute
import app.binos.shell.KitaProfileRoute
import app.binos.shell.LocalNav
import app.binos.ui.ImageViewer
import app.binos.ui.formatTime
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch

// 和 web/src/apps/kita 对应：首页是喜多的状态和对话列表，带身份的对话、临时对话、记忆和喜多的资料各一页

// 头像是用户选的喜多的照片；还没有照片时只显示猫的图标，不另画一个形象。busy：喜多在某个 app 里回答
@Composable
fun KitaAvatar(profile: Profile?, size: Dp, busy: Boolean = false) {
    val ring = if (busy) Modifier.border(BorderStroke(2.dp, MaterialTheme.colorScheme.primary), CircleShape).padding(3.dp) else Modifier
    Box(ring) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.size(size)) {
            val avatar = profile?.avatar
            if (avatar != null) {
                AsyncImage(KitaStore.photoUrl(avatar), "喜多", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            } else {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Pets, "喜多", Modifier.size(size * 0.55f), tint = MaterialTheme.colorScheme.onSecondaryContainer) }
            }
        }
    }
}

@Composable
fun KitaScreen() {
    val nav = LocalNav.current
    val conversations by KitaStore.conversations.collectAsStateWithLifecycle()
    val profile by KitaStore.profile.collectAsStateWithLifecycle()
    val memories by KitaStore.memories.collectAsStateWithLifecycle()
    val activity by KitaStore.activity.collectAsStateWithLifecycle()
    val failed by KitaStore.failed.collectAsStateWithLifecycle()
    val status = kitaStatus(activity)
    var deleting by remember { mutableStateOf<Conversation?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { KitaStore.refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("喜多") },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "identity") {
                ListItem(
                    leadingContent = { KitaAvatar(profile, 48.dp, status.busy) },
                    headlineContent = { Text("喜多", style = MaterialTheme.typography.titleMedium) },
                    supportingContent = { Text(status.label) },
                    modifier = Modifier.clickable { nav.navigate(KitaProfileRoute) },
                )
            }
            item(key = "actions") {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip(onClick = { nav.navigate(KitaChatRoute()) }, label = { Text("新对话") }, leadingIcon = { Icon(Icons.Outlined.AddComment, null, Modifier.size(18.dp)) })
                    AssistChip(onClick = { nav.navigate(KitaChatRoute(temporary = true)) }, label = { Text("临时对话") }, leadingIcon = { Icon(Icons.Outlined.VisibilityOff, null, Modifier.size(18.dp)) })
                    AssistChip(
                        onClick = { nav.navigate(KitaMemoriesRoute) },
                        label = { Text("记忆" + (memories?.size?.takeIf { it > 0 }?.let { " $it" } ?: "")) },
                        leadingIcon = { Icon(Icons.Outlined.Psychology, null, Modifier.size(18.dp)) },
                    )
                }
            }
            notice?.let { item(key = "notice") { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) } }
            item(key = "label") {
                Text("对话", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp))
            }
            when {
                conversations == null -> item(key = "loading") {
                    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                        if (failed) Text("读取失败", color = MaterialTheme.colorScheme.error) else CircularProgressIndicator()
                    }
                }
                conversations!!.isEmpty() -> item(key = "empty") { Text("还没有对话", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp)) }
                else -> items(conversations!!, key = { it.id }) { item ->
                    ListItem(
                        leadingContent = if (item.temporary) ({ Icon(Icons.Outlined.VisibilityOff, "临时对话", Modifier.size(18.dp)) }) else null,
                        headlineContent = { Text(item.title.ifEmpty { "对话" }, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = {
                            Text(
                                listOfNotNull(agentName(item.agent), when (item.outcome) { "stopped" -> "已停止"; "error" -> "出错了"; else -> null }).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        },
                        trailingContent = {
                            if (item.state != "idle") {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            } else {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(formatTime(parseTime(item.updatedAt)), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    IconButton(onClick = { deleting = item }) { Icon(Icons.Outlined.Delete, "删除对话") }
                                }
                            }
                        },
                        modifier = Modifier.clickable { nav.navigate(KitaChatRoute(item.id)) },
                    )
                }
            }
        }
    }
    deleting?.let { item ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除对话") },
            text = { Text("「${item.title.ifEmpty { "对话" }}」的记录和工作目录会一起删掉。") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    scope.launch { runCatching { KitaStore.delete(item.id) }.onFailure { notice = it.message } }
                }) { Text("删除") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } },
        )
    }
}

// id 为空是新对话，第一句发出后换成它的 id；temporary 只对新对话有意义
@Composable
fun KitaChatScreen(routeId: String?, temporary: Boolean) {
    val nav = LocalNav.current
    val conversations by KitaStore.conversations.collectAsStateWithLifecycle()
    val profile by KitaStore.profile.collectAsStateWithLifecycle()
    val memories by KitaStore.memories.collectAsStateWithLifecycle()
    val catalogs by CodeStore.catalogs.collectAsStateWithLifecycle()
    // 刚建好的对话可能还没出现在列表里，不能当成不存在
    var id by rememberSaveable { mutableStateOf(routeId) }
    var created by rememberSaveable { mutableStateOf<String?>(null) }
    val conversation = conversations?.find { it.id == id }
    val missing = id != null && conversations != null && conversation == null && id != created
    val isTemporary = conversation?.temporary ?: temporary
    val state = remember(id) { id?.let(ThreadCache::get) }
    val running = state?.live != null
    var input by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var stickRequests by remember { mutableIntStateOf(0) }
    var agent by rememberSaveable { mutableStateOf(defaultAgent) }
    var viewing by remember { mutableStateOf<Pair<String, String>?>(null) }
    var deleting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(state) {
        if (state != null) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { state.follow() }
    }
    val title = when {
        id == null -> if (temporary) "临时对话" else "新对话"
        missing -> "对话不存在"
        else -> conversation?.title?.ifEmpty { "对话" } ?: ""
    }

    fun send() {
        val text = input.trim()
        if (text.isEmpty() || sending) return
        sending = true
        notice = null
        stickRequests++
        scope.launch {
            try {
                val current = id
                if (current == null) {
                    val newId = KitaStore.start(text, temporary, agent)
                    created = newId
                    id = newId
                } else {
                    KitaStore.send(current, text)
                }
                input = ""
            } catch (error: Exception) {
                notice = error.message ?: "发送失败，请重试"
            } finally {
                sending = false
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
                actions = {
                    if (conversation != null && conversation.state == "idle" && !running) {
                        IconButton(onClick = { deleting = true }) { Icon(Icons.Outlined.Delete, "删除对话") }
                    }
                },
            )
        },
        bottomBar = {
            if (!missing) {
                Surface(tonalElevation = 3.dp) {
                    Column(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TextField(
                                value = input,
                                onValueChange = { input = it },
                                readOnly = sending,
                                placeholder = { Text(if (running) "补充或纠正" else "输入消息") },
                                maxLines = 6,
                                modifier = Modifier.weight(1f),
                            )
                            Spacer(Modifier.width(8.dp))
                            when {
                                sending -> Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) }
                                running && input.isBlank() -> FilledIconButton(onClick = { id?.let { scope.launch { runCatching { KitaStore.stop(it) } } } }) { Icon(Icons.Outlined.Stop, "停止") }
                                else -> FilledIconButton(onClick = ::send, enabled = input.isNotBlank()) { Icon(Icons.AutoMirrored.Outlined.Send, "发送") }
                            }
                        }
                        Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (id == null) {
                                // 新对话能选能用的 agent，已有的对话沿用它的
                                val choosable = catalogs.filter { it.available || it.agent == agent }.map { it.agent }.ifEmpty { listOf(agent) }
                                AgentPicker(agent, choosable) { agent = it }
                            } else {
                                conversation?.let { Text(agentName(it.agent), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            Spacer(Modifier.width(12.dp))
                            Text(
                                if (isTemporary) "不带记忆" else "${memories?.count { it.scope == "personal" } ?: 0} 条记忆",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
            when {
                missing -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("这个对话不存在", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { nav.navigate(KitaChatRoute()) { popUpTo<KitaChatRoute> { inclusive = true } } }) { Text("开始新对话") }
                }
                state == null -> Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (isTemporary) {
                        Icon(Icons.Outlined.VisibilityOff, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.size(12.dp))
                        Text("临时对话", style = MaterialTheme.typography.headlineSmall)
                        Text("不带喜多的身份，不读也不写记忆", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        KitaAvatar(profile, 88.dp)
                        Spacer(Modifier.size(12.dp))
                        Text("喜多", style = MaterialTheme.typography.headlineSmall)
                    }
                    notice?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) }
                }
                !state.loaded && state.items.isEmpty() -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                else -> Transcript(state, notice, stickRequests, null) { url, name -> if (isImage(name)) viewing = url to name else nav.navigate(FilePreviewRoute(url, name)) }
            }
        }
    }
    viewing?.let { (url, name) -> ImageViewer(url, name) { viewing = null } }
    if (deleting && conversation != null) {
        AlertDialog(
            onDismissRequest = { deleting = false },
            title = { Text("删除对话") },
            text = { Text("这个对话的记录和工作目录会一起删掉。") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = false
                    scope.launch {
                        runCatching { KitaStore.delete(conversation.id) }.onSuccess { nav.popBackStack() }.onFailure { notice = it.message }
                    }
                }) { Text("删除") }
            },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun AgentPicker(agent: String, options: List<String>, onPick: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded, onExpandedChange = { expanded = it }) {
        TextButton(onClick = {}, modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable)) {
            Text(agentName(agent))
            ExposedDropdownMenuDefaults.TrailingIcon(expanded)
        }
        ExposedDropdownMenu(expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(text = { Text(agentName(option)) }, onClick = {
                    onPick(option)
                    expanded = false
                })
            }
        }
    }
}

@Composable
fun KitaPhoto(file: String, modifier: Modifier = Modifier) {
    AsyncImage(KitaStore.photoUrl(file), "喜多的照片", contentScale = ContentScale.Crop, modifier = modifier.clip(MaterialTheme.shapes.medium))
}

@Composable
internal fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
}

@Composable
internal fun Separator() = HorizontalDivider(Modifier.padding(vertical = 4.dp))

@Composable
internal fun Placeholder(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
}

@Composable
internal fun DescriptionField(value: String, onChange: (String) -> Unit) {
    OutlinedTextField(value, onChange, label = { Text("喜多的描述") }, minLines = 6, modifier = Modifier.fillMaxWidth())
}
