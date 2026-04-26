// api/raidPassFireball.js
// 눈여아 전용 — 화염구슬 전달

import { db }          from "../lib/firestore.js"
import { corsHeaders } from "../lib/gameUtils.js"
import { josa }        from "../lib/effecthandler.js"

const PLAYER_SLOTS = ["p1", "p2", "p3"]

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId, fromSlot, toSlot } = req.body
  if (!roomId || !fromSlot || !toSlot)
    return res.status(400).json({ error: "파라미터 부족" })

  if (fromSlot === toSlot)
    return res.status(400).json({ error: "자신에게 전달 불가" })

  const roomRef = db.collection("raid").doc(roomId)
  const snap    = await roomRef.get()
  const data    = snap.data()
  if (!data)                         return res.status(404).json({ error: "방 없음" })
  if (data.boss_name !== "눈여아")   return res.status(403).json({ error: "해당 보스전이 아님" })
  if (!data[`${fromSlot}_fireball`]) return res.status(403).json({ error: "화염구슬 미소지" })
  if (data.game_over)                return res.status(403).json({ error: "게임 종료됨" })

  // 수신자가 살아있는지 확인
  const toIdx   = data[`${toSlot}_active_idx`] ?? 0
  const toEntry = JSON.parse(JSON.stringify(data[`${toSlot}_entry`] ?? []))
  const toPkmn  = toEntry[toIdx]
  if (!toPkmn || toPkmn.hp <= 0)
    return res.status(403).json({ error: "수신자 포켓몬이 기절 상태" })

  const update = {}

  // 모든 슬롯 fireball false → toSlot만 true
  PLAYER_SLOTS.forEach(s => { update[`${s}_fireball`] = false })
  update[`${toSlot}_fireball`] = true

  const logTexts = []
  const fromName = (data[`${fromSlot.replace("p", "player")}_name`] ?? fromSlot).split("]").pop().trim()
  const toName   = (data[`${toSlot.replace("p", "player")}_name`]   ?? toSlot).split("]").pop().trim()
  logTexts.push(`${fromName}${josa(fromName, "이가")} ${toName}에게 화염구슬을 전달했다!`)

  // 수신자가 얼음 상태이면 해제 + 온도 3 복구
 if (toPkmn.status === "얼음") {
  toPkmn.status = null
  update[`${toSlot}_entry`] = toEntry
  logTexts.push(`${toPkmn.name}${josa(toPkmn.name, "의")} 얼음이 녹았다!`)
}
update[`${toSlot}_temperature`] = 3  // 항상 3으로 리셋

  // 송신자 온도는 유지 (전달 직후 다음 EOT에서 감소 시작)
  // fireball 잃었으니 다음 라운드부터 감소
  update[`${fromSlot}_temperature`] = 3
  

  const logsRef = db.collection("raid").doc(roomId).collection("logs")
  const base    = Date.now()
  const batch   = db.batch()
  logTexts.forEach((text, i) => {
    batch.set(logsRef.doc(), { type: "normal", text, ts: base + i })
  })
  await batch.commit()
  await roomRef.update(update)

  return res.status(200).json({ ok: true })
}