import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Spinner } from '../../../ui/Spinner.tsx'
import { cancelCodexLogin, codexLoginStatus, startCodexLogin } from './api.ts'
import styles from '../Login.module.css'

type Step = { name: 'starting' } | { name: 'waiting'; id: string; url: string; code: string } | { name: 'done' } | { name: 'failed'; error: string }

// 等用户授权时多久问一次结果
const pollInterval = 2000

// 在网页上重新登录 Codex（后端见 codex/login.ts）：打开网址、输入一次性的码，授权后这里自己变成登录好了。
// 挂上就开始，onClose 关上（没完成时顺便取消这次登录）
export function CodexLogin({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>({ name: 'starting' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let id: string | undefined
    let timer: number | undefined
    const poll = async () => {
      const result = id && (await codexLoginStatus(id))
      if (cancelled || !result) {
        timer = window.setTimeout(() => void poll(), pollInterval)
        return
      }
      if (result.status === 'waiting') {
        timer = window.setTimeout(() => void poll(), pollInterval)
        return
      }
      id = undefined
      setStep('error' in result ? { name: 'failed', error: result.error } : { name: 'done' })
    }
    void startCodexLogin().then((result) => {
      if (cancelled) {
        if ('id' in result) {
          void cancelCodexLogin(result.id)
        }
        return
      }
      if ('id' in result) {
        id = result.id
        setStep({ name: 'waiting', ...result })
        timer = window.setTimeout(() => void poll(), pollInterval)
      } else {
        setStep({ name: 'failed', error: result.error })
      }
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (id) {
        void cancelCodexLogin(id)
      }
    }
  }, [attempt])

  return (
    <div className={styles.flow}>
      <div className={styles.title}>重新登录 Codex</div>
      {step.name === 'starting' && (
        <p className={styles.waiting}>
          <Spinner /> 正在拿登录码
        </p>
      )}
      {step.name === 'waiting' && (
        <div className={styles.steps}>
          <a className={styles.link} href={step.url} target="_blank" rel="noreferrer">
            1. 打开登录页面，用 ChatGPT 账号登录
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
          </a>
          <div className={styles.codeLabel}>
            2. 输入这个一次性的码（15 分钟内有效）
            <span className={styles.deviceCode}>{step.code}</span>
          </div>
          <p className={styles.waiting}>
            <Spinner /> 等你授权，授权后这里会自动更新
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      )}
      {step.name === 'done' && (
        <>
          <p className={styles.done}>登录好了，下一轮回答起用新的登录</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onClose}>
              好
            </button>
          </div>
        </>
      )}
      {step.name === 'failed' && (
        <>
          <p className={styles.error}>{step.error}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={onClose}>
              关上
            </button>
            <button type="button" className={styles.primary} onClick={() => (setStep({ name: 'starting' }), setAttempt(attempt + 1))}>
              重新开始
            </button>
          </div>
        </>
      )}
    </div>
  )
}
