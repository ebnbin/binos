@file:OptIn(ExperimentalSerializationApi::class)

package app.binos.code

import app.binos.net.LossyList
import app.binos.net.LossyMap
import app.binos.net.json
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.modules.SerializersModule
import kotlinx.serialization.modules.polymorphic

// 和 server/src/apps/code/types.ts、server/src/services/kita/types.ts 对应

@Serializable
data class Upload(val file: String, val name: String = "")

@Serializable
data class QueuedMessage(val id: String, val time: String = "", val text: String = "", @Serializable(LossyList::class) val attachments: List<Upload> = emptyList(), val model: String? = null, val effort: String? = null)

@Serializable
data class PullRequest(val url: String, val number: Int, val state: String? = null, val title: String? = null, val preview: String? = null)

@Serializable
data class Project(val id: String, val name: String = "", val repository: String? = null, val defaultBranch: String? = null)

@Serializable
data class ContextSize(val tokens: Long, val window: Long)

@Serializable
data class Tokens(val input: Long = 0, val output: Long = 0, val cacheRead: Long = 0, val cacheWrite: Long = 0) {
    val total get() = input + output + cacheRead + cacheWrite
}

@Serializable
data class SessionSummary(
    val project: String,
    val id: Int,
    val kitaSession: String,
    val title: String = "",
    val updatedAt: String = "",
    val running: Boolean = false,
    val waiting: Boolean = false,
    val unread: Boolean = false,
    val outcome: String? = null,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val context: ContextSize? = null,
    val agent: String = "claude",
    val model: String? = null,
    val modelName: String? = null,
    val effort: String? = null,
    val turns: Int = 0,
    val tokens: Tokens? = null,
    val priced: Boolean = false,
    val quota: Double? = null,
    @Serializable(LossyList::class) val prs: List<PullRequest> = emptyList(),
    @Serializable(LossyList::class) val queue: List<QueuedMessage> = emptyList(),
)

@Serializable
data class CodeUsage(val resetsAt: Long, val week: Double? = null)

@Serializable
data class SearchMatch(val id: Int, val title: String = "", val archived: Boolean = false, val seq: Int? = null, val kind: String = "", val before: String = "", val match: String, val after: String = "")

@Serializable
data class SearchResults(@Serializable(LossyList::class) val results: List<SearchMatch> = emptyList(), val total: Int = 0)

@Serializable
data class AgentModel(val id: String, val name: String = "", val efforts: List<String> = emptyList(), val isDefault: Boolean = false)

@Serializable
data class AgentCatalog(val agent: String, val available: Boolean = false, @Serializable(LossyList::class) val models: List<AgentModel> = emptyList(), val efforts: List<String> = emptyList())

@Serializable
data class QuotaWindow(val id: String, val minutes: Long, val label: String? = null, val utilization: Double, val resetsAt: Long)

@Serializable
data class Limits(val limited: Boolean = false, @Serializable(LossyList::class) val windows: List<QuotaWindow> = emptyList(), val updatedAt: String = "")

@Serializable
data class ClaudeLogin(val expiresAt: String? = null, val broken: Boolean = false)

@Serializable
data class ClaudeAuth(val mode: String = "", val login: ClaudeLogin? = null, val backup: ClaudeLogin? = null)

@Serializable
data class CodexAuth(val loggedIn: Boolean = false, val broken: Boolean = false)

@Serializable
data class AgentAuths(val claude: ClaudeAuth? = null, val codex: CodexAuth? = null)

// 登录要用户处理的事：reason 见 server/src/services/kita/types.ts 的 AgentAttention，usable 是现在还能回答
@Serializable
data class AgentAttention(val reason: String, val usable: Boolean = false, val expiresAt: String? = null)

@Serializable
data class AgentStatus(
    @Serializable(LossyMap::class) val limits: Map<String, Limits> = emptyMap(),
    val auth: AgentAuths = AgentAuths(),
    @Serializable(LossyMap::class) val attention: Map<String, AgentAttention> = emptyMap(),
)

@Serializable
data class AccountDetail(val label: String, val value: String = "", val note: String? = null)

@Serializable
data class AccountToken(val expiresAt: String? = null, val refreshedAt: String? = null, val refreshable: Boolean = false)

@Serializable
data class AgentAccount(
    val agent: String,
    val version: String? = null,
    val loggedIn: Boolean = false,
    val email: String? = null,
    val plan: String? = null,
    val token: AccountToken? = null,
    @Serializable(LossyList::class) val details: List<AccountDetail> = emptyList(),
    val configDir: String = "",
    val running: Int = 0,
)

val agentNames = mapOf("claude" to "Claude", "codex" to "Codex")
const val defaultAgent = "claude"

fun agentName(agent: String) = agentNames[agent] ?: agent

private val effortNames = mapOf("minimal" to "最低", "low" to "低", "medium" to "中", "high" to "高", "xhigh" to "很高", "max" to "最高", "ultra" to "极高")

fun effortName(effort: String) = effortNames[effort] ?: effort

// ---- thread 的条目 ----

@Serializable
data class Attachment(val file: String, val name: String = "")

@Serializable
@JsonClassDiscriminator("type")
sealed interface FileChange {
    @Serializable @SerialName("write")
    data class Write(val content: String) : FileChange

    @Serializable @SerialName("replace")
    data class Replace(val before: String, val after: String, val all: Boolean = false) : FileChange

    @Serializable @SerialName("diff")
    data class Diff(val op: String, val diff: String) : FileChange

    // 不认识的种类
    @Serializable @SerialName("other")
    data object Other : FileChange
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface ToolDetail {
    @Serializable @SerialName("command")
    data class Command(val command: String) : ToolDetail

    @Serializable @SerialName("read")
    data class Read(val path: String) : ToolDetail

    // lines：增删了多少行
    @Serializable @SerialName("edit")
    data class Edit(val path: String, val change: FileChange? = null, val lines: LineCount? = null) : ToolDetail

    @Serializable @SerialName("search")
    data class Search(val pattern: String, val target: String = "content") : ToolDetail

    @Serializable @SerialName("web_search")
    data class WebSearch(val query: String) : ToolDetail

    @Serializable @SerialName("web_fetch")
    data class WebFetch(val url: String, val prompt: String? = null) : ToolDetail

    @Serializable @SerialName("image_view")
    data class ImageView(val path: String) : ToolDetail

    // operation：归类后的操作
    @Serializable @SerialName("browser")
    data class Browser(val action: String, val target: String? = null, val operation: String? = null) : ToolDetail

    // target：参数里第一个文字参数
    @Serializable @SerialName("mcp")
    data class Mcp(val server: String, val tool: String, val target: String? = null) : ToolDetail

    @Serializable @SerialName("subagent")
    data class Subagent(val description: String, val prompt: String? = null, val type: String? = null) : ToolDetail

    @Serializable @SerialName("tool_search")
    data class ToolSearch(val query: String) : ToolDetail

    @Serializable @SerialName("skill")
    data class Skill(val name: String) : ToolDetail

    @Serializable @SerialName("todo")
    data object Todo : ToolDetail

    @Serializable @SerialName("other")
    data class Other(val target: String? = null) : ToolDetail
}

@Serializable
data class LineCount(val added: Int = 0, val removed: Int = 0)

@Serializable
data class WebLink(val title: String, val url: String)

@Serializable
@JsonClassDiscriminator("type")
sealed interface Entry {
    val time: String

    // 子 agent 的条目所属的那次工具调用
    val parent: String? get() = null

    @Serializable @SerialName("session")
    data class Session(override val time: String, val agent: String = defaultAgent, val owner: String = "", val cwd: String = "") : Entry

    @Serializable @SerialName("input")
    data class Input(
        override val time: String,
        val mode: String = "",
        val text: String = "",
        @Serializable(LossyList::class) val attachments: List<Attachment> = emptyList(),
        val model: String? = null,
        val effort: String? = null,
    ) : Entry

    @Serializable @SerialName("agent_session")
    data class AgentSession(override val time: String, val id: String, override val parent: String? = null) : Entry

    @Serializable @SerialName("thinking")
    data class Thinking(override val time: String, val text: String, val durationMs: Long? = null, override val parent: String? = null) : Entry

    @Serializable @SerialName("text")
    data class Text(override val time: String, val text: String, val files: Map<String, String> = emptyMap(), override val parent: String? = null) : Entry

    // clipped：发给页面时省略了过长的命令（只留开头）或输出（只留末尾），完整的按调用的位置另外读
    @Serializable @SerialName("tool_call")
    data class ToolCall(
        override val time: String,
        val id: String,
        val name: String,
        val tool: ToolDetail = ToolDetail.Other(),
        val input: JsonElement? = null,
        val background: Boolean = false,
        val clipped: Boolean = false,
        override val parent: String? = null,
    ) : Entry

    // startLine：读文件的结果认得出行号时，output 是去掉行号的内容，这是第一行的行号；
    // links：网页搜索的结果认得出搜到的网页时，output 是剩下的总结
    @Serializable @SerialName("tool_result")
    data class ToolResult(
        override val time: String,
        val callId: String,
        val status: String = "",
        val output: String? = null,
        val truncated: Boolean = false,
        val images: List<String> = emptyList(),
        val clipped: Boolean = false,
        val startLine: Int? = null,
        @Serializable(LossyList::class) val links: List<WebLink> = emptyList(),
        override val parent: String? = null,
    ) : Entry

    @Serializable @SerialName("compact")
    data class Compact(override val time: String, val trigger: String = "", val preTokens: Long? = null, val postTokens: Long? = null, override val parent: String? = null) : Entry

    @Serializable @SerialName("turn_end")
    data class TurnEnd(
        override val time: String,
        val durationMs: Long = 0,
        val outcome: String? = null,
        val error: String? = null,
        val model: String? = null,
        val modelName: String? = null,
        val outputTokens: Long? = null,
        val context: ContextSize? = null,
    ) : Entry

    // 不认识的条目
    @Serializable @SerialName("unknown")
    data class Unknown(override val time: String = "") : Entry
}

// 服务端新增的种类按「不认识」解码，不让包含它的整条数据失败
val codeSerializers = SerializersModule {
    polymorphic(Entry::class) { defaultDeserializer { Entry.Unknown.serializer() } }
    polymorphic(ToolDetail::class) { defaultDeserializer { ToolDetail.Other.serializer() } }
    polymorphic(FileChange::class) { defaultDeserializer { FileChange.Other.serializer() } }
    polymorphic(Status::class) { defaultDeserializer { Status.Other.serializer() } }
}

fun parseEntry(element: JsonElement): Entry = runCatching { json.decodeFromJsonElement(Entry.serializer(), element) }
    .getOrElse { Entry.Unknown((element as? JsonObject)?.get("time")?.jsonPrimitive?.content ?: "") }

@Serializable
@JsonClassDiscriminator("type")
sealed interface Status {
    @Serializable @SerialName("requesting") data object Requesting : Status
    @Serializable @SerialName("thinking") data object Thinking : Status
    @Serializable @SerialName("tool") data class Tool(val name: String) : Status
    @Serializable @SerialName("compacting") data object Compacting : Status
    @Serializable @SerialName("retrying") data class Retrying(val attempt: Int) : Status
    @Serializable @SerialName("waiting") data class Waiting(val tasks: Int) : Status
    // 不认识的状态
    @Serializable @SerialName("other") data object Other : Status
}

@Serializable
data class TaskProgress(val activity: String? = null, val toolUses: Int? = null, val tokens: Long? = null)

// 回答进行中的临时内容
@Serializable
data class Live(
    val thinking: String = "",
    val text: String = "",
    val status: Status? = null,
    @Serializable(LossyMap::class) val tasks: Map<String, TaskProgress> = emptyMap(),
    val files: Map<String, String> = emptyMap(),
)
