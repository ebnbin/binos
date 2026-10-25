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
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

// 和 web/src/services/kita/session/useKitaSession.ts、useFullCall.ts 对应

// 打开时先读最后至少这么多条，往上翻时每次再读这么多
private const val pageSize = 300

// 事件的 seq 是到它为止的条数，也就是它的位置加一
private data class PageEvent(val seq: Int, val entry: Entry)

// 解不开的条目也占住它的序号
private fun parsePageEvent(element: JsonElement): PageEvent? = (element as? JsonObject)?.let { event ->
    val seq = (event["seq"] as? JsonPrimitive)?.content?.toIntOrNull() ?: return null
    PageEvent(seq, event["data"]?.let(::parseEntry) ?: Entry.Unknown())
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
        val event = runCatching { json.parseToJsonElement(signal.message.data) }.getOrNull() as? JsonObject ?: return
        when (event.string("type")) {
            // 从这里开始补发，之前收到的都不要了
            "window" -> {
                val from = (event["from"] as? JsonPrimitive)?.content?.toIntOrNull() ?: return
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

    // 只接紧接着已收到位置、序号连续的那一段
    private fun append(events: List<PageEvent>) {
        val known = count ?: return
        val entries = events.dropWhile { it.seq <= known }.withIndex().takeWhile { (index, event) -> event.seq == known + 1 + index }.map { it.value.entry }
        if (entries.isEmpty()) return
        count = known + entries.size
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
                val contiguous = events.withIndex().all { (index, event) -> event.seq == events.first().seq + index }
                if (events.isNotEmpty() && contiguous && events.last().seq == end && offset == end) {
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

private fun JsonObject.string(key: String): String? = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun parseLive(element: JsonElement): Live = runCatching { json.decodeFromJsonElement(Live.serializer(), element) }.getOrElse {
    val obj = element as? JsonObject
    Live(thinking = obj?.string("thinking") ?: "", text = obj?.string("text") ?: "")
}

// 记成条目的思考和文字取代对应的临时内容
private fun applyEntry(live: Live, entry: Entry): Live = when {
    entry.parent != null -> live
    entry is Entry.Text -> live.copy(text = "", files = emptyMap())
    entry is Entry.Thinking -> live.copy(thinking = "")
    else -> live
}

private fun applyLiveEvent(live: Live, event: JsonObject): Live {
    val text = { event.string("text") ?: "" }
    return when (event.string("type")) {
        "thinking" -> live.copy(thinking = live.thinking + text())
        "text" -> live.copy(text = live.text + text())
        "file" -> {
            val path = event.string("path") ?: return live
            live.copy(files = live.files + (path to (event.string("name") ?: path.substringAfterLast('/'))))
        }
        "status" -> live.copy(status = event["status"]?.takeIf { it !is JsonNull }?.let { runCatching { json.decodeFromJsonElement(Status.serializer(), it) }.getOrDefault(Status.Other) })
        "task" -> {
            val callId = event.string("callId") ?: return live
            val progress = event["progress"]?.takeIf { it !is JsonNull }?.let { runCatching { json.decodeFromJsonElement(TaskProgress.serializer(), it) }.getOrDefault(TaskProgress()) }
            live.copy(tasks = if (progress == null) live.tasks - callId else live.tasks + (callId to progress))
        }
        else -> live
    }
}
