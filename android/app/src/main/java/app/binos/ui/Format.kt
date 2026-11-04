package app.binos.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

private val zone get() = ZoneId.systemDefault()
private val clock = DateTimeFormatter.ofPattern("HH:mm")
private val monthDay = DateTimeFormatter.ofPattern("M/d")
private val fullDate = DateTimeFormatter.ofPattern("yyyy/M/d")
private val fullDateTime = DateTimeFormatter.ofPattern("yyyy/M/d HH:mm:ss")
private val dateTime = DateTimeFormatter.ofPattern("M/d HH:mm")

private fun local(ms: Long) = Instant.ofEpochMilli(ms).atZone(zone)
private fun daysAgo(ms: Long) = LocalDate.now(zone).toEpochDay() - local(ms).toLocalDate().toEpochDay()

fun formatClock(ms: Long): String = local(ms).format(clock)

fun formatFull(ms: Long): String = local(ms).format(fullDateTime)

// 列表里的时间：今天写时刻，昨天，今年写月日，更早写完整日期
fun formatTime(ms: Long): String = when (daysAgo(ms)) {
    0L -> formatClock(ms)
    1L -> "昨天"
    else -> local(ms).let { if (it.year == LocalDate.now(zone).year) it.format(monthDay) else it.format(fullDate) }
}

// 对话里的时间分隔线：今天只写时刻，往前带上日期
fun formatDivider(ms: Long): String {
    val time = formatClock(ms)
    return when (daysAgo(ms)) {
        0L -> time
        1L -> "昨天 $time"
        else -> "${local(ms).let { if (it.year == LocalDate.now(zone).year) it.format(monthDay) else it.format(fullDate) }} $time"
    }
}

// 某个时刻和离现在多久：10/26 08:00（3 天后）
fun formatMoment(ms: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = ((ms - now) / 60_000.0).roundToLong()
    val amount = abs(minutes)
    val text = if (amount < 60) "$amount 分钟" else if (amount < 48 * 60) "${(amount / 60.0).roundToLong()} 小时" else "${(amount / 60.0 / 24).roundToLong()} 天"
    return "${local(ms).format(dateTime)}（${if (minutes >= 0) "${text}后" else "${text}前"}）"
}

// 耗时：10 秒内精确到 0.1 秒
fun formatDuration(ms: Long): String {
    val seconds = ms / 1000.0
    return when {
        seconds < 10 -> String.format(Locale.ROOT, "%.1f 秒", maxOf(seconds, 0.1))
        seconds < 60 -> "${seconds.toLong()} 秒"
        seconds < 3600 -> "${(seconds / 60).toLong()} 分 ${(seconds % 60).toLong()} 秒"
        else -> "${(seconds / 3600).toLong()} 小时 ${((seconds / 60) % 60).toLong()} 分"
    }
}

// 进行中的已用时间，只到秒
fun formatElapsed(ms: Long): String {
    val seconds = maxOf(ms / 1000, 0)
    return if (seconds < 60) "$seconds 秒" else "${seconds / 60} 分 ${seconds % 60} 秒"
}

fun formatTokens(count: Long): String = when {
    count < 1000 -> count.toString()
    count < 1_000_000 -> String.format(Locale.ROOT, if (count < 10_000) "%.1fk" else "%.0fk", count / 1000.0)
    else -> String.format(Locale.ROOT, "%.1fM", count / 1_000_000.0)
}

// 大约占周额度多少：不到 1% 时多留一位小数
fun formatQuota(quota: Double): String =
    if (quota < 0.01) String.format(Locale.ROOT, "%.1f%%", quota * 100) else "${(quota * 100).roundToLong()}%"

fun formatPercent(ratio: Double): String = "${(ratio * 100).roundToLong()}%"

fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes / 1024.0
    var unit = 0
    while (value >= 1024 && unit < units.size - 1) {
        value /= 1024
        unit++
    }
    return String.format(Locale.ROOT, if (value < 10) "%.1f %s" else "%.0f %s", value, units[unit])
}

// 多久：45 分钟、3 小时、2 天
fun formatSpan(ms: Long): String {
    val minutes = maxOf((ms / 60_000.0).roundToLong(), 1)
    return when {
        minutes < 60 -> "$minutes 分钟"
        minutes < 48 * 60 -> "${(minutes / 60.0).roundToLong()} 小时"
        else -> "${(minutes / 60.0 / 24).roundToLong()} 天"
    }
}

fun formatUptime(seconds: Long): String {
    val days = seconds / 86400
    val hours = seconds % 86400 / 3600
    val minutes = seconds % 3600 / 60
    return when {
        days > 0 -> "$days 天 $hours 小时"
        hours > 0 -> "$hours 小时 $minutes 分"
        else -> "$minutes 分"
    }
}

// 正在计时时每隔 interval 更新一次的当前时间
@Composable
fun rememberNow(active: Boolean = true, intervalMs: Long = 1000): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(active, intervalMs) {
        while (active) {
            now = System.currentTimeMillis()
            delay(intervalMs)
        }
    }
    return now
}
