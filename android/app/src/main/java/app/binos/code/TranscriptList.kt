package app.binos.code

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.binos.ui.Markdown
import app.binos.ui.formatElapsed
import app.binos.ui.rememberNow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import java.util.IdentityHashMap

// 离顶部还有这么多块时开始补读更早的轮
private const val olderMargin = 8

// 答完的轮整理成的块，previousTime 变了（前面补上了更早的轮）才重新整理
private class TurnBlocks(val previousTime: String?, val blocks: List<Block>)

// thread 的内容：倒序排列的列表，新内容出现在底部；往上翻看时不打扰，滚到顶部附近时补读更早的轮。
// 只有最后一轮随推送和计时重新整理。stickRequests 每加一次回到底部；targetSeq 是要定位的条目的 seq
@Composable
fun Transcript(state: ThreadState, notice: String?, stickRequests: Int, targetSeq: Int?, onOpenFile: (String, String) -> Unit) {
    val live = state.live
    val running = live != null
    val now = rememberNow(running)
    val turns = state.turns
    val cache = remember(state) { IdentityHashMap<Turn, TurnBlocks>() }
    val blocks = remember(turns, running) {
        turns.flatMapIndexed { i, turn ->
            val previousTime = turns.getOrNull(i - 1)?.main?.lastOrNull()?.entry?.time
            if (i == turns.lastIndex && running) {
                cache.remove(turn)
                buildBlocks(turn.main, turn, true, previousTime)
            } else {
                cache[turn]?.takeIf { it.previousTime == previousTime }?.blocks
                    ?: buildBlocks(turn.main, turn, false, previousTime).also { cache[turn] = TurnBlocks(previousTime, it) }
            }
        }
    }
    val context = TranscriptContext(state.thread, live, now, onOpenFile)
    val current = turns.lastOrNull()
    val runningTool = current?.main?.lastOrNull { it.entry is Entry.ToolCall && current.results[it.itemId ?: ""] == null }?.entry as? Entry.ToolCall
    val turnStart = (current?.first?.entry as? Entry.Input)?.takeIf { it.mode == "start" }?.time
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val reversed = remember(blocks) { blocks.asReversed() }
    val awayFromBottom by remember { derivedStateOf { listState.firstVisibleItemIndex > 1 } }
    // 在底部时新内容到来会跟着滚到底；往上翻看时不打扰。倒序列表按条目保持位置，新条目插在前面时要手动滚回去
    var stick by remember { mutableStateOf(targetSeq == null) }
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
            if (!scrolling) stick = listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset < 120
        }
    }
    LaunchedEffect(stickRequests) { stick = true }
    LaunchedEffect(blocks.size, live?.text?.length, live?.thinking?.length, live != null, notice) {
        if (stick) listState.scrollToItem(0)
    }
    // 倒序列表的末尾是最早的内容：看到离它不远时补读更早的轮；补上的条目接在末尾，正在看的内容不动。
    // 排版还没跟上现在的块（刚补发了一批条目）时不算到了顶部
    val blockCount by rememberUpdatedState(blocks.size)
    fun nearTop(): Boolean {
        val info = listState.layoutInfo
        val last = info.visibleItemsInfo.lastOrNull()?.index ?: return false
        return state.hasOlder && info.totalItemsCount > blockCount && last >= info.totalItemsCount - olderMargin
    }
    LaunchedEffect(listState, state) {
        snapshotFlow { nearTop() }.distinctUntilChanged().collect { if (it) state.loadOlder(scope) }
    }
    LaunchedEffect(state.firstSeq) { if (nearTop()) state.loadOlder(scope) }

    // 从搜索结果跳过来时，先补读到那一条，再滚过去并短暂高亮。倒序列表里条目前面还有提示和回答中的临时内容
    var located by remember { mutableStateOf(targetSeq == null) }
    var highlight by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(blocks, state.loaded) {
        if (located || targetSeq == null || !state.loaded) return@LaunchedEffect
        if (targetSeq < state.firstSeq) {
            state.loadOlder(scope, targetSeq)
            return@LaunchedEffect
        }
        val position = reversed.indexOfFirst { it is Block.Input && it.seq == targetSeq || it is Block.Text && it.key == targetSeq.toString() }
        if (position >= 0) {
            val leading = listOfNotNull(notice, live, live?.text?.takeIf { it.isNotBlank() }, live?.thinking?.takeIf { it.isNotEmpty() }).size
            listState.scrollToItem(position + leading, -listState.layoutInfo.viewportSize.height / 3)
            located = true
            highlight = reversed[position].key
            delay(2000)
            highlight = null
        }
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            reverseLayout = true,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            notice?.let { notice ->
                item(key = "notice") {
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                        Text(notice, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            if (live != null) {
                item(key = "live-status") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            statusText(live, runningTool?.name) + (turnStart?.let { " · ${formatElapsed(now - parseTime(it))}" } ?: ""),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (live.text.isNotBlank()) {
                    item(key = "live-text") { Markdown(live.text, resolve = context.resolver(live.files)) }
                }
                if (live.thinking.isNotEmpty()) {
                    item(key = "live-thinking") { ThinkingView(live.thinking, null, context, live = true) }
                }
            }
            items(reversed, key = { it.key }) { block -> BlockView(block, context, block === blocks.lastOrNull(), highlighted = block.key == highlight) }
            if (state.hasOlder) {
                item(key = "older") {
                    Text(
                        "正在读取更早的消息",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                    )
                }
            }
        }
        if (awayFromBottom) {
            SmallFloatingActionButton(
                onClick = {
                    stick = true
                    scope.launch { listState.animateScrollToItem(0) }
                },
                modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            ) { Icon(Icons.Outlined.KeyboardArrowDown, "回到底部") }
        }
    }
}
