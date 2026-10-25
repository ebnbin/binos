export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

// version 是正在运行的提交，开发时是 dev；protocol 是协议标识（见 protocol-id.ts）
export type Health = { version: string; protocol: string }

// 外部 app：独立部署的 web app，在窗口里打开。icon 是页面图标库里的名字，页面不认识时用默认图标
export type ExternalApp = { id: string; name: string; icon: string; url: string }

// app 注册表。内置 app 在代码里，不记在这里
export type AppRegistry = { external: ExternalApp[] }

// /api/events 推送的全局通知。session：对话新建、开始回答、回答结束，页面收到后重新读取列表；apps：app 注册表有变化
// agent：agent 的额度或登录有变化，页面重新读取 agent 的状况；kita：喜多的描述、照片、记忆或喜多 app 的对话有变化
export type ChangeEvent = { type: 'session'; id: number } | { type: 'project' } | { type: 'apps' } | { type: 'agent' } | { type: 'music' } | { type: 'devices' } | { type: 'builds' } | { type: 'kita' }
