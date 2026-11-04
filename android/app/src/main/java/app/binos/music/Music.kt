@file:OptIn(ExperimentalMaterial3Api::class)

package app.binos.music

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.outlined.DragHandle
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.zIndex
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Lyrics
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Repeat
import androidx.compose.material.icons.outlined.RepeatOne
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.Player
import app.binos.more.onEnter
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun MusicScreen() {
    LaunchedEffect(Unit) { MusicPlayer.connect() }
    val queue by MusicStore.queue.collectAsStateWithLifecycle()
    val providers by MusicStore.providers.collectAsStateWithLifecycle()
    val sync by MusicStore.sync.collectAsStateWithLifecycle()
    val synced by MusicStore.synced.collectAsStateWithLifecycle()
    var providerId by rememberSaveable { mutableStateOf<String?>(null) }
    val provider = providers.find { it.id == providerId } ?: providers.firstOrNull()
    var query by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<CatalogPage?>(null) }
    var lastSearch by remember { mutableStateOf<Triple<String, String, String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var tab by rememberSaveable { mutableStateOf(0) }
    var providerMenu by remember { mutableStateOf(false) }
    var lyricsOpen by remember { mutableStateOf(false) }
    var settingsOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val tracks = queue.orEmpty()
    val current = tracks.find { it.key == MusicPlayer.currentKey }
    // 歌词、相似歌曲看正在播放的这首来自哪个来源，不是查找用的那个
    val currentProvider = current?.let { track -> providers.find { it.id == track.ref.provider } }
    val queued = tracks.map { it.key }.toSet()
    val list = rememberLazyListState()
    val drag = remember(list) { QueueDrag(list) }
    val latestTracks by rememberUpdatedState(tracks)

    fun search(more: Boolean = false) {
        val source = provider ?: return
        val params = if (more) lastSearch ?: return else Triple(source.id, source.operationFor(query.trim()), query.trim())
        if (params.third.isEmpty()) return
        lastSearch = params
        busy = true
        message = null
        tab = 1
        if (!more) results = null
        scope.launch {
            runCatching { MusicStore.catalog(params.first, params.second, params.third, if (more) results?.nextPage else null) }
                .onSuccess { page ->
                    results = page.copy(tracks = (if (more) results?.tracks.orEmpty() else emptyList()) + page.tracks)
                    message = page.warning
                }
                .onFailure { message = it.message ?: "请求失败，请检查网络后重试" }
            busy = false
        }
    }

    // 正在播放的这首的相似歌曲，结果放进查找结果
    fun related(track: Track) {
        busy = true
        message = null
        tab = 1
        results = null
        lastSearch = null
        scope.launch {
            runCatching { MusicStore.catalog(track.ref.provider, "recommendations", track.ref.id) }
                .onSuccess { page -> results = page; message = page.warning }
                .onFailure { message = it.message ?: "请求失败，请检查网络后重试" }
            busy = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("音乐") },
                actions = {
                    if (provider?.configuration?.fields?.isNotEmpty() == true) IconButton(onClick = { settingsOpen = true }) { Icon(Icons.Outlined.Settings, "音乐来源设置") }
                    if (providers.size > 1) {
                        Box {
                            TextButton(onClick = { providerMenu = true }) { Text(provider?.name ?: "") }
                            DropdownMenu(providerMenu, onDismissRequest = { providerMenu = false }) {
                                providers.forEach { source ->
                                    DropdownMenuItem(text = { Text(source.name) }, onClick = {
                                        providerId = source.id
                                        providerMenu = false
                                        results = null
                                    })
                                }
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), state = list) {
            item(key = "search") {
                TextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("歌名、歌手或音乐链接") },
                    leadingIcon = { Icon(Icons.Outlined.Search, null) },
                    trailingIcon = { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) },
                    singleLine = true,
                    shape = CircleShape,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { search() }),
                    colors = TextFieldDefaults.colors(focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).onEnter { search() },
                )
            }
            (provider?.unavailableReason(provider.operationFor(query.trim())))?.let { reason ->
                item(key = "capability") { Text(reason, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
            }
            item(key = "now") { NowPlaying(current, currentProvider, busy, { lyricsOpen = true }) { current?.let(::related) } }
            item(key = "tabs") {
                PrimaryTabRow(selectedTabIndex = tab) {
                    Tab(tab == 0, onClick = { tab = 0 }, text = { Text("队列 ${tracks.size}") })
                    Tab(tab == 1, onClick = { tab = 1 }, text = { Text("查找结果" + (results?.let { " ${it.tracks.size}" } ?: "")) })
                }
            }
            item(key = "actions") {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
                    if (tab == 0 && tracks.isNotEmpty()) TextButton(onClick = { MusicStore.clear() }) { Text("清空") }
                    if (tab == 1 && !results?.tracks.isNullOrEmpty()) TextButton(onClick = {
                        MusicStore.add(results!!.tracks)
                        tab = 0
                    }) { Text("全部加入") }
                }
            }
            (message ?: MusicPlayer.error)?.let { text ->
                item(key = "message") { Text(text, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
            if (tab == 0) {
                item(key = "sync") {
                    Text(
                        if (tracks.size >= maxQueue) "队列已满（$maxQueue 首）" else sync,
                        Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        color = if (synced) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.tertiary,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            val shown = if (tab == 0) drag.order ?: tracks else results?.tracks.orEmpty()
            if (shown.isEmpty()) {
                item(key = "empty") {
                    Text(
                        when {
                            busy -> "正在查找音乐…"
                            tab == 0 -> "播放队列还是空的，搜索后加入"
                            results != null -> "没有找到内容，试试其他关键词或链接"
                            else -> "搜索歌名，或粘贴音乐链接"
                        },
                        Modifier.fillMaxWidth().padding(32.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // 队列里一首只出现一次，拖动时按曲目认位置
            itemsIndexed(shown, key = { index, track -> if (tab == 0) queueKey(track) else "1:${track.key}:$index" }) { _, track ->
                val dragged = tab == 0 && drag.key == queueKey(track)
                TrackRow(
                    track,
                    modifier = if (tab != 0) Modifier else if (dragged) Modifier.zIndex(1f).graphicsLayer { translationY = drag.offset } else Modifier.animateItem(),
                    handle = if (tab == 0) Modifier.pointerInput(track.key) {
                        detectDragGestures(
                            onDragStart = { drag.start(track, latestTracks) },
                            onDrag = { change, amount ->
                                change.consume()
                                drag.move(amount.y)
                            },
                            onDragEnd = { drag.end() },
                            onDragCancel = { drag.cancel() },
                        )
                    } else null,
                    active = track.key == MusicPlayer.currentKey,
                    queue = tab == 0,
                    queued = track.key in queued,
                    onPlay = {
                        if (tab == 0) {
                            MusicPlayer.play(track)
                        } else {
                            if (track.key !in queued) MusicStore.add(listOf(track))
                            pendingPlay = track.key
                        }
                    },
                    onAction = { if (tab == 0) MusicStore.remove(track) else MusicStore.add(listOf(track)) },
                )
            }
            if (tab == 1 && results?.nextPage != null) {
                item(key = "more") {
                    TextButton(onClick = { search(more = true) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "加载中…" else "加载更多") }
                }
            }
        }
    }
    // 从查找结果里点播：等它进了队列再播放
    LaunchedEffect(tracks, pendingPlay) {
        val key = pendingPlay ?: return@LaunchedEffect
        tracks.find { it.key == key }?.let {
            delay(300)
            MusicPlayer.play(it)
            pendingPlay = null
        }
    }
    if (settingsOpen && provider != null) {
        ModalBottomSheet(onDismissRequest = { settingsOpen = false }) { ProviderSettings(provider) }
    }
    if (lyricsOpen && current != null) {
        ModalBottomSheet(onDismissRequest = { lyricsOpen = false }) { LyricsView(current) }
    }
}

private var pendingPlay by mutableStateOf<String?>(null)

@Composable
private fun NowPlaying(track: Track?, provider: ProviderInfo?, busy: Boolean, onLyrics: () -> Unit, onRelated: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    var position by remember { mutableLongStateOf(0L) }
    var dragging by remember { mutableStateOf<Float?>(null) }
    LaunchedEffect(MusicPlayer.playing, MusicPlayer.currentKey) {
        while (true) {
            position = MusicPlayer.position()
            delay(500)
        }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(88.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh),
                contentAlignment = Alignment.Center,
            ) {
                if (track?.artworkUrl != null) {
                    AsyncImage(track.artworkUrl, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                } else {
                    Icon(Icons.Outlined.MusicNote, null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    when {
                        MusicPlayer.buffering -> "正在连接…"
                        MusicPlayer.playing -> "正在播放"
                        track != null -> "随时继续"
                        else -> "你的音乐，随时播放"
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(track?.title ?: "从喜欢的一首开始", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(track?.artistText ?: "搜索喜欢的音乐，或粘贴单曲和歌单链接", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        val duration = MusicPlayer.duration.takeIf { it > 0 } ?: track?.durationMs ?: 0L
        if (track != null && duration > 0) {
            Slider(
                value = dragging ?: (position.toFloat() / duration).coerceIn(0f, 1f),
                onValueChange = { dragging = it },
                onValueChangeFinished = {
                    dragging?.let { MusicPlayer.seek((it * duration).toLong()) }
                    dragging = null
                },
                modifier = Modifier.fillMaxWidth(),
            )
            Row(Modifier.fillMaxWidth()) {
                Text(formatMs(dragging?.let { (it * duration).toLong() } ?: position), style = MaterialTheme.typography.labelSmall)
                Spacer(Modifier.weight(1f))
                Text(formatMs(duration), style = MaterialTheme.typography.labelSmall)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            IconButton(onClick = { MusicPlayer.cycleRepeat() }) {
                Icon(
                    if (MusicPlayer.repeat == Player.REPEAT_MODE_ONE) Icons.Outlined.RepeatOne else Icons.Outlined.Repeat,
                    "循环",
                    tint = if (MusicPlayer.repeat == Player.REPEAT_MODE_OFF) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
                )
            }
            IconButton(onClick = { MusicPlayer.previous() }, enabled = track != null) { Icon(Icons.Outlined.SkipPrevious, "上一首", Modifier.size(32.dp)) }
            FilledIconButton(onClick = { MusicPlayer.toggle() }, enabled = track != null || MusicPlayer.controller?.mediaItemCount?.let { it > 0 } == true, modifier = Modifier.size(64.dp), colors = IconButtonDefaults.filledIconButtonColors()) {
                if (MusicPlayer.buffering) CircularProgressIndicator(Modifier.size(28.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 3.dp)
                else Icon(if (MusicPlayer.playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (MusicPlayer.playing) "暂停" else "播放", Modifier.size(36.dp))
            }
            IconButton(onClick = { MusicPlayer.next() }, enabled = track != null) { Icon(Icons.Outlined.SkipNext, "下一首", Modifier.size(32.dp)) }
            if (track != null && provider?.available("lyrics") == true) IconButton(onClick = onLyrics) { Icon(Icons.Outlined.Lyrics, "歌词") }
        }
        if (track != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (provider?.available("recommendations") == true) TextButton(onClick = onRelated, enabled = !busy) { Text("发现相似歌曲") }
                TextButton(onClick = { uriHandler.openUri(track.externalUrl) }) {
                    Icon(Icons.Outlined.OpenInNew, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("在${provider?.name ?: "来源"}打开")
                }
            }
        }
    }
}

@Composable
private fun LyricsView(track: Track) {
    var lyrics by remember(track.key) { mutableStateOf<Lyrics?>(null) }
    var failed by remember(track.key) { mutableStateOf(false) }
    LaunchedEffect(track.key) { runCatching { MusicStore.lyrics(track) }.onSuccess { lyrics = it }.onFailure { failed = true } }
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 32.dp)) {
        Text(track.title, style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.size(12.dp))
        when {
            failed -> Text("没有找到歌词", color = MaterialTheme.colorScheme.onSurfaceVariant)
            lyrics == null -> CircularProgressIndicator()
            else -> {
                Text(lyrics!!.text, style = MaterialTheme.typography.bodyLarge)
                lyrics!!.attribution?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp)) }
            }
        }
    }
}

private fun queueKey(track: Track) = "0:${track.key}"

// 拖动排序：拖动把手到别的位置，拖动时先在本地调整顺序，松开时提交一次 move
private class QueueDrag(private val list: LazyListState) {
    var key by mutableStateOf<String?>(null)
        private set
    var offset by mutableFloatStateOf(0f)
        private set
    var order by mutableStateOf<List<Track>?>(null)
        private set
    private var track: Track? = null
    private var from = -1

    fun start(track: Track, tracks: List<Track>) {
        this.track = track
        key = queueKey(track)
        order = tracks
        from = tracks.indexOf(track)
        offset = 0f
    }

    // 拖过了相邻的一首就和它换位置，被拖的这首在列表里的位置变了，偏移跟着减去移动的距离
    fun move(delta: Float) {
        val current = order ?: return
        offset += delta
        val items = list.layoutInfo.visibleItemsInfo
        val dragged = items.find { it.key == key } ?: return
        val center = dragged.offset + dragged.size / 2 + offset
        val over = items.find { it.key != key && (it.key as? String)?.startsWith("0:") == true && center.toInt() in it.offset until it.offset + it.size } ?: return
        val to = current.indexOfFirst { queueKey(it) == over.key }
        val at = current.indexOfFirst { queueKey(it) == key }
        if (to < 0 || at < 0) return
        order = current.toMutableList().apply { add(to, removeAt(at)) }
        offset -= over.offset - dragged.offset
    }

    fun end() {
        val moved = track
        val index = order?.indexOfFirst { queueKey(it) == key } ?: -1
        cancel()
        if (moved != null && index >= 0 && index != from) MusicStore.move(moved, index)
    }

    fun cancel() {
        key = null
        order = null
        track = null
        offset = 0f
    }
}

@Composable
private fun TrackRow(track: Track, active: Boolean, queue: Boolean, queued: Boolean, onPlay: () -> Unit, onAction: () -> Unit, modifier: Modifier = Modifier, handle: Modifier? = null) {
    ListItem(
        modifier = modifier.clickable(onClick = onPlay),
        colors = ListItemDefaults.colors(containerColor = if (active) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent),
        leadingContent = {
            Box(Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                if (track.artworkUrl != null) AsyncImage(track.artworkUrl, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else Icon(Icons.Outlined.MusicNote, null)
            }
        },
        headlineContent = { Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (active) FontWeight.SemiBold else null) },
        supportingContent = {
            Text(
                listOfNotNull(track.artistText, track.durationMs?.let { formatMs(it) }).joinToString(" · "),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onAction, enabled = queue || !queued) {
                    Icon(if (queue) Icons.Outlined.Close else if (queued) Icons.Outlined.Check else Icons.Outlined.Add, if (queue) "移除" else if (queued) "已在队列中" else "加入队列")
                }
                handle?.let { Icon(Icons.Outlined.DragHandle, "拖动排序", it.padding(8.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        },
    )
}

private fun formatMs(ms: Long): String {
    val seconds = ms / 1000
    return "%d:%02d".format(seconds / 60, seconds % 60)
}

// 其他页面底部的迷你播放条，点开进入音乐
@Composable
fun MiniPlayer(onOpen: () -> Unit) {
    val queue by MusicStore.queue.collectAsStateWithLifecycle()
    val track = queue?.find { it.key == MusicPlayer.currentKey } ?: return
    androidx.compose.material3.Surface(tonalElevation = 2.dp, modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                if (track.artworkUrl != null) AsyncImage(track.artworkUrl, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                else Icon(Icons.Outlined.MusicNote, null)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(track.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(track.artistText, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = { MusicPlayer.toggle() }) { Icon(if (MusicPlayer.playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (MusicPlayer.playing) "暂停" else "播放") }
            IconButton(onClick = { MusicPlayer.next() }) { Icon(Icons.Outlined.SkipNext, "下一首") }
        }
    }
}

// 音乐来源的连接设置：每项单独保存，已配置的可以替换或移除，值不回显
@Composable
private fun ProviderSettings(provider: ProviderInfo) {
    val values = remember(provider.id) { mutableStateMapOf<String, String>() }
    var saving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    fun save(patch: Map<String, String?>) {
        saving = true
        message = null
        scope.launch {
            runCatching { MusicStore.configure(provider.id, patch) }
                .onSuccess { patch.keys.forEach { values.remove(it) }; message = "连接设置已保存。" }
                .onFailure { message = it.message ?: "保存失败，请重试。" }
            saving = false
        }
    }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(provider.name, style = MaterialTheme.typography.titleLarge)
        if (provider.description.isNotEmpty()) Text(provider.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        provider.configuration.fields.forEach { field ->
            HorizontalDivider(Modifier.padding(vertical = 4.dp))
            Text(field.label + if (field.configured) " · 已配置" else "", style = MaterialTheme.typography.titleSmall)
            if (field.description.isNotEmpty()) Text(field.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = values[field.id] ?: "",
                onValueChange = { values[field.id] = it },
                placeholder = { Text(if (field.configured) "输入新值以替换" else field.label) },
                singleLine = true,
                visualTransformation = if (field.secret) PasswordVisualTransformation() else VisualTransformation.None,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { save(mapOf(field.id to values[field.id].orEmpty().trim())) }, enabled = !saving && !values[field.id].isNullOrBlank()) { Text("保存") }
                if (field.configured) TextButton(onClick = { save(mapOf(field.id to null)) }, enabled = !saving) { Text("移除") }
                field.links.forEach { link -> TextButton(onClick = { uriHandler.openUri(link.url) }) { Text(link.label) } }
            }
        }
        message?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
    }
}
