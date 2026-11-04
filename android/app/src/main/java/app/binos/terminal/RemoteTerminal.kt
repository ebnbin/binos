package app.binos.terminal

import android.os.Handler
import android.os.Looper
import app.binos.app
import app.binos.code.encode
import app.binos.net.json
import com.termux.terminal.RemoteSessionBridge
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

sealed interface TerminalState {
    data object Connecting : TerminalState
    data object Ready : TerminalState
    // 会话结束了（shell 退出或者被关闭）
    data object Exited : TerminalState
    data class Failed(val message: String) : TerminalState
}

// 收到这么多字符或者输出停下这么久，就告诉后端已经处理了，后端据此暂停和恢复输出
private const val ackChars = 32768
private const val ackDelayMs = 20L
private const val chunkChars = 8192
private const val reconnectDelayMs = 2000L

// 接 /api/apps/terminal/sessions/:id/socket 的终端：输出交给 Termux 的模拟器，键盘输入发给后端。协议见 server/src/apps/terminal/connection.ts
class RemoteTerminal(val id: String, client: TerminalSessionClient) {
    val session = TerminalSession("/system/bin/sh", "/", arrayOf(), arrayOf(), 5000, client)
    private val _state = MutableStateFlow<TerminalState>(TerminalState.Connecting)
    val state: StateFlow<TerminalState> = _state.asStateFlow()
    private val main = Handler(Looper.getMainLooper())
    private val socketClient = app.api.http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var socket: WebSocket? = null
    private var closed = false
    private var pending = 0
    private var size = 80 to 24
    private val flushAck = Runnable { sendAck() }

    init {
        RemoteSessionBridge.attach(session, 80, 24, 12, 24)
        // 键盘输入从写队列里读出来发给后端；UTF-8 可能被拆在两次读取之间，用解码器接上
        thread(name = "terminal-input-$id", isDaemon = true) {
            val buffer = ByteArray(4096)
            val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE)
            var leftover = ByteArray(0)
            while (true) {
                val count = RemoteSessionBridge.readInput(session, buffer)
                if (count < 0) break
                val bytes = ByteBuffer.wrap(leftover + buffer.copyOf(count))
                val chars = CharBuffer.allocate(bytes.remaining() + 1)
                decoder.decode(bytes, chars, false)
                leftover = ByteArray(bytes.remaining()).also { bytes.get(it) }
                chars.flip()
                if (chars.isNotEmpty()) main.post { send(chars.toString()) }
            }
        }
        connect()
    }

    private fun connect() {
        if (closed) return
        _state.value = TerminalState.Connecting
        pending = 0
        val url = app.api.url("/api/apps/terminal/sessions/${encode(id)}/socket")
        val request = Request.Builder().url(url).header("Origin", app.server.origin).build()
        socket = socketClient.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                main.post { if (webSocket == socket) receive(text) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                main.post { dropped(webSocket) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                main.post {
                    if (response != null && app.api.isAccessBlocked(response)) app.api.markAuthRequired()
                    dropped(webSocket)
                }
            }
        })
    }

    // 意外断开时 2 秒后重连；会话已结束或出错时不再重连
    private fun dropped(webSocket: WebSocket) {
        if (webSocket != socket || closed) return
        socket = null
        val current = _state.value
        if (current is TerminalState.Exited || current is TerminalState.Failed) return
        _state.value = TerminalState.Connecting
        main.postDelayed({ connect() }, reconnectDelayMs)
    }

    private fun receive(text: String) {
        val message = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        when (message["type"]?.jsonPrimitive?.content) {
            "ready" -> {
                session.reset()
                _state.value = TerminalState.Ready
                socket?.send(resizeMessage(size.first, size.second))
            }
            "output" -> {
                val data = message["data"]?.jsonPrimitive?.content ?: return
                RemoteSessionBridge.feed(session, data.toByteArray(Charsets.UTF_8))
                pending += data.length
                main.removeCallbacks(flushAck)
                if (pending >= ackChars) sendAck() else main.postDelayed(flushAck, ackDelayMs)
            }
            "ping" -> socket?.send("""{"type":"ping"}""")
            "exit" -> _state.value = TerminalState.Exited
            "error" -> _state.value = TerminalState.Failed(message["message"]?.jsonPrimitive?.content ?: "终端出错了")
        }
    }

    private fun sendAck() {
        if (pending > 0) {
            socket?.send(buildJsonObject { put("type", "ack"); put("size", pending) }.toString())
            pending = 0
        }
    }

    // 输入分块发送，后端限制一条消息的长度
    fun send(text: String) {
        if (_state.value != TerminalState.Ready) return
        text.chunked(chunkChars).forEach { chunk ->
            socket?.send(buildJsonObject { put("type", "input"); put("data", chunk) }.toString())
        }
    }

    fun resize(columns: Int, rows: Int) {
        val next = columns.coerceIn(2, 500) to rows.coerceIn(1, 200)
        if (next == size) return
        size = next
        if (_state.value == TerminalState.Ready) socket?.send(resizeMessage(next.first, next.second))
    }

    private fun resizeMessage(columns: Int, rows: Int) = buildJsonObject {
        put("type", "resize")
        put("cols", columns)
        put("rows", rows)
    }.toString()

    // 重新连接，比如回到前台时连接已经断了
    fun reconnect() {
        if (closed || _state.value == TerminalState.Exited) return
        if (socket == null || _state.value is TerminalState.Failed) {
            socket?.cancel()
            socket = null
            main.removeCallbacksAndMessages(null)
            connect()
        }
    }

    fun close() {
        closed = true
        main.removeCallbacksAndMessages(null)
        socket?.close(1000, null)
        socket = null
        RemoteSessionBridge.close(session)
    }
}
