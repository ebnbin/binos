package app.binos.net

import app.binos.code.codeSerializers
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = false
    serializersModule = codeSerializers
}

val jsonType = "application/json".toMediaType()
val octetType = "application/octet-stream".toMediaType()

// status 是 HTTP 状态码；error 是后端返回的 { error } 里的说明
class ApiException(val status: Int, message: String) : IOException(message)

// Access 拦下请求时没有到达后端：重定向到登录页，或者直接拒绝
class AuthRequired : IOException("需要登录")

class Api(val server: Server, val http: OkHttpClient) {
    private val _authRequired = MutableStateFlow(false)
    val authRequired: StateFlow<Boolean> = _authRequired.asStateFlow()

    fun markAuthRequired() {
        _authRequired.value = true
    }

    fun authenticated() {
        _authRequired.value = false
    }

    fun url(path: String): HttpUrl = server.resolve(path)

    fun request(path: String): Request.Builder = Request.Builder().url(url(path))

    suspend fun execute(request: Request): Response {
        val response = http.newCall(request).await()
        if (isAccessBlocked(response)) {
            response.close()
            _authRequired.value = true
            throw AuthRequired()
        }
        return response
    }

    fun isAccessBlocked(response: Response): Boolean {
        if (response.isRedirect) return true
        // Access 拒绝时返回它自己的 HTML 页，后端的拒绝是纯文字
        return response.code == 401 || response.code == 403 && response.header("Content-Type")?.startsWith("text/html") == true
    }

    suspend fun text(request: Request): String = withContext(Dispatchers.IO) {
        execute(request).use { response ->
            val body = response.body.string()
            if (!response.isSuccessful) throw ApiException(response.code, errorMessage(body) ?: "请求失败（${response.code}）")
            body
        }
    }

    suspend fun element(request: Request): JsonElement = json.parseToJsonElement(text(request))

    suspend fun <T> get(path: String, strategy: DeserializationStrategy<T>): T =
        json.decodeFromString(strategy, text(request(path).get().build()))

    suspend inline fun <reified T> get(path: String): T = get(path, serializer<T>())

    suspend fun getJson(path: String): JsonElement = element(request(path).get().build())

    suspend fun <T> send(method: String, path: String, body: JsonElement, strategy: DeserializationStrategy<T>): T =
        json.decodeFromString(strategy, text(request(path).method(method, body.toString().toRequestBody(jsonType)).build()))

    suspend inline fun <reified T> post(path: String, body: JsonElement = JsonObject(emptyMap())): T = send("POST", path, body, serializer<T>())

    suspend fun postJson(path: String, body: JsonElement = JsonObject(emptyMap())): JsonElement =
        element(request(path).post(body.toString().toRequestBody(jsonType)).build())

    suspend fun putJson(path: String, body: JsonElement): JsonElement =
        element(request(path).put(body.toString().toRequestBody(jsonType)).build())

    suspend fun deleteJson(path: String): JsonElement =
        element(request(path).delete("{}".toRequestBody(jsonType)).build())

    suspend fun upload(path: String, body: RequestBody, headers: Map<String, String> = emptyMap()): JsonElement {
        val builder = request(path).post(body)
        headers.forEach { (name, value) -> builder.header(name, value) }
        return element(builder.build())
    }
}

private fun errorMessage(body: String): String? = runCatching {
    json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content
}.getOrNull() ?: body.takeIf { it.isNotBlank() && it.length < 200 && !it.trimStart().startsWith("<") }

suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) = continuation.resume(response)
        override fun onFailure(call: Call, e: IOException) = continuation.resumeWithException(e)
    })
    continuation.invokeOnCancellation { cancel() }
}
