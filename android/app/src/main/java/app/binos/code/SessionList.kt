@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)

package app.binos.code

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CreateNewFolder
import androidx.compose.material.icons.outlined.DriveFileRenameOutline
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.binos.app
import app.binos.shell.LocalNav
import app.binos.shell.NewSessionRoute
import app.binos.shell.SessionRoute
import app.binos.ui.formatQuota
import app.binos.ui.formatTime
import app.binos.ui.rememberNow
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun CodeHomeScreen() {
    val nav = LocalNav.current
    val sessions by CodeStore.sessions.collectAsStateWithLifecycle()
    val projects by CodeStore.projects.collectAsStateWithLifecycle()
    val failed by CodeStore.failed.collectAsStateWithLifecycle()
    val status by CodeStore.status.collectAsStateWithLifecycle()
    val now = rememberNow(intervalMs = 60_000)
    // 正在做的登录：登录好了提醒就没了，登录的过程还要留着显示结果
    var login by remember { mutableStateOf<Attention?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var quotaOpen by remember { mutableStateOf(false) }
    var projectDialog by remember { mutableStateOf<Project?>(null) }
    var creatingProject by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()

    LaunchedEffect(sessions) { refreshing = false }

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(
                title = { Text("Code") },
                scrollBehavior = scrollBehavior,
                actions = {
                    QuotaChip(status, now) { quotaOpen = true }
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Outlined.MoreVert, "更多") }
                        DropdownMenu(menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(
                                text = { Text("创建项目") },
                                leadingIcon = { Icon(Icons.Outlined.CreateNewFolder, null) },
                                onClick = {
                                    menuOpen = false
                                    projectDialog = null
                                    creatingProject = true
                                },
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (query.isBlank()) {
                ExtendedFloatingActionButton(
                    onClick = { nav.navigate(NewSessionRoute()) },
                    icon = { Icon(Icons.Outlined.EditNote, null) },
                    text = { Text("新对话") },
                )
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                CodeStore.refresh()
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(bottom = 96.dp), modifier = Modifier.fillMaxSize()) {
                item(key = "search") { SearchField(query) { query = it } }
                val attention = firstAttention(status, now)
                if (attention != null || login != null) {
                    item(key = "auth") { AuthBanner(attention, login, onOpen = { login = it }, onClose = { login = null }) }
                }
                when {
                    query.isNotBlank() -> item(key = "results") {
                        SearchResultsView(query.trim()) { id, item -> nav.navigate(SessionRoute(id, item ?: -1)) }
                    }
                    sessions == null || projects == null -> item(key = "loading") {
                        Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                            if (failed) Text("读取失败，下拉重试", color = MaterialTheme.colorScheme.error) else CircularProgressIndicator()
                        }
                    }
                    else -> projects!!.forEach { project ->
                        projectSection(
                            project,
                            sessions!!.filter { it.project == project.id },
                            onOpen = { nav.navigate(SessionRoute(it)) },
                            onNew = { nav.navigate(NewSessionRoute(project.id)) },
                            onConnect = {
                                projectDialog = project
                                creatingProject = true
                            },
                        )
                    }
                }
            }
        }
    }

    if (quotaOpen) {
        ModalBottomSheet(onDismissRequest = { quotaOpen = false }) { QuotaDetails(status, now) }
    }
    if (creatingProject) {
        ProjectDialog(projectDialog, onDismiss = { creatingProject = false }) { project ->
            creatingProject = false
            nav.navigate(NewSessionRoute(project.id))
        }
    }
}

@Composable
private fun SearchField(query: String, onChange: (String) -> Unit) {
    TextField(
        value = query,
        onValueChange = onChange,
        placeholder = { Text("搜索对话与消息") },
        leadingIcon = { Icon(Icons.Outlined.Search, null) },
        trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { onChange("") }) { Icon(Icons.Outlined.Close, "清除搜索") } },
        singleLine = true,
        shape = CircleShape,
        colors = TextFieldDefaults.colors(focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

// 一个项目：标题行，置顶的在最上面，其余按最近活动排序，归档的收在最下面
private fun LazyListScope.projectSection(
    project: Project,
    sessions: List<SessionSummary>,
    onOpen: (Int) -> Unit,
    onNew: () -> Unit,
    onConnect: () -> Unit,
) {
    stickyHeader(key = "project-${project.id}") {
        Row(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(start = 16.dp, end = 4.dp, top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(project.name, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                project.repository?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (project.id != "binos" && project.repository == null) TextButton(onClick = onConnect) { Text("关联仓库") }
            IconButton(onClick = onNew) { Icon(Icons.Outlined.EditNote, "在 ${project.name} 中新建对话") }
        }
    }
    if (sessions.isEmpty()) {
        item(key = "empty-${project.id}") {
            Text("还没有对话", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
        }
        return
    }
    val pinned = sessions.filter { it.pinned && !it.archived }
    val others = sessions.filter { !it.pinned && !it.archived }
    val archived = sessions.filter { it.archived }
    if (pinned.isNotEmpty()) {
        item(key = "pinned-${project.id}") { SectionLabel("置顶") }
        items(pinned, key = { it.id }) { SessionRow(it) { onOpen(it.id) } }
    }
    items(others, key = { it.id }) { SessionRow(it) { onOpen(it.id) } }
    if (archived.isNotEmpty()) {
        item(key = "archived-${project.id}") { ArchivedSection(archived, onOpen) }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 4.dp))
}

@Composable
private fun ArchivedSection(archived: List<SessionSummary>, onOpen: (Int) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column {
        TextButton(onClick = { open = !open }, modifier = Modifier.padding(start = 4.dp)) {
            Icon(if (open) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, Modifier.size(18.dp))
            Text(" 已归档 ${archived.size}")
        }
        if (open) archived.forEach { session -> SessionRow(session) { onOpen(session.id) } }
    }
}

// 标题和一行概况；长按改名、置顶、归档
@Composable
fun SessionRow(session: SessionSummary, onClick: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    Box {
        ListItem(
            modifier = Modifier.combinedClickable(onClick = onClick, onLongClick = { menu = true }),
            colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
            leadingContent = { SessionIndicator(session) },
            headlineContent = {
                Text(
                    session.title.ifEmpty { "（无内容）" },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    fontWeight = if (session.unread) FontWeight.Bold else null,
                )
            },
            supportingContent = { Text(sessionFacts(session), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall) },
            trailingContent = {
                Text(
                    when {
                        session.running -> "回答中"
                        session.waiting -> "后台任务"
                        else -> formatTime(parseTime(session.updatedAt))
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = if (session.running || session.waiting) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            },
        )
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
        }
    }
    if (renaming) RenameDialog(session) { renaming = false }
}

@Composable
fun RenameDialog(session: SessionSummary, onDone: () -> Unit) {
    var title by remember { mutableStateOf(session.title) }
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text("改名") },
        text = { OutlinedTextField(title, { title = it }, singleLine = true, modifier = Modifier.fillMaxWidth()) },
        confirmButton = {
            TextButton(enabled = title.isNotBlank(), onClick = {
                CodeStore.edit(session.id, title = title.trim())
                onDone()
            }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDone) { Text("取消") } },
    )
}

// 正在回答时是跳动的点，有新回复时是实心点
@Composable
private fun SessionIndicator(session: SessionSummary) {
    val color = when {
        session.running || session.waiting -> MaterialTheme.colorScheme.primary
        session.outcome == "error" -> MaterialTheme.colorScheme.error
        session.unread -> MaterialTheme.colorScheme.primary
        else -> androidx.compose.ui.graphics.Color.Transparent
    }
    val alpha = if (session.running) {
        val transition = rememberInfiniteTransition(label = "running")
        transition.animateFloat(0.3f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "alpha").value
    } else 1f
    Box(Modifier.size(10.dp).alpha(alpha).background(color, CircleShape))
}

// 编号、不是默认的 agent、轮数、大约占周额度多少、开着的 PR、排队的消息、停止或出错
fun sessionFacts(session: SessionSummary): String = listOfNotNull(
    "#${session.id}",
    agentName(session.agent).takeIf { session.agent != defaultAgent },
    "${session.turns} 轮".takeIf { session.turns > 1 },
    session.quota?.takeIf { it >= 0.005 }?.let { "≈${formatQuota(it)} 周额度" },
    session.prs.filter { it.state == "open" }.takeIf { it.isNotEmpty() }?.joinToString(" ") { "PR #${it.number}" },
    "排队 ${session.queue.size}".takeIf { session.queue.isNotEmpty() },
    session.outcome?.takeIf { !session.running && !session.waiting }?.let { if (it == "error") "出错" else "已停止" },
).joinToString(" · ")

// 全部历史内容的搜索结果，按对话分组，命中的文字加粗
@Composable
private fun SearchResultsView(query: String, onOpen: (Int, Int?) -> Unit) {
    var results by remember { mutableStateOf<SearchResults?>(null) }
    var failed by remember { mutableStateOf(false) }
    var revision by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) { app.events.of("session").collect { revision++ } }
    LaunchedEffect(query, revision) {
        delay(250)
        failed = false
        runCatching { CodeStore.api.search(query) }.onSuccess { results = it }.onFailure { failed = true }
    }
    val data = results
    when {
        failed -> Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("搜索失败", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { revision++ }) { Text("重新搜索") }
        }
        data == null -> Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        data.results.isEmpty() -> Text("没有找到相关内容", Modifier.fillMaxWidth().padding(32.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> Column {
            Text(
                "找到 ${data.total} 处${if (data.total > data.results.size) "，显示前 ${data.results.size} 处" else ""}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            data.results.groupBy { it.id }.forEach { (id, matches) ->
                Text(
                    matches.first().title + if (matches.first().archived) "（已归档）" else "",
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp),
                )
                matches.forEach { match ->
                    ListItem(
                        modifier = Modifier.combinedClickable(onClick = { onOpen(id, match.item) }),
                        colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
                        leadingContent = {
                            Icon(
                                if (match.kind == "input") Icons.Outlined.EditNote else Icons.AutoMirrored.Outlined.Chat,
                                if (match.kind == "input") "你说的" else "回复",
                                Modifier.size(18.dp),
                            )
                        },
                        headlineContent = {
                            Text(
                                buildAnnotatedString {
                                    append(match.before.replace('\n', ' '))
                                    withStyle(SpanStyle(fontWeight = FontWeight.Bold, background = MaterialTheme.colorScheme.primaryContainer)) { append(match.match) }
                                    append(match.after.replace('\n', ' '))
                                },
                                maxLines = 3,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        },
                    )
                }
                HorizontalDivider(Modifier.padding(horizontal = 16.dp))
            }
        }
    }
}

// 新建项目，或者给已有项目关联仓库
@Composable
private fun ProjectDialog(connect: Project?, onDismiss: () -> Unit, onCreated: (Project) -> Unit) {
    var name by remember { mutableStateOf(connect?.name ?: "") }
    var repository by remember { mutableStateOf("") }
    var create by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(if (connect != null) "关联仓库" else "创建项目") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("项目名称") }, singleLine = true, enabled = connect == null && !saving)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(!create, onClick = { create = false }, label = { Text("关联已有仓库") })
                    FilterChip(create, onClick = { create = true }, label = { Text("新建私有仓库") })
                }
                OutlinedTextField(repository, { repository = it }, label = { Text("GitHub 仓库") }, placeholder = { Text("owner/repository") }, singleLine = true, enabled = !saving)
                if (saving) Text("准备仓库中…", style = MaterialTheme.typography.bodySmall)
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(enabled = name.isNotBlank() && repository.isNotBlank() && !saving, onClick = {
                saving = true
                error = null
                scope.launch {
                    runCatching { CodeStore.api.createProject(name.trim(), repository.trim(), create, connect?.id) }
                        .onSuccess(onCreated)
                        .onFailure { error = it.message ?: "创建失败，请重试" }
                    saving = false
                }
            }) { Text(if (connect != null) "关联" else "创建") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("取消") } },
    )
}

// agent 的登录要处理时（快到期、失效了、在用备用的登录……），列表上面一条提醒，点了就地登录
@Composable
private fun AuthBanner(attention: Attention?, login: Attention?, onOpen: (Attention) -> Unit, onClose: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (attention?.bad == true) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.tertiaryContainer,
        ),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        if (login != null) {
            Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { AgentLogin(login.agent, login.fix, onClose) }
        } else if (attention != null) {
            Row(Modifier.fillMaxWidth().clickable { onOpen(attention) }.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.WarningAmber, null)
                Spacer(Modifier.width(8.dp))
                Text(attention.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = { onOpen(attention) }) { Text(attention.action) }
            }
        }
    }
}
