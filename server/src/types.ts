export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

// version 是正在运行的提交，开发时是 dev；protocol 是协议标识（见 protocol-id.ts）
export type Health = { version: string; protocol: string }

// 外部 app：独立部署的 web app，在窗口里打开。icon 是页面图标库里的名字，页面不认识时用默认图标
export type ExternalApp = { id: string; name: string; icon: string; url: string }

// app 注册表，整份替换。内置 app 在代码里，不记在这里
export type AppRegistry = { external: ExternalApp[] }

export type BuiltinApp = { id: string; name: string }
// 全部 app：内置的和注册表里的外部 app，按这个顺序排列
export type Apps = AppRegistry & { builtin: BuiltinApp[] }

// /api/events 推送的全局通知，收到后重新读取对应的数据。session：Code 的这个对话有变化（新建、开始或结束回答、改名……）；
// project：Code 的项目有变化；apps：app 注册表；agent：agent 的额度或登录；music：音乐的共享队列或来源设置；
// players：音乐播放器上线、下线或播放状态变了（播放进度按 updatedAt 推算，不另外通知）；devices：设备、租约或排队；
// builds：构建；kita：喜多的描述、照片、记忆或喜多 app 的对话；terminal：终端会话新建或结束
export type ChangeEvent =
  | { type: 'session'; id: number }
  | { type: 'project' }
  | { type: 'apps' }
  | { type: 'agent' }
  | { type: 'music' }
  | { type: 'players' }
  | { type: 'devices' }
  | { type: 'builds' }
  | { type: 'kita' }
  | { type: 'terminal' }
