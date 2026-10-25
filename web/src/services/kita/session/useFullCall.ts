import { useEffect, useState } from 'react'
import { readCall } from '../api.ts'
import type { ToolCall, ToolResult } from './tools.ts'

// 发给页面时省略过的调用，展开时读完整的（seq 是调用事件的位置）；还没读到或读不到时用已有的
export function useFullCall(thread: string, seq: number, call: ToolCall, result: ToolResult | undefined) {
  const clipped = Boolean(call.clipped || result?.clipped)
  const [full, setFull] = useState<{ for: ToolResult | undefined; call: ToolCall; result: ToolResult | undefined }>()
  useEffect(() => {
    if (!clipped) {
      return
    }
    let cancelled = false
    void readCall(thread, seq).then((value) => {
      if (!cancelled && value?.call.data.type === 'tool_call') {
        setFull({ for: result, call: value.call.data, result: value.result?.data.type === 'tool_result' ? value.result.data : undefined })
      }
    })
    return () => {
      cancelled = true
    }
  }, [thread, seq, clipped, result])
  // 结果是读完之后才到的，就还用已有的
  return full && full.for === result ? full : { call, result }
}
