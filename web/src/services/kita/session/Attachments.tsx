import type { Attachment } from '@binos/server/services/kita/types'
import { FileTextIcon, XIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import { FileBlock } from '../../preview/index.ts'
import { threadPreviewFile } from '../files.ts'
import styles from './Attachments.module.css'

// 附件的两种样子：浏览器能显示的图片是方形缩略图，其他文件是带文件名的卡片


function FileCard({ name }: { name: string }) {
  return (
    <span className={styles.card}>
      <FileTextIcon size={18} />
      <span className={styles.name}>{name}</span>
    </span>
  )
}

// 消息里已发出的附件
export function AttachmentList({ thread, attachments }: { thread: string; attachments: Attachment[] }) {
  return (
    <div className={`${styles.list} ${styles.sent}`}>
      {attachments.map(({ file, name }) => <FileBlock key={file} item={threadPreviewFile(thread, file, name)} />)}
    </div>
  )
}

// preview 是图片的本地预览地址
export type PendingFile = { key: number; file: File; preview?: string }

// 本地预览加载失败的（浏览器不认识的图片格式，比如 HEIC）退回文件卡片
function PendingItem({ file, preview }: { file: File; preview?: string }) {
  const [broken, setBroken] = useState(false)
  return preview && !broken ? (
    <span className={styles.thumb}>
      <img src={preview} alt={file.name} onError={() => setBroken(true)} />
    </span>
  ) : (
    <FileCard name={file.name} />
  )
}

// 输入框上方待发的附件，右上角可以移除
export function PendingAttachments({ files, onRemove }: { files: PendingFile[]; onRemove?: (key: number) => void }) {
  return (
    <div className={styles.list}>
      {files.map(({ key, file, preview }) => (
        <div key={key} className={styles.pending} title={file.name}>
          <PendingItem file={file} preview={preview} />
          {onRemove && (
            <button type="button" className={styles.remove} onClick={() => onRemove(key)} aria-label={`移除 ${file.name}`}>
              <XIcon size={11} weight="bold" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
