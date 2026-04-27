// api/raidResonance.js
// 누클라바스 4페이즈 물+풀 코어 — 레조넌스 동의 / 어드민 발동 API

import { db } from "../lib/firestore.js"
import { corsHeaders } from "../lib/gameUtils.js"
import { josa } from "../lib/effecthandler.js"
import { getResonancePlayerLog, getResonanceFireLog } from "../lib/bosses/catastrophe.js"

const PLAYER_SLOTS = ["p1", "p2", "p3"]

async function writeLogs(roomId, logEntries) {
  const logsRef = db.collection("raid").doc(roomId).collection("logs")
  const base    = Date.now()
  const batch   = db.batch()
  logEntries.forEach((entry, i) => batch.set(logsRef.doc(), { ...entry, ts: base + i }))
  await batch.commit()
}

function makeLog(type, text = "", meta = null) {
  return { type, text, ...(meta ? { meta } : {}) }
}

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  // action: "agree" | "fire"
  const { roomId, myUid, mySlot, action } = req.body
  if (!roomId || !myUid || !action)
    return res.status(400).json({ error: "파라미터 부족" })

  const roomRef = db.collection("raid").doc(roomId)
  const snap    = await roomRef.get()
  const data    = snap.data()
  if (!data) return res.status(404).json({ error: "방 없음" })

  if (data.boss_name !== "누클라바스")
    return res.status(403).json({ error: "해당 보스에서 사용 불가" })
  if ((data.boss_state?.ultPhase ?? 0) !== 2)
    return res.status(403).json({ error: "레조넌스 대기 상태가 아님" })

  // ── 동의 ────────────────────────────────────────────────────────
  if (action === "agree") {
    const agreed = data.resonance_agreed ?? []
    if (agreed.includes(myUid)) return res.status(200).json({ ok: true, already: true })

    const newAgreed = [...agreed, myUid]
    await roomRef.update({ resonance_agreed: newAgreed })

    // 로그: 닉네임 표시
    const userSnap = await db.collection("users").doc(myUid).get()
    const nick     = userSnap.data()?.nickname ?? myUid.slice(0, 6)
    await writeLogs(roomId, [makeLog("normal", getResonancePlayerLog(nick))])

    // 전원 동의 시 어드민 발동 가능 상태로 변경
    const totalPlayers = PLAYER_SLOTS.filter(s => {
      const slotKey = s.replace("p", "player")
      return data[`${slotKey}_uid`]
    }).length
    if (newAgreed.length >= totalPlayers) {
      await roomRef.update({ resonance_ready: true })
    }

    return res.status(200).json({ ok: true, agreedCount: newAgreed.length })
  }

  // ── 발동 (어드민 전용) ──────────────────────────────────────────
  if (action === "fire") {
    // 어드민 확인
    const userSnap = await db.collection("users").doc(myUid).get()
    const role     = userSnap.data()?.role ?? ""
    if (role !== "admin")
      return res.status(403).json({ error: "어드민만 발동 가능" })

    if (!data.resonance_ready)
      return res.status(403).json({ error: "전원 동의 필요" })

    const logEntries = []
    logEntries.push(makeLog("normal", getResonanceFireLog()))

    // 보스 즉사
    const bossName = data.boss_name ?? "누클라바스"
    logEntries.push(makeLog("hp",    "", { slot: "boss", hp: 0, maxHp: data.boss_max_hp ?? 1 }))
    logEntries.push(makeLog("faint", `${bossName}${josa(bossName, "은는")} 쓰러졌다!`, { slot: "boss" }))

    await writeLogs(roomId, logEntries)

    await roomRef.update({
      boss_current_hp:   0,
      game_over:         true,
      raid_result:       "victory",
      current_order:     [],
      turn_started_at:   null,
      resonance_agreed:  [],
      resonance_ready:   false,
      boss_state: {
        ...(data.boss_state ?? {}),
        ultPhase: 0,
      },
    })

    return res.status(200).json({ ok: true, result: "victory" })
  }

  return res.status(400).json({ error: "유효하지 않은 action" })
}