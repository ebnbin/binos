@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package app.binos.more

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import app.binos.app
import app.binos.code.encode
import app.binos.shell.LocalNav
import app.binos.shell.SessionRoute
import app.binos.ui.formatClock
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add

// 和 server/src/apps/devices/types.ts 对应

@Serializable
data class Device(val id: String, val platform: String, val name: String, val target: String = "", val system: String? = null, val status: String, val error: String? = null)

@Serializable
data class Lease(val requestId: String, val claimed: Boolean = false, val id: String, val owner: String, val reason: String = "", val platforms: List<String> = emptyList(), val devices: List<String> = emptyList())

@Serializable
data class Waiting(val id: String, val owner: String, val reason: String = "", val platforms: List<String> = emptyList(), val phase: String, val error: String? = null)

@Serializable
data class DeviceEvent(val time: Long, val text: String, val device: String? = null, val owner: String? = null)

@Serializable
data class Observed(val platform: String, val name: String, val target: String, val state: String)

@Serializable
data class Owner(val session: Int, val title: String)

@Serializable
data class DevicesSnapshot(
    val devices: List<Device> = emptyList(),
    val leases: List<Lease> = emptyList(),
    val queue: List<Waiting> = emptyList(),
    val events: List<DeviceEvent> = emptyList(),
    val capacity: Int = 0,
    val mode: String = "real",
    val observed: List<Observed> = emptyList(),
    val discoveryErrors: List<String> = emptyList(),
    val owners: Map<String, Owner> = emptyMap(),
)

private const val base = "/api/apps/devices"
private val statusLabels = mapOf("creating" to "初始化中", "checking" to "检查中", "free" to "闲置", "reserved" to "整组预留", "leased" to "使用中", "cleaning" to "清理中", "destroying" to "回收中", "broken" to "故障隔离")

private fun ownerName(data: DevicesSnapshot, owner: String) = data.owners[owner]?.title ?: if (owner == "manual") "手动使用" else owner

private suspend fun acquire(platforms: List<String>, reason: String, requestId: String? = null) {
    app.api.postJson("$base/leases", buildJsonObject {
        putJsonArray("platforms") { platforms.forEach { add(it) } }
        put("reason", reason)
        requestId?.let { put("requestId", it) }
    })
}

// 开发测试设备：设备池、手动申请和归还、截图、排队和操作记录
@Composable
fun DevicesScreen() {
    var data by remember { mutableStateOf<DevicesSnapshot?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var platforms by remember { mutableStateOf(listOf("android", "ios")) }
    var reason by remember { mutableStateOf("手动验证") }
    var revision by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    suspend fun load() {
        runCatching { app.api.get<DevicesSnapshot>(base) }.onSuccess { data = it; error = null }.onFailure { error = it.message }
    }
    LaunchedEffect(revision) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            launch { app.events.of("devices").collect { load() } }
            while (true) {
                load()
                delay(5000)
            }
        }
    }
    fun act(operation: suspend () -> Unit) {
        busy = true
        scope.launch {
            runCatching { operation() }.onFailure { error = it.message }
            load()
            busy = false
        }
    }
    val snapshot = data
    val own = snapshot?.leases?.find { it.owner == "manual" }
    val waiting = snapshot?.queue?.find { it.owner == "manual" }
    // 申请还在等待或还没交付时，定时用同一个申请编号续上
    LaunchedEffect(waiting?.id, own?.id, own?.claimed) {
        val pending = waiting?.takeIf { it.phase != "failed" }?.let { Triple(it.platforms, it.reason, it.id) }
            ?: own?.takeIf { !it.claimed }?.let { Triple(it.platforms, it.reason, it.requestId) }
            ?: return@LaunchedEffect
        while (true) {
            runCatching { acquire(pending.first, pending.second, pending.third) }
            load()
            delay(30_000)
        }
    }
    Scaffold(
        topBar = { BackBar("设备") { IconButton(onClick = { revision++ }, enabled = !busy) { Icon(Icons.Outlined.Refresh, "刷新") } } },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (snapshot?.mode == "mock") item { Text("模拟设备预览 · 所有操作与正式设备隔离", color = MaterialTheme.colorScheme.tertiary) }
            error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
            if (snapshot == null) {
                item { CircularProgressIndicator() }
                return@LazyColumn
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Stat("闲置设备", snapshot.devices.count { it.status == "free" }, Modifier.weight(1f))
                    Stat("使用会话", snapshot.leases.size, Modifier.weight(1f))
                    Stat("排队会话", snapshot.queue.count { it.phase != "failed" }, Modifier.weight(1f))
                }
                Text("设备池 ${snapshot.devices.size} / ${snapshot.capacity} · 按需创建 · 闲置一小时后销毁 · 双端全部就绪后交付", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
            }
            item {
                ElevatedCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        val locked = busy || own != null || waiting != null
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(listOf("android", "ios") to "Android + iOS", listOf("android") to "Android", listOf("ios") to "iOS").forEach { (value, label) ->
                                FilterChip(platforms == value, onClick = { platforms = value }, label = { Text(label) }, enabled = !locked)
                            }
                        }
                        OutlinedTextField(reason, { reason = it }, label = { Text("使用用途") }, singleLine = true, enabled = !locked, modifier = Modifier.fillMaxWidth())
                        when {
                            own != null -> Button(onClick = { act { app.api.postJson("$base/leases/${encode(own.id)}/release") } }, enabled = !busy) { Text("归还我的设备") }
                            waiting != null -> OutlinedButton(onClick = { act { app.api.postJson("$base/queue/cancel", buildJsonObject { put("requestId", waiting.id) }) } }, enabled = !busy) { Text("取消申请") }
                            else -> Button(onClick = { act { acquire(platforms, reason) } }, enabled = !busy) { Text("申请设备") }
                        }
                        if (own != null) Text("手动租约空闲 15 分钟后回收。查看截图不会延长占用。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (snapshot.devices.isEmpty()) item { Text("设备池为空，申请时会自动创建专属设备。", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(snapshot.devices, key = { it.id }) { device -> DeviceCard(device, snapshot, busy, ::act) }
            item { Text("排队", style = MaterialTheme.typography.titleMedium) }
            if (snapshot.queue.isEmpty()) item { Text("没有等待中的申请", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(snapshot.queue, key = { "queue-${it.id}" }) { item ->
                Text(
                    "${ownerName(snapshot, item.owner)}：${item.platforms.joinToString(" + ")} · ${
                        when (item.phase) {
                            "preparing" -> "正在准备整组设备"
                            "failed" -> item.error ?: "失败"
                            else -> "等待容量"
                        }
                    } · ${item.reason.ifEmpty { "未填写用途" }}",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            item { Text("已有模拟器", style = MaterialTheme.typography.titleMedium) }
            item {
                Column {
                    Text("这些设备不参与分配，也不会被清理或接管。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    snapshot.observed.forEach { Text("${it.name} · ${it.platform} · ${it.state}", style = MaterialTheme.typography.bodyMedium) }
                    snapshot.discoveryErrors.forEach { Text(it, color = MaterialTheme.colorScheme.error) }
                    TextButton(onClick = { act { data = app.api.post<DevicesSnapshot>("$base/discover") } }, enabled = !busy) { Text("只读发现") }
                }
            }
            item { Text("操作记录", style = MaterialTheme.typography.titleMedium) }
            items(snapshot.events.asReversed().take(30)) { event ->
                Text(
                    "${formatClock(event.time)}  ${event.text}" + (event.owner?.let { " · ${ownerName(snapshot, it)}" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: Int, modifier: Modifier) {
    ElevatedCard(modifier) {
        Column(Modifier.padding(12.dp)) {
            Text(value.toString(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun DeviceCard(device: Device, data: DevicesSnapshot, busy: Boolean, act: (suspend () -> Unit) -> Unit) {
    val nav = LocalNav.current
    val lease = data.leases.find { device.id in it.devices }
    val owner = lease?.let { data.owners[it.owner] }
    var destroying by remember { mutableStateOf(false) }
    var screenshot by remember { mutableStateOf<Pair<ImageBitmap, Long?>?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (device.platform == "android") "Android" else "iOS", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(statusLabels[device.status] ?: device.status, style = MaterialTheme.typography.labelLarge, color = if (device.status == "broken") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
            }
            Text(listOfNotNull(device.system, device.name).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(device.id, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            lease?.let {
                // 持有设备的是 Code 的对话时点开它
                Text(
                    "${ownerName(data, it.owner)} · ${it.reason}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (owner != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    modifier = if (owner != null) Modifier.clickable { nav.navigate(SessionRoute(owner.session)) } else Modifier,
                )
            }
            device.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            FlowRow {
                TextButton(onClick = {
                    loading = true
                    scope.launch {
                        runCatching {
                            val result = app.api.getJson("$base/${encode(device.id)}/screenshot").jsonObject
                            val bytes = Base64.decode(result["image"]!!.jsonPrimitive.content, Base64.DEFAULT)
                            BitmapFactory.decodeByteArray(bytes, 0, bytes.size).asImageBitmap() to result["at"]?.jsonPrimitive?.content?.toLongOrNull()
                        }.onSuccess { screenshot = it; error = null }.onFailure { error = it.message }
                        loading = false
                    }
                }, enabled = !loading && device.status in setOf("free", "reserved", "leased") && device.error == null) { Text(if (screenshot == null) "查看截图" else "刷新截图") }
                if (device.status != "destroying") {
                    TextButton(onClick = { destroying = true }, enabled = !busy, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                        Text(if (lease != null) "强制回收" else "销毁设备")
                    }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            screenshot?.let { (image, at) ->
                at?.let { Text("截图于 ${formatClock(it)} · 非实时画面", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Image(image, "截图", Modifier.fillMaxWidth().heightIn(max = 480.dp), contentScale = ContentScale.Fit)
            }
        }
    }
    if (destroying) {
        AlertDialog(
            onDismissRequest = { destroying = false },
            title = { Text(if (lease != null) "中断租约并销毁？" else "销毁这台设备？") },
            text = { Text(if (lease != null) "${ownerName(data, lease.owner)} 正在使用它，租约会被中断。" else "设备服务之后会按需重新创建。") },
            confirmButton = {
                TextButton(onClick = {
                    destroying = false
                    act { app.api.postJson("$base/${encode(device.id)}/control", buildJsonObject { put("operation", "destroy") }) }
                }) { Text(if (lease != null) "确认中断租约并销毁" else "确认销毁设备") }
            },
            dismissButton = { TextButton(onClick = { destroying = false }) { Text("取消") } },
        )
    }
}
