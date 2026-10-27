# binOS

binOS 是运行在 macOS 上、通过浏览器使用的个人操作系统。用户在 binos.app 上和 agent 对话，由 agent 修改 binOS 自己的代码。你改动的，是你自己正在运行的系统。

## 目录

根目录由环境变量 `BINOS_ROOT` 指定。

- `System/binos`：正在运行的 binOS，由上线服务装进来。launchd 的三个服务都运行其中的 `bin/binos`：`app.binos.server` 运行 `server`（后端），`app.binos.tunnel` 运行 `tunnel`（Cloudflare Tunnel），`app.binos.deploy` 每 60 秒运行一次 `deploy`（GitHub 上的 main 有新提交，就取它的源码构建并上线）
- `Library/`：系统数据，包括 session 记录
- `Library/Apps/code/repositories/binos/`：binOS 的仓库。`.git/` 是仓库本身（裸仓库），其余每个子目录是它的一个 worktree
- `Library/Apps/code/repositories/binos/main/`：main 分支的 worktree，只读。binOS 的 session 从这里启动
- `Library/Apps/code/repositories/binos/<分支名>/`：每项改动一个 worktree
- `Library/Services/deploy/`：上线服务的数据。`previous/` 是上一个版本，`tmp/` 是上线过程中的临时文件，`failed` 记着上线失败或被回退的提交，main 停在这个提交时不再自动上线
- `Library/binos/logs/`：launchd 服务的输出，`server.log`、`tunnel.log`、`deploy.log`
- `Agents/`：Claude Code、Codex 自己的配置目录，包括登录凭证和它们的会话记录。路径和钥匙串里的凭证、会话的续接绑定在一起，不能挪动

## 工作流

1. 有明确的改动任务时，基于最新的 `origin/main`，在 `main/` 旁边建 worktree。目录名和分支名一致，只用小写字母、数字和连字符
2. 在 worktree 根目录 `pnpm install` 安装依赖，完成改动后运行 `pnpm check`（类型检查、lint 和测试），再用 `pnpm dev` 启动测试实例验证。测试实例的数据在 worktree 里，和正式版互不影响
3. 第一次提交后推送、开 PR，在描述里写明验证的方式和结果，构建服务会自动构建 PR 最新的提交，Web 的产物就是 `https://pr-<编号>.binos.app` 预览。在 worktree 里运行 `pnpm preview` 等这个提交的预览构建完成，它会给出预览链接。把 PR 链接和预览链接一起发给用户。之后的改动都提交、推送到同一个 PR，每次推送后重新运行 `pnpm preview`
4. 用户明确说合并后，才合并 PR
5. 合并后，binOS 会在一分钟内自动上线 main 的最新版本。运行 `pnpm deployed` 等待并确认正式版包含这次合并的提交。上线失败时线上会自动切回原版本，这个提交不再自动上线，`pnpm deployed` 会输出 `deploy.log` 里的原因，详细日志见 `Library/binos/logs/server.log`。自动上线本身坏了、上不了修复它的提交时，在 `Library/Apps/code/repositories/binos/main` 里依次运行 `git fetch origin`、`git merge --ff-only origin/main`、`node scripts/deploy.ts deploy` 手动上线
6. 合并上线后，或者 PR 被关闭后，删除这次的 worktree 和本地分支。预览会在 PR 合并或关闭后一分钟内自动删除

## 约定

- 修改 AGENTS.md 前，先征得用户同意
- 结论只由事实和推理决定，不随用户的问法或倾向改变：没有新的事实或理由就坚持原结论；用户的想法不如别的方案时直接指出
- 代码是 SSOT：注释只写读代码得不到的信息，测试只用于防范不写就难以发现的问题，PR 描述只写改动目的和核心行为变化。
- 遵循所用工具和框架的官方最佳实践
- 代码、注释、提交信息和 PR 描述只写结论和现状，不写讨论过程和被放弃的方案
- 客户端收发的数据结构都登记在 `server/src/protocol.ts`。改了它、`pnpm protocol` 生成的 schema 变了时，在同一个 PR 里同步更新 `ios/`、`android/` 的模型和协议标识；做不到时在 PR 描述里说明
- 外部 app 的清单（`Library/binos/apps.json`）是私有数据，可能有不公开的 app：其中的名称、网址等信息不写进代码、注释、提交信息和 PR 描述
- 仓库之外的改动没有 PR 和回退兜底：删除或改写 `Library/`、`Agents/` 里的数据，修改 launchd 服务、钥匙串、Cloudflare 或 GitHub 的设置之前，先征得用户同意
