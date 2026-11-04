package app.binos.net

import android.content.Context
import android.webkit.CookieManager
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

const val productionUrl = "https://binos.app"

// 连接哪个 binOS：正式版前面有 Cloudflare Access，测试实例（pnpm dev）和局域网地址没有
class Server(context: Context) {
    private val prefs = context.getSharedPreferences("server", Context.MODE_PRIVATE)
    private val _url = MutableStateFlow(prefs.getString("url", null)?.toHttpUrlOrNull())
    val url: StateFlow<HttpUrl?> = _url.asStateFlow()

    fun connect(url: HttpUrl) {
        prefs.edit { putString("url", url.toString()) }
        _url.value = url
    }

    fun disconnect() {
        prefs.edit { remove("url") }
        _url.value = null
    }

    val base: HttpUrl get() = _url.value ?: productionUrl.toHttpUrl()

    fun resolve(path: String): HttpUrl = base.resolve(path) ?: error("无效的路径 $path")

    // WebSocket 要求 Origin 和 Host 一致
    val origin: String get() = base.let { url -> url.scheme + "://" + url.host + (if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}") }
}

// 和 WebView 共用 cookie：在 WebView 里通过 Cloudflare Access 登录后，原生请求自动带上 CF_Authorization
object WebViewCookieJar : CookieJar {
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val manager = CookieManager.getInstance()
        cookies.forEach { manager.setCookie(url.toString(), it.toString()) }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val header = CookieManager.getInstance().getCookie(url.toString()) ?: return emptyList()
        return header.split(';').mapNotNull { Cookie.parse(url, it.trim()) }
    }
}

// 重定向不自动跟随：Access 未登录时把请求重定向到登录页，据此判断需要登录
fun createHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .cookieJar(WebViewCookieJar)
    .followRedirects(false)
    .followSslRedirects(false)
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS)
    .build()
