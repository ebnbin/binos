@file:OptIn(ExperimentalMaterial3Api::class)

package app.binos.system

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.NetworkCheck
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SdStorage
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import app.binos.app
import app.binos.code.AgentAccount
import app.binos.code.AgentLogin
import app.binos.code.AgentStatus
import app.binos.code.CodeStore
import app.binos.code.QuotaDetails
import app.binos.code.agentName
import app.binos.code.attention
import app.binos.code.authRows
import app.binos.code.loginActions
import app.binos.net.LossyList
import app.binos.shell.LocalNav
import app.binos.ui.formatBytes
import app.binos.ui.formatMoment
import app.binos.ui.formatUptime
import app.binos.ui.rememberNow
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.Instant

// 和 server/src/apps/system/types.ts 对应

@Serializable
data class Host(val name: String = "", val model: String = "", val chip: String = "", val os: String = "", val uptime: Double = 0.0, val cores: Int = 0)

@Serializable
data class Cpu(val percent: Double? = null)

@Serializable
data class Memory(val total: Double, val free: Double, val cached: Double? = null, val pressure: String = "unknown")

@Serializable
data class Volume(val filesystem: String = "", val mount: String, val total: Double, val available: Double, val used: Double)

@Serializable
data class Network(val receiveRate: Double? = null, val sendRate: Double? = null)

@Serializable
data class Power(val source: String = "", val battery: Double? = null)

@Serializable
data class Runtime(val version: String = "", val uptime: Double = 0.0, val memory: Double = 0.0, val test: Boolean = false)

@Serializable
data class Snapshot(
    val at: Double,
    val host: Host = Host(),
    val cpu: Cpu = Cpu(),
    val memory: Memory,
    @Serializable(LossyList::class) val volumes: List<Volume> = emptyList(),
    val network: Network = Network(),
    val power: Power = Power(),
    val runtime: Runtime = Runtime(),
    @Serializable(LossyList::class) val unavailable: List<String> = emptyList(),
)

@Serializable
data class MonitorStatus(val snapshot: Snapshot? = null, val collecting: Boolean = false, val collectionError: String? = null)

private val pressureNames = mapOf("normal" to "正常", "warning" to "偏高", "critical" to "很高", "unknown" to "未知")

// 宿主 Mac 和 binOS 的状态，在前台时每 5 秒刷新
@Composable
fun SystemScreen() {
    val nav = LocalNav.current
    var status by remember { mutableStateOf<MonitorStatus?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(Unit) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                runCatching { app.api.get<MonitorStatus>("/api/apps/system/status") }.onSuccess { status = it; error = null }.onFailure { error = it.message }
                delay(5000)
            }
        }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("系统") },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
                actions = {
                    IconButton(onClick = {
                        scope.launch { runCatching { app.api.post<MonitorStatus>("/api/apps/system/refresh") }.onSuccess { status = it } }
                    }) { Icon(Icons.Outlined.Refresh, "立即刷新") }
                },
            )
        },
    ) { padding ->
        val snapshot = status?.snapshot
        if (snapshot == null) {
            Column(Modifier.fillMaxSize().padding(padding), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                if (error != null || status?.collectionError != null) Text(error ?: status?.collectionError ?: "", color = MaterialTheme.colorScheme.error)
                else CircularProgressIndicator()
            }
            return@Scaffold
        }
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text(snapshot.host.name, style = MaterialTheme.typography.headlineSmall)
                Text(listOf(snapshot.host.chip, "${snapshot.host.cores} 核", snapshot.host.os).filter { it.isNotBlank() }.joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (snapshot.unavailable.isNotEmpty()) Text("${snapshot.unavailable.joinToString("、")}暂时无法读取，其他信息仍会更新。", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            item {
                val cpu = snapshot.cpu.percent
                Metric(Icons.Outlined.Speed, "CPU", cpu?.let { "${it.toInt()}%" } ?: "采样中", cpu?.let { it / 100 }, "当前总使用率")
            }
            item {
                val memory = snapshot.memory
                val used = memory.cached?.let { (memory.total - memory.free - it).coerceAtLeast(0.0) }
                Metric(
                    Icons.Outlined.Memory,
                    "内存",
                    "${used?.let { formatBytes(it.toLong()) } ?: "—"} / ${formatBytes(memory.total.toLong())}",
                    used?.let { it / memory.total },
                    "内存压力：${pressureNames[memory.pressure] ?: memory.pressure}（已用量扣除文件缓存，为估算值）",
                )
            }
            item {
                val network = snapshot.network
                Metric(
                    Icons.Outlined.NetworkCheck,
                    "网络速度",
                    "↓ ${network.receiveRate?.let { formatBytes(it.toLong()) } ?: "—"}/s  ↑ ${network.sendRate?.let { formatBytes(it.toLong()) } ?: "—"}/s",
                    null,
                    "当前物理网卡合计速度",
                )
            }
            item {
                val power = snapshot.power
                val source = when (power.source) {
                    "AC Power" -> "外接电源"
                    "Battery Power" -> "电池供电"
                    else -> power.source
                }
                Metric(Icons.Outlined.Bolt, "供电与运行时间", source + (power.battery?.let { " · ${it.toInt()}%" } ?: ""), power.battery?.let { it / 100 }, "连续运行 ${formatUptime(snapshot.host.uptime.toLong())}")
            }
            item { Text("存储", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
            items(snapshot.volumes, key = { it.mount }) { volume ->
                Metric(
                    Icons.Outlined.SdStorage,
                    volume.mount,
                    "${formatBytes(volume.used.toLong())} / ${formatBytes(volume.total.toLong())}",
                    volume.used / volume.total,
                    "可用 ${formatBytes(volume.available.toLong())} · ${volume.filesystem}",
                )
            }
            item { Text("binOS", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp)) }
            item {
                val runtime = snapshot.runtime
                Metric(
                    Icons.Outlined.Dns,
                    if (runtime.test) "测试实例" else "后端",
                    runtime.version.take(12).ifEmpty { "dev" },
                    null,
                    "已运行 ${formatUptime(runtime.uptime.toLong())} · 占用内存 ${formatBytes(runtime.memory.toLong())}",
                )
            }
        }
    }
}

@Composable
private fun Metric(icon: ImageVector, title: String, value: String, ratio: Double?, note: String) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(8.dp))
                Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            ratio?.let {
                LinearProgressIndicator(
                    progress = { it.toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                    color = if (it >= 0.9) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                )
            }
            Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private val planNames = mapOf("max" to "Max", "pro" to "Pro", "prolite" to "Pro Lite", "plus" to "Plus", "team" to "Team", "enterprise" to "Enterprise", "free" to "Free")

// agent 的账号、登录凭证和额度；登录在这里就地完成
@Composable
fun AccountsScreen() {
    val nav = LocalNav.current
    var accounts by remember { mutableStateOf<List<AgentAccount>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reloads by remember { mutableIntStateOf(0) }
    val status by CodeStore.status.collectAsStateWithLifecycle()
    val now = rememberNow(intervalMs = 60_000)
    LaunchedEffect(status, reloads) { runCatching { CodeStore.api.accounts() }.onSuccess { accounts = it; error = null }.onFailure { error = it.message } }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Agent") },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
                actions = { IconButton(onClick = { reloads++ }) { Icon(Icons.Outlined.Refresh, "重新读取") } },
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (accounts == null) item { if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error) else CircularProgressIndicator() }
            items(accounts.orEmpty(), key = { it.agent }) { account -> AccountCard(account, status, now) }
            if (!status?.limits.isNullOrEmpty()) item { Card { Column(Modifier.padding(top = 16.dp)) { QuotaDetails(status, now) } } }
        }
    }
}

@Composable
private fun AccountCard(account: AgentAccount, status: AgentStatus?, now: Long) {
    var login by remember { mutableStateOf<String?>(null) }
    val attention = attention(account.agent, status, now)
    val actions = loginActions(account.agent, status)
    val limits = status?.limits?.get(account.agent)
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(agentName(account.agent), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                Text(
                    when {
                        account.version == null -> "没有安装"
                        account.loggedIn -> "已登录"
                        else -> "没有登录"
                    },
                    color = if (account.loggedIn) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
            HorizontalDivider()
            Row2("版本", account.version ?: "—")
            account.email?.let { Row2("账号", it) }
            account.plan?.let { Row2("套餐", planNames[it] ?: it) }
            account.details.forEach { Row2(it.label, it.value, it.note) }
            authRows(account.agent, status, now).forEach { Row2(it.label, it.value, it.note, it.expired) }
            account.token?.let { token ->
                val expires = token.expiresAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
                Row2(
                    "访问令牌",
                    expires?.let { "${formatMoment(it, now)}过期" } ?: "过期时间未知",
                    if (token.refreshable) "有刷新令牌，到期前自动续期" else "没有刷新令牌，过期后要重新登录",
                    expires != null && expires <= now,
                )
                token.refreshedAt?.let { at -> runCatching { Instant.parse(at).toEpochMilli() }.getOrNull()?.let { Row2("上次续期", formatMoment(it, now)) } }
            }
            limits?.updatedAt?.takeIf { it.isNotEmpty() }?.let { at -> runCatching { Instant.parse(at).toEpochMilli() }.getOrNull()?.let { Row2("额度更新于", formatMoment(it, now)) } }
            Row2("正在运行", "${account.running} 个")
            Row2("配置目录", account.configDir)
            attention?.let {
                Text(it.text, style = MaterialTheme.typography.bodyMedium, color = if (it.bad) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.tertiary)
            }
            val fix = login
            if (fix != null) {
                HorizontalDivider()
                AgentLogin(account.agent, fix) { login = null }
            } else if (actions.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    actions.forEach { (label, action) -> OutlinedButton(onClick = { login = action }) { Text(label) } }
                }
            }
        }
    }
}

// expired：已经用不了，标红
@Composable
private fun Row2(label: String, value: String, note: String? = null, expired: Boolean = false) {
    Row {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(96.dp))
        Column {
            Text(value, style = MaterialTheme.typography.bodyMedium, color = if (expired) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
            note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
