import styles from './Spinner.module.css'

// 系统的活动指示器：八根辐条依次变暗
export function Spinner() {
  return (
    <span className={styles.spinner} role="status" aria-label="进行中">
      {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
    </span>
  )
}
