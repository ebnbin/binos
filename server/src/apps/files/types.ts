// directory：链接指向目录时也是 true。读不到信息的项 size、modified 是 0
export type FileEntry = { name: string; path: string; directory: boolean; symlink: boolean; size: number; modified: number }
export type Directory = { path: string; parent: string; home: string; entries: FileEntry[] }
// path 是要操作的文件或目录：mkdir 在它里面新建 name，rename 改名为 name，copy、move 到 destination 目录里，trash 移到废纸篓
export type FileOperation = { action: 'mkdir' | 'rename'; path: string; name: string } | { action: 'copy' | 'move'; path: string; destination: string } | { action: 'trash'; path: string }
