@file:OptIn(ExperimentalMaterial3Api::class)

package app.binos.code

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.PlaylistAdd
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Undo
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.binos.ui.formatPercent
import app.binos.ui.formatQuota
import app.binos.ui.formatTokens
import coil3.compose.AsyncImage

@Composable
fun Composer(model: ConversationModel, session: SessionSummary?, running: Boolean, agentFixed: Boolean, onSend: (SendMode) -> Unit) {
    val context = LocalContext.current
    val catalogs by CodeStore.catalogs.collectAsStateWithLifecycle()
    val choice = model.choice(session)
    val hasContent = model.input.isNotBlank() || model.pending.isNotEmpty()
    var attachMenu by remember { mutableStateOf(false) }
    var modelSheet by remember { mutableStateOf(false) }
    var effortMenu by remember { mutableStateOf(false) }
    var usageSheet by remember { mutableStateOf(false) }

    fun add(uris: List<Uri>) {
        uris.forEach { uri ->
            val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "file"
            val image = context.contentResolver.getType(uri)?.startsWith("image/") == true
            model.pending.add(PendingFile(uri, name, image))
        }
    }
    val media = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { add(it) }
    val documents = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { add(it) }

    val catalog = catalogs.find { it.agent == choice.agent }
    val models = catalog?.models.orEmpty()
    val defaultModel = models.find { it.isDefault }
    val selectedModel = models.find { it.id == choice.model } ?: if (choice.model == null) defaultModel else null
    val efforts = (models.find { it.id == (choice.model ?: defaultModel?.id) }?.efforts ?: catalog?.efforts.orEmpty()).let { list ->
        (list + listOfNotNull(choice.effort)).distinct()
    }

    Surface(tonalElevation = 3.dp, shadowElevation = 2.dp, shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)) {
        Column(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)).padding(horizontal = 12.dp, vertical = 8.dp)) {
            // 排着队、等这一轮答完再发的消息；被停止或出错后留下的可以现在就发
            session?.queue?.takeIf { it.isNotEmpty() && model.sessionId != null }?.let { queue ->
                queue.forEach { item ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                        Icon(Icons.Outlined.Schedule, "排队中", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            item.text.trim().ifEmpty { item.attachments.firstOrNull()?.name ?: "" } + if (item.attachments.isNotEmpty()) " 📎${item.attachments.size}" else "",
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (!running) IconButton(onClick = { model.sendQueued(item.id) }, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.ArrowUpward, "现在发送", Modifier.size(18.dp)) }
                        IconButton(onClick = { model.withdraw(item.id) }, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.Undo, "撤回到输入框", Modifier.size(18.dp)) }
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = 4.dp))
            }
            if (model.pending.isNotEmpty()) {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    model.pending.forEach { file ->
                        Box {
                            if (file.image) {
                                AsyncImage(file.uri, file.name, contentScale = ContentScale.Crop, modifier = Modifier.size(64.dp).clip(RoundedCornerShape(10.dp)))
                            } else {
                                Row(
                                    Modifier.heightIn(min = 64.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null, Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(file.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(120.dp))
                                }
                            }
                            if (!model.sending) {
                                Icon(
                                    Icons.Outlined.Close,
                                    "移除 ${file.name}",
                                    Modifier.align(Alignment.TopEnd).padding(2.dp).size(18.dp).clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.inverseSurface).clickable { model.pending.remove(file) }.padding(2.dp),
                                    tint = MaterialTheme.colorScheme.inverseOnSurface,
                                )
                            }
                        }
                    }
                }
            }
            BasicTextField(
                value = model.input,
                onValueChange = model::updateInput,
                readOnly = model.sending,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                maxLines = 8,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp),
                decorationBox = { field ->
                    Box {
                        if (model.input.isEmpty()) {
                            Text(
                                if (running) "补充或纠正，agent 会在下一步看到" else "输入消息",
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        field()
                    }
                },
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box {
                    IconButton(onClick = { attachMenu = true }, enabled = !model.sending) { Icon(Icons.Outlined.AttachFile, "添加附件") }
                    DropdownMenu(attachMenu, onDismissRequest = { attachMenu = false }) {
                        DropdownMenuItem(text = { Text("照片和视频") }, leadingIcon = { Icon(Icons.Outlined.Image, null) }, onClick = {
                            attachMenu = false
                            media.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                        })
                        DropdownMenuItem(text = { Text("文件") }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null) }, onClick = {
                            attachMenu = false
                            documents.launch(arrayOf("*/*"))
                        })
                    }
                }
                Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { modelSheet = true }, enabled = !running) {
                        Text(selectedModel?.name ?: choice.model ?: agentName(choice.agent), maxLines = 1)
                    }
                    Box {
                        TextButton(onClick = { effortMenu = true }, enabled = !running) {
                            Icon(Icons.Outlined.Psychology, "思考程度", Modifier.size(18.dp))
                            choice.effort?.let { Text(" ${effortName(it)}") }
                        }
                        DropdownMenu(effortMenu, onDismissRequest = { effortMenu = false }) {
                            Text("思考程度", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                            (listOf("") + efforts).forEach { effort ->
                                DropdownMenuItem(
                                    text = { Text(if (effort.isEmpty()) "默认" else effortName(effort)) },
                                    trailingIcon = { if ((choice.effort ?: "") == effort) Icon(Icons.Outlined.Check, null) },
                                    onClick = {
                                        model.picked = choice.copy(effort = effort.ifEmpty { null })
                                        effortMenu = false
                                    },
                                )
                            }
                        }
                    }
                    if (session != null) UsageRing(session) { usageSheet = true }
                }
                when {
                    model.sending -> Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) }
                    running && !hasContent -> FilledIconButton(onClick = model::stop) { Icon(Icons.Outlined.Stop, "停止") }
                    else -> {
                        if (running) {
                            IconButton(onClick = { onSend(SendMode.Interrupt) }) { Icon(Icons.Outlined.Bolt, "打断并发送") }
                            IconButton(onClick = { onSend(SendMode.Queue) }) { Icon(Icons.AutoMirrored.Outlined.PlaylistAdd, "排队：这一轮答完再发") }
                        }
                        FilledIconButton(onClick = { onSend(SendMode.Send) }, enabled = hasContent, colors = IconButtonDefaults.filledIconButtonColors()) {
                            Icon(Icons.AutoMirrored.Outlined.Send, if (running) "插话" else "发送")
                        }
                    }
                }
            }
        }
    }

    if (modelSheet) {
        ModalBottomSheet(onDismissRequest = { modelSheet = false }) {
            Column(Modifier.verticalScroll(rememberScrollState())) {
            Text("模型", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            // 能选的 agent：能用的，加上这个对话正在用的
            catalogs.filter { it.available || it.agent == choice.agent }.forEach { item ->
                Text(agentName(item.agent), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                item.models.forEach { option ->
                    val disabled = agentFixed && item.agent != choice.agent
                    val selected = item.agent == choice.agent && (option.id == choice.model || choice.model == null && option.isDefault)
                    ListItem(
                        colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
                        headlineContent = { Text(option.name) },
                        supportingContent = { Text(listOfNotNull(agentName(item.agent), "默认".takeIf { option.isDefault }, "新对话才能换 agent".takeIf { disabled }).joinToString(" · ")) },
                        trailingContent = { if (selected) Icon(Icons.Outlined.Check, null, tint = MaterialTheme.colorScheme.primary) },
                        modifier = Modifier.alpha(if (disabled) 0.4f else 1f).clickable(enabled = !disabled) {
                            model.picked = Choice(
                                item.agent,
                                option.id.takeUnless { option.isDefault },
                                choice.effort?.takeIf { item.agent == choice.agent && it in option.efforts },
                            )
                            modelSheet = false
                        },
                    )
                }
            }
            if (catalogs.isEmpty()) Text("模型信息暂不可用", Modifier.padding(24.dp))
            Spacer(Modifier.size(24.dp))
            }
        }
    }
    if (usageSheet && session != null) {
        ModalBottomSheet(onDismissRequest = { usageSheet = false }) { UsageDetails(session) }
    }
}

// 上下文占了多少：小圆环加百分比，快满时变色
@Composable
private fun UsageRing(session: SessionSummary, onClick: () -> Unit) {
    val ratio = session.context?.let { (it.tokens.toDouble() / it.window).coerceAtMost(1.0) }
    val color = when {
        ratio == null -> MaterialTheme.colorScheme.onSurfaceVariant
        ratio >= 0.9 -> MaterialTheme.colorScheme.error
        ratio >= 0.7 -> androidx.compose.ui.graphics.Color(0xFFE6A23C)
        else -> MaterialTheme.colorScheme.primary
    }
    TextButton(onClick = onClick) {
        CircularProgressIndicator(
            progress = { (ratio ?: 0.0).toFloat() },
            modifier = Modifier.size(16.dp),
            strokeWidth = 3.dp,
            color = color,
            trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
            gapSize = 0.dp,
        )
        Text(" " + (ratio?.let { formatPercent(it) } ?: "用量"), color = color, style = MaterialTheme.typography.labelLarge)
    }
}

// 这个会话的用量：上下文、一共用掉的 token 和各部分、大约占订阅周额度多少，以及这 7 天里 binOS 大约用了多少
@Composable
private fun UsageDetails(session: SessionSummary) {
    val status by CodeStore.status.collectAsStateWithLifecycle()
    var usage by remember { mutableStateOf<CodeUsage?>(null) }
    LaunchedEffect(Unit) { usage = runCatching { CodeStore.api.usage() }.getOrNull() }
    val week = status?.limits?.get(session.agent)?.windows?.find { it.minutes == 7L * 24 * 60 }
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("会话用量", style = MaterialTheme.typography.titleLarge)
        val context = session.context
        UsageLine("上下文", context?.let { "${formatTokens(it.tokens)} / ${formatTokens(it.window)} · ${formatPercent(it.tokens.toDouble() / it.window)}" } ?: "答完第一轮后显示")
        context?.let { LinearProgressIndicator(progress = { (it.tokens.toFloat() / it.window).coerceAtMost(1f) }, modifier = Modifier.fillMaxWidth()) }
        val tokens = session.tokens
        UsageLine("本会话", tokens?.let { "${formatTokens(it.total)} token" } ?: "还没有记录")
        tokens?.let {
            Text(
                "输入 ${formatTokens(it.input)} · 读缓存 ${formatTokens(it.cacheRead)} · 写缓存 ${formatTokens(it.cacheWrite)} · 输出 ${formatTokens(it.output)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (session.priced) {
            UsageLine("约占周额度", session.quota?.let { formatQuota(it) } ?: "还估不出来")
            val week7 = usage?.week
            if (week7 != null && week != null && week.resetsAt == usage?.resetsAt) {
                UsageLine("这 7 天", "binOS 约 ${formatQuota(week7)} · 订阅共 ${formatPercent(week.utilization)}")
            }
            Text(
                if (session.quota != null) "订阅是 ${agentName(session.agent)} 自己的 app、网页版和别的应用共用的，这里只算 binOS 的；按 API 价格折算估计，别处一直在用时偏高"
                else "binOS 的用量让 7 天额度涨过 3% 后才估得出来",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun UsageLine(label: String, value: String) {
    Row {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
