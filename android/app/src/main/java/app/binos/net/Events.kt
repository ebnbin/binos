package app.binos.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

// /api/events 推送的全局通知；id 只有 session 有
@Serializable
data class ChangeEvent(val type: String, val id: Int? = null)

// 旧服务端没有 protocol
@Serializable
private data class Health(val version: String? = null, val protocol: String? = null)

// 整个应用只连一条全局通知。连上时发出 null，表示之前可能漏了通知，应全部重新读取。只在应用在前台时连接
class Events(private val api: Api, private val scope: CoroutineScope) {
    private val _connected = MutableStateFlow(true)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()
    private val _changes = MutableSharedFlow<ChangeEvent?>(extraBufferCapacity = 64)
    val changes = _changes.asSharedFlow()
    private val _version = MutableStateFlow<String?>(null)
    val version: StateFlow<String?> = _version.asStateFlow()
    // 服务端的接口和这个版本的 app 不是同一版；每次连上都重新比对，服务端上线新版本后会变
    private val _outdated = MutableStateFlow(false)
    val outdated: StateFlow<Boolean> = _outdated.asStateFlow()
    private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            api.eventStream { api.url("/api/events").toString() }.collect { signal ->
                when (signal) {
                    StreamSignal.Open -> {
                        _connected.value = true
                        api.authenticated()
                        _changes.emit(null)
                        launch { checkVersion() }
                    }
                    StreamSignal.Closed -> _connected.value = false
                    is StreamSignal.Message -> if (signal.message.event == null) {
                        runCatching { json.decodeFromString<ChangeEvent>(signal.message.data) }.getOrNull()?.let { _changes.emit(it) }
                    }
                }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    fun restart() {
        stop()
        start()
    }

    private suspend fun checkVersion() {
        runCatching { api.get<Health>("/api/health") }.getOrNull()?.let {
            _version.value = it.version
            _outdated.value = it.protocol != null && it.protocol != BinOSProtocol.PROTOCOL_ID
        }
    }

    // 只关心这几类通知（以及重新连上）
    fun of(vararg types: String): Flow<ChangeEvent?> = changes.filter { it == null || it.type in types }
}
