// lib/bossRegistry.js
// 모든 보스 AI를 여기서 등록
// 새 보스 추가 시 import 후 registry에 추가만 하면 됨

import * as absol from "./bosses/absol.js"
import * as beequeen from "./bosses/beequeen.js"
import * as falinks from "./bosses/falinks.js"
import * as kangaskhan from "./bosses/kangaskhan.js"
import * as primarina from "./bosses/primarina.js"
import * as garbodor from "./bosses/garbodor.js"
import * as delphox from "./bosses/delphox.js"
import * as malamar from "./bosses/malamar.js"
import * as ursaluna from "./bosses/ursaluna.js"
import * as zoroark from "./bosses/zoroark.js"
import * as ninjask from "./bosses/ninjask.js"
import * as froslass from "./bosses/froslass.js"
export const bossRegistry = {
  "앱솔": absol,
  "비퀸": beequeen,
  "대여르": falinks,
  "엄마 캥카": kangaskhan,
  "누리레느": primarina,
  "더스트나": garbodor,
  "마폭시": delphox, 
  "칼라마네로": malamar,
  "다투곰": ursaluna,
  "조로아크": zoroark,
  "아이스크": ninjask,
  "눈여아": froslass,
}

// 보스 AI 가져오기
export function getBossAI(bossName) {
  const ai = bossRegistry[bossName]
  if (!ai) throw new Error(`보스 AI 없음: ${bossName}`)
  return ai
}