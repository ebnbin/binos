package app.binos.music

import app.binos.app
import app.binos.code.encode
import app.binos.net.json
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.UUID

// 和 server/src/apps/music/types.ts 对应

@Serializable
data class TrackRef(val provider: String, val id: String)

@Serializable
data class Album(val id: String? = null, val title: String)

@Serializable
data class Track(
    val ref: TrackRef,
    val title: String,
    val artists: List<String> = emptyList(),
    val album: Album? = null,
    val artworkUrl: String? = null,
    val durationMs: Long? = null,
    val externalUrl: String,
) {
    val key get() = "${ref.provider}:${ref.id}"
    val artistText get() = artists.joinToString(" / ").ifEmpty { "未知艺人" }
}

@Serializable
data class CatalogPage(val tracks: List<Track> = emptyList(), val nextPage: String? = null, val warning: String? = null)

@Serializable
data class Capability(val state: String, val reason: String? = null)

@Serializable
data class ReferenceRule(val pattern: String, val capability: String)

@Serializable
data class ProviderInput(val references: List<ReferenceRule> = emptyList())

@Serializable
data class SettingLink(val label: String, val url: String)

// 连接来源要填的一项；configured：已经填过，值不会返回
@Serializable
data class SettingField(val id: String, val label: String, val description: String = "", val secret: Boolean = false, val configured: Boolean = false, val links: List<SettingLink> = emptyList())

@Serializable
data class ProviderConfiguration(val fields: List<SettingField> = emptyList())

@Serializable
data class ProviderInfo(
    val id: String,
    val name: String,
    val description: String = "",
    val input: ProviderInput = ProviderInput(),
    val capabilities: Map<String, Capability> = emptyMap(),
    val configuration: ProviderConfiguration = ProviderConfiguration(),
) {
    fun available(operation: String) = capabilities[operation]?.state == "available"

    // 用不了时给用户看的原因
    fun unavailableReason(operation: String): String? = when (val capability = capabilities[operation]) {
        null -> null
        else -> when (capability.state) {
            "available" -> null
            "configuration-required" -> capability.reason ?: "需要先在设置里连接"
            else -> "此来源不支持${mapOf("search" to "搜索", "resolve" to "链接导入", "playlist" to "歌单导入")[operation] ?: operation}"
        }
    }

    // 输入的是链接时导入，否则搜索
    fun operationFor(query: String): String =
        input.references.firstOrNull { Regex(it.pattern, RegexOption.IGNORE_CASE).containsMatchIn(query) }?.capability ?: "search"
}

@Serializable
private data class Providers(val providers: List<ProviderInfo>)

@Serializable
data class QueueSnapshot(val revision: Int = 0, val tracks: List<Track> = emptyList())

@Serializable
data class Lyrics(val text: String, val attribution: String? = null)

private const val base = "/api/apps/music"

// 一次修改：id 让后端认出重试的同一次修改
private class QueueMutation(val id: String, val operation: JsonObject)

// 队列最多这么多首
const val maxQueue = 500

// 音乐的共享数据：所有设备共用的播放队列和音乐来源，随 music 通知重新读取。和 web/src/apps/music/queueSync.ts 一致：
// 快照按 revision 丢弃旧的，修改按顺序逐个提交，失败时排着队重试，显示的队列是最新快照加上还没提交的修改
object MusicStore {
    private val _queue = MutableStateFlow<List<Track>?>(null)
    val queue: StateFlow<List<Track>?> = _queue.asStateFlow()
    private val _providers = MutableStateFlow<List<ProviderInfo>>(emptyList())
    val providers: StateFlow<List<ProviderInfo>> = _providers.asStateFlow()
    private val _sync = MutableStateFlow("正在同步队列…")
    val sync: StateFlow<String> = _sync.asStateFlow()
    private val _synced = MutableStateFlow(false)
    val synced: StateFlow<Boolean> = _synced.asStateFlow()

    private val pending = ArrayDeque<QueueMutation>()
    private var snapshot = QueueSnapshot(revision = -1)
    private var flushing = false
    private var retry: Job? = null

    init {
        app.scope.launch { app.events.of("music").collect { refresh() } }
        refresh()
    }

    private fun status(message: String, synced: Boolean) {
        _sync.value = message
        _synced.value = synced
    }

    fun refresh() {
        app.scope.launch { refreshQueue() }
        app.scope.launch { runCatching { app.api.get<Providers>("$base/providers") }.onSuccess { _providers.value = it.providers } }
    }

    suspend fun refreshQueue(): Boolean = try {
        accept(app.api.get<QueueSnapshot>("$base/queue"))
        if (pending.isEmpty()) status("队列已在设备间同步", true)
        true
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        failed()
        false
    }

    private fun accept(next: QueueSnapshot) {
        if (next.revision >= snapshot.revision) snapshot = next
        var tracks = snapshot.tracks
        for (mutation in pending) {
            val operation = mutation.operation
            when (operation["type"]?.jsonPrimitive?.content) {
                "clear" -> tracks = emptyList()
                "remove" -> {
                    val ref = json.decodeFromJsonElement<TrackRef>(operation["ref"]!!)
                    tracks = tracks.filter { it.ref != ref }
                }
                else -> if (operation["type"]?.jsonPrimitive?.content == "add" || snapshot.revision == 0) {
                    val keys = tracks.mapTo(HashSet()) { it.key }
                    val added = json.decodeFromJsonElement<List<Track>>(operation["tracks"]!!).filter { keys.add(it.key) }
                    tracks = (tracks + added).take(maxQueue)
                }
            }
        }
        _queue.value = tracks
    }

    private fun failed() {
        status("队列尚未同步，正在重试…", false)
        retry?.cancel()
        retry = app.scope.launch {
            delay(3000)
            if (pending.isNotEmpty()) flush() else refreshQueue()
        }
    }

    private fun enqueue(operation: JsonObject) {
        pending.addLast(QueueMutation(UUID.randomUUID().toString(), operation))
        status("正在同步队列…", false)
        accept(snapshot)
        app.scope.launch { flush() }
    }

    private suspend fun flush() {
        if (flushing) return
        flushing = true
        try {
            while (pending.isNotEmpty()) {
                val mutation = pending.first()
                val next = app.api.post<QueueSnapshot>("$base/queue", buildJsonObject {
                    put("id", mutation.id)
                    put("operation", mutation.operation)
                })
                pending.removeFirst()
                accept(next)
            }
            status("队列已在设备间同步", true)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            failed()
        } finally {
            flushing = false
        }
    }

    fun add(tracks: List<Track>) = enqueue(buildJsonObject {
        put("type", "add")
        put("tracks", json.encodeToJsonElement(tracks))
    })

    fun remove(track: Track) = enqueue(buildJsonObject {
        put("type", "remove")
        put("ref", json.encodeToJsonElement(track.ref))
    })

    fun clear() = enqueue(buildJsonObject { put("type", "clear") })

    suspend fun catalog(provider: String, operation: String, query: String, page: String? = null): CatalogPage =
        app.api.get("$base/providers/${encode(provider)}/$operation?q=${encode(query)}" + (page?.let { "&page=${encode(it)}" } ?: ""))

    // 改连接设置：值为空字符串表示移除这一项
    suspend fun configure(provider: String, values: Map<String, String>) {
        val updated = json.decodeFromJsonElement<ProviderInfo>(app.api.putJson("$base/providers/${encode(provider)}/settings", buildJsonObject { values.forEach { (key, value) -> put(key, value) } }))
        _providers.value = _providers.value.map { if (it.id == updated.id) updated else it }
    }

    suspend fun lyrics(track: Track): Lyrics = app.api.get("$base/providers/${encode(track.ref.provider)}/lyrics?q=${encode(track.ref.id)}")

    // 后端代理的纯音频流；两个来源的 id 都是 YouTube 的视频 id，官方来源只能嵌入播放，原生播放时同样走这条音频流
    fun streamUrl(track: Track): String = app.api.url("$base/providers/youtube-music/stream?id=${encode(track.ref.id)}").toString()
}
