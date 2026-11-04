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
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
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
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit
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

// status 是 HTTP 状态码；code、message 是后端返回的 { error: { code, message } }，读不出来时 code 为 null
class ApiException(val status: Int, val code: String?, message: String) : IOException(message)

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

    // readTimeoutSeconds：等得比平常久的请求（服务端要等外部程序的结果）
    suspend fun execute(request: Request, readTimeoutSeconds: Long? = null): Response {
        val client = readTimeoutSeconds?.let { http.newBuilder().readTimeout(it, TimeUnit.SECONDS).build() } ?: http
        val response = try {
            client.newCall(request).await()
        } catch (error: SocketTimeoutException) {
            throw IOException("等服务器回应超时，请重试", error)
        }
        if (isAccessBlocked(response)) {
            response.close()
            _authRequired.value = true
            throw AuthRequired()
        }
        return response
    }

    // 后端的 401 也是登录失效（没有带上 Access 的凭证）；403 只有 Access 返回的 HTML 页才是，后端的是 JSON 的错误
    fun isAccessBlocked(response: Response): Boolean {
        if (response.isRedirect) return true
        return response.code == 401 || response.code == 403 && response.header("Content-Type")?.startsWith("application/json") != true
    }

    // 成功时的响应体；204 是空的
    suspend fun text(request: Request, readTimeoutSeconds: Long? = null): String = withContext(Dispatchers.IO) {
        execute(request, readTimeoutSeconds).use { response ->
            val body = response.body.string()
            if (!response.isSuccessful) throw apiError(response.code, body)
            body
        }
    }

    // 没有响应体（204）时是 JsonNull
    suspend fun element(request: Request, readTimeoutSeconds: Long? = null): JsonElement =
        text(request, readTimeoutSeconds).let { if (it.isEmpty()) JsonNull else json.parseToJsonElement(it) }

    // 不读响应体的请求（图片等）：失败时照样读出后端的错误
    suspend fun <T> response(request: Request, read: (Response) -> T): T = withContext(Dispatchers.IO) {
        execute(request).use { response ->
            if (!response.isSuccessful) throw apiError(response.code, response.body.string())
            read(response)
        }
    }

    suspend fun <T> get(path: String, strategy: DeserializationStrategy<T>): T =
        json.decodeFromString(strategy, text(request(path).get().build()))

    suspend inline fun <reified T> get(path: String): T = get(path, serializer<T>())

    suspend fun getJson(path: String): JsonElement = element(request(path).get().build())

    suspend fun <T> send(method: String, path: String, body: JsonElement, strategy: DeserializationStrategy<T>): T =
        json.decodeFromString(strategy, text(request(path).method(method, body.toString().toRequestBody(jsonType)).build()))

    suspend inline fun <reified T> post(path: String, body: JsonElement = JsonObject(emptyMap())): T = send("POST", path, body, serializer<T>())

    suspend fun postJson(path: String, body: JsonElement = JsonObject(emptyMap()), readTimeoutSeconds: Long? = null): JsonElement =
        element(request(path).post(body.toString().toRequestBody(jsonType)).build(), readTimeoutSeconds)

    suspend fun putJson(path: String, body: JsonElement): JsonElement =
        element(request(path).put(body.toString().toRequestBody(jsonType)).build())

    suspend fun patchJson(path: String, body: JsonElement): JsonElement =
        element(request(path).patch(body.toString().toRequestBody(jsonType)).build())

    suspend fun delete(path: String): JsonElement = element(request(path).delete().build())

    suspend fun upload(path: String, body: RequestBody, headers: Map<String, String> = emptyMap()): JsonElement {
        val builder = request(path).post(body)
        headers.forEach { (name, value) -> builder.header(name, value) }
        return element(builder.build())
    }
}

// 不是后端的错误（网关、代理返回的）时只有状态码
fun apiError(status: Int, body: String): ApiException {
    val error = runCatching { json.parseToJsonElement(body).jsonObject["error"]?.jsonObject }.getOrNull()
    val message = error?.get("message")?.jsonPrimitive?.contentOrNull
    return ApiException(status, error?.get("code")?.jsonPrimitive?.contentOrNull, message ?: "请求失败（$status）")
}

suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) = continuation.resume(response)
        override fun onFailure(call: Call, e: IOException) = continuation.resumeWithException(e)
    })
    continuation.invokeOnCancellation { cancel() }
}
