package app.binos.net

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import okhttp3.Request
import java.util.concurrent.TimeUnit

// 一条 SSE 消息；event 为 null 是默认的 message
data class SseMessage(val event: String?, val data: String, val id: String?)

sealed interface StreamSignal {
    // 连上了：之前可能漏了消息，订阅者应全部重新读取
    data object Open : StreamSignal
    data object Closed : StreamSignal
    data class Message(val message: SseMessage) : StreamSignal
}

// 后端每 15 秒发一次 ping，这么久什么都没收到，说明连接已经断了却没有报错
private const val silenceSeconds = 45L
private const val retryDelayMs = 1000L

// 断开后自动重连的 SSE；每次连接时调用 url() 取地址（可以带上接着补发的位置）
fun Api.eventStream(url: () -> String): Flow<StreamSignal> = flow {
    val client = http.newBuilder().readTimeout(silenceSeconds, TimeUnit.SECONDS).build()
    while (true) {
        try {
            val request = Request.Builder().url(url()).header("Accept", "text/event-stream").build()
            val call = client.newCall(request)
            val cancel = currentCoroutineContext().job.invokeOnCompletion { call.cancel() }
            val response = try {
                call.execute()
            } finally {
                cancel.dispose()
            }
            if (isAccessBlocked(response)) {
                response.close()
                markAuthRequired()
                throw AuthRequired()
            }
            response.use {
                if (!response.isSuccessful) throw apiError(response.code, response.body.string())
                emit(StreamSignal.Open)
                val source = response.body.source()
                val cancelRead = currentCoroutineContext().job.invokeOnCompletion { call.cancel() }
                var event: String? = null
                var id: String? = null
                val data = StringBuilder()
                while (true) {
                    val line = source.readUtf8Line() ?: break
                    when {
                        line.isEmpty() -> {
                            if (data.isNotEmpty() || event != null) {
                                emit(StreamSignal.Message(SseMessage(event, data.toString().removeSuffix("\n"), id)))
                            }
                            event = null
                            data.clear()
                        }
                        line.startsWith(":") -> Unit
                        else -> {
                            val field = line.substringBefore(':')
                            val value = line.substringAfter(':', "").removePrefix(" ")
                            when (field) {
                                "data" -> data.append(value).append('\n')
                                "event" -> event = value
                                "id" -> id = value
                            }
                        }
                    }
                }
                cancelRead.dispose()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // 网络错误、登录过期等都在下面重连
        }
        emit(StreamSignal.Closed)
        delay(retryDelayMs)
    }
}.flowOn(Dispatchers.IO)
