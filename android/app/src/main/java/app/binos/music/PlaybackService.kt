package app.binos.music

import android.content.ComponentName
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.Player
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaController
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionToken
import app.binos.app
import com.google.common.util.concurrent.MoreExecutors
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

// 后台播放：ExoPlayer 放在媒体会话服务里，系统据此显示媒体通知、锁屏和耳机控制。音频请求带着登录 cookie
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val dataSource = OkHttpDataSource.Factory(app.api.http.newBuilder().followRedirects(true).build())
        val player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSource))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        session = MediaSession.Builder(this, player).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    // 没在播放时划掉应用就停止服务
    override fun onTaskRemoved(rootIntent: android.content.Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}

fun Track.toMediaItem(): MediaItem = MediaItem.Builder()
    .setMediaId(key)
    .setUri(MusicStore.streamUrl(this))
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artistText)
            .setAlbumTitle(album?.title)
            .setArtworkUri(artworkUrl?.let(Uri::parse))
            .build(),
    )
    .build()

// 界面用的播放器：连接播放服务的 MediaController，播放列表跟着共享队列走
object MusicPlayer {
    var controller by mutableStateOf<MediaController?>(null)
        private set
    var currentKey by mutableStateOf<String?>(null)
        private set
    var playing by mutableStateOf(false)
        private set
    var buffering by mutableStateOf(false)
        private set
    var repeat by mutableStateOf(Player.REPEAT_MODE_OFF)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var duration by mutableLongStateOf(0L)
        private set

    fun connect() {
        if (controller != null) return
        val token = SessionToken(app, ComponentName(app, PlaybackService::class.java))
        val future = MediaController.Builder(app, token).buildAsync()
        future.addListener({
            val connected = future.get()
            connected.addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) = update(player)
                override fun onPlayerError(exception: PlaybackException) {
                    error = "播放遇到问题：${exception.errorCodeName}"
                }
            })
            controller = connected
            update(connected)
            app.scope.launch { MusicStore.queue.collectLatest { tracks -> tracks?.let { sync(it) } } }
        }, MoreExecutors.directExecutor())
    }

    private fun update(player: Player) {
        currentKey = player.currentMediaItem?.mediaId
        playing = player.isPlaying
        buffering = player.playbackState == Player.STATE_BUFFERING
        repeat = player.repeatMode
        duration = player.duration.takeIf { it != C.TIME_UNSET } ?: 0L
        if (player.isPlaying) error = null
        RemotePlayer.update()
    }

    // 共享队列有变化时同步播放列表：正在播放的那首保持不动，前后的换成新的
    private fun sync(tracks: List<Track>) {
        val player = controller ?: return
        val keys = tracks.map { it.key }
        val existing = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
        if (existing == keys) return
        val current = player.currentMediaItem?.mediaId
        val position = keys.indexOf(current)
        val items = tracks.map { it.toMediaItem() }
        if (current == null || position < 0) {
            player.setMediaItems(items, player.currentMediaItemIndex.coerceIn(0, maxOf(items.size - 1, 0)), 0)
            return
        }
        val index = player.currentMediaItemIndex
        if (index + 1 < player.mediaItemCount) player.removeMediaItems(index + 1, player.mediaItemCount)
        if (index > 0) player.removeMediaItems(0, index)
        player.addMediaItems(0, items.subList(0, position))
        player.addMediaItems(items.subList(position + 1, items.size))
    }

    fun play(track: Track) {
        val player = controller ?: return
        val index = (0 until player.mediaItemCount).indexOfFirst { player.getMediaItemAt(it).mediaId == track.key }
        if (index < 0) return
        error = null
        player.seekTo(index, 0)
        player.prepare()
        player.play()
    }

    fun toggle() {
        val player = controller ?: return
        if (player.isPlaying) player.pause() else {
            if (player.playbackState == Player.STATE_IDLE) player.prepare()
            if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
            player.play()
        }
    }

    fun next() = controller?.seekToNextMediaItem()
    fun previous() = controller?.seekToPrevious()
    fun seek(position: Long) = controller?.seekTo(position)
    fun position(): Long = controller?.currentPosition ?: 0L

    fun cycleRepeat() {
        val player = controller ?: return
        player.repeatMode = when (player.repeatMode) {
            Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
    }
}
