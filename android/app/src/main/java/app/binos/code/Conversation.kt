@file:OptIn(ExperimentalMaterial3Api::class)

package app.binos.code

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.DriveFileRenameOutline
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.edit
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.binos.app
import app.binos.more.buildState
import app.binos.more.buildStateColor
import app.binos.more.prBuilds
import app.binos.more.rememberBuilds
import app.binos.shell.BuildsRoute
import app.binos.shell.FilePreviewRoute
import app.binos.shell.LocalNav
import app.binos.shell.NewSessionRoute
import app.binos.shell.SessionRoute
import app.binos.ui.ImageViewer
import kotlinx.coroutines.launch

// 待发的附件
data class PendingFile(val uri: Uri, val name: String, val image: Boolean)

// 刚建好的 session 可能还没出现在列表里：记下它的 thread 和项目
private val created = HashMap<Int, Pair<String, String>>()

class ConversationModel(val sessionId: Int?, initialProject: String?) : ViewModel() {
    var project by mutableStateOf(initialProject)
    var picked by mutableStateOf<Choice?>(null)
    val pending = mutableStateListOf<PendingFile>()
    var sending by mutableStateOf(false)
        private set
    var notice by mutableStateOf<String?>(null)
    // 每次发送时加一，对话回到底部
    var stickRequests by mutableStateOf(0)
        private set
    private val drafts = app.getSharedPreferences("drafts", Context.MODE_PRIVATE)
    private val draftKey get() = "code/draft/${sessionId ?: "new-${project ?: ""}"}"
    var input by mutableStateOf(drafts.getString(draftKey, "") ?: "")
        private set

    fun updateInput(value: String) {
        input = value
        drafts.edit { if (value.isEmpty()) remove(draftKey) else putString(draftKey, value) }
    }

    fun threadId(session: SessionSummary?): String? = session?.kitaSession ?: sessionId?.let { created[it]?.first }

    fun choice(session: SessionSummary?): Choice = picked ?: Choice(session?.agent ?: defaultAgent, session?.model, session?.effort)

    // 发送成功后清空输入；新对话返回新 session 的编号
    fun send(resolver: ContentResolver, mode: SendMode, session: SessionSummary?, running: Boolean, onCreated: (Int) -> Unit) {
        if (sending || input.isBlank() && pending.isEmpty()) return
        sending = true
        notice = null
        stickRequests++
        viewModelScope.launch {
            try {
                val uploads = pending.map { CodeStore.api.upload(resolver, it.uri) }
                val projectId = session?.project ?: project ?: "binos"
                val (id, thread) = CodeStore.api.send(sessionId, projectId, input.trim(), uploads, if (session?.running == true || running) mode else SendMode.Send, choice(session))
                updateInput("")
                pending.clear()
                if (sessionId == null) {
                    created[id] = thread to projectId
                    CodeStore.refresh()
                    onCreated(id)
                }
            } catch (error: Exception) {
                notice = error.message ?: "发送失败，请重试"
            } finally {
                sending = false
            }
        }
    }

    fun stop() {
        sessionId?.let { viewModelScope.launch { runCatching { CodeStore.api.stop(it) } } }
    }

    // 撤回排队的消息：文字回到输入框，接在已经写的后面
    fun withdraw(item: String) {
        val id = sessionId ?: return
        viewModelScope.launch {
            runCatching { CodeStore.api.withdraw(id, item) }
                .onSuccess { text -> updateInput(if (input.isNotBlank()) "${input.trimEnd()}\n$text" else text) }
                .onFailure { notice = it.message }
        }
    }

    fun sendQueued(item: String) {
        val id = sessionId ?: return
        viewModelScope.launch { runCatching { CodeStore.api.sendQueued(id, item) }.onFailure { notice = it.message } }
    }
}

@Composable
fun ConversationScreen(sessionId: Int?, project: String?, targetSeq: Int?) {
    val nav = LocalNav.current
    val context = LocalContext.current
    val model: ConversationModel = viewModel(key = "conversation-${sessionId ?: "new"}") { ConversationModel(sessionId, project) }
    val sessions by CodeStore.sessions.collectAsStateWithLifecycle()
    val projects by CodeStore.projects.collectAsStateWithLifecycle()
    val session = sessions?.find { it.id == sessionId }
    val thread = model.threadId(session)
    val state = remember(thread) { thread?.let(ThreadCache::get) }
    val running = state?.live != null
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var viewing by remember { mutableStateOf<Pair<String, String>?>(null) }
    var renaming by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    val openPrs = session?.prs.orEmpty().filter { it.state == "open" || it.state == null }
    // 构建服务只编 binOS 自己的仓库
    val builds = rememberBuilds(session?.project == "binos" && openPrs.isNotEmpty()).snapshot?.builds
    val prBuildStates = builds?.let { list -> openPrs.mapNotNull { pr -> buildState(prBuilds(list, pr.number))?.let { pr.number to it } } }.orEmpty()

    // 只在页面可见时跟着推送
    LaunchedEffect(thread) {
        if (state != null) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { state.follow() }
    }
    // 正在看、又没在回答：记为已读
    LaunchedEffect(sessionId, running, state?.loaded) {
        if (sessionId != null && state?.loaded == true && !running) CodeStore.api.markRead(sessionId)
    }

    val missing = sessionId != null && sessions != null && session == null && thread == null
    val title = when {
        sessionId == null -> "新对话"
        missing -> "对话不存在"
        else -> session?.title ?: ""
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                        session?.let {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    listOfNotNull("#${it.id}", projects?.find { p -> p.id == it.project }?.name, agentName(it.agent)).joinToString(" · "),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f, fill = false),
                                )
                                prBuildStates.forEach { (number, state) ->
                                    Text("#$number ${state.label}", style = MaterialTheme.typography.labelSmall, color = buildStateColor(state), maxLines = 1)
                                }
                            }
                        }
                    }
                },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
                actions = {
                    if (session != null) {
                        IconButton(onClick = { nav.navigate(NewSessionRoute(session.project)) }) { Icon(Icons.Outlined.EditNote, "新对话") }
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, "更多") }
                            DropdownMenu(menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(text = { Text("改名") }, leadingIcon = { Icon(Icons.Outlined.DriveFileRenameOutline, null) }, onClick = {
                                    menu = false
                                    renaming = true
                                })
                                DropdownMenuItem(text = { Text(if (session.pinned) "取消置顶" else "置顶") }, leadingIcon = { Icon(Icons.Outlined.PushPin, null) }, onClick = {
                                    menu = false
                                    CodeStore.edit(session.id, pinned = !session.pinned)
                                })
                                DropdownMenuItem(
                                    text = { Text(if (session.archived) "取消归档" else "归档") },
                                    leadingIcon = { Icon(if (session.archived) Icons.Outlined.Unarchive else Icons.Outlined.Archive, null) },
                                    onClick = {
                                        menu = false
                                        CodeStore.edit(session.id, archived = !session.archived)
                                    },
                                )
                                session.prs.forEach { pr ->
                                    DropdownMenuItem(
                                        text = { Text("PR #${pr.number}" + (pr.state?.let { s -> " · ${mapOf("open" to "开着", "merged" to "已合并", "closed" to "已关闭")[s] ?: s}" } ?: "")) },
                                        leadingIcon = { Icon(Icons.Outlined.OpenInNew, null) },
                                        onClick = {
                                            menu = false
                                            uriHandler.openUri(pr.url)
                                        },
                                    )
                                    prBuildStates.find { it.first == pr.number }?.let { (number, state) ->
                                        DropdownMenuItem(text = { Text("${state.label} #$number") }, leadingIcon = { Icon(Icons.Outlined.Build, null) }, onClick = {
                                            menu = false
                                            nav.navigate(BuildsRoute("pr/$number"))
                                        })
                                    }
                                    pr.preview?.let { preview ->
                                        DropdownMenuItem(text = { Text("预览 #${pr.number}") }, leadingIcon = { Icon(Icons.Outlined.OpenInNew, null) }, onClick = {
                                            menu = false
                                            uriHandler.openUri(preview)
                                        })
                                    }
                                }
                            }
                        }
                    }
                },
            )
        },
        bottomBar = {
            if (!missing) {
                Composer(
                    model = model,
                    session = session,
                    running = running,
                    agentFixed = sessionId != null,
                    onSend = { mode ->
                        model.send(context.contentResolver, mode, session, running) { id ->
                            nav.navigate(SessionRoute(id)) { popUpTo<NewSessionRoute> { inclusive = true } }
                        }
                    },
                )
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
            when {
                missing -> Text("这个对话不存在", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.onSurfaceVariant)
                sessionId == null -> NewConversation(model, projects)
                state == null || !state.loaded && state.events.isEmpty() -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                else -> Transcript(state, model.notice, model.stickRequests, targetSeq) { url, name -> if (isImage(name)) viewing = url to name else nav.navigate(FilePreviewRoute(url, name)) }
            }
        }
    }
    viewing?.let { (url, name) -> ImageViewer(url, name) { viewing = null } }
    if (renaming && session != null) RenameDialog(session) { renaming = false }
}

// 新对话：选所属项目
@Composable
private fun NewConversation(model: ConversationModel, projects: List<Project>?) {
    var expanded by remember { mutableStateOf(false) }
    val current = projects?.find { it.id == (model.project ?: "binos") } ?: projects?.firstOrNull()
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("开始新对话", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.size(16.dp))
        ExposedDropdownMenuBox(expanded, onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = current?.name ?: "",
                onValueChange = {},
                readOnly = true,
                label = { Text("所属项目") },
                leadingIcon = { Icon(Icons.Outlined.Folder, null) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
                modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).widthIn(max = 360.dp),
            )
            ExposedDropdownMenu(expanded, onDismissRequest = { expanded = false }) {
                projects?.forEach { project ->
                    DropdownMenuItem(text = { Text(project.name) }, onClick = {
                        model.project = project.id
                        expanded = false
                    })
                }
            }
        }
    }
}
