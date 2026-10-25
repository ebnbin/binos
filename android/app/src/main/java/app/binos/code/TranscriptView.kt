package app.binos.code

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.binos.ui.CodeBlock
import app.binos.ui.Markdown
import app.binos.ui.codeStyle
import app.binos.ui.formatClock
import app.binos.ui.formatDivider
import app.binos.ui.formatDuration
import app.binos.ui.formatTokens
import app.binos.ui.languageOf
import coil3.compose.AsyncImage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

// 显示 transcript 用到的上下文：thread 用来拼文件地址，now 是计时用的当前时间
class TranscriptContext(
    val thread: String,
    val live: Live?,
    val now: Long,
    val onOpenFile: (url: String, name: String) -> Unit,
) {
    fun fileUrl(file: String, name: String? = null) = CodeStore.api.fileUrl(thread, file, name)

    // 文字里引用的本机文件换成会话里的快照
    fun resolver(files: Map<String, String>): (String) -> String? = { reference ->
        val decoded = runCatching { java.net.URLDecoder.decode(reference.replace("+", "%2B"), "UTF-8") }.getOrDefault(reference)
        files[decoded]?.let { fileUrl(it) }
    }
}

private val prettyJson = Json { prettyPrint = true }

@Composable
fun BlockView(block: Block, context: TranscriptContext, last: Boolean, highlighted: Boolean = false) {
    when (block) {
        is Block.Turn -> Unit
        is Block.Time -> Text(
            formatDivider(parseTime(block.time)),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        is Block.Input -> UserMessage(block, highlighted)
        is Block.Attachments -> AttachmentRow(block.attachments, context)
        is Block.Text -> SelectionContainer {
            Markdown(
                block.text,
                modifier = if (highlighted) Modifier.background(MaterialTheme.colorScheme.tertiaryContainer, RoundedCornerShape(8.dp)) else Modifier,
                resolve = context.resolver(block.files),
            )
        }
        is Block.Steps -> StepsView(block.steps, context, last)
        is Block.Compact -> Divider(
            "${if (block.item.trigger == "manual") "手动" else "自动"}压缩了上下文" +
                if (block.item.preTokens != null && block.item.postTokens != null) "（${formatTokens(block.item.preTokens)} → ${formatTokens(block.item.postTokens)} token）" else "",
        )
        is Block.Interrupted -> Divider("已打断")
        is Block.TurnEnd -> TurnEndView(block, context)
    }
}

@Composable
private fun Divider(text: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        HorizontalDivider(Modifier.weight(1f))
        Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 8.dp))
        HorizontalDivider(Modifier.weight(1f))
    }
}

@Composable
private fun UserMessage(block: Block.Input, highlighted: Boolean) {
    val clipboard = LocalClipboardManager.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        Surface(
            color = if (highlighted) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.secondaryContainer,
            shape = RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp),
            modifier = Modifier.widthIn(max = 560.dp).padding(start = 40.dp),
        ) {
            SelectionContainer {
                Text(block.text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(formatClock(parseTime(block.time)), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            IconButton(onClick = { clipboard.setText(AnnotatedString(block.text)) }, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Outlined.ContentCopy, "复制消息", Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

private val imageExtensions = setOf("png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "heic")

fun isImage(name: String) = name.substringAfterLast('.', "").lowercase() in imageExtensions

// 已发出的附件：图片是缩略图，其他是文件卡片，点开预览或下载
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AttachmentRow(attachments: List<Attachment>, context: TranscriptContext) {
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        attachments.forEach { attachment ->
            val url = context.fileUrl(attachment.file)
            if (isImage(attachment.name)) {
                AsyncImage(
                    model = url,
                    contentDescription = attachment.name,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(96.dp).clip(RoundedCornerShape(12.dp)).clickable { context.onOpenFile(url, attachment.name) },
                )
            } else {
                FileChip(attachment.name) { context.onOpenFile(context.fileUrl(attachment.file), attachment.name) }
            }
        }
    }
}

@Composable
fun FileChip(name: String, onClick: (() -> Unit)? = null) {
    OutlinedCard(modifier = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null, Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 200.dp))
        }
    }
}

// 连续的几步：最多只有一次工具调用时直接显示；多次时收成一行「已工作 …」，正在进行的那一组展开
@Composable
private fun StepsView(steps: List<Step>, context: TranscriptContext, last: Boolean) {
    val states = steps.mapNotNull {
        when (it) {
            is Step.Tool -> it.state
            is Step.Subagent -> it.state
            else -> null
        }
    }
    if (states.size <= 1) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) { steps.forEach { StepView(it, context) } }
        return
    }
    var userOpen by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val running = states.any { it.status == "running" }
    val errors = states.count { it.status == "error" }
    val first = steps.first()
    val start = parseTime(first.time) - ((first as? Step.Thinking)?.durationMs ?: 0)
    val end = steps.maxOf { step ->
        when (step) {
            is Step.Thinking -> parseTime(step.time)
            is Step.Tool -> step.state.result?.let { parseTime(it.time) } ?: if (running) context.now else parseTime(step.time)
            is Step.Subagent -> step.state.result?.let { parseTime(it.time) } ?: if (running) context.now else parseTime(step.time)
        }
    }
    val open = userOpen ?: (context.live != null && last)
    Column(Modifier.animateContentSize()) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { userOpen = !open }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "${if (running) "正在工作" else "已工作"} ${formatDuration((end - start).coerceAtLeast(0))} · ${summarize(steps)}" +
                    if (errors > 0) " · $errors 个出错" else "",
                style = MaterialTheme.typography.bodyMedium,
                color = if (errors > 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            Icon(Icons.Outlined.ChevronRight, null, Modifier.size(18.dp).rotate(if (open) 90f else 0f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (open) {
            Column(
                Modifier.padding(start = 8.dp).background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(8.dp)).padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) { steps.forEach { StepView(it, context) } }
        }
    }
}

@Composable
private fun StepView(step: Step, context: TranscriptContext) {
    when (step) {
        is Step.Thinking -> ThinkingView(step.text, step.durationMs, context)
        is Step.Tool -> ToolCallView(step.state, context)
        is Step.Subagent -> SubagentView(step.state, step.turn, context)
    }
}

// 思考：收起时一行「思考了 X 秒」，展开看思考的摘要；正在想时展开
@Composable
fun ThinkingView(text: String, durationMs: Long?, context: TranscriptContext, live: Boolean = false) {
    var open by rememberSaveable { mutableStateOf(false) }
    val expanded = open || live
    Column(Modifier.animateContentSize()) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(enabled = !live) { open = !open }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Lightbulb, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    live -> "思考中…"
                    durationMs != null -> "思考了 ${formatDuration(durationMs)}"
                    else -> "思考"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            if (!live) Icon(Icons.Outlined.ExpandMore, null, Modifier.size(18.dp).rotate(if (expanded) 180f else 0f), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (expanded && text.isNotBlank()) {
            Markdown(
                text,
                modifier = Modifier.padding(start = 24.dp, bottom = 6.dp),
                style = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurfaceVariant, fontStyle = FontStyle.Italic),
                resolve = context.resolver(emptyMap()),
            )
        }
    }
}

@Composable
private fun StatusIndicator(state: CallState, now: Long) {
    when (state.status) {
        "running" -> CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        "error" -> Icon(Icons.Outlined.ErrorOutline, "出错", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.error)
        "stopped" -> Icon(Icons.Outlined.StopCircle, "已停止", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> state.durationMs(now)?.takeIf { it >= 1000 }?.let {
            Text(formatDuration(it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// 一次工具调用：图标、动作、对象，点开看参数和结果
@Composable
private fun ToolCallView(state: CallState, context: TranscriptContext) {
    var open by rememberSaveable(state.call.id) { mutableStateOf(false) }
    val label = toolLabel(state.call)
    val changes = (state.call.tool as? ToolDetail.Edit)?.lines
    Column(Modifier.animateContentSize()) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { open = !open }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(label.icon, null, Modifier.size(16.dp), tint = if (state.status == "error") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(8.dp))
            Text(label.verb, style = MaterialTheme.typography.bodyMedium)
            label.detail?.let {
                Spacer(Modifier.width(6.dp))
                Text(
                    it.replace('\n', ' '),
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
            }
            Spacer(Modifier.weight(0.001f).width(6.dp))
            changes?.let { ChangeCounts(it.added, it.removed) }
            Spacer(Modifier.width(6.dp))
            StatusIndicator(state, context.now)
        }
        if (open) {
            Column(Modifier.padding(start = 24.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                ToolBody(state, context)
            }
        }
    }
}

@Composable
fun ChangeCounts(added: Int, removed: Int) {
    Text(
        androidx.compose.ui.text.buildAnnotatedString {
            if (added > 0) pushStyle(androidx.compose.ui.text.SpanStyle(color = addedColor())).also { append("+$added") }.also { pop() }
            if (added > 0 && removed > 0) append(" ")
            if (removed > 0) pushStyle(androidx.compose.ui.text.SpanStyle(color = removedColor())).also { append("−$removed") }.also { pop() }
        },
        style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
    )
}

@Composable
private fun addedColor() = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) Color(0xFF7EE787) else Color(0xFF1A7F37)

@Composable
private fun removedColor() = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) Color(0xFFFF7B72) else Color(0xFFCF222E)

private fun Color.luminance() = 0.2126f * red + 0.7152f * green + 0.0722f * blue

// 发给页面时省略过的调用，展开时读完整的；还没读到或读不到时用已有的。结果是读完之后才到的，就还用已有的
@Composable
private fun rememberFullCall(thread: String, state: CallState): Pair<Entry.ToolCall, Entry.ToolResult?> {
    val clipped = state.call.clipped || state.result?.clipped == true
    var full by remember(thread, state.seq) { mutableStateOf<Triple<Entry.ToolResult?, Entry.ToolCall, Entry.ToolResult?>?>(null) }
    LaunchedEffect(thread, state.seq, clipped, state.result) {
        if (clipped) readFullCall(thread, state.seq)?.let { (call, result) -> full = Triple(state.result, call, result) }
    }
    return full?.takeIf { it.first === state.result }?.let { it.second to it.third } ?: (state.call to state.result)
}

// 展开一次工具调用看到的内容：常用的几类按各自的样子显示，其他的显示参数和输出
@Composable
private fun ToolBody(state: CallState, context: TranscriptContext) {
    val (call, result) = rememberFullCall(context.thread, state)
    val failed = result?.status == "error" && call.tool !is ToolDetail.Command
    if (failed) {
        Output(result)
    } else {
        when (val tool = call.tool) {
            is ToolDetail.Command -> TerminalOutput(tool.command, result)
            is ToolDetail.Read -> result?.output?.let { output ->
                result.startLine?.let { CodeBlock(output, lang = languageOf(tool.path), startLine = it, maxHeight = 420) } ?: CodeBlock(output, maxHeight = 420)
            }
            is ToolDetail.Edit -> when (val change = tool.change) {
                is FileChange.Write -> CodeBlock(change.content.removeSuffix("\n"), lang = languageOf(tool.path), startLine = 1, maxHeight = 420)
                is FileChange.Replace -> {
                    if (change.all) Text("替换全部出现的地方", style = MaterialTheme.typography.bodySmall)
                    DiffView(remember(change) { diffLines(change.before, change.after) })
                }
                is FileChange.Diff -> when (change.op) {
                    "add" -> CodeBlock(change.diff.removeSuffix("\n"), lang = languageOf(tool.path), startLine = 1, maxHeight = 420)
                    "delete" -> Text("删除了这个文件", style = MaterialTheme.typography.bodySmall)
                    else -> DiffView(remember(change) { patchLines(change.diff) })
                }
                FileChange.Other, null -> Raw(call, result)
            }
            is ToolDetail.WebSearch -> result?.let { WebSearchResults(it, context) }
            is ToolDetail.WebFetch -> {
                tool.prompt?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                result?.output?.let { Markdown(it, style = MaterialTheme.typography.bodyMedium) }
            }
            is ToolDetail.Subagent -> {
                tool.prompt?.let { Markdown(it, style = MaterialTheme.typography.bodyMedium) }
                result?.output?.let { Markdown(it, style = MaterialTheme.typography.bodyMedium) }
            }
            else -> Raw(call, result)
        }
    }
    result?.images?.forEach { file ->
        val url = context.fileUrl(file)
        AsyncImage(
            model = url,
            contentDescription = null,
            contentScale = ContentScale.FillWidth,
            modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp).clip(RoundedCornerShape(8.dp)).clickable { context.onOpenFile(url, file) },
        )
    }
}

@Composable
private fun Raw(call: Entry.ToolCall, result: Entry.ToolResult?) {
    val input: JsonElement? = call.input
    val text = remember(call) {
        input?.let { prettyJson.encodeToString(JsonElement.serializer(), it) } ?: prettyJson.encodeToString(ToolDetail.serializer(), call.tool)
    }
    CodeBlock(text, lang = "json", maxHeight = 320)
    Output(result)
}

@Composable
private fun Output(result: Entry.ToolResult?) {
    val output = result?.output?.takeIf { it.isNotEmpty() } ?: return
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).heightIn(max = 320.dp)
            .verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(10.dp),
    ) {
        Text(
            (if (result.truncated || result.clipped) "…（前面的输出已省略）\n" else "") + output,
            style = codeStyle,
            color = if (result.status == "error") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            softWrap = false,
        )
    }
}

@Composable
private fun TerminalOutput(command: String, result: Entry.ToolResult?) {
    val background = Color(0xFF1E1E1E)
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(background).heightIn(max = 360.dp)
            .verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(10.dp),
    ) {
        Text(
            androidx.compose.ui.text.buildAnnotatedString {
                pushStyle(androidx.compose.ui.text.SpanStyle(color = Color(0xFF7EE787)))
                append("$ ")
                pop()
                pushStyle(androidx.compose.ui.text.SpanStyle(color = Color(0xFFE6EDF3)))
                append(command)
                pop()
                result?.output?.takeIf { it.isNotEmpty() }?.let {
                    pushStyle(androidx.compose.ui.text.SpanStyle(color = if (result.status == "error") Color(0xFFFF7B72) else Color(0xFFB0B8C1)))
                    append("\n")
                    if (result.truncated || result.clipped) append("…（前面的输出已省略）\n")
                    append(it)
                    pop()
                }
            },
            style = codeStyle,
            softWrap = false,
        )
    }
}

@Composable
fun DiffView(lines: List<DiffLine>) {
    val added = addedColor()
    val removed = removedColor()
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).heightIn(max = 420.dp)
            .verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState()).padding(vertical = 8.dp),
    ) {
        Column {
            lines.forEach { line ->
                val (sign, color) = when (line.kind) {
                    DiffKind.Added -> "+" to added
                    DiffKind.Removed -> "−" to removed
                    DiffKind.Hunk -> "" to MaterialTheme.colorScheme.primary
                    DiffKind.Same -> " " to Color.Unspecified
                }
                Text(
                    if (line.kind == DiffKind.Hunk) line.text else "$sign ${line.text}",
                    style = codeStyle,
                    color = if (line.kind == DiffKind.Same) MaterialTheme.colorScheme.onSurface else color,
                    softWrap = false,
                    modifier = Modifier
                        .background(if (line.kind == DiffKind.Added || line.kind == DiffKind.Removed) color.copy(alpha = 0.12f) else Color.Transparent)
                        .padding(horizontal = 10.dp),
                )
            }
        }
    }
}

// 搜索网页的结果：搜到的网页，以及总结
@Composable
private fun WebSearchResults(result: Entry.ToolResult, context: TranscriptContext) {
    val uriHandler = LocalUriHandler.current
    result.links.forEach { link ->
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable { uriHandler.openUri(link.url) }.padding(vertical = 4.dp)) {
            Text(link.title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(link.url.toHttpHost(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    result.output?.takeIf { it.isNotBlank() }?.let { Markdown(it.trim(), style = MaterialTheme.typography.bodyMedium, resolve = context.resolver(emptyMap())) }
}

private fun String.toHttpHost() = runCatching { java.net.URI(this).host }.getOrNull() ?: this

// 子 agent：卡片里是任务描述和进度，点开看它的过程
@Composable
private fun SubagentView(state: CallState, turn: Turn, context: TranscriptContext) {
    var open by rememberSaveable(state.call.id) { mutableStateOf(false) }
    val tool = state.call.tool as ToolDetail.Subagent
    val progress = context.live?.tasks?.get(state.call.id)
    val children = turn.children[state.itemId]
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).animateContentSize(),
    ) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.SmartToy, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(tool.description, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val facts = listOfNotNull(
                    tool.type,
                    progress?.activity,
                    progress?.toolUses?.let { "$it 次工具调用" },
                    progress?.tokens?.let { "${formatTokens(it)} token" },
                )
                if (facts.isNotEmpty()) {
                    Text(facts.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Spacer(Modifier.width(8.dp))
            StatusIndicator(state, context.now)
        }
        if (open) {
            Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                tool.prompt?.let {
                    Text("任务", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Markdown(it, style = MaterialTheme.typography.bodySmall)
                }
                if (!children.isNullOrEmpty()) {
                    HorizontalDivider()
                    val blocks = remember(children, state.live) { buildBlocks(children, turn, state.live) }
                    blocks.forEach { BlockView(it, context, it === blocks.last()) }
                } else if (state.result?.output?.isNotBlank() == true) {
                    // 没有过程的记录时显示交回的结果，发给页面时省略过就读完整的
                    val (_, result) = rememberFullCall(context.thread, state)
                    result?.output?.takeIf { it.isNotBlank() }?.let {
                        HorizontalDivider()
                        Text("结果", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Markdown(it, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

// 一轮的结尾：改过的文件、停止或出错、这一轮的统计
@Composable
private fun TurnEndView(block: Block.TurnEnd, context: TranscriptContext) {
    val item = block.item
    val files = remember(block) { fileChanges(block.edits) }
    val clipboard = LocalClipboardManager.current
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (files.isNotEmpty()) TurnChanges(files)
        if (item.outcome == "stopped") {
            Divider("已停止 · 用时 ${formatDuration(item.durationMs)}")
            return@Column
        }
        if (item.outcome == "error") {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                Text(item.error ?: "agent 出错了", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(12.dp))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                listOfNotNull(
                    formatClock(parseTime(item.time)),
                    "用时 ${formatDuration(item.durationMs)}",
                    item.outputTokens?.let { "输出 ${formatTokens(it)} token" },
                    item.context?.let { "上下文 ${(it.tokens * 100 / maxOf(it.window, 1))}%" },
                    item.modelName ?: item.model,
                ).joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            if (block.reply.isNotEmpty()) {
                IconButton(onClick = { clipboard.setText(AnnotatedString(block.reply)) }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Outlined.ContentCopy, "复制回复", Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

// 这一轮改过的文件：增删的行数，点开看每一次修改
@Composable
private fun TurnChanges(files: List<ChangedFile>) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Text(
            "改了 ${files.size} 个文件",
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(start = 12.dp, top = 10.dp, bottom = 4.dp),
        )
        files.forEach { file ->
            var open by rememberSaveable(file.path) { mutableStateOf(false) }
            Column(Modifier.animateContentSize()) {
                Row(Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        file.path.substringAfterLast('/'),
                        style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    file.op?.let { Text(if (it == "add") "新建 " else "删除 ", style = MaterialTheme.typography.labelSmall) }
                    ChangeCounts(file.added, file.removed)
                }
                if (open) {
                    Column(Modifier.padding(horizontal = 12.dp).padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(file.path, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        file.calls.forEach { state ->
                            val tool = state.call.tool as ToolDetail.Edit
                            when (val change = tool.change) {
                                is FileChange.Write -> CodeBlock(change.content.removeSuffix("\n"), lang = languageOf(tool.path), startLine = 1, maxHeight = 360)
                                is FileChange.Replace -> DiffView(remember(change) { diffLines(change.before, change.after) })
                                is FileChange.Diff -> if (change.op == "update") DiffView(remember(change) { patchLines(change.diff) })
                                else if (change.op == "add") CodeBlock(change.diff.removeSuffix("\n"), lang = languageOf(tool.path), startLine = 1, maxHeight = 360)
                                FileChange.Other, null -> Unit
                            }
                        }
                    }
                }
            }
        }
    }
}

// 回答进行中的状态：现在在做什么，已经用了多久
fun statusText(live: Live, runningTool: String?): String = when (val status = live.status) {
    Status.Requesting -> "等待模型"
    Status.Thinking -> "思考中"
    is Status.Tool -> "正在调用 ${status.name}"
    Status.Compacting -> "正在压缩上下文"
    is Status.Waiting -> "已答完，等待 ${status.tasks} 个后台任务"
    is Status.Retrying -> "请求失败，第 ${status.attempt} 次重试"
    Status.Other, null -> if (live.text.isNotEmpty()) "正在回答" else runningTool?.let { "正在运行 $it" } ?: "正在处理"
}
