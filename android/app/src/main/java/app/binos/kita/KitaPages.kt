@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package app.binos.kita

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.History
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.binos.code.parseTime
import app.binos.more.AppsStore
import app.binos.more.appName
import app.binos.shell.KitaChatRoute
import app.binos.shell.LocalNav
import app.binos.ui.formatDivider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

// 改动后马上重新读取，不等通知；失败时把原因留在页面上
private fun CoroutineScope.act(onError: (String) -> Unit, block: suspend () -> Unit) = launch {
    runCatching { block() }.onSuccess { KitaStore.refresh() }.onFailure { onError(it.message ?: "操作失败，请重试") }
}

@Composable
private fun PageBar(title: String) {
    val nav = LocalNav.current
    TopAppBar(
        title = { Text(title) },
        navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
    )
}

// 长期记忆：推测的待确认，用户说过或确认过的已确认
@Composable
fun KitaMemoriesScreen() {
    val memories by KitaStore.memories.collectAsStateWithLifecycle()
    val conversations by KitaStore.conversations.collectAsStateWithLifecycle()
    var draft by rememberSaveable { mutableStateOf("") }
    var notice by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val inferred = memories.orEmpty().filter { it.kind == "inferred" }
    val stated = memories.orEmpty().filter { it.kind == "stated" }
    Scaffold(topBar = { PageBar("记忆") }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).imePadding(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item(key = "add") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(draft, { draft = it }, label = { Text("添加记忆") }, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = {
                        val text = draft.trim()
                        scope.act({ notice = it }) {
                            KitaStore.addMemory(text)
                            draft = ""
                            notice = null
                        }
                    }, enabled = draft.isNotBlank()) { Text("添加") }
                }
            }
            notice?.let { item(key = "notice") { Text(it, color = MaterialTheme.colorScheme.error) } }
            if (inferred.isNotEmpty()) {
                item(key = "inferred") { SectionTitle("待确认") }
                items(inferred, key = { it.id }) { MemoryItem(it, conversations) { error -> notice = error } }
            }
            item(key = "stated") { SectionTitle("已确认") }
            when {
                memories == null -> Unit
                stated.isEmpty() -> item(key = "none") { Placeholder("无") }
                else -> items(stated, key = { it.id }) { MemoryItem(it, conversations) { error -> notice = error } }
            }
        }
    }
}

private fun kindName(kind: String) = if (kind == "inferred") "推测" else "已确认"

@Composable
private fun MemoryItem(memory: Memory, conversations: List<Conversation>?, onError: (String) -> Unit) {
    val apps by AppsStore.apps.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var editing by rememberSaveable(memory.id) { mutableStateOf<String?>(null) }
    var history by rememberSaveable(memory.id) { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 4.dp)) {
            val text = editing
            if (text == null) {
                Text(memory.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(end = 12.dp))
            } else {
                OutlinedTextField(text, { editing = it }, label = { Text("记忆的内容") }, modifier = Modifier.fillMaxWidth().padding(end = 12.dp))
                Row(Modifier.fillMaxWidth().padding(end = 8.dp), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { editing = null }) { Text("取消") }
                    TextButton(onClick = {
                        val value = text.trim()
                        if (value == memory.text) editing = null else scope.act(onError) {
                            KitaStore.updateMemory(memory.id, text = value)
                            editing = null
                        }
                    }, enabled = text.isNotBlank()) { Text("保存") }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    SourceText(memory.source, conversations)
                    Text(
                        listOfNotNull(formatDivider(parseTime(memory.updatedAt)), memory.scope.takeIf { it != "personal" }?.let { appName(apps, it) }).joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (memory.kind == "inferred") IconButton(onClick = { scope.act(onError) { KitaStore.updateMemory(memory.id, kind = "stated") } }) { Icon(Icons.Outlined.Check, "确认") }
                if (memory.history.isNotEmpty()) {
                    IconButton(onClick = { history = !history }) { Icon(Icons.Outlined.History, "历史版本") }
                    IconButton(onClick = { scope.act(onError) { KitaStore.revertMemory(memory.id) } }) { Icon(Icons.AutoMirrored.Outlined.Undo, "恢复上一版") }
                }
                if (editing == null) IconButton(onClick = { editing = memory.text }) { Icon(Icons.Outlined.Edit, "修改") }
                IconButton(onClick = { deleting = true }) { Icon(Icons.Outlined.Delete, "删除") }
            }
            if (history) {
                Separator()
                // 从新到旧：最上面是恢复时会换回来的那一版
                memory.history.asReversed().forEach { version ->
                    Column(Modifier.padding(end = 12.dp, top = 4.dp, bottom = 8.dp)) {
                        Text(version.text, style = MaterialTheme.typography.bodyMedium)
                        Row {
                            SourceText(version.source, conversations)
                            Text(
                                " · ${kindName(version.kind)} · ${formatDivider(parseTime(version.time))}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
    if (deleting) {
        AlertDialog(
            onDismissRequest = { deleting = false },
            title = { Text("删除这条记忆") },
            text = { Text(memory.text, maxLines = 4, overflow = TextOverflow.Ellipsis) },
            confirmButton = {
                TextButton(onClick = {
                    deleting = false
                    scope.act(onError) { KitaStore.removeMemory(memory.id) }
                }) { Text("删除") }
            },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text("取消") } },
        )
    }
}

// 谁写的：手动添加，喜多的某个对话（点开它），或者别的 app
@Composable
private fun SourceText(source: MemorySource, conversations: List<Conversation>?) {
    val nav = LocalNav.current
    val style = MaterialTheme.typography.labelSmall
    if (source.type == "user") {
        Text("手动添加", style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val conversation = if (source.owner == "kita") conversations?.find { it.id == source.session } else null
    if (conversation != null) {
        Text(
            conversation.title.ifEmpty { "对话" },
            style = style,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.clickable { nav.navigate(KitaChatRoute(conversation.id)) },
        )
    } else {
        val apps by AppsStore.apps.collectAsStateWithLifecycle()
        Text(source.owner?.let { appName(apps, it) } ?: "", style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// 喜多的照片、头像和描述：第一张照片自动成为头像，点别的照片换成它
@Composable
fun KitaProfileScreen() {
    val profile by KitaStore.profile.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var description by rememberSaveable { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val text = description ?: profile?.description ?: ""
    val changed = description != null && description != profile?.description
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        uploading = true
        notice = null
        scope.launch {
            for (uri in uris) runCatching { KitaStore.uploadPhoto(context.contentResolver, uri) }.onFailure { notice = it.message }
            KitaStore.refresh()
            uploading = false
        }
    }
    Scaffold(topBar = { PageBar("喜多") }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding).imePadding(), contentPadding = PaddingValues(16.dp)) {
            item(key = "header") {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    KitaAvatar(profile, 96.dp)
                    Spacer(Modifier.size(8.dp))
                    Text("喜多", style = MaterialTheme.typography.headlineSmall)
                }
            }
            notice?.let { item(key = "notice") { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp)) } }
            item(key = "photos") {
                SectionTitle("照片")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    profile?.photos?.forEach { photo ->
                        val current = photo.file == profile?.avatar
                        Box {
                            KitaPhoto(
                                photo.file,
                                Modifier.size(104.dp)
                                    .then(if (current) Modifier.border(BorderStroke(3.dp, MaterialTheme.colorScheme.primary), MaterialTheme.shapes.medium) else Modifier)
                                    .clickable(enabled = !current) { scope.act({ notice = it }) { KitaStore.setAvatar(photo.file) } },
                            )
                            FilledTonalIconButton(onClick = { removing = photo.file }, modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(28.dp)) {
                                Icon(Icons.Outlined.Close, "删除这张照片", Modifier.size(16.dp))
                            }
                            if (current) {
                                Surface(color = MaterialTheme.colorScheme.primary, shape = MaterialTheme.shapes.small, modifier = Modifier.align(Alignment.BottomStart).padding(6.dp)) {
                                    Text("头像", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                                }
                            }
                        }
                    }
                    Surface(
                        shape = MaterialTheme.shapes.medium,
                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                        modifier = Modifier.size(104.dp).clickable(enabled = !uploading) { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    ) {
                        Column(verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            if (uploading) androidx.compose.material3.CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Outlined.AddPhotoAlternate, null)
                            Text(if (uploading) "正在上传" else "添加照片", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
                Text("点照片用作头像", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
            item(key = "description") {
                SectionTitle("描述")
                DescriptionField(text) { description = it }
                Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
                    if (changed) TextButton(onClick = { description = null }) { Text("还原") }
                    Button(onClick = {
                        scope.act({ notice = "保存失败，请重试" }) { KitaStore.saveDescription(text) }
                    }, enabled = changed) { Text("保存") }
                }
            }
        }
    }
    removing?.let { file ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("删除这张照片") },
            text = { KitaPhoto(file, Modifier.size(160.dp)) },
            confirmButton = {
                TextButton(onClick = {
                    removing = null
                    scope.act({ notice = it }) { KitaStore.removePhoto(file) }
                }) { Text("删除") }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("取消") } },
        )
    }
}
