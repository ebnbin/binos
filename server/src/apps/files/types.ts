// directory：链接指向目录时也是 true。读不到信息的项 size、modified 是 0
export type FileEntry = { name: string; path: string; directory: boolean; symlink: boolean; size: number; modified: number }
export type Directory = { path: string; parent: string; home: string; entries: FileEntry[] }
import type { ApiError } from '../../errors.js'

// 在 path 目录里新建 name，或者把 path 改名为 name
export type FileName = { path: string; name: string }
// 把 paths 复制或移动到 destination 目录里，同名的不覆盖
export type FileTransfer = { paths: string[]; destination: string }
export type FileTrash = { paths: string[] }
// 批量操作逐项的结果，顺序和请求里的一样；没做成的带着原因
export type FileResult = { path: string; error?: ApiError['error'] }
export type FileResults = { results: FileResult[] }
