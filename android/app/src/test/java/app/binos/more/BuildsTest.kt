package app.binos.more

import app.binos.net.json
import org.junit.Assert.assertEquals
import org.junit.Test

class BuildsTest {
    private val snapshot = json.decodeFromString(
        BuildsSnapshot.serializer(),
        """
        {"builds":[
          {"id":"w","commit":"c2","target":"web","trigger":"pr","pr":7,"status":"success","createdAt":"2026-10-25T00:00:00Z","endedAt":"2026-10-25T00:02:00Z",
           "artifacts":[{"kind":"link","platform":"web","name":"preview","url":"https://pr-7.example.test"}]},
          {"id":"a","commit":"c2","target":"android","trigger":"pr","pr":7,"status":"failed","createdAt":"2026-10-25T00:00:00Z","endedAt":"2026-10-25T00:01:00Z","error":"x","artifacts":[]},
          {"id":"i","commit":"c1","target":"ios","trigger":"main","status":"success","createdAt":"2026-10-24T00:00:00Z","endedAt":"2026-10-24T00:01:00Z",
           "artifacts":[{"kind":"install","platform":"ios","name":"binos-ios-adhoc.ipa","size":12,"sha256":"s"},{"kind":"future","name":"x"},{"kind":"install"}]},
          {"id":"m","commit":"c0","target":"android","trigger":"manual","status":"queued","createdAt":"2026-10-23T00:00:00Z"},
          {"id":"o","commit":"c1","target":"watch","trigger":"main","status":"paused","createdAt":"2026-10-24T00:00:00Z","newField":true},
          {"commit":"c9","target":"android","status":"queued"}
        ],"settings":{"automatic":true,"adhoc":true},"prs":[{"number":7,"title":"t"}],"mode":"mock","version":"v"}
        """,
    )

    @Test
    fun 两种产物都能解码_缺核心字段的构建丢掉() {
        assertEquals(listOf("w", "a", "i", "m", "o"), snapshot.builds.map { it.id })
        val link = snapshot.builds[0].artifacts.single()
        assertEquals("link" to "https://pr-7.example.test", link.kind to link.url)
        val install = snapshot.builds[2].artifacts
        assertEquals(listOf("install", "future"), install.map { it.kind })
        assertEquals(12L, install[0].size)
        assertEquals("ios", install[0].platform)
        assertEquals(true, snapshot.settings.automatic)
    }

    @Test
    fun 按来源分组_组内按提交() {
        val groups = groupBuilds(snapshot.builds)
        assertEquals(listOf("pr-7", "main", "manual"), groups.map { it.key })
        assertEquals(listOf(listOf("w", "a")), groups[0].commits.map { c -> c.map { it.id } })
        assertEquals(listOf(listOf("i", "o")), groups[1].commits.map { c -> c.map { it.id } })
    }

    @Test
    fun 预览只在开着的PR最新成功的Web构建上() {
        assertEquals(setOf("w"), livePreviews(snapshot))
        assertEquals(emptySet<String>(), livePreviews(snapshot.copy(prs = emptyList())))
    }

    @Test
    fun PR和入口的构建概况() {
        assertEquals(BuildState.Failed, buildState(prBuilds(snapshot.builds, 7)))
        assertEquals("1 个排队" to BuildState.Running, buildsSummary(snapshot.builds))
        assertEquals("PR #7 构建失败" to BuildState.Failed, buildsSummary(snapshot.builds.filter { it.status != "queued" }))
    }
}
