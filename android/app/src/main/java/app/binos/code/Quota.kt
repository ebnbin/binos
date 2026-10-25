package app.binos.code

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.binos.ui.formatPercent
import app.binos.ui.formatSpan
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// 和 web/src/services/kita/quota.ts 对应：订阅额度的窗口

private const val hourMs = 3_600_000L
private val weekday = DateTimeFormatter.ofPattern("EEE HH:mm", Locale.CHINA)

fun windowName(window: QuotaWindow): String {
    val minutes = window.minutes
    val length = when {
        minutes % (24 * 60) == 0L -> "${minutes / 24 / 60} 天"
        minutes % 60 == 0L -> "${minutes / 60} 小时"
        else -> "$minutes 分钟"
    }
    return window.label?.let { "$it $length" } ?: length
}

fun formatReset(resetsAt: Long, now: Long): String {
    val left = resetsAt * 1000 - now
    return when {
        left <= 0 -> "已重置"
        left < 24 * hourMs -> "${formatSpan(left)}后重置"
        else -> "${Instant.ofEpochSecond(resetsAt).atZone(ZoneId.systemDefault()).format(weekday)} 重置"
    }
}

data class WindowState(val used: Double, val left: Long?, val expected: Double, val runsOut: Long?)

fun windowState(window: QuotaWindow, now: Long): WindowState {
    if (window.resetsAt * 1000 <= now) return WindowState(0.0, null, 0.0, null)
    val length = window.minutes * 60_000
    val left = window.resetsAt * 1000 - now
    val used = minOf(window.utilization, 1.0)
    val elapsed = (length - left).coerceIn(1, length)
    val rate = used / elapsed
    val runsOut = if (used >= 1) 0L else if (rate > 0 && (1 - used) / rate < left) ((1 - used) / rate).toLong() else null
    return WindowState(used, left, elapsed.toDouble() / length, runsOut)
}

// 一眼要看的：最紧的那个窗口用了多少，按现在的速度会不会在重置前用完
data class QuotaSummary(val used: Double, val runsOut: Long?, val limited: Boolean)

fun quotaSummary(limits: Limits, now: Long): QuotaSummary {
    val states = limits.windows.map { windowState(it, now) }
    return QuotaSummary(states.maxOfOrNull { it.used } ?: 0.0, states.mapNotNull { it.runsOut }.minOrNull(), limits.limited)
}

@Composable
fun levelColor(ratio: Double, limited: Boolean = false): Color = when {
    limited || ratio >= 0.95 -> MaterialTheme.colorScheme.error
    ratio >= 0.8 -> Color(0xFFE6A23C)
    else -> MaterialTheme.colorScheme.primary
}

// 顶栏上的额度：每个报告过额度的 agent 一个圆环和最紧窗口的用量
@Composable
fun QuotaChip(status: AgentStatus?, now: Long, onClick: () -> Unit) {
    val reported = status?.limits?.entries?.toList().orEmpty()
    if (reported.isEmpty()) return
    TextButton(onClick = onClick) {
        reported.forEachIndexed { index, (agent, limits) ->
            val summary = quotaSummary(limits, now)
            val alert = summary.limited || summary.runsOut != null
            if (index > 0) Spacer(Modifier.width(8.dp))
            CircularProgressIndicator(
                progress = { summary.used.toFloat() },
                modifier = Modifier.size(16.dp),
                strokeWidth = 3.dp,
                color = levelColor(summary.used, alert),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                (if (reported.size > 1) "${agentName(agent)} " else "") + if (summary.limited) "已限流" else formatPercent(summary.used),
                color = if (alert) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

// 额度详情：每个窗口用了多少、匀速的话该用到哪、什么时候重置
@Composable
fun QuotaDetails(status: AgentStatus?, now: Long) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("订阅额度", style = MaterialTheme.typography.titleLarge)
        status?.limits?.forEach { (agent, limits) ->
            Text(agentName(agent) + if (limits.limited) " · 已限流" else "", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            limits.windows.forEach { window ->
                val state = windowState(window, now)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(windowName(window), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        Text(formatPercent(state.used), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    }
                    LinearProgressIndicator(
                        progress = { state.used.toFloat() },
                        modifier = Modifier.fillMaxWidth(),
                        color = levelColor(state.used, limits.limited),
                    )
                    val pace = state.used - state.expected
                    Text(
                        listOfNotNull(
                            formatReset(window.resetsAt, now),
                            state.left?.let { if (pace > 0.02) "比匀速多用 ${formatPercent(pace)}" else if (pace < -0.02) "比匀速少用 ${formatPercent(-pace)}" else "接近匀速" },
                            state.runsOut?.let { "按现在的速度 ${formatSpan(it)}后用完" },
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (state.runsOut != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
