package app.binos.code

import app.binos.net.SseMessage
import app.binos.net.StreamSignal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class ThreadStateTest {
    private val time = "2026-10-24T00:00:00Z"
    private fun input(text: String) = """{"type":"input","time":"$time","mode":"start","text":"$text"}"""
    private fun call(id: String) = """{"type":"tool_call","time":"$time","id":"$id","name":"Bash","tool":{"kind":"command","command":"ls"}}"""
    private fun result(id: String) = """{"type":"tool_result","time":"$time","callId":"$id","status":"done","output":"x","clipped":true}"""
    private fun event(seq: Int, data: String) = """{"seq":$seq,"data":$data}"""
    private fun ThreadState.receive(data: String) = apply(StreamSignal.Message(SseMessage(null, data, null)))

    @Test
    fun 只读最后几轮时条目的位置从窗口起点算起_对不上的推送不接() {
        val state = ThreadState("t")
        state.apply(StreamSignal.Open)
        state.receive("""{"type":"window","from":5,"session":{"type":"session","time":"$time","agent":"codex"}}""")
        state.receive("""{"type":"events","events":[${event(6, input("一"))},${event(7, call("c"))}]}""")
        state.receive("""{"type":"event","event":${event(9, result("c"))}}""")
        assertEquals(2, state.items.size)
        state.receive("""{"type":"event","event":${event(8, result("c"))}}""")
        assertEquals(5, state.offset)
        assertEquals("codex", state.session?.agent)
        val turn = state.turns.single()
        assertEquals(5, turn.start)
        assertEquals(listOf(5, 6, 7), turn.main.map { it.index })
        assertEquals(true, turn.results[state.items[1] as Entry.ToolCall]?.clipped)
    }

    @Test
    fun 答完的轮沿用原来的对象_调用只和同一轮的结果对应() {
        val state = ThreadState("t")
        state.receive("""{"type":"window","from":0,"session":{"type":"session","time":"$time","agent":"claude"}}""")
        state.receive("""{"type":"events","events":[${event(1, input("一"))},${event(2, call("c"))},${event(3, input("二"))}]}""")
        val first = state.turns[0]
        state.receive("""{"type":"event","event":${event(4, call("c"))}}""")
        state.receive("""{"type":"event","event":${event(5, result("c"))}}""")
        assertSame(first, state.turns[0])
        assertNull(first.results[state.items[1] as Entry.ToolCall])
        assertEquals("x", state.turns[1].results[state.items[3] as Entry.ToolCall]?.output)
    }

    @Test
    fun 不认识和解不开的条目占住序号_后面的条目位置不错() {
        val state = ThreadState("t")
        state.receive("""{"type":"window","from":0,"session":{"type":"session","time":"$time","agent":"claude"}}""")
        state.receive("""{"type":"events","events":[${event(1, input("一"))},${event(2, """{"type":"future","time":"$time","extra":1}""")},${event(3, """{"type":"tool_call","time":"$time"}""")},{"seq":4}]}""")
        state.receive("""{"type":"event","event":${event(5, """{"type":"tool_call","time":"$time","id":"c","name":"X","tool":{"kind":"future"}}""")}}""")
        assertEquals(5, state.items.size)
        assertEquals(listOf(Entry.Unknown::class, Entry.Unknown::class, Entry.Unknown::class), state.items.subList(1, 4).map { it::class })
        assertEquals(ToolDetail.Other, (state.items[4] as Entry.ToolCall).tool)
        state.receive("""{"type":"event","event":${event(6, input("二"))}}""")
        assertEquals("二", (state.items[5] as Entry.Input).text)
    }

    @Test
    fun 回答中的临时内容遇到不认识的状态和缺字段的事件不出错() {
        val state = ThreadState("t")
        state.receive("""{"type":"window","from":0}""")
        state.receive("""{"type":"live","live":{"text":"半","status":{"type":"future"},"tasks":{"a":{"toolUses":1},"b":{"toolUses":"x"}},"extra":true}}""")
        assertEquals(Status.Other, state.live?.status)
        assertEquals(setOf("a"), state.live?.tasks?.keys)
        state.receive("""{"type":"file"}""")
        state.receive("""{"type":"task"}""")
        state.receive("""{"type":"text","text":"截"}""")
        assertEquals("半截", state.live?.text)
    }
}
