import type { Profile } from '@binos/server/services/kita/types'
import { ImageSquareIcon, TrashIcon } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { photoUrl, removePhoto, saveDescription, setAvatar, uploadPhoto } from '../../services/kita/api.ts'
import { Alert } from '../../ui/Alert.tsx'
import { IconButton } from '../../ui/IconButton.tsx'
import { Avatar } from './Avatar.tsx'
import styles from './ProfilePage.module.css'

// 喜多的照片、头像和描述
export function ProfilePage({ profile }: { profile: Profile | undefined }) {
  const [description, setDescription] = useState<string>()
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const text = description ?? profile?.description ?? ''
  const changed = description !== undefined && description !== profile?.description

  async function upload(files: File[]) {
    setNotice('')
    for (const file of files) {
      const error = await uploadPhoto(file)
      if (error) setNotice(error)
    }
  }

  async function save() {
    setSaving(true)
    if (await saveDescription(text)) setDescription(undefined)
    else setNotice('保存失败，请重试')
    setSaving(false)
  }

  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <header className={styles.header}>
          <Avatar profile={profile} size={96} />
          <h1>喜多</h1>
        </header>
        {notice && <Alert>{notice}</Alert>}
        <section>
          <h2 className={styles.heading}>照片</h2>
          <div className={styles.photos}>
            {profile?.photos.map((photo) => (
              <figure key={photo.file} className={styles.photo} data-avatar={photo.file === profile.avatar || undefined}>
                <button type="button" className={styles.pick} onClick={() => void setAvatar(photo.file)} title={photo.file === profile.avatar ? '当前的头像' : '用作头像'}>
                  <img src={photoUrl(photo.file)} alt="喜多的照片" loading="lazy" />
                </button>
                <IconButton icon={TrashIcon} label="删除这张照片" className={styles.remove} onClick={() => void removePhoto(photo.file)} />
              </figure>
            ))}
            <button type="button" className={styles.upload} onClick={() => fileInput.current?.click()}>
              <ImageSquareIcon size={22} />
              <span>添加照片</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                void upload([...(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
          </div>
        </section>
        <section>
          <h2 className={styles.heading}>描述</h2>
          <textarea
            className={styles.description}
            value={text}
            onChange={(event) => setDescription(event.target.value)}
            aria-label="喜多的描述"
            rows={8}
          />
          <div className={styles.save}>
            {changed && (
              <button type="button" className={styles.button} onClick={() => setDescription(undefined)}>
                还原
              </button>
            )}
            <button type="button" className={styles.primary} disabled={!changed || saving} onClick={() => void save()}>
              保存
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
