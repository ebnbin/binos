import path from 'node:path'
import { transcriptPrompt } from '../../services/kita/transcript-prompt.js'
import type { Project } from './types.js'

const devicePrompt = `开发验证设备通过 "$BINOS_DEVICES_CLI" devices 使用。先 acquire --platform android|ios|both --reason 用途 --wait 60。设备由服务按需创建，双端全部就绪后整组交付租约；等待时保留申请编号并重试相同组合，取消用 cancel --request 申请编号。同一 session 只能有一份申请，换平台必须先归还或取消；用 run --lease ID -- 命令 执行，自动续租并注入 ANDROID_SERIAL、BINOS_IOS_UDID 和 BINOS_IOS_DEVICE_SET。iOS 命令必须带 xcrun simctl --set "$BINOS_IOS_DEVICE_SET"，不要使用 booted。用 screenshot 只截租约里的设备，验证后 release --lease ID。不要接管已有模拟器。创建、启动、擦除、销毁和强制回收由设备服务负责，session 不能执行生命周期操作。`

const buildPrompt = `移动端构建使用 "$BINOS_DEVICES_CLI" builds。status 查看队列与产物，enqueue main|pr/编号|完整提交号 android,ios-simulator 发起构建，retry 构建ID 重试，log 构建ID 行数 读取日志末尾。ios-adhoc 需要已配置的真机签名；模拟器包不能安装到真机。构建由独立服务在干净提交中执行，不需要申请模拟器。不要把签名密钥放入代码或产物。`

export const codeInstructions = [transcriptPrompt, devicePrompt, buildPrompt].join('\n\n')

export function projectInstructions(project: Project, cwd: string): string {
  return [transcriptPrompt, devicePrompt, [
    `当前项目：${JSON.stringify(project.name)}，GitHub 仓库：${project.repository}。`,
    `仓库目录：${JSON.stringify(path.dirname(cwd))}；默认分支：${JSON.stringify(project.defaultBranch)}；默认分支的 worktree：${JSON.stringify(cwd)}，只用于读取。`,
    '先读取并遵循仓库里的 AGENTS.md。有明确开发任务时，git fetch origin，基于最新的远程默认分支，在默认 worktree 旁创建独立 worktree；目录名与分支名一致，只用小写字母、数字和连字符。不要直接修改默认分支。',
    '在任务 worktree 中开发，按项目自己的工具安装依赖、运行检查和验证。提交后推送分支，用 gh pr create 创建 PR，将 PR 链接交给用户；后续修改继续提交推送到同一 PR。',
    '只有用户明确要求合并时才合并 PR。合并或关闭后，清理本次任务的 worktree 和本地分支。预览和部署遵循项目自身配置。',
  ].join('\n')].join('\n\n')
}
