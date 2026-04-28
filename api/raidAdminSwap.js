// api/raidAdminSwap.js
import { db } from "../lib/firestore.js"
import { corsHeaders } from "../lib/gameUtils.js"

const PLAYER_SLOTS = ["p1", "p2", "p3"]

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId, outUid, inUid, targetSlot } = req.body
  if (!roomId || !inUid || !targetSlot)
    return res.status(400).json({ error: "파라미터 부족" })
  if (!PLAYER_SLOTS.includes(targetSlot))
    return res.status(400).json({ error: "유효하지 않은 슬롯" })

  const roomRef = db.collection("raid").doc(roomId)
  const snap    = await roomRef.get()
  const data    = snap.data()
  if (!data)          return res.status(404).json({ error: "방 없음" })
  if (data.game_over) return res.status(403).json({ error: "게임 종료됨" })

  const roster      = data.roster ?? {}
  const activeSlots = { ...(data.active_slots ?? {}) }
  const update      = {}

  // ── 1. outUid: 슬롯에서 빼고 현재 배틀 데이터를 roster에 백업 ──
  if (outUid) {
    const outEntry     = data[`${targetSlot}_entry`]     ?? []
    const outActiveIdx = data[`${targetSlot}_active_idx`] ?? 0

    update[`roster.${outUid}.status`]     = "bench"
    update[`roster.${outUid}.entry`]      = outEntry
    update[`roster.${outUid}.active_idx`] = outActiveIdx

    activeSlots[targetSlot] = null
    update[`${targetSlot}_entry`]      = []
    update[`${targetSlot}_active_idx`] = 0
  }

  // ── 2. inUid: 이미 다른 슬롯에 출전 중이면 거부 ──────────────
  const alreadySlot = Object.entries(activeSlots).find(([, uid]) => uid === inUid)?.[0]
  if (alreadySlot && alreadySlot !== targetSlot)
    return res.status(403).json({ error: `이미 ${alreadySlot}에 출전 중` })

  // ── 3. inMember 확정 ─────────────────────────────────────────
  let inMember = roster[inUid] ?? null
  let inNick   = inMember?.nick ?? null

  if (!inMember) {
    const spectators = data.spectators      ?? []
    const spectNames = data.spectator_names ?? []
    const spectIdx   = spectators.indexOf(inUid)
    if (spectIdx === -1) return res.status(404).json({ error: "투입 대상 없음" })
    inNick = spectNames[spectIdx] ?? inUid.slice(0, 6)
  }

  // ── 4. entry 결정: roster 백업 → users 컬렉션 순서 ──────────
  let inEntry, inActiveIdx

  if (inMember?.entry?.length > 0) {
    // 이전에 배틀 중이었던 데이터 복원 (HP/PP/상태 유지)
    inEntry     = inMember.entry
    inActiveIdx = inMember.active_idx ?? 0
    console.log("[AdminSwap] 백업 데이터 복원:", inUid, "entry 길이:", inEntry.length)
  } else {
    // 처음 투입 — users/{inUid} 에서 entry 로드
    const userSnap = await db.collection("users").doc(inUid).get()
    const userData = userSnap.data()
    console.log("[AdminSwap] users 로드:", inUid, "exists:", userSnap.exists, "entry 길이:", userData?.entry?.length)

    if (!userData?.entry?.length)
      return res.status(404).json({ error: "유저 엔트리 없음" })

    inEntry = userData.entry.map(p => ({
      ...p,
      maxHp: p.maxHp ?? p.hp,
      moves: (p.moves ?? []).map(m => ({ ...m })),
    }))
    inActiveIdx = 0
  }

  // ── 5. 슬롯에 데이터 기록 ────────────────────────────────────
  activeSlots[targetSlot]            = inUid
  update[`${targetSlot}_entry`]      = inEntry
  update[`${targetSlot}_active_idx`] = inActiveIdx
  update.active_slots                = activeSlots

  // ── 6. roster 갱신 ───────────────────────────────────────────
  if (!inMember) {
    update[`roster.${inUid}`] = {
      nick:       inNick,
      role:       null,
      status:     "active",
      entry:      inEntry,
      active_idx: inActiveIdx,
    }
  } else {
    update[`roster.${inUid}.status`]     = "active"
    update[`roster.${inUid}.entry`]      = inEntry
    update[`roster.${inUid}.active_idx`] = inActiveIdx
  }

  // ── 7. player_name 동기화 ────────────────────────────────────
  const slotKey = targetSlot.replace("p", "player")
  update[`${slotKey}_name`] = inNick ?? inUid.slice(0, 6)

  console.log("[AdminSwap] update keys:", Object.keys(update))
  console.log("[AdminSwap] inEntry[0].moves:", JSON.stringify(inEntry[0]?.moves))

  await roomRef.update(update)
  return res.status(200).json({ ok: true })
}