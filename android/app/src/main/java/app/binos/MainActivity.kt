package app.binos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.binos.shell.ConnectScreen
import app.binos.shell.LoginScreen
import app.binos.shell.MainScreen
import app.binos.ui.theme.BinOSTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BinOSTheme {
                val url by app.server.url.collectAsStateWithLifecycle()
                val authRequired by app.api.authRequired.collectAsStateWithLifecycle()
                val current = url
                when {
                    current == null -> ConnectScreen()
                    authRequired -> LoginScreen(current)
                    else -> MainScreen()
                }
            }
        }
    }
}
