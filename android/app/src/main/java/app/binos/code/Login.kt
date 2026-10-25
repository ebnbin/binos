package app.binos.code

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import app.binos.app
import app.binos.ui.formatMoment
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Instant

// 和 web/src/services/kita/claude、codex 的 view.tsx、Login.tsx 对应：登录要留意的事、登录相关的几行，以及就地完成的登录

private const val day = 86_400_000L
// 完整登录剩不到这么多天时提醒重新登录，备用 token 剩不到这么多天时提醒更新
private const val loginWarnDays = 7
private const val backupWarnDays = 30

private fun millis(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()

// 还剩几天，不足一天按 0
private fun daysLeft(iso: String, now: Long): Long = (((millis(iso) ?: now) - now) / day).coerceAtLeast(0)

// bad：用不了了；否则是还能用但要处理。action 是按钮上的字，fix 交给登录流程说明做哪种登录
data class Attention(val agent: String, val text: String, val bad: Boolean, val action: String, val fix: String)

fun attention(agent: String, status: AgentStatus?, now: Long): Attention? = when (agent) {
    "claude" -> status?.auth?.claude?.let { auth ->
        val loginExpiry = auth.login?.expiresAt
        val backupExpiry = auth.backup?.expiresAt
        when {
            auth.mode == "none" -> Attention(agent, "Claude 没有能用的登录", true, "重新登录", "login")
            auth.mode == "token" -> Attention(
                agent,
                if (auth.login?.broken == true) "Claude 的登录失效了，正在用备用 token" else "Claude 的登录过期了，正在用备用 token",
                false, "重新登录", "login",
            )
            loginExpiry != null && (millis(loginExpiry) ?: Long.MAX_VALUE) - now < loginWarnDays * day -> {
                val days = daysLeft(loginExpiry, now)
                Attention(agent, "Claude 的登录${if (days == 0L) "今天" else "还有 $days 天"}到期", false, "重新登录", "login")
            }
            backupExpiry != null && (millis(backupExpiry) ?: Long.MAX_VALUE) - now < backupWarnDays * day ->
                Attention(agent, "Claude 的备用 token 还有 ${daysLeft(backupExpiry, now)} 天到期", false, "更新", "token")
            else -> null
        }
    }
    // Codex 只在回答时认证失败过才提醒：没登录过 Codex 也照样能用别的 agent
    "codex" -> status?.auth?.codex?.takeIf { it.broken }?.let { Attention(agent, "Codex 的登录失效了，回答时认证失败了", true, "重新登录", "login") }
    else -> null
}

// 几个都要处理时按 agent 的顺序先处理前面的
fun firstAttention(status: AgentStatus?, now: Long): Attention? = agentNames.keys.firstNotNullOfOrNull { attention(it, status, now) }

// 系统 app 里账号下面登录相关的一行；expired：已经用不了
data class AuthRow(val label: String, val value: String, val note: String? = null, val expired: Boolean = false)

fun authRows(agent: String, status: AgentStatus?, now: Long): List<AuthRow> {
    val auth = status?.auth?.claude?.takeIf { agent == "claude" } ?: return emptyList()
    val full = auth.login
    val backup = auth.backup
    val fullExpired = full?.expiresAt?.let { (millis(it) ?: Long.MAX_VALUE) <= now } == true
    return listOf(
        AuthRow("正在用", mapOf("login" to "完整登录", "token" to "备用 token", "none" to "没有能用的登录")[auth.mode] ?: auth.mode, expired = auth.mode == "none"),
        AuthRow(
            "完整登录",
            when {
                full == null -> "没有"
                full.broken -> "已失效"
                full.expiresAt != null -> if (fullExpired) "已过期" else "还有 ${daysLeft(full.expiresAt, now)} 天"
                else -> "已登录"
            },
            if (full?.expiresAt != null && !full.broken) "${formatMoment(millis(full.expiresAt) ?: now, now)}到期，之后只能重新登录" else "回答时认证失败了，重新登录后自动换回来",
            full == null || full.broken || fullExpired,
        ),
        AuthRow(
            "备用 token",
            backup?.let { b -> b.expiresAt?.let { "还有 ${daysLeft(it, now)} 天" } ?: "已存好" } ?: "没有",
            "完整登录过期或失效时自动换用，只能回答，没有 claude.ai 的连接器",
        ),
    )
}

// 能做的登录：按钮上的字和 fix
fun loginActions(agent: String, status: AgentStatus?): List<Pair<String, String>> = when (agent) {
    "claude" -> status?.auth?.claude?.let { listOf("重新登录" to "login", (if (it.backup != null) "更新备用 token" else "生成备用 token") to "token") }.orEmpty()
    "codex" -> listOf((if (status?.auth?.codex?.loggedIn == true) "重新登录" else "登录") to "login")
    else -> emptyList()
}

private sealed interface LoginStep {
    data object Starting : LoginStep
    // Claude：打开 url 授权，把授权后页面上的代码贴回来；Codex：打开 url，输入 code
    data class Pending(val id: String, val url: String, val code: String? = null, val finishing: Boolean = false) : LoginStep
    data object Done : LoginStep
    data class Failed(val error: String) : LoginStep
}

// 等用户授权 Codex 时多久问一次结果
private const val pollIntervalMs = 2000L

private suspend fun startLogin(agent: String, fix: String): LoginStep = try {
    val result = if (agent == "claude") app.api.postJson("/api/kita/claude/login", buildJsonObject { put("kind", fix) }).jsonObject
    else app.api.postJson("/api/kita/codex/login").jsonObject
    LoginStep.Pending(result["id"]!!.jsonPrimitive.content, result["url"]!!.jsonPrimitive.content, result["code"]?.jsonPrimitive?.content)
} catch (error: CancellationException) {
    throw error
} catch (error: Exception) {
    LoginStep.Failed(error.message ?: "网络错误")
}

private fun cancelLogin(agent: String, id: String) {
    app.scope.launch { runCatching { app.api.postJson("/api/kita/$agent/login/${encode(id)}/cancel") } }
}

// 就地完成的登录：挂上就开始，onClose 关上，没完成时顺便取消这次登录。fix 是 Claude 的 login（重新登录）或 token（生成备用 token）
@Composable
fun AgentLogin(agent: String, fix: String, onClose: () -> Unit) {
    var step by remember { mutableStateOf<LoginStep>(LoginStep.Starting) }
    var attempt by remember { mutableIntStateOf(0) }
    var code by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    val clipboard = LocalClipboardManager.current
    // 还没完成的这次登录，离开时取消
    val pending = remember { mutableStateOf<String?>(null) }
    DisposableEffect(Unit) { onDispose { pending.value?.let { cancelLogin(agent, it) } } }

    LaunchedEffect(attempt) {
        step = LoginStep.Starting
        val started = startLogin(agent, fix)
        step = started
        if (started !is LoginStep.Pending) return@LaunchedEffect
        pending.value = started.id
        if (agent != "codex") return@LaunchedEffect
        while (true) {
            delay(pollIntervalMs)
            val result = runCatching { app.api.getJson("/api/kita/codex/login/${encode(started.id)}").jsonObject }.getOrNull() ?: continue
            when (result["status"]?.jsonPrimitive?.content) {
                "waiting" -> continue
                "done" -> step = LoginStep.Done
                else -> step = LoginStep.Failed(result["error"]?.jsonPrimitive?.content ?: "登录失败")
            }
            pending.value = null
            break
        }
    }

    fun submit(current: LoginStep.Pending) {
        if (code.isBlank() || current.finishing) return
        step = current.copy(finishing = true)
        scope.launch {
            step = try {
                app.api.postJson("/api/kita/claude/login/${encode(current.id)}", buildJsonObject { put("code", code.trim()) })
                LoginStep.Done
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                LoginStep.Failed(error.message ?: "网络错误")
            }
            // 后端处理完就结束了这次登录，成没成功都不用再取消
            pending.value = null
        }
    }

    val title = when {
        agent == "codex" -> "重新登录 Codex"
        fix == "token" -> "生成备用 token"
        else -> "重新登录 Claude"
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        when (val current = step) {
            LoginStep.Starting -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
                Text(if (agent == "codex") "正在拿登录码" else "正在拿授权链接", style = MaterialTheme.typography.bodyMedium)
            }
            is LoginStep.Pending -> {
                FilledTonalButton(onClick = { uriHandler.openUri(current.url) }) {
                    Text(if (agent == "codex") "1. 打开登录页面，用 ChatGPT 账号登录" else "1. 打开授权页面，用 Claude 账号授权")
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(16.dp))
                }
                if (current.code != null) {
                    Text("2. 输入这个一次性的码（15 分钟内有效）", style = MaterialTheme.typography.bodyMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SelectionContainer { Text(current.code, style = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Monospace)) }
                        IconButton(onClick = { clipboard.setText(AnnotatedString(current.code)) }) { Icon(Icons.Outlined.ContentCopy, "复制登录码") }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("等你授权，授权后这里会自动更新", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        TextButton(onClick = onClose) { Text("取消") }
                    }
                } else {
                    OutlinedTextField(
                        code,
                        { code = it },
                        label = { Text("2. 把授权后页面上显示的代码贴到这里") },
                        placeholder = { Text("授权代码") },
                        singleLine = true,
                        enabled = !current.finishing,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = onClose) { Text("取消") }
                        Button(onClick = { submit(current) }, enabled = code.isNotBlank() && !current.finishing) {
                            if (current.finishing) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text("完成")
                        }
                    }
                }
            }
            LoginStep.Done -> {
                Text(if (agent == "claude" && fix == "token") "备用 token 存好了" else "登录好了，下一轮回答起用新的登录", color = MaterialTheme.colorScheme.primary)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { Button(onClick = onClose) { Text("好") } }
            }
            is LoginStep.Failed -> {
                Text(current.error, color = MaterialTheme.colorScheme.error)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onClose) { Text("关上") }
                    Button(onClick = {
                        code = ""
                        attempt++
                    }) { Text("重新开始") }
                }
            }
        }
    }
}
