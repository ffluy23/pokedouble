// api/raidStandChoice.js
// 누클라바스 4페이즈 땅 코어 — 막아선다 / 물러난다 선택 API

import { db } from "../lib/firestore.js"
import { corsHeaders } from "../lib/gameUtils.js"

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId, mySlot, choice } = req.body
  // choice: "stand" | "step_back"
  if (!roomId || !mySlot || !choice)
    return res.status(400).json({ error: "파라미터 부족" })
  if (!["stand", "step_back"].includes(choice))
    return res.status(400).json({ error: "유효하지 않은 선택" })

  const roomRef = db.collection("raid").doc(roomId)
  const snap    = await roomRef.get()
  const data    = snap.data()
  if (!data) return res.status(404).json({ error: "방 없음" })

  // 누클라바스 4페이즈 땅 코어 페이즈인지 확인
  if (data.boss_name !== "누클라바스")
    return res.status(403).json({ error: "해당 보스에서 사용 불가" })
  if ((data.boss_state?.phase ?? 1) !== 4)
    return res.status(403).json({ error: "4페이즈가 아님" })
  if ((data.boss_state?.phase4CoreSeq ?? 0) !== 2)
    return res.status(403).json({ error: "땅 코어 페이즈가 아님" })

  // 탱커 슬롯만 선택 가능
  const tankSlot = data.boss_state?.phase4TankSlot ?? null
  if (tankSlot !== mySlot)
    return res.status(403).json({ error: "선택 권한 없음" })

  // 이미 선택됐는지 확인 (step_back이 기본값이므로 stand만 체크)
  if (data.phase4StandChoice === "stand")
    return res.status(200).json({ ok: true, already: true })

  await roomRef.update({ phase4StandChoice: choice })

  return res.status(200).json({ ok: true, choice })
}