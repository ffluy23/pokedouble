// api/raidAttackMirage.js
// 눈여아 전용 — 눈속임 형상 선택 공격
// 플레이어가 0/1/2 중 하나를 선택 → 진짜면 정상 데미지, 가짜면 데미지 0 + 온도 -1

import { db }          from "../lib/firestore.js"
import { corsHeaders } from "../lib/gameUtils.js"
import { josa }        from "../lib/effecthandler.js"

const PLAYER_SLOTS = ["p1", "p2", "p3"]

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId, mySlot, mirageIdx } = req.body
  if (!roomId || !mySlot || mirageIdx === undefined)
    return res.status(400).json({ error: "파라미터 부족" })

  const roomRef = db.collection("raid").doc(roomId)
  const snap    = await roomRef.get()
  const data    = snap.data()
  if (!data)                       return res.status(404).json({ error: "방 없음" })
  if (data.boss_name !== "눈여아") return res.status(403).json({ error: "해당 보스전이 아님" })
  if (!data.boss_state?.mirageActive)
    return res.status(403).json({ error: "눈속임 미발동 상태" })
  if (data.game_over)              return res.status(403).json({ error: "게임 종료됨" })

  const realIdx = data.boss_state?.mirageRealIdx ?? 0
  const isReal  = Number(mirageIdx) === realIdx

  const logsRef = db.collection("raid").doc(roomId).collection("logs")
  const base    = Date.now()
  const batch   = db.batch()
  const update  = {}

  const myName = (data[`${mySlot.replace("p", "player")}_name`] ?? mySlot).split("]").pop().trim()

  if (isReal) {
    // 진짜 형상 — 눈속임 이번 라운드 해제 (다음 눈보라 전까지 비활성)
    batch.set(logsRef.doc(), { type: "normal", text: `${myName}${josa(myName, "이가")} 진짜 눈여아를 찾아냈다!`, ts: base })
    batch.set(logsRef.doc(), { type: "normal", text: "눈속임이 일시적으로 해제됐다!", ts: base + 1 })

    update["boss_state"] = {
      ...data.boss_state,
      mirageActive: false,   // 이번 라운드만 해제, 다음 눈보라 때 재발동
    }
  } else {
    // 가짜 형상 — 데미지 0, 온도 1 감소
    batch.set(logsRef.doc(), { type: "normal", text: `${myName}${josa(myName, "이가")} 가짜 형상을 공격했다! 공격이 허공을 가른다…`, ts: base })

    const myIdx   = data[`${mySlot}_active_idx`] ?? 0
    const myEntry = JSON.parse(JSON.stringify(data[`${mySlot}_entry`] ?? []))
    const myPkmn  = myEntry[myIdx]

    if (myPkmn && myPkmn.hp > 0 && myPkmn.status !== "얼음") {
      const curTemp = data[`${mySlot}_temperature`] ?? 3
      const newTemp = Math.max(0, curTemp - 1)
      update[`${mySlot}_temperature`] = newTemp

      if (newTemp <= 0) {
        myPkmn.status = "얼음"
        update[`${mySlot}_entry`] = myEntry
        batch.set(logsRef.doc(), { type: "normal", text: `차가운 기운이 ${myPkmn.name}${josa(myPkmn.name, "을를")} 덮친다! 온도가 0이 되어 얼어붙었다!`, ts: base + 2 })
        batch.set(logsRef.doc(), { type: "hp",     text: "", meta: { slot: mySlot, hp: myPkmn.hp, maxHp: myPkmn.maxHp }, ts: base + 3 })
      } else {
        batch.set(logsRef.doc(), { type: "normal", text: `차가운 기운이 스며든다… (온도: ${newTemp})`, ts: base + 2 })
      }
    }
  }

  await batch.commit()
  await roomRef.update(update)

  return res.status(200).json({ ok: true, isReal })
}