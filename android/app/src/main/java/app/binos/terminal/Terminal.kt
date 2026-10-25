@file:OptIn(ExperimentalMaterial3Api::class)

package app.binos.terminal

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Typeface
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import app.binos.app
import app.binos.code.encode
import app.binos.net.json
import app.binos.shell.LocalNav
import app.binos.shell.TerminalSessionRoute
import app.binos.ui.formatTime
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.decodeFromJsonElement

@Serializable
data class TerminalInfo(val id: String, val created: Long, val cwd: String = "", val command: String = "")

@Serializable
private data class TerminalList(val available: Boolean = true, val sessions: List<TerminalInfo> = emptyList())

private const val base = "/api/apps/terminal"

// 终端会话（tmux）列表，每 5 秒刷新
@Composable
fun TerminalHomeScreen() {
    val nav = LocalNav.current
    var list by remember { mutableStateOf<TerminalList?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableStateOf(0) }
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<TerminalInfo?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(refresh) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                runCatching { app.api.get<TerminalList>(base) }.onSuccess { list = it; error = null }.onFailure { error = it.message }
                delay(5000)
            }
        }
    }
    Scaffold(
        topBar = { TopAppBar(title = { Text("终端") }) },
        floatingActionButton = {
            if (list?.available != false) {
                ExtendedFloatingActionButton(
                    onClick = {
                        if (creating) return@ExtendedFloatingActionButton
                        creating = true
                        scope.launch {
                            runCatching { json.decodeFromJsonElement<TerminalInfo>(app.api.postJson("$base/sessions")) }
                                .onSuccess { nav.navigate(TerminalSessionRoute(it.id)) }
                                .onFailure { error = it.message }
                            creating = false
                            refresh++
                        }
                    },
                    icon = { if (creating) CircularProgressIndicator(Modifier.height(20.dp)) else Icon(Icons.Outlined.Add, null) },
                    text = { Text("新终端") },
                )
            }
        },
    ) { padding ->
        PullToRefreshBox(isRefreshing = false, onRefresh = { refresh++ }, modifier = Modifier.fillMaxSize().padding(padding)) {
            val current = list
            when {
                current == null && error == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                current?.available == false -> Text("Mac 上没有安装 tmux，终端不可用", Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp)) } }
                    if (current?.sessions?.isEmpty() == true) {
                        item { Text("还没有终端，点右下角新建", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    items(current?.sessions.orEmpty(), key = { it.id }) { session ->
                        ListItem(
                            modifier = Modifier.clickable { nav.navigate(TerminalSessionRoute(session.id)) },
                            leadingContent = { Icon(Icons.Outlined.Terminal, null) },
                            headlineContent = { Text(session.cwd.ifEmpty { session.id.removePrefix("terminal-").take(8) }, fontFamily = FontFamily.Monospace) },
                            supportingContent = { Text("创建于 ${formatTime(session.created)}") },
                            trailingContent = {
                                Row {
                                    // 在 Mac 的终端里接上同一个 shell 的命令
                                    if (session.command.isNotEmpty()) IconButton(onClick = {
                                        clipboard.setText(AnnotatedString(session.command))
                                        Toast.makeText(context, "已复制 Mac Terminal 连接命令", Toast.LENGTH_SHORT).show()
                                    }) { Icon(Icons.Outlined.ContentCopy, "复制 Mac Terminal 连接命令") }
                                    IconButton(onClick = { deleting = session }) { Icon(Icons.Outlined.Delete, "关闭终端") }
                                }
                            },
                            colors = androidx.compose.material3.ListItemDefaults.colors(containerColor = Color.Transparent),
                        )
                    }
                }
            }
        }
    }
    deleting?.let { session ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("关闭这个终端？") },
            text = { Text("里面正在运行的程序会被结束。") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    scope.launch {
                        runCatching { app.api.deleteJson("$base/sessions/${encode(session.id)}") }.onFailure { error = it.message }
                        refresh++
                    }
                }) { Text("关闭") }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } },
        )
    }
}

// 软键盘上没有的键：Ctrl、Alt 按一次只作用于下一个键
private class Modifiers {
    var ctrl by mutableStateOf(false)
    var alt by mutableStateOf(false)
}

@Composable
fun TerminalScreen(id: String) {
    val nav = LocalNav.current
    val context = LocalContext.current
    val density = LocalDensity.current
    val modifiers = remember { Modifiers() }
    var view by remember { mutableStateOf<TerminalView?>(null) }
    var fontSize by remember { mutableStateOf(with(density) { 13.sp.roundToPx() }) }
    val terminal = remember(id) {
        RemoteTerminal(id, object : TerminalSessionClient {
            override fun onTextChanged(changedSession: TerminalSession) {
                view?.onScreenUpdated()
            }

            override fun onTitleChanged(changedSession: TerminalSession) {}
            override fun onSessionFinished(finishedSession: TerminalSession) {}
            override fun onCopyTextToClipboard(session: TerminalSession, text: String) {
                context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("终端", text))
            }

            override fun onPasteTextFromClipboard(session: TerminalSession?) {
                paste(context, session)
            }

            override fun onBell(session: TerminalSession) {}
            override fun onColorsChanged(session: TerminalSession) {}
            override fun onTerminalCursorStateChange(state: Boolean) {}
            override fun getTerminalCursorStyle(): Int = 0
            override fun logError(tag: String?, message: String?) {}
            override fun logWarn(tag: String?, message: String?) {}
            override fun logInfo(tag: String?, message: String?) {}
            override fun logDebug(tag: String?, message: String?) {}
            override fun logVerbose(tag: String?, message: String?) {}
            override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
            override fun logStackTrace(tag: String?, e: Exception?) {}
        })
    }
    DisposableEffect(terminal) { onDispose { terminal.close() } }
    val state by terminal.state.collectAsStateWithLifecycle()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(terminal) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { terminal.reconnect() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("终端", maxLines = 1) },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
                actions = {
                    IconButton(onClick = { paste(context, terminal.session) }) { Icon(Icons.Outlined.ContentPaste, "粘贴") }
                    IconButton(onClick = { view?.let { showKeyboard(it) } }) { Icon(Icons.Outlined.Keyboard, "键盘") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(top = padding.calculateTopPadding()).windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars))) {
            Box(Modifier.weight(1f).fillMaxWidth().background(Color.Black)) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        TerminalView(ctx, null).apply {
                            setTerminalViewClient(viewClient(this, modifiers) { size -> fontSize = size })
                            setTextSize(fontSize)
                            setTypeface(Typeface.MONOSPACE)
                            isFocusable = true
                            isFocusableInTouchMode = true
                            attachSession(terminal.session)
                            addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
                                post {
                                    val emulator = terminal.session.emulator ?: return@post
                                    terminal.resize(emulator.mColumns, emulator.mRows)
                                }
                            }
                            view = this
                            requestFocus()
                        }
                    },
                    update = { it.setTextSize(fontSize) },
                )
                when (val current = state) {
                    TerminalState.Connecting -> CircularProgressIndicator(Modifier.align(Alignment.Center), color = Color.White)
                    TerminalState.Exited -> Overlay("终端已结束") { nav.popBackStack() }
                    is TerminalState.Failed -> Overlay(current.message) { terminal.reconnect() }
                    TerminalState.Ready -> Unit
                }
            }
            ExtraKeys(modifiers, onKey = { code -> view?.handleKeyCode(code, 0) }, onText = { terminal.send(it) })
        }
    }
}

@Composable
private fun Overlay(text: String, action: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.7f)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(text, color = Color.White)
            Button(onClick = action) { Text("好") }
        }
    }
}

private fun paste(context: Context, session: TerminalSession?) {
    val text = context.getSystemService(ClipboardManager::class.java).primaryClip?.getItemAt(0)?.coerceToText(context)?.toString() ?: return
    session?.emulator?.paste(text)
}

private fun showKeyboard(view: TerminalView) {
    view.requestFocus()
    view.context.getSystemService(InputMethodManager::class.java).showSoftInput(view, InputMethodManager.SHOW_IMPLICIT)
}

private fun viewClient(view: TerminalView, modifiers: Modifiers, onFontSize: (Int) -> Unit) = object : TerminalViewClient {
    private var scale = 1f
    override fun onScale(scale: Float): Float {
        // 双指缩放调字号
        if (scale < 0.9f || scale > 1.1f) {
            this.scale *= scale
            onFontSize((view.resources.displayMetrics.scaledDensity * 13 * this.scale.coerceIn(0.6f, 2.5f)).toInt())
            return 1f
        }
        return scale
    }

    override fun onSingleTapUp(e: MotionEvent) = showKeyboard(view)
    override fun shouldBackButtonBeMappedToEscape() = false
    override fun shouldEnforceCharBasedInput() = true
    override fun shouldUseCtrlSpaceWorkaround() = false
    override fun isTerminalViewSelected() = true
    override fun copyModeChanged(copyMode: Boolean) {}
    override fun onKeyDown(keyCode: Int, e: KeyEvent, session: TerminalSession) = false
    override fun onKeyUp(keyCode: Int, e: KeyEvent) = false
    override fun onLongPress(event: MotionEvent) = false
    override fun readControlKey() = modifiers.ctrl.also { modifiers.ctrl = false }
    override fun readAltKey() = modifiers.alt.also { modifiers.alt = false }
    override fun readShiftKey() = false
    override fun readFnKey() = false
    override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession) = false
    override fun onEmulatorSet() {}
    override fun logError(tag: String?, message: String?) {}
    override fun logWarn(tag: String?, message: String?) {}
    override fun logInfo(tag: String?, message: String?) {}
    override fun logDebug(tag: String?, message: String?) {}
    override fun logVerbose(tag: String?, message: String?) {}
    override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
    override fun logStackTrace(tag: String?, e: Exception?) {}
}

private sealed interface ExtraKey {
    val label: String

    data class Code(override val label: String, val code: Int) : ExtraKey
    data class Chars(override val label: String, val text: String) : ExtraKey
    data object Ctrl : ExtraKey { override val label = "Ctrl" }
    data object Alt : ExtraKey { override val label = "Alt" }
}

private val extraKeys = listOf(
    ExtraKey.Code("Esc", KeyEvent.KEYCODE_ESCAPE),
    ExtraKey.Code("Tab", KeyEvent.KEYCODE_TAB),
    ExtraKey.Ctrl,
    ExtraKey.Alt,
    ExtraKey.Chars("^C", "\u0003"),
    ExtraKey.Code("←", KeyEvent.KEYCODE_DPAD_LEFT),
    ExtraKey.Code("↑", KeyEvent.KEYCODE_DPAD_UP),
    ExtraKey.Code("↓", KeyEvent.KEYCODE_DPAD_DOWN),
    ExtraKey.Code("→", KeyEvent.KEYCODE_DPAD_RIGHT),
    ExtraKey.Code("Home", KeyEvent.KEYCODE_MOVE_HOME),
    ExtraKey.Code("End", KeyEvent.KEYCODE_MOVE_END),
    ExtraKey.Code("PgUp", KeyEvent.KEYCODE_PAGE_UP),
    ExtraKey.Code("PgDn", KeyEvent.KEYCODE_PAGE_DOWN),
    ExtraKey.Chars("|", "|"),
    ExtraKey.Chars("~", "~"),
    ExtraKey.Chars("/", "/"),
    ExtraKey.Chars("-", "-"),
    ExtraKey.Chars("^D", "\u0004"),
)

// 特殊按键栏：方向键等按模拟器的模式编码（比如 vim 里的应用光标模式）
@Composable
private fun ExtraKeys(modifiers: Modifiers, onKey: (Int) -> Unit, onText: (String) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp, vertical = 4.dp)) {
            extraKeys.forEach { key ->
                val active = key == ExtraKey.Ctrl && modifiers.ctrl || key == ExtraKey.Alt && modifiers.alt
                TextButton(
                    onClick = {
                        when (key) {
                            is ExtraKey.Code -> onKey(key.code)
                            is ExtraKey.Chars -> onText(key.text)
                            ExtraKey.Ctrl -> modifiers.ctrl = !modifiers.ctrl
                            ExtraKey.Alt -> modifiers.alt = !modifiers.alt
                        }
                    },
                    modifier = Modifier.widthIn(min = 48.dp).background(if (active) MaterialTheme.colorScheme.primaryContainer else Color.Transparent, MaterialTheme.shapes.small),
                ) {
                    Text(key.label, fontFamily = FontFamily.Monospace, fontWeight = if (active) FontWeight.Bold else null)
                }
            }
        }
    }
}
