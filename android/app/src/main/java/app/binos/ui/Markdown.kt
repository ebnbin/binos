package app.binos.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage

// 简化的原生 Markdown：块级的标题、段落、列表、引用、代码块、表格、分隔线、公式，行内的粗体、斜体、代码、删除线、链接。
// 公式按 TeX 原文显示。resolve 把文字里引用的路径换成能打开的地址（会话里的文件快照），不认识的返回 null

sealed interface MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Paragraph(val text: String) : MdBlock
    data class Code(val lang: String, val code: String) : MdBlock
    data class Math(val tex: String) : MdBlock
    data class Quote(val blocks: List<MdBlock>) : MdBlock
    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<List<MdBlock>>) : MdBlock
    data class Table(val header: List<String>, val rows: List<List<String>>) : MdBlock
    data class Image(val alt: String, val url: String) : MdBlock
    data object Rule : MdBlock
}

private val headingPattern = Regex("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")
private val bulletPattern = Regex("^(\\s*)([-*+])\\s+(.*)$")
private val orderedPattern = Regex("^(\\s*)(\\d{1,9})[.)]\\s+(.*)$")
private val rulePattern = Regex("^\\s{0,3}([-*_])(\\s*\\1){2,}\\s*$")
private val fencePattern = Regex("^\\s{0,3}(```+|~~~+)\\s*([^`\\s]*).*$")
private val imagePattern = Regex("^!\\[([^]]*)]\\(([^)\\s]+)(?:\\s+\"[^\"]*\")?\\)$")
private val tableSeparator = Regex("^\\s*\\|?\\s*:?-+:?\\s*(\\|\\s*:?-+:?\\s*)*\\|?\\s*$")

fun parseMarkdown(text: String): List<MdBlock> = parseLines(text.replace("\r\n", "\n").split('\n'))

private fun parseLines(lines: List<String>): List<MdBlock> {
    val blocks = ArrayList<MdBlock>()
    var i = 0
    val paragraph = ArrayList<String>()
    fun flush() {
        if (paragraph.isNotEmpty()) {
            val joined = paragraph.joinToString("\n").trim()
            val image = imagePattern.matchEntire(joined)
            blocks.add(if (image != null) MdBlock.Image(image.groupValues[1], image.groupValues[2]) else MdBlock.Paragraph(joined))
            paragraph.clear()
        }
    }
    while (i < lines.size) {
        val line = lines[i]
        val fence = fencePattern.matchEntire(line)
        when {
            fence != null -> {
                flush()
                val marker = fence.groupValues[1]
                val code = ArrayList<String>()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith(marker)) code.add(lines[i++])
                blocks.add(MdBlock.Code(fence.groupValues[2], code.joinToString("\n")))
            }
            line.trim().startsWith("$$") -> {
                flush()
                val first = line.trim().removePrefix("$$")
                if (first.endsWith("$$") && first.length >= 2) {
                    blocks.add(MdBlock.Math(first.removeSuffix("$$").trim()))
                } else {
                    val tex = arrayListOf(first)
                    i++
                    while (i < lines.size && !lines[i].trim().endsWith("$$")) tex.add(lines[i++])
                    if (i < lines.size) tex.add(lines[i].trim().removeSuffix("$$"))
                    blocks.add(MdBlock.Math(tex.joinToString("\n").trim()))
                }
            }
            line.isBlank() -> flush()
            headingPattern.matches(line) -> {
                flush()
                val match = headingPattern.matchEntire(line)!!
                blocks.add(MdBlock.Heading(match.groupValues[1].length, match.groupValues[2]))
            }
            rulePattern.matches(line) -> {
                flush()
                blocks.add(MdBlock.Rule)
            }
            line.trimStart().startsWith(">") -> {
                flush()
                val quoted = ArrayList<String>()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) {
                    quoted.add(lines[i].trimStart().removePrefix(">").removePrefix(" "))
                    i++
                }
                blocks.add(MdBlock.Quote(parseLines(quoted)))
                continue
            }
            line.contains('|') && i + 1 < lines.size && tableSeparator.matches(lines[i + 1]) -> {
                flush()
                val header = splitRow(line)
                i += 2
                val rows = ArrayList<List<String>>()
                while (i < lines.size && lines[i].contains('|') && lines[i].isNotBlank()) rows.add(splitRow(lines[i++]))
                blocks.add(MdBlock.Table(header, rows))
                continue
            }
            bulletPattern.matches(line) || orderedPattern.matches(line) -> {
                flush()
                i = parseList(lines, i, blocks)
                continue
            }
            else -> paragraph.add(line)
        }
        i++
    }
    flush()
    return blocks
}

private fun splitRow(line: String): List<String> = line.trim().removePrefix("|").removeSuffix("|").split('|').map { it.trim() }

// 一个列表：同样缩进的列表项，缩进更深的行属于上一项
private fun parseList(lines: List<String>, start: Int, blocks: MutableList<MdBlock>): Int {
    val first = bulletPattern.matchEntire(lines[start]) ?: orderedPattern.matchEntire(lines[start])!!
    val indent = first.groupValues[1].length
    val ordered = orderedPattern.matches(lines[start])
    val items = ArrayList<ArrayList<String>>()
    var i = start
    while (i < lines.size) {
        val line = lines[i]
        val match = (if (ordered) orderedPattern else bulletPattern).matchEntire(line)
        if (match != null && match.groupValues[1].length == indent) {
            items.add(arrayListOf(match.groupValues[3]))
        } else if (line.isBlank()) {
            val next = lines.getOrNull(i + 1)
            if (next == null || next.takeWhile { it == ' ' }.length <= indent && (if (ordered) orderedPattern else bulletPattern).matchEntire(next) == null) break
            items.last().add("")
        } else if (line.takeWhile { it == ' ' }.length > indent) {
            items.last().add(line.drop(minOf(line.takeWhile { it == ' ' }.length, indent + 2)))
        } else if (match == null && !bulletPattern.matches(line) && !orderedPattern.matches(line) && items.last().last().isNotBlank()) {
            // 延续上一项的段落
            items.last().add(line.trim())
        } else {
            break
        }
        i++
    }
    val startNumber = if (ordered) first.groupValues[2].toIntOrNull() ?: 1 else 1
    blocks.add(MdBlock.ListBlock(ordered, startNumber, items.map { parseLines(it) }))
    return i
}

// ---- 行内 ----

private val inlinePattern = Regex(
    "(`+)(.+?)\\1" + // 代码
        "|\\*\\*(.+?)\\*\\*|__(.+?)__" + // 粗体
        "|(?<![\\w*])\\*(?!\\s)(.+?)(?<!\\s)\\*(?!\\w)|(?<!\\w)_(?!\\s)(.+?)(?<!\\s)_(?!\\w)" + // 斜体
        "|~~(.+?)~~" + // 删除线
        "|!?\\[([^]]*)]\\(([^)\\s]+)(?:\\s+\"[^\"]*\")?\\)" + // 链接、图片
        "|<(https?://[^>\\s]+)>|(https?://[^\\s<>()]+[^\\s<>().,;:!?'\"，。])" + // 网址
        "|(?<![\\w$])\\$(?!\\s)([^$\\n]+?)(?<!\\s)\\$(?![\\w$])", // 行内公式
)

data class MarkdownColors(val code: Color, val codeBackground: Color, val link: Color, val muted: Color)

@Composable
fun markdownColors() = MarkdownColors(
    code = MaterialTheme.colorScheme.onSurface,
    codeBackground = MaterialTheme.colorScheme.surfaceContainerHighest,
    link = MaterialTheme.colorScheme.primary,
    muted = MaterialTheme.colorScheme.onSurfaceVariant,
)

fun inlineMarkdown(text: String, colors: MarkdownColors, resolve: (String) -> String?): AnnotatedString = buildAnnotatedString {
    appendInline(text, colors, resolve)
}

private fun AnnotatedString.Builder.appendInline(text: String, colors: MarkdownColors, resolve: (String) -> String?) {
    var last = 0
    for (match in inlinePattern.findAll(text)) {
        append(unescape(text.substring(last, match.range.first)))
        last = match.range.last + 1
        val g = match.groups
        when {
            g[2] != null -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = colors.codeBackground, fontSize = 0.92.em)) { append(g[2]!!.value.trim()) }
            g[3] != null || g[4] != null -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { appendInline((g[3] ?: g[4])!!.value, colors, resolve) }
            g[5] != null || g[6] != null -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { appendInline((g[5] ?: g[6])!!.value, colors, resolve) }
            g[7] != null -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { appendInline(g[7]!!.value, colors, resolve) }
            g[9] != null -> {
                val label = g[8]!!.value.ifEmpty { g[9]!!.value }
                link(resolveLink(g[9]!!.value, resolve), colors) { appendInline(label, colors, resolve) }
            }
            g[10] != null || g[11] != null -> {
                val url = (g[10] ?: g[11])!!.value
                link(url, colors) { append(url) }
            }
            g[12] != null -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontStyle = FontStyle.Italic, color = colors.link)) { append(g[12]!!.value) }
        }
    }
    append(unescape(text.substring(last)))
}

private val Double.em get() = androidx.compose.ui.unit.TextUnit(this.toFloat(), androidx.compose.ui.unit.TextUnitType.Em)

private fun resolveLink(target: String, resolve: (String) -> String?): String? =
    resolve(target) ?: target.takeIf { it.startsWith("http://") || it.startsWith("https://") || it.startsWith("mailto:") }

private fun AnnotatedString.Builder.link(url: String?, colors: MarkdownColors, content: AnnotatedString.Builder.() -> Unit) {
    if (url == null) {
        withStyle(SpanStyle(color = colors.link)) { content() }
        return
    }
    withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = colors.link, textDecoration = TextDecoration.Underline)))) { content() }
}

private val escapePattern = Regex("\\\\([\\\\`*_{}\\[\\]()#+\\-.!|~>$])")
private fun unescape(text: String) = text.replace(escapePattern, "$1")

// ---- 显示 ----

@Composable
fun Markdown(text: String, modifier: Modifier = Modifier, resolve: (String) -> String? = { null }, style: TextStyle = MaterialTheme.typography.bodyLarge) {
    val blocks = remember(text) { parseMarkdown(text) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blocks.forEach { MarkdownBlock(it, resolve, style) }
    }
}

@Composable
private fun MarkdownBlock(block: MdBlock, resolve: (String) -> String?, style: TextStyle) {
    val colors = markdownColors()
    when (block) {
        is MdBlock.Heading -> Text(
            inlineMarkdown(block.text, colors, resolve),
            style = when (block.level) {
                1 -> MaterialTheme.typography.titleLarge
                2 -> MaterialTheme.typography.titleMedium
                else -> MaterialTheme.typography.titleSmall
            },
            modifier = Modifier.padding(top = 4.dp),
        )
        is MdBlock.Paragraph -> Text(inlineMarkdown(block.text, colors, resolve), style = style)
        is MdBlock.Code -> CodeBlock(block.code, lang = block.lang)
        is MdBlock.Math -> CodeBlock(block.tex, lang = "tex")
        is MdBlock.Quote -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(2.dp)))
            Spacer(Modifier.width(10.dp))
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                block.blocks.forEach { MarkdownBlock(it, resolve, style.copy(color = colors.muted)) }
            }
        }
        is MdBlock.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            block.items.forEachIndexed { index, item ->
                Row {
                    Text(
                        if (block.ordered) "${block.start + index}." else "•",
                        style = style,
                        modifier = Modifier.widthIn(min = 20.dp).padding(end = 6.dp),
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        item.forEach { MarkdownBlock(it, resolve, style) }
                    }
                }
            }
        }
        is MdBlock.Table -> MarkdownTable(block, colors, resolve)
        is MdBlock.Image -> {
            val url = resolveLink(block.url, resolve)
            if (url != null) {
                AsyncImage(
                    model = url,
                    contentDescription = block.alt,
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier.fillMaxWidth().heightIn(max = 400.dp).clip(RoundedCornerShape(8.dp)),
                )
            } else {
                Text(block.alt.ifEmpty { block.url }, style = style, color = colors.muted)
            }
        }
        MdBlock.Rule -> HorizontalDivider(Modifier.padding(vertical = 4.dp))
    }
}

@Composable
private fun MarkdownTable(table: MdBlock.Table, colors: MarkdownColors, resolve: (String) -> String?) {
    val columns = maxOf(table.header.size, table.rows.maxOfOrNull { it.size } ?: 0)
    val border = MaterialTheme.colorScheme.outlineVariant
    Box(Modifier.horizontalScroll(rememberScrollState())) {
        Column(Modifier.border(1.dp, border, RoundedCornerShape(6.dp)).padding(1.dp)) {
            (listOf(table.header) + table.rows).forEachIndexed { rowIndex, row ->
                Row(Modifier.background(if (rowIndex == 0) colors.codeBackground else Color.Transparent)) {
                    for (column in 0 until columns) {
                        Text(
                            inlineMarkdown(row.getOrElse(column) { "" }, colors, resolve),
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = if (rowIndex == 0) FontWeight.SemiBold else null),
                            modifier = Modifier.widthIn(min = 60.dp, max = 260.dp).padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                    }
                }
                if (rowIndex < table.rows.size) HorizontalDivider(color = border)
            }
        }
    }
}

// 代码块：横向滚动，等宽字体，按语言做简单的高亮；startLine 不为 null 时显示行号
@Composable
fun CodeBlock(code: String, modifier: Modifier = Modifier, lang: String = "", startLine: Int? = null, maxHeight: Int? = null) {
    val highlightColors = highlightColors()
    val text = remember(code, lang, highlightColors) { highlight(code, lang, highlightColors) }
    val scroll = Modifier.horizontalScroll(rememberScrollState())
    Box(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .then(if (maxHeight != null) Modifier.heightIn(max = maxHeight.dp) else Modifier),
    ) {
        Row((if (maxHeight != null) Modifier.verticalScroll(rememberScrollState()) else Modifier).then(scroll).padding(horizontal = 12.dp, vertical = 10.dp)) {
            if (startLine != null) {
                Text(
                    (startLine until startLine + code.count { it == '\n' } + 1).joinToString("\n"),
                    style = codeStyle.copy(color = MaterialTheme.colorScheme.outline),
                    modifier = Modifier.padding(end = 12.dp),
                )
            }
            Text(text, style = codeStyle, softWrap = false)
        }
        val clipboard = LocalClipboardManager.current
        IconButton(onClick = { clipboard.setText(AnnotatedString(code)) }, modifier = Modifier.align(Alignment.TopEnd).size(32.dp)) {
            Icon(Icons.Outlined.ContentCopy, "复制代码", Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

val codeStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 18.sp)
