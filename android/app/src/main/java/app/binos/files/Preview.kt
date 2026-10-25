@file:OptIn(ExperimentalMaterial3Api::class)

package app.binos.files

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.webkit.WebView
import androidx.annotation.OptIn as MediaOptIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.graphics.createBitmap
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import app.binos.app
import app.binos.shell.LocalNav
import app.binos.ui.CodeBlock
import app.binos.ui.Markdown
import app.binos.ui.download
import app.binos.ui.formatBytes
import app.binos.ui.formatFull
import app.binos.ui.languageOf
import coil3.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import java.io.File
import java.time.Instant

// 文字最多读这么多来预览
private const val textLimit = 1024 * 1024

// 预览 binOS 上的一个文件：图片、文字和 Markdown、网页、PDF、音视频；其他的显示信息，可以下载
@Composable
fun FilePreviewScreen(url: String, name: String) {
    val nav = LocalNav.current
    val context = LocalContext.current
    val kind = fileKind(name)
    val downloadUrl = url.toHttpUrl().newBuilder().addQueryParameter("name", name).build().toString()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回") } },
                actions = { IconButton(onClick = { download(context, downloadUrl, name) }) { Icon(Icons.Outlined.Download, "下载") } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (kind) {
                "image" -> ZoomableImage(url, name)
                "text", "markdown", "html" -> TextPreview(url, name, kind)
                "pdf" -> PdfPreview(url)
                "video", "audio" -> MediaPreview(url)
                else -> FileInfo(url, name) { download(context, downloadUrl, name) }
            }
        }
    }
}

@Composable
private fun ZoomableImage(url: String, name: String) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val state = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 8f)
        offset = if (scale == 1f) Offset.Zero else offset + pan
    }
    AsyncImage(
        model = url,
        contentDescription = name,
        contentScale = ContentScale.Fit,
        modifier = Modifier.fillMaxSize().transformable(state).graphicsLayer {
            scaleX = scale
            scaleY = scale
            translationX = offset.x
            translationY = offset.y
        },
    )
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun TextPreview(url: String, name: String, kind: String) {
    var text by remember { mutableStateOf<String?>(null) }
    var truncated by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(url) {
        runCatching {
            app.api.text(Request.Builder().url(url).header("Range", "bytes=0-$textLimit").build())
        }.onSuccess {
            truncated = it.length >= textLimit
            text = it
        }.onFailure { error = it.message }
    }
    val content = text
    when {
        error != null -> Text(error!!, Modifier.padding(24.dp), color = MaterialTheme.colorScheme.error)
        content == null -> CircularProgressIndicator(Modifier.fillMaxWidth().padding(48.dp).wrapCenter())
        kind == "html" -> AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                // 和网页版的沙箱一样不给它 binOS 的源：脚本照常运行，但碰不到 binOS 的 cookie 和接口
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.allowFileAccess = false
                    loadDataWithBaseURL(null, content, "text/html", "UTF-8", null)
                }
            },
        )
        kind == "markdown" -> SelectionContainer {
            Markdown(content, Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp))
        }
        else -> {
            // 长文件按行分块显示，避免一次排版整个文件
            val chunks = remember(content) { content.lines().chunked(200).map { it.joinToString("\n") } }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(8.dp)) {
                items(chunks.size) { index ->
                    CodeBlock(chunks[index], lang = languageOf(name), startLine = index * 200 + 1)
                }
                if (truncated) item { Text("只显示了前 1 MB", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

private fun Modifier.wrapCenter() = this

// PDF 下载到缓存，用系统的 PdfRenderer 逐页画出来
@Composable
private fun PdfPreview(url: String) {
    val context = LocalContext.current
    var pages by remember { mutableStateOf<List<Bitmap>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(url) {
        runCatching {
            withContext(Dispatchers.IO) {
                val file = File(context.cacheDir, "preview.pdf")
                app.api.execute(Request.Builder().url(url).build()).use { response ->
                    if (!response.isSuccessful) error("读取失败（${response.code}）")
                    file.outputStream().use { response.body.byteStream().copyTo(it) }
                }
                PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { renderer ->
                    (0 until minOf(renderer.pageCount, 50)).map { index ->
                        renderer.openPage(index).use { page ->
                            val width = 1200
                            val bitmap = createBitmap(width, width * page.height / page.width)
                            bitmap.eraseColor(android.graphics.Color.WHITE)
                            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            bitmap
                        }
                    }
                }
            }
        }.onSuccess { pages = it }.onFailure { error = it.message }
    }
    when {
        error != null -> Text(error!!, Modifier.padding(24.dp), color = MaterialTheme.colorScheme.error)
        pages == null -> CircularProgressIndicator(Modifier.fillMaxWidth().padding(48.dp))
        else -> LazyColumn(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainer),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(pages!!) { page -> Image(page.asImageBitmap(), null, Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth) }
        }
    }
}

@MediaOptIn(UnstableApi::class)
@Composable
private fun MediaPreview(url: String) {
    val context = LocalContext.current
    val player = remember {
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(app.api.http.newBuilder().followRedirects(true).build())))
            .build()
            .apply {
                setMediaItem(MediaItem.fromUri(url))
                prepare()
                playWhenReady = true
            }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    AndroidView(
        modifier = Modifier.fillMaxSize().background(Color.Black),
        factory = { PlayerView(it).apply { this.player = player } },
    )
}

@Composable
private fun FileInfo(url: String, name: String, onDownload: () -> Unit) {
    var info by remember { mutableStateOf<Triple<Long, String, String>?>(null) }
    LaunchedEffect(url) {
        runCatching {
            val element = app.api.element(Request.Builder().url(url.toHttpUrl().newBuilder().addQueryParameter("info", "1").build()).build()).jsonObject
            Triple(
                element["size"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L,
                element["modified"]?.jsonPrimitive?.content ?: "",
                element["type"]?.jsonPrimitive?.content ?: "",
            )
        }.onSuccess { info = it }
    }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.AutoMirrored.Outlined.InsertDriveFile, null, Modifier.padding(8.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(name, style = MaterialTheme.typography.titleMedium)
        info?.let { (size, modified, type) ->
            Text(
                listOfNotNull(
                    formatBytes(size),
                    type.takeIf { it.isNotEmpty() },
                    runCatching { formatFull(Instant.parse(modified).toEpochMilli()) }.getOrNull(),
                ).joinToString(" · "),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text("这种文件不能预览", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onDownload) { Text("下载到手机") }
    }
}
