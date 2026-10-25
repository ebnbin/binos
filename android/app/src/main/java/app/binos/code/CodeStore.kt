package app.binos.code

import android.widget.Toast
import app.binos.app
import app.binos.net.ApiException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

// Code 的共享数据：session 和项目的列表、agent 的状况和模型，随全局通知重新读取
object CodeStore {
    val api = CodeApi(app.api)

    private val _sessions = MutableStateFlow<List<SessionSummary>?>(null)
    val sessions: StateFlow<List<SessionSummary>?> = _sessions.asStateFlow()
    private val _projects = MutableStateFlow<List<Project>?>(null)
    val projects: StateFlow<List<Project>?> = _projects.asStateFlow()
    private val _failed = MutableStateFlow(false)
    val failed: StateFlow<Boolean> = _failed.asStateFlow()
    private val _status = MutableStateFlow<AgentStatus?>(null)
    val status: StateFlow<AgentStatus?> = _status.asStateFlow()
    private val _catalogs = MutableStateFlow<List<AgentCatalog>>(emptyList())
    val catalogs: StateFlow<List<AgentCatalog>> = _catalogs.asStateFlow()

    private var refreshing: Job? = null

    init {
        app.scope.launch {
            app.events.of("session", "project", "agent").collect { event ->
                val session = event?.id?.takeIf { event.type == "session" }
                when {
                    session != null -> refreshSession(session)
                    event == null || event.type != "agent" -> refresh()
                }
                if (event == null || event.type == "agent") refreshStatus()
                if (event == null && _catalogs.value.isEmpty()) refreshCatalogs()
            }
        }
        refresh()
        refreshStatus()
        refreshCatalogs()
    }

    // 只保留最新的一次读取
    fun refresh() {
        refreshing?.cancel()
        refreshing = app.scope.launch {
            runCatching { api.sessions() to api.projects() }
                .onSuccess { (sessions, projects) ->
                    _sessions.value = sessions
                    _projects.value = projects
                    _failed.value = false
                }
                .onFailure { if (it !is kotlinx.coroutines.CancellationException) _failed.value = true }
        }
    }

    // 只更新有变化的这一条
    private fun refreshSession(id: Int) {
        app.scope.launch {
            runCatching { api.session(id) }
                .onSuccess { put(it) }
                .onFailure { if (it is ApiException && it.status == 404) _sessions.value = _sessions.value?.filter { session -> session.id != id } }
        }
    }

    private fun put(session: SessionSummary) {
        val list = _sessions.value ?: return
        _sessions.value = if (list.any { it.id == session.id }) list.map { if (it.id == session.id) session else it } else listOf(session) + list
    }

    private fun refreshStatus() {
        app.scope.launch { runCatching { api.status() }.onSuccess { _status.value = it } }
    }

    private fun refreshCatalogs() {
        app.scope.launch { runCatching { api.catalogs() }.onSuccess { _catalogs.value = it } }
    }

    fun session(id: Int): SessionSummary? = _sessions.value?.find { it.id == id }

    // 改名、置顶、归档；失败时提示
    fun edit(id: Int, title: String? = null, pinned: Boolean? = null, archived: Boolean? = null) {
        app.scope.launch {
            runCatching { api.edit(id, title, pinned, archived) }
                .onSuccess { put(it) }
                .onFailure { Toast.makeText(app, "保存失败：${it.message ?: "请重试"}", Toast.LENGTH_SHORT).show() }
        }
    }
}
