package app.binos.code

import androidx.compose.runtime.getValue
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

// 对话里的一条事件：seq 是在对话里的位置，从 1 开始；turnId 是所属的一轮，第一条 session 条目没有；
// itemId 是所属的条目，一次工具调用和它的结果相同；parentId 是子 agent 的条目所属的那次调用的 itemId
class PageEvent(val seq: Int, val turnId: String?, val itemId: String?, val parentId: String?, val entry: Entry)

// 解不开的条目按不认识的显示，不影响其他条目
fun parsePageEvent(element: JsonElement): PageEvent? = (element as? JsonObject)?.let { event ->
    val seq = (event["seq"] as? JsonPrimitive)?.content?.toIntOrNull() ?: return null
    PageEvent(seq, event.string("turnId"), event.string("itemId"), event.string("parentId"), event["data"]?.let(::parseEntry) ?: Entry.Unknown())
}

// thread 的内容：events 是 seq 连续的一段，第一条的 seq 大于 1 时前面还有更早的，由 loadOlder 往前补读；
// turns 随事件增量更新，没变的轮沿用原来的对象。在主线程上修改，界面直接读取
class ThreadState(val thread: String) {
    var events by mutableStateOf<List<PageEvent>>(emptyList())
        private set
    var turns by mutableStateOf<List<Turn>>(emptyList())
        private set
    // 第一条条目，由 window 给出
    var session by mutableStateOf<Entry.Session?>(null)
        private set
    var live by mutableStateOf<Live?>(null)
        private set
    var loaded by mutableStateOf(false)
        private set
    var loadingOlder by mutableStateOf(false)
        private set

    val firstSeq: Int get() = events.firstOrNull()?.seq ?: 1
    val hasOlder: Boolean get() = firstSeq > 1

    // 收到的最后一条的 seq；还没收到过 window 时为 null，连接时只要最后几轮
    private var last: Int? = null

    private fun replace(events: List<PageEvent>) {
        this.events = events
        turns = splitTurns(events, turns)
    }

    // 断开后自动重连：从收到的最后一条接着补发
    suspend fun follow() {
        app.api.eventStream {
            val known = last
            app.api.url("/api/kita/sessions/${encode(thread)}/stream?" + if (known != null) "from=$known" else "tail=$pageSize").toString()
        }.collect(::apply)
    }

    fun apply(signal: StreamSignal) {
        if (signal == StreamSignal.Open) loaded = true
        if (signal !is StreamSignal.Message) return
        val event = runCatching { json.parseToJsonElement(signal.message.data) }.getOrNull() as? JsonObject ?: return
        when (event.string("type")) {
            // 重新给出最后几轮，之前收到的都不要了
            "window" -> {
                val events = (event["events"] as? JsonArray).orEmpty().mapNotNull(::parsePageEvent)
                last = events.lastOrNull()?.seq ?: 0
                session = event["session"]?.let { parseEntry(it) as? Entry.Session }
                live = null
                turns = emptyList()
                replace(events)
            }
            "event" -> event["event"]?.let(::parsePageEvent)?.let { append(listOf(it)) }
            "events" -> append((event["events"] as? JsonArray).orEmpty().mapNotNull(::parsePageEvent))
            "live" -> live = event["live"]?.takeIf { it !is JsonNull }?.let(::parseLive)
            else -> live = live?.let { applyLiveEvent(it, event) }
        }
    }

    // 只接紧接着收到的最后一条、seq 连续的那一段
    private fun append(events: List<PageEvent>) {
        val known = last ?: return
        val added = events.dropWhile { it.seq <= known }.withIndex().takeWhile { (index, event) -> event.seq == known + 1 + index }.map { it.value }
        if (added.isEmpty()) return
        last = added.last().seq
        replace(this.events + added)
        for (item in added) live = live?.let { applyEntry(it, item.entry) }
    }

    // 往前补读一段；给出 until 时一直读到包含这个 seq。这期间重新给出过最后几轮、位置对不上时不接
    fun loadOlder(scope: CoroutineScope, until: Int? = null) {
        val first = firstSeq
        if (first <= 1 || loadingOlder) return
        loadingOlder = true
        scope.launch {
            try {
                val limit = maxOf(pageSize, first - (until ?: first))
                val older = app.api.getJson("/api/kita/sessions/${encode(thread)}/events?before=$first&limit=$limit")
                    .jsonObject["events"]?.jsonArray.orEmpty().mapNotNull(::parsePageEvent)
                val contiguous = older.withIndex().all { (index, event) -> event.seq == older.first().seq + index }
                if (older.isNotEmpty() && contiguous && older.last().seq == first - 1 && firstSeq == first) replace(older + events)
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
private data class CallDetail(val call: JsonElement, val result: JsonElement? = null)

// seq 处的工具调用和它的结果，完整的；读不到时返回 null
suspend fun readFullCall(thread: String, seq: Int): Pair<Entry.ToolCall, Entry.ToolResult?>? = runCatching {
    val value = json.decodeFromJsonElement<CallDetail>(app.api.getJson("/api/kita/sessions/${encode(thread)}/calls/$seq"))
    val call = parsePageEvent(value.call)?.entry as? Entry.ToolCall ?: return null
    call to value.result?.let { parsePageEvent(it)?.entry as? Entry.ToolResult }
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
