@file:OptIn(ExperimentalSerializationApi::class)

package app.binos.code

import app.binos.net.json
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

// 和 server/src/apps/code/types.ts、server/src/services/kita/types.ts 对应

@Serializable
data class Upload(val file: String, val name: String)

@Serializable
data class QueuedMessage(val id: String, val time: String, val text: String, val attachments: List<Upload> = emptyList(), val model: String? = null, val effort: String? = null)

@Serializable
data class PullRequest(val url: String, val number: Int, val state: String? = null, val title: String? = null, val preview: String? = null)

@Serializable
data class Project(val id: String, val name: String, val repository: String? = null, val defaultBranch: String? = null)

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
    val title: String,
    val updatedAt: String,
    val running: Boolean = false,
    val waiting: Boolean = false,
    val unread: Boolean = false,
    val outcome: String? = null,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val context: ContextSize? = null,
    val agent: String = "claude",
    val model: String? = null,
    val effort: String? = null,
    val turns: Int = 0,
    val tokens: Tokens? = null,
    val priced: Boolean = false,
    val quota: Double? = null,
    val prs: List<PullRequest> = emptyList(),
    val queue: List<QueuedMessage> = emptyList(),
)

@Serializable
data class CodeUsage(val resetsAt: Long, val week: Double? = null)

@Serializable
data class SearchMatch(val id: Int, val title: String, val archived: Boolean = false, val item: Int? = null, val kind: String, val before: String, val match: String, val after: String)

@Serializable
data class SearchResults(val results: List<SearchMatch>, val total: Int)

@Serializable
data class AgentModel(val id: String, val name: String, val efforts: List<String> = emptyList(), val isDefault: Boolean = false)

@Serializable
data class AgentCatalog(val agent: String, val available: Boolean, val models: List<AgentModel> = emptyList(), val efforts: List<String> = emptyList())

@Serializable
data class QuotaWindow(val id: String, val minutes: Long, val label: String? = null, val utilization: Double, val resetsAt: Long)

@Serializable
data class Limits(val limited: Boolean = false, val windows: List<QuotaWindow> = emptyList(), val updatedAt: String = "")

@Serializable
data class ClaudeLogin(val expiresAt: String? = null, val broken: Boolean = false)

@Serializable
data class ClaudeAuth(val mode: String, val login: ClaudeLogin? = null, val backup: ClaudeLogin? = null)

@Serializable
data class CodexAuth(val loggedIn: Boolean, val broken: Boolean = false)

@Serializable
data class AgentAuths(val claude: ClaudeAuth? = null, val codex: CodexAuth? = null)

@Serializable
data class AgentStatus(val limits: Map<String, Limits> = emptyMap(), val auth: AgentAuths = AgentAuths())

@Serializable
data class AccountDetail(val label: String, val value: String, val note: String? = null)

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
    val details: List<AccountDetail> = emptyList(),
    val configDir: String = "",
    val running: Int = 0,
)

val agentNames = mapOf("claude" to "Claude", "codex" to "Codex")
const val defaultAgent = "claude"

fun agentName(agent: String) = agentNames[agent] ?: agent

private val effortNames = mapOf("minimal" to "最低", "low" to "低", "medium" to "中", "high" to "高", "xhigh" to "很高", "max" to "最高", "ultra" to "极高")

fun effortName(effort: String) = effortNames[effort] ?: effort

// claude-opus-5-5 → Opus 5.5；其他 agent 的模型原样显示
fun modelName(agent: String?, model: String): String {
    if (agent != null && agent != "claude") return model
    val match = Regex("^claude-([a-z]+)-(\\d+)(?:-(\\d+))?").find(model) ?: return model
    val (family, major, minor) = match.destructured
    return "${family.replaceFirstChar { it.uppercase() }} ${if (minor.isNotEmpty()) "$major.$minor" else major}"
}

// ---- thread 的条目 ----

@Serializable
data class Attachment(val file: String, val name: String)

@Serializable
@JsonClassDiscriminator("type")
sealed interface FileChange {
    @Serializable @SerialName("write")
    data class Write(val content: String) : FileChange

    @Serializable @SerialName("replace")
    data class Replace(val before: String, val after: String, val all: Boolean = false) : FileChange

    @Serializable @SerialName("diff")
    data class Diff(val op: String, val diff: String) : FileChange
}

@Serializable
@JsonClassDiscriminator("kind")
sealed interface ToolDetail {
    @Serializable @SerialName("command")
    data class Command(val command: String) : ToolDetail

    @Serializable @SerialName("read")
    data class Read(val path: String) : ToolDetail

    @Serializable @SerialName("edit")
    data class Edit(val path: String, val change: FileChange? = null) : ToolDetail

    @Serializable @SerialName("search")
    data class Search(val pattern: String, val target: String = "content") : ToolDetail

    @Serializable @SerialName("web_search")
    data class WebSearch(val query: String) : ToolDetail

    @Serializable @SerialName("web_fetch")
    data class WebFetch(val url: String, val prompt: String? = null) : ToolDetail

    @Serializable @SerialName("image_view")
    data class ImageView(val path: String) : ToolDetail

    @Serializable @SerialName("browser")
    data class Browser(val action: String, val target: String? = null) : ToolDetail

    @Serializable @SerialName("mcp")
    data class Mcp(val server: String, val tool: String) : ToolDetail

    @Serializable @SerialName("subagent")
    data class Subagent(val description: String, val prompt: String? = null, val type: String? = null) : ToolDetail

    @Serializable @SerialName("tool_search")
    data class ToolSearch(val query: String) : ToolDetail

    @Serializable @SerialName("skill")
    data class Skill(val name: String) : ToolDetail

    @Serializable @SerialName("todo")
    data object Todo : ToolDetail

    @Serializable @SerialName("other")
    data object Other : ToolDetail
}

@Serializable
@JsonClassDiscriminator("type")
sealed interface Entry {
    val time: String

    // 子 agent 的条目所属的那次工具调用
    val parent: String? get() = null

    @Serializable @SerialName("session")
    data class Session(override val time: String, val agent: String, val owner: String = "", val cwd: String = "") : Entry

    @Serializable @SerialName("input")
    data class Input(
        override val time: String,
        val mode: String,
        val text: String,
        val attachments: List<Attachment> = emptyList(),
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
        val tool: ToolDetail = ToolDetail.Other,
        val input: JsonElement? = null,
        val background: Boolean = false,
        val clipped: Boolean = false,
        override val parent: String? = null,
    ) : Entry

    @Serializable @SerialName("tool_result")
    data class ToolResult(
        override val time: String,
        val callId: String,
        val status: String,
        val output: String? = null,
        val truncated: Boolean = false,
        val images: List<String> = emptyList(),
        val clipped: Boolean = false,
        override val parent: String? = null,
    ) : Entry

    @Serializable @SerialName("compact")
    data class Compact(override val time: String, val trigger: String, val preTokens: Long? = null, val postTokens: Long? = null, override val parent: String? = null) : Entry

    @Serializable @SerialName("turn_end")
    data class TurnEnd(
        override val time: String,
        val durationMs: Long = 0,
        val outcome: String? = null,
        val error: String? = null,
        val model: String? = null,
        val outputTokens: Long? = null,
        val context: ContextSize? = null,
    ) : Entry

    // 不认识的条目占住位置，条目的序号和后端一致
    @Serializable @SerialName("unknown")
    data class Unknown(override val time: String) : Entry
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
}

@Serializable
data class TaskProgress(val activity: String? = null, val toolUses: Int? = null, val tokens: Long? = null)

// 回答进行中的临时内容
@Serializable
data class Live(
    val thinking: String = "",
    val text: String = "",
    val status: Status? = null,
    val tasks: Map<String, TaskProgress> = emptyMap(),
    val files: Map<String, String> = emptyMap(),
)
