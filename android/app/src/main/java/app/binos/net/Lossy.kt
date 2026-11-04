package app.binos.net

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// 解不开的元素丢掉，其余照常解码：服务端的某一项结构变了或者多了新种类的项，不让整个响应失败。
// 用法：@Serializable(LossyList::class) val items: List<Item> = emptyList()
class LossyList<T>(private val element: KSerializer<T>) : KSerializer<List<T>> {
    private val delegate = ListSerializer(element)
    override val descriptor: SerialDescriptor = delegate.descriptor

    override fun deserialize(decoder: Decoder): List<T> {
        val input = decoder as? JsonDecoder ?: return delegate.deserialize(decoder)
        val array = input.decodeJsonElement() as? JsonArray ?: throw SerializationException("应为数组")
        return array.mapNotNull { input.json.decodeOrNull(element, it) }
    }

    override fun serialize(encoder: Encoder, value: List<T>) = delegate.serialize(encoder, value)
}

class LossyMap<K, V>(private val key: KSerializer<K>, private val value: KSerializer<V>) : KSerializer<Map<K, V>> {
    private val delegate = MapSerializer(key, value)
    override val descriptor: SerialDescriptor = delegate.descriptor

    override fun deserialize(decoder: Decoder): Map<K, V> {
        val input = decoder as? JsonDecoder ?: return delegate.deserialize(decoder)
        val obj = input.decodeJsonElement() as? JsonObject ?: throw SerializationException("应为对象")
        return obj.entries.mapNotNull { (name, item) ->
            val k = input.json.decodeOrNull(key, JsonPrimitive(name)) ?: return@mapNotNull null
            input.json.decodeOrNull(value, item)?.let { k to it }
        }.toMap()
    }

    override fun serialize(encoder: Encoder, value: Map<K, V>) = delegate.serialize(encoder, value)
}

private fun <T> kotlinx.serialization.json.Json.decodeOrNull(serializer: KSerializer<T>, element: JsonElement): T? = try {
    decodeFromJsonElement(serializer, element)
} catch (_: IllegalArgumentException) {
    // SerializationException 也是 IllegalArgumentException
    null
}
