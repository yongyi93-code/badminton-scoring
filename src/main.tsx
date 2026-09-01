import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from './store/useTheme'
import { initLang } from './lib/i18n'
import { clearUpdateMarker } from './lib/update'
import './index.css'

// 渲染之前先把主题和语言定下来 —— 否则深色的人先白闪一帧，
// 英文用户先看到一帧中文
initTheme()
initLang()
// 「检查更新」留下的 ?_v=… 到这里就没用了，抹掉再往下走
clearUpdateMarker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
