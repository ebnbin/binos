package app.binos.code

import app.binos.net.SseMessage
import app.binos.net.StreamSignal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class ThreadStateTest {
    private val time = "2026-10-24T00:00:00Z"
    private val session = """{"type":"session","time":"$time","agent":"codex"}"""
    private fun input(text: String) = """{"type":"input","time":"$time","mode":"start","text":"$text"}"""
    private fun call(id: String) = """{"type":"tool_call","time":"$time","id":"$id","name":"Bash","tool":{"kind":"command","command":"ls"}}"""
    private fun result(id: String) = """{"type":"tool_result","time":"$time","callId":"$id","status":"done","output":"x","clipped":true}"""
    private fun event(seq: Int, turn: String?, item: String?, data: String, parent: String? = null) =
        """{"seq":$seq,"turnId":${turn?.let { "\"$it\"" }},"itemId":${item?.let { "\"$it\"" }}${parent?.let { ",\"parentId\":\"$it\"" } ?: ""},"data":$data}"""
    private fun ThreadState.receive(data: String) = apply(StreamSignal.Message(SseMessage(null, data, null)))

    @Test
    fun 只接紧接着最后一条的推送_对不上的不接() {
        val state = ThreadState("t")
        state.apply(StreamSignal.Open)
        state.receive("""{"type":"window","session":$session,"events":[${event(6, "a", "i1", input("一"))},${event(7, "a", "a:c", call("c"))}]}""")
        state.receive("""{"type":"event","event":${event(9, "a", "a:c", result("c"))}}""")
        assertEquals(2, state.events.size)
        state.receive("""{"type":"event","event":${event(8, "a", "a:c", result("c"))}}""")
        assertEquals(6, state.firstSeq)
        assertEquals(true, state.hasOlder)
        assertEquals("codex", state.session?.agent)
        val turn = state.turns.single()
        assertEquals(listOf(6, 7, 8), turn.main.map { it.seq })
        assertEquals(true, turn.results["a:c"]?.clipped)
    }

    @Test
    fun 按_turnId_分轮_答完的轮沿用原来的对象_按_itemId_配对结果() {
        val state = ThreadState("t")
        state.receive("""{"type":"window","session":$session,"events":[${event(1, null, null, session)},${event(2, "a", "i1", input("一"))},${event(3, "a", "a:c", call("c"))}]}""")
        state.receive("""{"type":"event","event":${event(4, "b", "i2", input("二"))}}""")
        val first = state.turns[1]
        state.receive("""{"type":"event","event":${event(5, "b", "b:c", call("c"))}}""")
        state.receive("""{"type":"event","event":${event(6, "b", "b:c", result("c"))}}""")
        assertEquals(listOf("", "a", "b"), state.turns.map { it.id })
        assertEquals(false, state.hasOlder)
        assertSame(first, state.turns[1])
        assertNull(first.results["a:c"])
        assertEquals("x", state.turns[2].results["b:c"]?.output)
    }

    @Test
    fun 子_agent_的条目按_parentId_挂在调用下() {
        val state = ThreadState("t")
        state.receive("""{"type":"window","session":$session,"events":[${event(1, "a", "i1", input("一"))},${event(2, "a", "a:p", call("p"))},${event(3, "a", "a:s", call("s"), parent = "a:p")}]}""")
        val turn = state.turns.single()
        assertEquals(listOf(1, 2), turn.main.map { it.seq })
        assertEquals(listOf(3), turn.children["a:p"]?.map { it.seq })
    }

    @Test
    fun 不认识和解不开的条目不影响其他条目() {
        val state = ThreadState("t")
        state.receive("""{"type":"window","session":$session,"events":[${event(1, "a", "i1", input("一"))},${event(2, "a", "i2", """{"type":"future","time":"$time","extra":1}""")},${event(3, "a", "i3", """{"type":"tool_call","time":"$time"}""")},{"seq":4}]}""")
        state.receive("""{"type":"event","event":${event(5, "a", "a:c", """{"type":"tool_call","time":"$time","id":"c","name":"X","tool":{"kind":"future"}}""")}}""")
        assertEquals(5, state.events.size)
        assertEquals(listOf(Entry.Unknown::class, Entry.Unknown::class, Entry.Unknown::class), state.events.subList(1, 4).map { it.entry::class })
        assertEquals(ToolDetail.Other(), (state.events[4].entry as Entry.ToolCall).tool)
        state.receive("""{"type":"event","event":${event(6, "b", "i6", input("二"))}}""")
        assertEquals("二", (state.events[5].entry as Entry.Input).text)
    }

    @Test
    fun 回答中的临时内容遇到不认识的状态和缺字段的事件不出错() {
        val state = ThreadState("t")
        state.receive("""{"type":"window","events":[]}""")
        state.receive("""{"type":"live","live":{"text":"半","status":{"type":"future"},"tasks":{"a":{"toolUses":1},"b":{"toolUses":"x"}},"extra":true}}""")
        assertEquals(Status.Other, state.live?.status)
        assertEquals(setOf("a"), state.live?.tasks?.keys)
        state.receive("""{"type":"file"}""")
        state.receive("""{"type":"task"}""")
        state.receive("""{"type":"text","text":"截"}""")
        assertEquals("半截", state.live?.text)
    }
}
