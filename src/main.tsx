import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from './store/useTheme'
import { initLang } from './lib/i18n'
import { clearUpdateMarker, healIfStale } from './lib/update'
import { readInvite, rememberInvite, stripInvite } from './lib/invite'
import './index.css'

// 渲染之前先把主题和语言定下来 —— 否则深色的人先白闪一帧，
// 英文用户先看到一帧中文
initTheme()
initLang()
// 「检查更新」留下的 ?_v=… 到这里就没用了，抹掉再往下走
clearUpdateMarker()

/*
 * 球局分享链接。要在最前面读，而且读完立刻从地址栏抹掉：
 *
 *   读得早 —— 后面任何一处 replaceState（比如登录回调清理凭证）
 *             都会把这两个参数一起冲掉
 *   抹得早 —— 不抹的话刷新一次就再触发一次，人在球局里刷新一下
 *             又被弹一遍「有人约你打球」
 *
 * 存进 localStorage 再处理：中间可能要先登录，而登录会跳走再跳回来。
 */
const invite = readInvite(window.location.href)
if (invite) {
  rememberInvite(invite)
  history.replaceState(history.state, '', stripInvite(window.location.href))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/*
 * 画完了再去问服务器「现在是哪一版」。
 *
 * 放在 render 后面：这个检查不该拖慢首屏，而且离线时它本来就什么都不做。
 * 对不上会自己清掉缓存重载一次 —— 见 healIfStale 里的说明。
 */
void healIfStale()
