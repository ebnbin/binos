@file:OptIn(ExperimentalMaterial3Api::class)

package app.binos.more

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material3.FilterChip
import androidx.compose.material3.AssistChip
import androidx.compose.runtime.mutableIntStateOf
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.KeyEvent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Keyboard
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import app.binos.app
import app.binos.net.json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.abs

// 远程浏览器：驱动 Mac 上 Chrome 里的一个标签页，画面是截图流，触摸和输入转成指针、滚轮和按键。协议见 server/src/apps/browser/protocol.ts
class RemoteBrowser {
    var frame by mutableStateOf<ImageBitmap?>(null)
        private set
    var frameSize by mutableStateOf(IntSize(1, 1))
        private set
    var url by mutableStateOf("")
        private set
    var title by mutableStateOf("")
        private set
    var canBack by mutableStateOf(false)
        private set
    var canForward by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var ready by mutableStateOf(false)
        private set
    private val main = Handler(Looper.getMainLooper())
    private val client = app.api.http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var socket: WebSocket? = null
    private var session: String? = null
    private var chunks = StringBuilder()
    private var chunkFrame = -1
    private var viewport: Triple<Int, Int, Float>? = null
    private var pendingUrl: String? = null
    private var closed = false
    private var attempts = 0

    fun connect() {
        if (closed) return
        ready = false
        val path = "/api/apps/browser/socket" + (session?.let { "?session=$it" } ?: "")
        val request = Request.Builder().url(app.api.url(path)).header("Origin", app.server.origin).build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                        val message = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
                if (message["type"]?.jsonPrimitive?.content == "frame") receiveFrame(webSocket, message) else main.post { if (webSocket == socket) receive(message) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                main.post { dropped(webSocket, code) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                main.post { dropped(webSocket, 0) }
            }
        })
    }

    // 意外断开时重连，最多 3 次；被别处接管（4001）时不重连
    private fun dropped(webSocket: WebSocket, code: Int) {
        if (webSocket != socket || closed) return
        socket = null
        ready = false
        if (code == 4001) {
            error = "这个标签页在别处打开了"
            return
        }
        if (attempts++ < 3) main.postDelayed({ connect() }, 1500L * attempts) else error = "连接已断开"
    }

    private fun receive(message: JsonObject) {
        when (message["type"]?.jsonPrimitive?.content) {
            "ready" -> {
                session = message["id"]?.jsonPrimitive?.content
                ready = true
                attempts = 0
                error = null
                viewport?.let { (width, height, scale) -> sendResize(width, height, scale) }
            }
            "state" -> {
                val state = message["state"] as? JsonObject ?: return
                url = state["url"]?.jsonPrimitive?.content ?: ""
                title = state["title"]?.jsonPrimitive?.content ?: ""
                canBack = state["canBack"]?.jsonPrimitive?.content == "true"
                canForward = state["canForward"]?.jsonPrimitive?.content == "true"
                pendingUrl?.let { target ->
                    pendingUrl = null
                    if (target != url) navigate(target)
                }
            }
            "error" -> error = message["message"]?.jsonPrimitive?.content
            "ping" -> send(buildJsonObject { put("type", "ping") })
            "replaced" -> error = "这个标签页在别处打开了"
            "closed" -> error = "标签页已关闭"
        }
    }

    // 一帧分成多块：每块都要确认，最后一块解码完再确认，后端据此控制节奏
    private fun receiveFrame(webSocket: WebSocket, message: JsonObject) {
        val number = message["frame"]!!.jsonPrimitive.int
        if (number != chunkFrame) {
            chunkFrame = number
            chunks = StringBuilder()
        }
        chunks.append(message["data"]!!.jsonPrimitive.content)
        val ack = buildJsonObject { put("type", "ack"); put("frame", number) }.toString()
        if (message["more"]?.jsonPrimitive?.content == "true") {
            webSocket.send(ack)
            return
        }
        val data = chunks.toString()
        chunks = StringBuilder()
        val size = IntSize(message["width"]!!.jsonPrimitive.int, message["height"]!!.jsonPrimitive.int)
        thread {
            val bytes = runCatching { Base64.decode(data, Base64.DEFAULT) }.getOrNull()
            val bitmap = bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            main.post {
                if (bitmap != null) {
                    frame = bitmap.asImageBitmap()
                    frameSize = size
                }
                webSocket.send(ack)
            }
        }
    }

    private fun send(message: JsonObject) {
        socket?.send(message.toString())
    }

    private fun sendResize(width: Int, height: Int, scale: Float) = send(buildJsonObject {
        put("type", "resize")
        put("width", width.coerceIn(1, 4096))
        put("height", height.coerceIn(1, 4096))
        put("scale", scale.coerceIn(1f, 2f))
    })

    // 画面区域的大小（CSS 像素）
    fun resize(width: Int, height: Int, scale: Float) {
        viewport = Triple(width, height, scale)
        if (ready) sendResize(width, height, scale)
    }

    fun open(target: String) {
        if (target.isBlank()) return
        if (ready) navigate(target) else pendingUrl = target
    }

    fun navigate(target: String) {
        val normalized = if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(target)) target
        else if (target.contains('.') && !target.contains(' ')) "https://$target"
        else "https://www.google.com/search?q=${java.net.URLEncoder.encode(target, "UTF-8")}"
        send(buildJsonObject { put("type", "navigate"); put("url", normalized) })
    }

    fun command(type: String) = send(buildJsonObject { put("type", type) })

    fun tap(x: Float, y: Float) {
        listOf("down", "up").forEach { action ->
            send(buildJsonObject {
                put("type", "pointer")
                put("action", action)
                put("x", x.coerceIn(0f, 4096f))
                put("y", y.coerceIn(0f, 4096f))
                put("button", "left")
                put("buttons", if (action == "down") 1 else 0)
                put("clickCount", 1)
            })
        }
    }

    fun wheel(x: Float, y: Float, deltaX: Float, deltaY: Float) = send(buildJsonObject {
        put("type", "wheel")
        put("x", x.coerceIn(0f, 4096f))
        put("y", y.coerceIn(0f, 4096f))
        put("deltaX", deltaX.coerceIn(-10000f, 10000f))
        put("deltaY", deltaY.coerceIn(-10000f, 10000f))
    })

    fun text(value: String) = send(buildJsonObject { put("type", "text"); put("text", value) })

    // code 是物理键位（KeyA、Digit1、ArrowLeft……），modifiers 是按着的修饰键（见 modifierKeys）
    fun key(key: String, code: String = key, modifiers: Int = 0) {
        listOf("down", "up").forEach { action ->
            send(buildJsonObject {
                put("type", "key")
                put("action", action)
                put("key", key)
                put("code", code)
                put("modifiers", modifiers)
            })
        }
    }

    fun close() {
        closed = true
        main.removeCallbacksAndMessages(null)
        socket?.close(1000, null)
    }
}

// 浏览器：远程模式操作 Mac 上的 Chrome（经 binOS Browser 扩展），嵌入模式在应用内的 WebView 里打开
@Composable
fun BrowserScreen(url: String) {
    var mode by rememberSaveable { mutableStateOf(0) }
    var address by rememberSaveable { mutableStateOf(url) }
    var embedded by rememberSaveable { mutableStateOf(url.ifEmpty { "https://www.google.com" }) }
    val browser = remember { RemoteBrowser() }
    DisposableEffect(browser) {
        browser.connect()
        if (url.isNotEmpty()) browser.open(url)
        onDispose { browser.close() }
    }
    var typing by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val density = LocalDensity.current
    // 远程页面跳转后，地址栏跟着显示它现在的网址
    LaunchedEffect(browser.url) { if (mode == 0 && browser.url.isNotEmpty()) address = browser.url }
    fun go() {
        if (mode == 0) browser.open(address) else embedded = address.let { if (it.startsWith("http")) it else "https://$it" }
        keyboard?.hide()
    }
    Scaffold(topBar = { BackBar(if (mode == 0) browser.title.ifEmpty { "浏览器" } else "浏览器") }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            PrimaryTabRow(selectedTabIndex = mode) {
                Tab(mode == 0, onClick = { mode = 0 }, text = { Text("远程 Chrome") })
                Tab(mode == 1, onClick = { mode = 1 }, text = { Text("嵌入") })
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                if (mode == 0) {
                    IconButton(onClick = { browser.command("back") }, enabled = browser.canBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "后退") }
                    IconButton(onClick = { browser.command("forward") }, enabled = browser.canForward) { Icon(Icons.AutoMirrored.Outlined.ArrowForward, "前进") }
                }
                TextField(
                    value = address,
                    onValueChange = { address = it },
                    placeholder = { Text(if (mode == 0) browser.url.ifEmpty { "输入网址或搜索" } else embedded) },
                    singleLine = true,
                    shape = CircleShape,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { go() }),
                    colors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
                    modifier = Modifier.weight(1f).onEnter { go() },
                )
                if (mode == 0) {
                    IconButton(onClick = { browser.command("reload") }) { Icon(Icons.Outlined.Refresh, "刷新") }
                    IconButton(onClick = { typing = !typing }) { Icon(Icons.Outlined.Keyboard, "输入文字") }
                }
            }
            if (mode == 1) {
                WebPage(embedded, Modifier.fillMaxSize(), onState = { _, current -> address = current })
                return@Column
            }
            if (typing) {
                var modifiers by remember { mutableIntStateOf(0) }
                KeyBar(browser, modifiers) { modifiers = it }
                TypingBar(browser, modifiers) { modifiers = 0 }
            }
            Box(
                Modifier.fillMaxSize().background(Color(0xFF202124))
                    .onSizeChanged { size ->
                        val scale = density.density
                        browser.resize((size.width / scale).toInt(), (size.height / scale).toInt(), minOf(scale, 2f))
                    }
                    .pointerInput(browser) {
                        // 点按是点击，拖动是滚动；坐标按画面实际显示的区域换算成页面的 CSS 像素
                        awaitEachGesture {
                            val down = awaitFirstDown()
                            var moved = 0f
                            var last = down.position
                            do {
                                val event = awaitPointerEvent()
                                val change = event.changes.first()
                                val delta = change.positionChange()
                                moved += abs(delta.x) + abs(delta.y)
                                if (moved > 8 * density.density) {
                                    val (x, y) = toPage(change.position, size, browser.frameSize)
                                    browser.wheel(x, y, -delta.x / density.density, -delta.y / density.density)
                                    change.consume()
                                }
                                last = change.position
                            } while (event.changes.any { it.pressed })
                            if (moved <= 8 * density.density) {
                                val (x, y) = toPage(last, size, browser.frameSize)
                                browser.tap(x, y)
                            }
                        }
                    },
            ) {
                browser.frame?.let { Image(it, browser.title, Modifier.fillMaxSize(), contentScale = ContentScale.Fit, alignment = Alignment.TopCenter) }
                if (!browser.ready && browser.error == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
                browser.error?.let {
                    Text(
                        "$it\n远程模式需要在 Mac 的 Chrome 里装好 binOS Browser 扩展",
                        color = Color.White,
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

// 实体键盘（以及 adb）的回车也提交
fun Modifier.onEnter(action: () -> Unit) = onPreviewKeyEvent { event ->
    if (event.type == KeyEventType.KeyUp && event.key == Key.Enter) {
        action()
        true
    } else false
}

// 画面按比例缩放、顶部对齐：把屏幕上的点换算成页面坐标
private fun toPage(position: androidx.compose.ui.geometry.Offset, view: IntSize, page: IntSize): Pair<Float, Float> {
    val scale = minOf(view.width.toFloat() / page.width, view.height.toFloat() / page.height)
    val left = (view.width - page.width * scale) / 2
    return (position.x - left) / scale to position.y / scale
}

// 修饰键和 CDP 的 modifiers 位
private val modifierKeys = listOf("Ctrl" to 2, "Alt" to 1, "Shift" to 8, "⌘" to 4)

// 键盘上没有的键：方向键、翻页、F1–F12 等
private val specialKeys = listOf(
    "Esc" to "Escape", "Tab" to "Tab", "←" to "ArrowLeft", "↑" to "ArrowUp", "↓" to "ArrowDown", "→" to "ArrowRight",
    "Home" to "Home", "End" to "End", "PgUp" to "PageUp", "PgDn" to "PageDown", "Del" to "Delete",
) + (1..12).map { "F$it" to "F$it" }

// 按键栏：先点修饰键再按键（或者在下面打一个字）是组合键，按完一次修饰键就松开
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun KeyBar(browser: RemoteBrowser, modifiers: Int, onModifiers: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        modifierKeys.forEach { (label, bit) ->
            FilterChip(modifiers and bit != 0, onClick = { onModifiers(modifiers xor bit) }, label = { Text(label) })
        }
        specialKeys.forEach { (label, key) ->
            AssistChip(onClick = {
                browser.key(key, key, modifiers)
                onModifiers(0)
            }, label = { Text(label) })
        }
    }
}

// 字符对应的物理键位，组合键（Ctrl+C 之类）要用
private fun codeOf(char: Char): String = when {
    char in 'a'..'z' || char in 'A'..'Z' -> "Key${char.uppercaseChar()}"
    char in '0'..'9' -> "Digit$char"
    else -> ""
}

// 往远程页面里打字：文字整段插入，回车和退格按键发送；按着修饰键时打的字作为组合键发送
@Composable
private fun TypingBar(browser: RemoteBrowser, modifiers: Int, onCombined: () -> Unit) {
    var value by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    TextField(
        value = value,
        onValueChange = { next ->
            when {
                modifiers != 0 && next.length > value.length && next.startsWith(value) -> {
                    next.substring(value.length).forEach { browser.key(it.toString(), codeOf(it), modifiers) }
                    onCombined()
                    return@TextField
                }
                next.length > value.length && next.startsWith(value) -> browser.text(next.substring(value.length))
                next.length < value.length && value.startsWith(next) -> repeat(value.length - next.length) { browser.key("Backspace") }
                else -> browser.text(next)
            }
            value = next
        },
        placeholder = { Text("在页面的输入框里打字") },
        singleLine = true,
        keyboardActions = KeyboardActions(onDone = {
            browser.key("Enter", "Enter", modifiers)
            onCombined()
            value = ""
        }),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        modifier = Modifier.fillMaxWidth().focusRequester(focus).onKeyEvent { event ->
            if (event.nativeKeyEvent.action == KeyEvent.ACTION_DOWN && event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DEL && value.isEmpty()) {
                browser.key("Backspace")
                true
            } else false
        },
    )
    DisposableEffect(Unit) {
        focus.requestFocus()
        onDispose { }
    }
}
