package app.binos.shell

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import app.binos.app
import app.binos.net.AuthRequired
import app.binos.net.productionUrl
import kotlinx.coroutines.launch
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Request

// 第一次打开：连正式版（经 Cloudflare Access 登录），或者输入测试实例的地址（模拟器里本机是 10.0.2.2）
@Composable
fun ConnectScreen() {
    var address by remember { mutableStateOf("http://10.0.2.2:") }
    var error by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun connect(url: HttpUrl) {
        checking = true
        error = null
        scope.launch {
            // /api/health 不需要登录，先确认地址能连上
            val result = runCatching { app.api.text(Request.Builder().url(url.resolve("/api/health")!!).build()) }
            checking = false
            // 被 Access 拦下也说明地址对，接下来登录
            if (result.isSuccess || result.exceptionOrNull() is AuthRequired) {
                app.server.connect(url)
                app.events.restart()
            } else {
                error = "连不上 $url：${result.exceptionOrNull()?.message}"
            }
        }
    }

    Scaffold { padding ->
        Box(Modifier.fillMaxSize().padding(padding).imePadding(), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 420.dp).verticalScroll(rememberScrollState()).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("binOS", style = MaterialTheme.typography.displaySmall)
                Text("连接到你的 binOS", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { connect(productionUrl.toHttpUrl()) }, enabled = !checking, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Cloud, null, Modifier.size(18.dp))
                    Text("  binos.app")
                }
                Text("或者连接测试实例", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = address,
                    onValueChange = { address = it },
                    label = { Text("后端地址") },
                    supportingText = { Text("pnpm dev 输出的接口地址，模拟器里把 127.0.0.1 换成 10.0.2.2") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    modifier = Modifier.fillMaxWidth(),
                )
                FilledTonalButton(
                    onClick = {
                        val url = address.trim().removeSuffix("/api").toHttpUrlOrNull()
                        if (url == null) error = "地址格式不对" else connect(url)
                    },
                    enabled = !checking,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Outlined.Computer, null, Modifier.size(18.dp))
                    Text("  连接")
                }
                if (checking) LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
            }
        }
    }
}

// 正式版前面的 Cloudflare Access：在 WebView 里登录，拿到 CF_Authorization 后原生网络层共用这份 cookie
@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(base: HttpUrl) {
    var loading by remember { mutableStateOf(true) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    BackHandler(enabled = webView?.canGoBack() == true) { webView?.goBack() }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("登录 ${base.host}") },
                actions = {
                    IconButton(onClick = { app.server.disconnect() }) { Icon(Icons.AutoMirrored.Outlined.Logout, "换一个 binOS") }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    WebView(context).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        CookieManager.getInstance().setAcceptCookie(true)
                        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                                loading = true
                            }

                            override fun onPageFinished(view: WebView, url: String) {
                                loading = false
                                val host = url.toHttpUrlOrNull()?.host
                                val cookies = CookieManager.getInstance().getCookie(base.toString()).orEmpty()
                                if (host == base.host && "CF_Authorization=" in cookies) {
                                    CookieManager.getInstance().flush()
                                    app.api.authenticated()
                                    app.events.restart()
                                }
                            }
                        }
                        loadUrl(base.toString())
                        webView = this
                    }
                },
            )
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().align(Alignment.TopCenter))
        }
    }
}
