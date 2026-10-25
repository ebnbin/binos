import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import './index.css'
import { Shell } from './shell/Shell.tsx'
import { reloadOnStaleAssets } from './stale-assets.ts'
import { reserveStatusBarTint } from './status-bar.ts'
import { followVisualViewport, preventPinchZoom } from './viewport.ts'

reloadOnStaleAssets()
followVisualViewport()
preventPinchZoom()
reserveStatusBarTint()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
)
