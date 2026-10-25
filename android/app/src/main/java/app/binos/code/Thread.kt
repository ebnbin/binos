package app.binos.code

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.binos.app
import app.binos.net.StreamSignal
import app.binos.net.eventStream
import app.binos.net.json
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// 和 web/src/services/kita/session/useKitaSession.ts、useFullCall.ts 对应

// 打开时先读最后至少这么多条，往上翻时每次再读这么多
private const val pageSize = 300

// 事件的 seq 是到它为止的条数，也就是它的位置加一
private data class PageEvent(val seq: Int, val entry: Entry)

private fun parsePageEvent(element: JsonElement): PageEvent? = (element as? JsonObject)?.let { event ->
    val seq = event["seq"]?.jsonPrimitive?.content?.toIntOrNull() ?: return null
    PageEvent(seq, parseEntry(event["data"] ?: return null))
}

// thread 的内容：items 是从 offset 开始的连续条目，offset 大于 0 时前面还有更早的，由 loadOlder 往前补读；
// turns 随条目增量更新，没变的轮沿用原来的对象。在主线程上修改，界面直接读取
class ThreadState(val thread: String) {
    var items by mutableStateOf<List<Entry>>(emptyList())
        private set
    var offset by mutableIntStateOf(0)
        private set
    var turns by mutableStateOf<List<Turn>>(emptyList())
        private set
    // 第一条条目；只读最后几轮时由 window 给出
    var session by mutableStateOf<Entry.Session?>(null)
        private set
    var live by mutableStateOf<Live?>(null)
        private set
    var loaded by mutableStateOf(false)
        private set
    var loadingOlder by mutableStateOf(false)
        private set

    // 已收到的条数；还没收到过时为 null，连接时只要最后几轮
    private var count: Int? = null

    private fun replace(items: List<Entry>, offset: Int) {
        this.items = items
        this.offset = offset
        turns = splitTurns(items, turns, offset)
        if (offset == 0) (items.firstOrNull() as? Entry.Session)?.let { session = it }
    }

    // 断开后自动重连：从已收到的位置接着补发
    suspend fun follow() {
        app.api.eventStream {
            val known = count
            app.api.url("/api/kita/sessions/${encode(thread)}/stream?" + if (known != null) "from=$known" else "tail=$pageSize").toString()
        }.collect(::apply)
    }

    fun apply(signal: StreamSignal) {
        if (signal == StreamSignal.Open) loaded = true
        if (signal !is StreamSignal.Message) return
        val event = runCatching { json.parseToJsonElement(signal.message.data).jsonObject }.getOrNull() ?: return
        when (event["type"]?.jsonPrimitive?.content) {
            // 从这里开始补发，之前收到的都不要了
            "window" -> {
                val from = event["from"]?.jsonPrimitive?.content?.toIntOrNull() ?: return
                count = from
                session = event["session"]?.let { parseEntry(it) as? Entry.Session }
                live = null
                turns = emptyList()
                replace(emptyList(), from)
            }
            "event" -> event["event"]?.let(::parsePageEvent)?.let { append(listOf(it)) }
            "events" -> append((event["events"] as? JsonArray).orEmpty().mapNotNull(::parsePageEvent))
            "live" -> live = event["live"]?.takeIf { it !is JsonNull }?.let(::parseLive)
            else -> live = live?.let { applyLiveEvent(it, event) }
        }
    }

    private fun append(events: List<PageEvent>) {
        val known = count ?: return
        if (events.isEmpty() || events.first().seq != known + 1) return
        count = known + events.size
        val entries = events.map { it.entry }
        replace(items + entries, offset)
        for (entry in entries) live = live?.let { applyEntry(it, entry) }
    }

    // 往前补读一段；给出 until 时一直读到包含这个位置。这期间重新补发过、位置对不上时不接
    fun loadOlder(scope: CoroutineScope, until: Int? = null) {
        val end = offset
        if (end == 0 || loadingOlder) return
        loadingOlder = true
        scope.launch {
            try {
                val limit = maxOf(pageSize, end - (until ?: end))
                val events = app.api.getJson("/api/kita/sessions/${encode(thread)}/events?before=$end&limit=$limit")
                    .jsonObject["events"]?.jsonArray.orEmpty().mapNotNull(::parsePageEvent)
                if (events.isNotEmpty() && events.last().seq == end && offset == end) {
                    replace(events.map { it.entry } + items, events.first().seq - 1)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // 下次滚到顶部附近时再读
            } finally {
                loadingOlder = false
            }
        }
    }
}

// 最近打开过的几个 thread：再打开时先显示已有的内容，再从它之后接着补发
object ThreadCache {
    private const val size = 10
    private val threads = LinkedHashMap<String, ThreadState>(16, 0.75f, true)

    fun get(thread: String): ThreadState = threads.getOrPut(thread) { ThreadState(thread) }.also {
        while (threads.size > size) threads.remove(threads.keys.first())
    }
}

@Serializable
private data class FullCall(val call: JsonElement, val result: JsonElement? = null)

// index 处的工具调用和它的结果，完整的；读不到时返回 null
suspend fun readFullCall(thread: String, index: Int): Pair<Entry.ToolCall, Entry.ToolResult?>? = runCatching {
    val value = json.decodeFromJsonElement<FullCall>(app.api.getJson("/api/kita/sessions/${encode(thread)}/calls/$index"))
    val call = parseEntry(value.call) as? Entry.ToolCall ?: return null
    call to value.result?.let { parseEntry(it) as? Entry.ToolResult }
}.getOrElse { if (it is CancellationException) throw it else null }

private fun parseLive(element: JsonElement): Live = runCatching { json.decodeFromJsonElement(Live.serializer(), element) }.getOrElse {
    val obj = element.jsonObject
    Live(thinking = obj["thinking"]?.jsonPrimitive?.content ?: "", text = obj["text"]?.jsonPrimitive?.content ?: "")
}

// 记成条目的思考和文字取代对应的临时内容
private fun applyEntry(live: Live, entry: Entry): Live = when {
    entry.parent != null -> live
    entry is Entry.Text -> live.copy(text = "", files = emptyMap())
    entry is Entry.Thinking -> live.copy(thinking = "")
    else -> live
}

private fun applyLiveEvent(live: Live, event: JsonObject): Live {
    val text = { event["text"]?.jsonPrimitive?.content ?: "" }
    return when (event["type"]?.jsonPrimitive?.content) {
        "thinking" -> live.copy(thinking = live.thinking + text())
        "text" -> live.copy(text = live.text + text())
        "file" -> live.copy(files = live.files + (event["path"]!!.jsonPrimitive.content to event["name"]!!.jsonPrimitive.content))
        "status" -> live.copy(status = event["status"]?.takeIf { it !is JsonNull }?.let { runCatching { json.decodeFromJsonElement(Status.serializer(), it) }.getOrNull() })
        "task" -> {
            val callId = event["callId"]!!.jsonPrimitive.content
            val progress = event["progress"]?.takeIf { it !is JsonNull }?.let { json.decodeFromJsonElement(TaskProgress.serializer(), it) }
            live.copy(tasks = if (progress == null) live.tasks - callId else live.tasks + (callId to progress))
        }
        else -> live
    }
}
