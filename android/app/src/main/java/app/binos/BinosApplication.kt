package app.binos

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import app.binos.music.RemotePlayer
import app.binos.net.Api
import app.binos.net.Events
import app.binos.net.Server
import app.binos.net.createHttpClient
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers

class BinosApplication : Application(), SingletonImageLoader.Factory {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    lateinit var server: Server
    lateinit var api: Api
    lateinit var events: Events

    override fun onCreate() {
        super.onCreate()
        instance = this
        server = Server(this)
        api = Api(server, createHttpClient())
        events = Events(api, scope)
        // 全局通知只在应用在前台时连接
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                if (server.url.value != null) events.start()
                RemotePlayer.update()
            }

            override fun onStop(owner: LifecycleOwner) {
                events.stop()
                RemotePlayer.update()
            }
        })
    }

    // 图片也走同一个带登录 cookie 的网络层
    override fun newImageLoader(context: android.content.Context): ImageLoader = ImageLoader.Builder(context)
        .components { add(OkHttpNetworkFetcherFactory(callFactory = { api.http.newBuilder().followRedirects(true).build() })) }
        .build()

    companion object {
        lateinit var instance: BinosApplication
            private set
    }
}

val app: BinosApplication get() = BinosApplication.instance
