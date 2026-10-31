package app.binos.code

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import app.binos.net.Api
import app.binos.net.ApiException
import app.binos.net.LossyList
import app.binos.net.json
import app.binos.net.octetType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.addJsonObject
import okhttp3.MediaType
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.net.URLEncoder

// 正在回答时：插话（agent 在下一步看到）、先打断再说、排到这一轮答完之后
enum class SendMode { Send, Interrupt, Queue }

// 下一轮用的 agent、模型和思考程度；agent 只在新对话时能选
data class Choice(val agent: String, val model: String? = null, val effort: String? = null)

@Serializable
private data class SessionsResponse(@Serializable(LossyList::class) val sessions: List<SessionSummary>)

@Serializable
private data class ProjectsResponse(@Serializable(LossyList::class) val projects: List<Project>)

@Serializable
private data class CreatedResponse(val id: Int, val kitaSession: String)

const val maxUploadBytes = 50L * 1024 * 1024

class CodeApi(private val api: Api) {
    private val base = "/api/apps/code"

    suspend fun sessions(): List<SessionSummary> = api.get<SessionsResponse>("$base/sessions").sessions
    suspend fun session(id: Int): SessionSummary = api.get("$base/sessions/$id")
    suspend fun projects(): List<Project> = api.get<ProjectsResponse>("$base/projects").projects
    suspend fun search(query: String): SearchResults = api.get("$base/search?q=${encode(query)}")
    suspend fun usage(): CodeUsage? = api.getJson("$base/usage").jsonObject["usage"]?.takeIf { it !is JsonNull }?.let { json.decodeFromJsonElement<CodeUsage>(it) }

    suspend fun createProject(name: String, repository: String, create: Boolean, connect: String? = null): Project {
        val body = buildJsonObject {
            put("name", name)
            put("repository", repository)
            put("create", create)
        }
        val result = if (connect != null) api.putJson("$base/projects/${encode(connect)}/repository", body) else api.postJson("$base/projects", body)
        return json.decodeFromJsonElement(result.jsonObject["project"]!!)
    }

    // 新对话时 sessionId 为 null；返回 session 的编号和 thread
    suspend fun send(sessionId: Int?, project: String, text: String, attachments: List<Upload>, mode: SendMode, choice: Choice): Pair<Int, String> {
        val body = buildJsonObject {
            put("project", project)
            put("text", text)
            putJsonArray("attachments") { attachments.forEach { addJsonObject { put("file", it.file); put("name", it.name) } } }
            if (mode == SendMode.Interrupt) put("interrupt", true)
            if (mode == SendMode.Queue) put("queue", true)
            put("agent", choice.agent)
            choice.model?.let { put("model", it) }
            choice.effort?.let { put("effort", it) }
        }
        val path = if (sessionId == null) "$base/sessions" else "$base/sessions/$sessionId/messages"
        val result = api.postJson(path, body).jsonObject
        return result["id"]!!.jsonPrimitive.content.toInt() to result["kitaSession"]!!.jsonPrimitive.content
    }

    suspend fun upload(resolver: ContentResolver, uri: Uri): Upload {
        val (name, size) = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) (cursor.getString(0) ?: "file") to cursor.getLong(1) else null
        } ?: ("file" to -1L)
        if (size > maxUploadBytes) throw ApiException(413, "too-large", "$name 太大，附件最大 ${maxUploadBytes / 1024 / 1024} MB")
        val body = object : RequestBody() {
            override fun contentType(): MediaType = octetType
            override fun contentLength(): Long = size
            override fun writeTo(sink: BufferedSink) {
                resolver.openInputStream(uri)!!.source().use { sink.writeAll(it) }
            }
        }
        val result = try {
            api.upload("$base/uploads", body, mapOf("X-File-Name" to encode(name)))
        } catch (error: ApiException) {
            throw ApiException(error.status, error.code, "上传 $name 失败：${error.message}")
        }
        return Upload(result.jsonObject["file"]!!.jsonPrimitive.content, name)
    }

    // 撤回排队的消息，返回它的文字；已经发出去时是 410
    suspend fun withdraw(sessionId: Int, item: String): String =
        api.delete("$base/sessions/$sessionId/queue/${encode(item)}").jsonObject["text"]!!.jsonPrimitive.content

    suspend fun sendQueued(sessionId: Int, item: String) {
        api.postJson("$base/sessions/$sessionId/queue/${encode(item)}/send")
    }

    suspend fun stop(sessionId: Int) {
        api.postJson("$base/sessions/$sessionId/stop")
    }

    suspend fun edit(sessionId: Int, title: String? = null, pinned: Boolean? = null, archived: Boolean? = null): SessionSummary =
        json.decodeFromJsonElement(api.patchJson("$base/sessions/$sessionId", buildJsonObject {
            title?.let { put("title", it) }
            pinned?.let { put("pinned", it) }
            archived?.let { put("archived", it) }
        }))

    suspend fun markRead(sessionId: Int) {
        runCatching { api.postJson("$base/sessions/$sessionId/read") }
    }

    // ---- agent 服务 ----

    suspend fun status(): AgentStatus = api.get("/api/kita/status")

    suspend fun accounts(): List<AgentAccount> = json.decodeFromJsonElement(LossyList(AgentAccount.serializer()), api.getJson("/api/kita/accounts").jsonObject["accounts"]!!)

    suspend fun catalogs(): List<AgentCatalog> = json.decodeFromJsonElement(LossyList(AgentCatalog.serializer()), api.getJson("/api/kita/agents").jsonObject["agents"]!!)

    fun fileUrl(thread: String, file: String, name: String? = null): String =
        api.url("/api/kita/sessions/${encode(thread)}/files/${encode(file)}").newBuilder().apply { name?.let { addQueryParameter("name", it) } }.build().toString()
}

fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
