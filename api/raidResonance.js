// api/raidResonance.js
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

function getActiveTotalPlayers(data) {
  if (data.active_slots) {
    return Object.values(data.active_slots).filter(uid => !!uid).length
  }
  return PLAYER_SLOTS.filter(s => data[`${s.replace("p", "player")}_uid`]).length
}

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId, myUid, action } = req.body
  if (!roomId || !myUid || !action)
    return res.status(400).json({ error: "파라미터 부족" })

  const roomRef = db.collection("raid").doc(roomId)

  // ── 동의 ────────────────────────────────────────────────────────
  if (action === "agree") {
    // 닉네임 먼저 조회 (트랜잭션 밖에서)
    const userSnap = await db.collection("users").doc(myUid).get()
    const nick     = userSnap.data()?.nickname ?? myUid.slice(0, 6)

    let agreedCount = 0
    let isReady     = false

    await db.runTransaction(async tx => {
      const snap = await tx.get(roomRef)
      const data = snap.data()
      if (!data) throw new Error("방 없음")
      if (data.boss_name !== "누클라바스") throw new Error("해당 보스에서 사용 불가")
      if ((data.boss_state?.ultPhase ?? 0) !== 2) throw new Error("레조넌스 대기 상태가 아님")

      const agreed = data.resonance_agreed ?? []
      if (agreed.includes(myUid)) {
        agreedCount = agreed.length
        isReady     = data.resonance_ready ?? false
        return  // 중복 동의 — 트랜잭션은 그냥 종료
      }

      const newAgreed    = [...agreed, myUid]
      const totalPlayers = Object.keys(data.roster ?? {}).length
      isReady            = newAgreed.length >= totalPlayers
      agreedCount        = newAgreed.length

      tx.update(roomRef, {
        resonance_agreed: newAgreed,
        ...(isReady ? { resonance_ready: true } : {}),
      })
    })

    await writeLogs(roomId, [makeLog("normal", getResonancePlayerLog(nick))])
    return res.status(200).json({ ok: true, agreedCount, isReady })
  }

  // ── 발동 (어드민 전용) ──────────────────────────────────────────
  if (action === "fire") {
    const userSnap = await db.collection("users").doc(myUid).get()
    const role     = userSnap.data()?.role ?? ""
    if (role !== "admin")
      return res.status(403).json({ error: "어드민만 발동 가능" })

    const snap = await roomRef.get()
    const data = snap.data()
    if (!data) return res.status(404).json({ error: "방 없음" })
    if (data.boss_name !== "누클라바스")
      return res.status(403).json({ error: "해당 보스에서 사용 불가" })
    if ((data.boss_state?.ultPhase ?? 0) !== 2)
      return res.status(403).json({ error: "레조넌스 대기 상태가 아님" })
    if (!data.resonance_ready)
      return res.status(403).json({ error: "전원 동의 필요" })

    const bossName   = data.boss_name ?? "누클라바스"
    const logEntries = [
      makeLog("normal", getResonanceFireLog()),
      makeLog("hp",    "", { slot: "boss", hp: 0, maxHp: data.boss_max_hp ?? 1 }),
      makeLog("faint", `${bossName}${josa(bossName, "은는")} 쓰러졌다!`, { slot: "boss" }),
    ]
    await writeLogs(roomId, logEntries)

    await roomRef.update({
      boss_current_hp:  0,
      game_over:        true,
      raid_result:      "victory",
      current_order:    [],
      turn_started_at:  null,
      resonance_agreed: [],
      resonance_ready:  false,
      boss_state: { ...(data.boss_state ?? {}), ultPhase: 0 },
    })

    return res.status(200).json({ ok: true, result: "victory" })
  }

  return res.status(400).json({ error: "유효하지 않은 action" })
}