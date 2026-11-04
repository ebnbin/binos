package app.binos.music

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.media3.common.Player
import app.binos.app
import app.binos.code.encode
import app.binos.net.StreamSignal
import app.binos.net.eventStream
import app.binos.net.json
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

private const val base = "/api/apps/music"

// 把这台手机登记成 binOS 的一个播放器：别的设备（网页、其他客户端）能看到它在放什么并遥控它。
// 协议见 server/src/apps/music/players.ts：SSE 收指令，定时报告状态。应用在前台或者正在播放时保持连接
object RemotePlayer {
    private var job: Job? = null
    private var playerId: String? = null
    private var lastReport: String? = null
    private var busy = false

    fun update() {
        val foreground = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
        val active = app.server.url.value != null && MusicPlayer.controller != null && (foreground || MusicPlayer.playing)
        if (active && job == null) start() else if (!active) stop()
    }

    private fun stop() {
        job?.cancel()
        job = null
        playerId = null
    }

    private fun start() {
        job = app.scope.launch {
            launch {
                // 状态变了每秒报告一次，没变也每 10 秒报告一次，后端据此判断播放器还在
                var ticks = 0
                while (true) {
                    delay(1000)
                    ticks++
                    val state = stateJson().toString()
                    if (state != lastReport || ticks % 10 == 0) report(null)
                }
            }
            app.api.eventStream { app.api.url("$base/players/connect?label=Android").toString() }.collect { signal ->
                if (signal is StreamSignal.Closed) playerId = null
                if (signal !is StreamSignal.Message || signal.message.event != null) return@collect
                val message = runCatching { json.parseToJsonElement(signal.message.data).jsonObject }.getOrNull() ?: return@collect
                when (message["type"]?.jsonPrimitive?.content) {
                    "connected" -> {
                        playerId = message["playerId"]?.jsonPrimitive?.content
                        busy = false
                        report(null)
                    }
                    "command" -> (message["command"] as? JsonObject)?.let { command -> launch { execute(command) } }
                }
            }
        }
    }

    private suspend fun report(result: JsonObject?) {
        val id = playerId ?: return
        val state = stateJson()
        runCatching {
            app.api.postJson("$base/players/${encode(id)}/report", buildJsonObject {
                put("state", state)
                result?.let { put("result", it) }
            })
        }.onSuccess { lastReport = state.toString() }
    }

    private fun stateJson(): JsonElement {
        // 播放器还没准备好时报告空闲
        val player = MusicPlayer.controller
        val track = player?.let { MusicStore.queue.value?.find { track -> track.key == it.currentMediaItem?.mediaId } }
        val status = when {
            MusicPlayer.error != null -> "error"
            player == null -> "idle"
            player.isPlaying -> "playing"
            player.playbackState == Player.STATE_BUFFERING -> "loading"
            player.playbackState == Player.STATE_ENDED -> "ended"
            track != null -> "paused"
            else -> "idle"
        }
        return buildJsonObject {
            put("track", track?.let { json.encodeToJsonElement(TrackRef.serializer(), it.ref) } ?: JsonNull)
            put("status", status)
            put("positionMs", player?.currentPosition?.coerceAtLeast(0) ?: 0L)
            put("durationMs", if (player == null) 0L else MusicPlayer.duration)
            put("volume", player?.volume?.toDouble() ?: 1.0)
            put("repeat", when (player?.repeatMode) {
                Player.REPEAT_MODE_ALL -> "all"
                Player.REPEAT_MODE_ONE -> "one"
                else -> "off"
            })
            putJsonObject("controls") {
                put("seek", true)
                put("volume", true)
            }
            MusicPlayer.error?.let { put("error", it) }
        }
    }

    // 执行一条指令：先确认它还在等待执行，执行完报告结果。播放类的指令等到真的开始播放
    private suspend fun execute(command: JsonObject) {
        val id = (command["id"] as? JsonPrimitive)?.content ?: return
        if (busy) {
            report(buildJsonObject {
                put("id", id)
                put("error", "播放器正在执行另一条指令。")
            })
            return
        }
        var error: String? = null
        busy = true
        try {
            MusicStore.refreshQueue()
            val latest = app.api.getJson("$base/commands/${encode(id)}").jsonObject
            if (latest["status"]?.jsonPrimitive?.content != "pending") return
            val body = command["command"]!!.jsonObject
            val player = MusicPlayer.controller ?: throw IllegalStateException("播放器还没准备好。")
            when (body["type"]?.jsonPrimitive?.content) {
                "play" -> if (!player.isPlaying) MusicPlayer.toggle()
                "pause" -> player.pause()
                "stop" -> {
                    player.pause()
                    player.seekTo(0)
                }
                "next" -> player.seekToNextMediaItem()
                "previous" -> player.seekToPrevious()
                "select" -> {
                    val ref = json.decodeFromJsonElement<TrackRef>(body["ref"]!!)
                    val track = MusicStore.queue.value?.find { it.ref == ref } ?: throw IllegalStateException("这首歌不在队列里。")
                    // 队列刚更新时，等播放列表同步过来
                    withTimeoutOrNull(3000) { while ((0 until player.mediaItemCount).none { player.getMediaItemAt(it).mediaId == track.key }) delay(100) }
                    MusicPlayer.play(track)
                }
                "seek" -> player.seekTo(body["positionMs"]!!.jsonPrimitive.long)
                "volume" -> player.volume = body["volume"]!!.jsonPrimitive.double.toFloat().coerceIn(0f, 1f)
                "repeat" -> player.repeatMode = when (body["repeat"]?.jsonPrimitive?.content) {
                    "all" -> Player.REPEAT_MODE_ALL
                    "one" -> Player.REPEAT_MODE_ONE
                    else -> Player.REPEAT_MODE_OFF
                }
            }
            if (body["type"]?.jsonPrimitive?.content in setOf("play", "select", "next", "previous")) {
                if (!player.isPlaying) player.play()
                withTimeoutOrNull(10_000) { while (!player.isPlaying) delay(200) } ?: throw IllegalStateException("没能开始播放。")
            }
        } catch (failure: Exception) {
            error = (failure.message ?: "播放指令执行失败。").take(2000)
        } finally {
            busy = false
        }
        report(buildJsonObject {
            put("id", id)
            error?.let { put("error", it) }
        })
    }
}
