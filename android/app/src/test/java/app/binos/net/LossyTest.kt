package app.binos.net

import app.binos.code.FileChange
import app.binos.code.SessionSummary
import app.binos.code.ToolDetail
import app.binos.code.parseEntry
import app.binos.code.Entry
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LossyTest {
    @Serializable
    private data class Item(val id: String, val label: String = "")

    @Serializable
    private data class Page(
        @Serializable(LossyList::class) val items: List<Item> = emptyList(),
        @Serializable(LossyMap::class) val byKey: Map<String, Item> = emptyMap(),
    )

    @Test
    fun 列表和对象里解不开的项丢掉_其余照常() {
        val page = json.decodeFromString(
            Page.serializer(),
            """{"items":[{"id":"a"},{"label":"缺 id"},"不是对象",{"id":"b","label":"二","新字段":[1]}],"byKey":{"x":{"id":"x"},"y":{"id":3.5}},"多余":{}}""",
        )
        assertEquals(listOf(Item("a"), Item("b", "二")), page.items)
        assertEquals(setOf("x"), page.byKey.keys)
    }

    @Test(expected = SerializationException::class)
    fun 核心字段缺失仍然报错() {
        json.decodeFromString(Item.serializer(), """{"label":"缺 id"}""")
    }

    @Test(expected = SerializationException::class)
    fun 列表本身不是数组时报错() {
        json.decodeFromString(Page.serializer(), """{"items":{}}""")
    }

    @Test
    fun 会话缺可选字段_未知值和不认识的项不影响() {
        val session = json.decodeFromString(
            SessionSummary.serializer(),
            """{"project":"binos","id":1,"kitaSession":"k","outcome":"future","prs":[{"url":"u","number":2,"state":"draft"},{"number":3}],"queue":[{"id":"q"}],"newField":1}""",
        )
        assertEquals("", session.title)
        assertEquals("future", session.outcome)
        assertEquals(listOf(2), session.prs.map { it.number })
        assertEquals("draft", session.prs.single().state)
        assertEquals("q", session.queue.single().id)
    }

    @Test
    fun 不认识的工具和改动种类按其他解码() {
        val call = parseEntry(json.parseToJsonElement("""{"type":"tool_call","time":"t","id":"c","name":"Edit","tool":{"kind":"edit","path":"a","change":{"type":"future"}}}"""))
        assertTrue(call is Entry.ToolCall)
        assertEquals(FileChange.Other, ((call as Entry.ToolCall).tool as ToolDetail.Edit).change)
        assertEquals(Entry.Unknown("t"), parseEntry(json.parseToJsonElement("""{"type":"future","time":"t"}""")))
    }
}
