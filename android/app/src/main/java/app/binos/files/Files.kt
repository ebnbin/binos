@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)

package app.binos.files

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.outlined.Audiotrack
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.DriveFileMove
import androidx.compose.material.icons.outlined.DriveFileRenameOutline
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.PictureAsPdf
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Upload
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.binos.app
import app.binos.code.encode
import app.binos.net.LossyList
import app.binos.net.octetType
import app.binos.shell.FilePreviewRoute
import app.binos.shell.FolderRoute
import app.binos.shell.LocalNav
import app.binos.ui.download
import app.binos.ui.formatBytes
import app.binos.ui.formatTime
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source

// 和 server/src/apps/files/api.ts 对应：Mac 上的文件，路径都是绝对路径

@Serializable
data class FileEntry(val name: String, val path: String, val directory: Boolean = false, val symlink: Boolean = false, val size: Long = 0, val modified: Double = 0.0)

@Serializable
data class Listing(val path: String, val parent: String, val home: String, @Serializable(LossyList::class) val entries: List<FileEntry> = emptyList())

private const val base = "/api/apps/files"

fun fileUrl(path: String): String = app.api.url("$base/download?path=${encode(path)}").toString()

private suspend fun operation(action: String, path: String, name: String? = null, destination: String? = null) {
    app.api.postJson("$base/operation", buildJsonObject {
        put("action", action)
        put("path", path)
        name?.let { put("name", it) }
        destination?.let { put("destination", it) }
    })
}

// 预览用的文件类型，和 web/src/services/preview/kind.ts 一致
fun fileKind(name: String): String {
    val ext = name.substringAfterLast('.', "").lowercase()
    return when {
        ext.matches(Regex("png|jpe?g|gif|webp|avif|bmp|svg")) -> "image"
        ext.matches(Regex("mp4|webm|mov|m4v")) -> "video"
        ext.matches(Regex("mp3|wav|ogg|m4a|flac")) -> "audio"
        ext == "html" || ext == "htm" -> "html"
        ext == "pdf" -> "pdf"
        ext == "md" || ext == "markdown" -> "markdown"
        ext.matches(Regex("txt|log|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|cfg|conf|env|js|jsx|ts|tsx|mjs|cjs|mts|cts|css|scss|less|py|rb|rs|go|java|kt|kts|swift|c|cpp|h|hpp|sh|bash|zsh|sql|vue|svelte|tex|r|patch|diff|gradle|properties")) ||
            name.lowercase().matches(Regex("dockerfile|makefile|license|readme|\\.gitignore")) -> "text"
        else -> "binary"
    }
}

private fun iconOf(entry: FileEntry): ImageVector = if (entry.directory) Icons.Outlined.Folder else when (fileKind(entry.name)) {
    "image" -> Icons.Outlined.Image
    "video" -> Icons.Outlined.Movie
    "audio" -> Icons.Outlined.Audiotrack
    "pdf" -> Icons.Outlined.PictureAsPdf
    "markdown" -> Icons.Outlined.Description
    "text", "html" -> Icons.Outlined.Code
    else -> Icons.AutoMirrored.Outlined.InsertDriveFile
}

private enum class Sort(val label: String) { Name("名称"), Modified("修改时间"), Size("大小") }

private var showHidden by mutableStateOf(false)
private var sortBy by mutableStateOf(Sort.Name)

// 剪贴板：复制或移动的源文件，到目标目录里粘贴
private var clipboard by mutableStateOf<Pair<String, FileEntry>?>(null)

@Composable
fun FilesScreen(path: String?) {
    val nav = LocalNav.current
    val context = LocalContext.current
    var listing by remember { mutableStateOf<Listing?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var revision by remember { mutableStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    var search by rememberSaveable { mutableStateOf("") }
    var searching by rememberSaveable { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<Pair<String, FileEntry?>?>(null) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(path, revision) {
        loading = true
        runCatching { app.api.get<Listing>("$base${path?.let { "?path=${encode(it)}" } ?: ""}") }
            .onSuccess { listing = it; error = null }
            .onFailure { error = it.message }
        loading = false
    }

    fun act(message: String, block: suspend () -> Unit) {
        scope.launch {
            runCatching { block() }.onSuccess { snackbar.showSnackbar(message) }.onFailure { snackbar.showSnackbar(it.message ?: "操作失败") }
            revision++
        }
    }

    val upload = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val dir = listing?.path ?: return@rememberLauncherForActivityResult
        uris.forEach { uri -> act("已上传") { uploadFile(context, uri, dir) } }
    }

    val current = listing
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (searching) {
                        OutlinedTextField(search, { search = it }, placeholder = { Text("在这个目录里筛选") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    } else {
                        Text(current?.let { if (it.path == it.home) "主目录" else it.path.substringAfterLast('/').ifEmpty { "/" } } ?: "文件", maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                navigationIcon = {
                    if (path != null) IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") }
                },
                actions = {
                    IconButton(onClick = { searching = !searching; search = "" }) { Icon(Icons.Outlined.Search, "筛选") }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "更多") }
                        DropdownMenu(menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("新建文件夹") }, leadingIcon = { Icon(Icons.Outlined.CreateNewFolder, null) }, onClick = {
                                menu = false
                                dialog = "mkdir" to null
                            })
                            DropdownMenuItem(text = { Text(if (showHidden) "不显示隐藏文件" else "显示隐藏文件") }, leadingIcon = { Icon(if (showHidden) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, null) }, onClick = {
                                menu = false
                                showHidden = !showHidden
                            })
                            Sort.entries.forEach { sort ->
                                DropdownMenuItem(
                                    text = { Text("按${sort.label}排序") },
                                    leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Sort, null, tint = if (sortBy == sort) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant) },
                                    onClick = {
                                        menu = false
                                        sortBy = sort
                                    },
                                )
                            }
                            current?.let {
                                DropdownMenuItem(text = { Text("回到主目录") }, leadingIcon = { Icon(Icons.Outlined.Home, null) }, onClick = {
                                    menu = false
                                    nav.navigate(FolderRoute(it.home))
                                })
                            }
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { upload.launch(arrayOf("*/*")) }) { Icon(Icons.Outlined.Upload, "上传到这里") }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        PullToRefreshBox(isRefreshing = loading && current != null, onRefresh = { revision++ }, modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                current == null && error != null -> Text(error!!, Modifier.align(Alignment.Center).padding(24.dp), color = MaterialTheme.colorScheme.error)
                current == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    item(key = "crumbs") { Breadcrumbs(current.path) { nav.navigate(FolderRoute(it)) } }
                    clipboard?.let { (action, entry) ->
                        item(key = "clipboard") {
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("${if (action == "copy") "复制" else "移动"} ${entry.name}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                TextButton(onClick = { clipboard = null }) { Text("取消") }
                                TextButton(onClick = {
                                    clipboard = null
                                    act(if (action == "copy") "已复制" else "已移动") { operation(action, entry.path, destination = current.path) }
                                }) { Text("粘贴到这里") }
                            }
                        }
                    }
                    val entries = current.entries
                        .filter { (showHidden || !it.name.startsWith(".")) && it.name.contains(search, ignoreCase = true) }
                        .sortedWith(
                            compareByDescending<FileEntry> { it.directory }.then(
                                when (sortBy) {
                                    Sort.Name -> compareBy(String.CASE_INSENSITIVE_ORDER) { it.name }
                                    Sort.Modified -> compareByDescending { it.modified }
                                    Sort.Size -> compareByDescending { it.size }
                                },
                            ),
                        )
                    if (entries.isEmpty()) item(key = "empty") { Text("空文件夹", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    items(entries, key = { it.path }) { entry ->
                        EntryRow(
                            entry,
                            onOpen = { if (entry.directory) nav.navigate(FolderRoute(entry.path)) else nav.navigate(FilePreviewRoute(fileUrl(entry.path), entry.name)) },
                            onAction = { action ->
                                when (action) {
                                    "rename" -> dialog = "rename" to entry
                                    "trash" -> dialog = "trash" to entry
                                    "copy", "move" -> clipboard = action to entry
                                    "download" -> download(context, fileUrl(entry.path) + "&name=${encode(entry.name)}", entry.name)
                                    "link" -> {
                                        context.getSystemService(android.content.ClipboardManager::class.java)
                                            .setPrimaryClip(android.content.ClipData.newPlainText("路径", entry.path))
                                        scope.launch { snackbar.showSnackbar("已复制路径") }
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
    }

    dialog?.let { (action, entry) ->
        when (action) {
            "trash" -> AlertDialog(
                onDismissRequest = { dialog = null },
                title = { Text("移到废纸篓？") },
                text = { Text(entry!!.name) },
                confirmButton = {
                    TextButton(onClick = {
                        dialog = null
                        act("已移到废纸篓") { operation("trash", entry!!.path) }
                    }) { Text("移到废纸篓") }
                },
                dismissButton = { TextButton(onClick = { dialog = null }) { Text("取消") } },
            )
            else -> NameDialog(
                title = if (action == "mkdir") "新建文件夹" else "重命名",
                initial = entry?.name ?: "",
                onDismiss = { dialog = null },
            ) { name ->
                dialog = null
                if (action == "mkdir") act("已新建") { operation("mkdir", current!!.path, name = name) }
                else act("已重命名") { operation("rename", entry!!.path, name = name) }
            }
        }
    }
}

@Composable
private fun Breadcrumbs(path: String, onOpen: (String) -> Unit) {
    val parts = path.split('/').filter { it.isNotEmpty() }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState(Int.MAX_VALUE)).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = { onOpen("/") }) { Text("/") }
        parts.forEachIndexed { index, part ->
            Icon(Icons.Outlined.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { onOpen("/" + parts.take(index + 1).joinToString("/")) }, enabled = index < parts.size - 1) { Text(part) }
        }
    }
}

@Composable
private fun EntryRow(entry: FileEntry, onOpen: () -> Unit, onAction: (String) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        ListItem(
            modifier = Modifier.combinedClickable(onClick = onOpen, onLongClick = { menu = true }),
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            leadingContent = { Icon(iconOf(entry), null, tint = if (entry.directory) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant) },
            headlineContent = { Text(entry.name + if (entry.symlink) " ↗" else "", maxLines = 1, overflow = TextOverflow.Ellipsis) },
            supportingContent = { Text(listOfNotNull(formatTime(entry.modified.toLong()), formatBytes(entry.size).takeIf { !entry.directory }).joinToString(" · ")) },
            trailingContent = { IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "操作") } },
        )
        DropdownMenu(menu, onDismissRequest = { menu = false }) {
            listOfNotNull(
                Triple("rename", "重命名", Icons.Outlined.DriveFileRenameOutline),
                Triple("copy", "复制到…", Icons.Outlined.ContentCopy),
                Triple("move", "移动到…", Icons.Outlined.DriveFileMove),
                Triple("download", "下载到手机", Icons.Outlined.Download).takeIf { !entry.directory },
                Triple("link", "复制路径", Icons.Outlined.Link),
                Triple("trash", "移到废纸篓", Icons.Outlined.Delete),
            ).forEach { (action, label, icon) ->
                DropdownMenuItem(text = { Text(label) }, leadingIcon = { Icon(icon, null) }, onClick = {
                    menu = false
                    onAction(action)
                })
            }
        }
    }
}

@Composable
private fun NameDialog(title: String, initial: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var name by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(name, { name = it }, singleLine = true) },
        confirmButton = { TextButton(onClick = { onConfirm(name.trim()) }, enabled = name.isNotBlank() && "/" !in name) { Text("确定") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

// 上传：请求体就是文件本身，同名文件已存在时后端拒绝
private suspend fun uploadFile(context: Context, uri: Uri, dir: String) {
    val resolver = context.contentResolver
    val (name, size) = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
        if (it.moveToFirst()) (it.getString(0) ?: "file") to it.getLong(1) else null
    } ?: ("file" to -1L)
    val body = object : RequestBody() {
        override fun contentType(): MediaType = octetType
        override fun contentLength(): Long = size
        override fun writeTo(sink: BufferedSink) {
            resolver.openInputStream(uri)!!.source().use { sink.writeAll(it) }
        }
    }
    app.api.upload("$base/upload?path=${encode(dir)}&name=${encode(name)}", body)
}
