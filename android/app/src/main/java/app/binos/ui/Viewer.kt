package app.binos.ui

import android.app.DownloadManager
import android.content.Context
import android.os.Environment
import android.webkit.CookieManager
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.net.toUri
import coil3.compose.AsyncImage

// 用系统的下载管理器下载 binOS 上的文件，带上登录 cookie；下载完在通知栏里打开
fun download(context: Context, url: String, name: String) {
    val request = DownloadManager.Request(url.toUri())
        .setTitle(name)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
    CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
    context.getSystemService(DownloadManager::class.java).enqueue(request)
    Toast.makeText(context, "开始下载 $name", Toast.LENGTH_SHORT).show()
}

// 全屏看图，双指缩放、拖动
@Composable
fun ImageViewer(url: String, name: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    val state = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 8f)
        offset = if (scale == 1f) Offset.Zero else offset + pan
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
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
            val colors = IconButtonDefaults.iconButtonColors(contentColor = Color.White)
            IconButton(onClick = onDismiss, colors = colors, modifier = Modifier.systemBarsPadding().padding(8.dp).align(Alignment.TopStart)) {
                Icon(Icons.Outlined.Close, "关闭")
            }
            IconButton(onClick = { download(context, url, name) }, colors = colors, modifier = Modifier.systemBarsPadding().padding(8.dp).align(Alignment.TopEnd)) {
                Icon(Icons.Outlined.Download, "下载")
            }
        }
    }
}
