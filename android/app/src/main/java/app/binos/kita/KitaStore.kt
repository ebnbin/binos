package app.binos.kita

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import app.binos.app
import app.binos.code.encode
import app.binos.net.ApiException
import app.binos.net.json
import app.binos.net.octetType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source

// 和 server/src/apps/kita/types.ts、server/src/services/kita/types.ts 的身份部分对应

// temporary：临时对话，不带喜多的身份，也读写不了记忆
@Serializable
data class Conversation(
    val id: String,
    val title: String,
    val temporary: Boolean = false,
    val agent: String,
    val state: String = "idle",
    val createdAt: String = "",
    val updatedAt: String = "",
    val outcome: String? = null,
)

@Serializable
data class Photo(val file: String, val addedAt: String = "")

@Serializable
data class Profile(val description: String = "", val photos: List<Photo> = emptyList(), val avatar: String? = null)

// type 是 user（页面上的用户）或 session（某个 app 的 session 里的 agent）
@Serializable
data class MemorySource(val type: String, val owner: String? = null, val session: String? = null)

@Serializable
data class MemoryVersion(val text: String, val kind: String, val time: String, val source: MemorySource)

// kind：stated 是用户说过或确认过的，inferred 是推测的；history 是改动前的各个版本，从旧到新
@Serializable
data class Memory(
    val id: String,
    val text: String,
    val kind: String,
    val scope: String,
    val source: MemorySource,
    val createdAt: String = "",
    val updatedAt: String = "",
    val history: List<MemoryVersion> = emptyList(),
)

@Serializable
data class Activity(val session: String, val owner: String, val state: String, val since: String = "")

@Serializable
private data class Conversations(val conversations: List<Conversation>)

@Serializable
private data class Profiles(val profile: Profile)

@Serializable
private data class Memories(val memories: List<Memory>)

@Serializable
private data class Activities(val activity: List<Activity>)

const val maxPhotoBytes = 20L * 1024 * 1024
private val photoTypes = setOf("jpg", "jpeg", "png", "webp", "gif", "heic", "avif")

// 内置 app 的名字，喜多的状态和记忆的来源用到
val appNames = mapOf("code" to "Code", "kita" to "喜多", "music" to "音乐", "terminal" to "终端", "files" to "文件", "system" to "系统")

private const val appBase = "/api/apps/kita"
private const val identityBase = "/api/kita"

// 喜多 app 用到的全部数据：对话、描述和照片、记忆、各 app 正在回答的 session，收到 kita、session 通知（以及重新连上）时重新读取
object KitaStore {
    private val api get() = app.api

    private val _conversations = MutableStateFlow<List<Conversation>?>(null)
    val conversations: StateFlow<List<Conversation>?> = _conversations.asStateFlow()
    private val _profile = MutableStateFlow<Profile?>(null)
    val profile: StateFlow<Profile?> = _profile.asStateFlow()
    private val _memories = MutableStateFlow<List<Memory>?>(null)
    val memories: StateFlow<List<Memory>?> = _memories.asStateFlow()
    private val _activity = MutableStateFlow<List<Activity>>(emptyList())
    val activity: StateFlow<List<Activity>> = _activity.asStateFlow()
    private val _failed = MutableStateFlow(false)
    val failed: StateFlow<Boolean> = _failed.asStateFlow()
    private var refreshing: Job? = null

    init {
        app.scope.launch { app.events.of("kita", "session").collect { refresh() } }
        refresh()
    }

    // 只保留最新的一次读取
    fun refresh() {
        refreshing?.cancel()
        refreshing = app.scope.launch {
            try {
                val conversations = api.get<Conversations>("$appBase/conversations").conversations
                val profile = api.get<Profiles>("$identityBase/profile").profile
                val memories = api.get<Memories>("$identityBase/memories").memories
                val activity = runCatching { api.get<Activities>("$identityBase/activity").activity }.getOrDefault(emptyList())
                _conversations.value = conversations
                _profile.value = profile
                _memories.value = memories
                _activity.value = activity
                _failed.value = false
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                _failed.value = true
            }
        }
    }

    fun photoUrl(file: String): String = api.url("$identityBase/profile/photos/${encode(file)}").toString()

    // ---- 对话 ----

    // 新对话返回它的 id
    suspend fun start(text: String, temporary: Boolean, agent: String): String =
        unavailable { api.postJson("$appBase/conversations", buildJsonObject { put("text", text); put("temporary", temporary); put("agent", agent) }) }
            .jsonObject["id"]!!.jsonPrimitive.content.also { refresh() }

    // 正在回答时交给 agent，它在下一步看到
    suspend fun send(id: String, text: String) {
        unavailable { api.postJson("$appBase/conversations/${encode(id)}/messages", buildJsonObject { put("text", text) }) }
    }

    suspend fun stop(id: String) {
        api.postJson("$appBase/conversations/${encode(id)}/stop")
    }

    // 只能删没在回答的
    suspend fun delete(id: String) {
        try {
            api.postJson("$appBase/conversations/${encode(id)}/delete")
        } catch (error: ApiException) {
            throw if (error.status == 409) ApiException(409, "正在回答，停下后才能删除") else error
        }
    }

    private suspend fun <T> unavailable(block: suspend () -> T): T = try {
        block()
    } catch (error: ApiException) {
        throw if (error.status == 503) ApiException(503, "消息没能发出，稍后再试") else error
    }

    // ---- 描述和照片 ----

    suspend fun saveDescription(description: String) {
        api.postJson("$identityBase/profile/description", buildJsonObject { put("description", description) })
    }

    // 后端按文件名的扩展名判断格式；相册给的名字没有扩展名时按类型补上
    suspend fun uploadPhoto(resolver: ContentResolver, uri: Uri) {
        val (displayName, size) = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) (cursor.getString(0) ?: "photo") to cursor.getLong(1) else null
        } ?: ("photo" to -1L)
        val extension = displayName.substringAfterLast('.', "").lowercase()
        val name = if (extension in photoTypes) displayName
        else MimeTypeMap.getSingleton().getExtensionFromMimeType(resolver.getType(uri))?.let { "$displayName.$it" } ?: displayName
        if (size > maxPhotoBytes) throw ApiException(413, "$name 太大，照片最大 ${maxPhotoBytes / 1024 / 1024} MB")
        val body = object : RequestBody() {
            override fun contentType(): MediaType = octetType
            override fun contentLength(): Long = size
            override fun writeTo(sink: BufferedSink) {
                resolver.openInputStream(uri)!!.source().use { sink.writeAll(it) }
            }
        }
        try {
            api.upload("$identityBase/profile/photos", body, mapOf("X-File-Name" to encode(name)))
        } catch (error: ApiException) {
            throw if (error.status == 400) error else ApiException(error.status, "上传 $name 失败（${error.status}）")
        }
    }

    suspend fun removePhoto(file: String) {
        api.postJson("$identityBase/profile/photos/${encode(file)}/delete")
    }

    suspend fun setAvatar(file: String) {
        api.postJson("$identityBase/profile/photos/${encode(file)}/avatar")
    }

    // ---- 记忆 ----

    // 页面上的用户添加的，默认记到个人范围
    suspend fun addMemory(text: String, kind: String = "stated", scope: String? = null): Memory =
        json.decodeFromJsonElement(api.postJson("$identityBase/memories", buildJsonObject {
            put("text", text)
            put("kind", kind)
            scope?.let { put("scope", it) }
        }).jsonObject["memory"]!!)

    suspend fun updateMemory(id: String, text: String? = null, kind: String? = null) {
        api.postJson("$identityBase/memories/${encode(id)}", buildJsonObject {
            text?.let { put("text", it) }
            kind?.let { put("kind", it) }
        })
    }

    suspend fun removeMemory(id: String) {
        api.postJson("$identityBase/memories/${encode(id)}/delete", JsonObject(emptyMap()))
    }

    // 恢复上一个版本，这个版本不再保留
    suspend fun revertMemory(id: String) {
        try {
            api.postJson("$identityBase/memories/${encode(id)}/revert", JsonObject(emptyMap()))
        } catch (error: ApiException) {
            throw if (error.status == 409) ApiException(409, "没有可以恢复的版本") else error
        }
    }
}

// 喜多现在在做什么，按各个 app 里真实在回答的 session 说
data class KitaStatus(val busy: Boolean, val label: String)

fun kitaStatus(activity: List<Activity>): KitaStatus {
    if (activity.isEmpty()) return KitaStatus(false, "空闲")
    val parts = activity.groupingBy { it.owner }.eachCount().map { (owner, count) ->
        val name = appNames[owner] ?: owner
        if (count > 1) "$name（$count）" else name
    }
    return KitaStatus(true, "回答中：${parts.joinToString("、")}")
}
