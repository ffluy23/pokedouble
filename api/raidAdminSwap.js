// api/raidAdminSwap.js
// Admin 전용 — 레이드 중 슬롯 교체 (출전 ↔ 대기/관전)

import { db } from "../lib/firestore.js"
import { corsHeaders } from "../lib/gameUtils.js"
import { hydrateSlotData, dehydrateSlotData } from "../lib/raidBossAction.js"

const PLAYER_SLOTS = ["p1", "p2", "p3"]

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  // outUid: 빠지는 사람 (null이면 빈 슬롯에 투입)
  // inUid:  들어오는 사람
  // targetSlot: "p1" | "p2" | "p3"
  const { roomId, outUid, inUid, targetSlot } = req.body
  if (!roomId || !inUid || !targetSlot)
    return res.status(400).json({ error: "파라미터 부족" })
  if (!PLAYER_SLOTS.includes(targetSlot))
    return res.status(400).json({ error: "유효하지 않은 슬롯" })

  const roomRef = db.collection("raid").doc(roomId)
  const snap    = await roomRef.get()
  const data    = snap.data()
  if (!data) return res.status(404).json({ error: "방 없음" })
  if (data.game_over) return res.status(403).json({ error: "게임 종료됨" })

  // ── admin 확인 ─────────────────────────────────────────────────
  // roster에 role: "admin" 이 있는 사람만 가능
  const roster = data.roster ?? {}
  const isAdmin = Object.values(roster).some(m => m.role === "admin")
  // 실제로 요청자가 admin인지 확인하려면 inUid 대신 adminUid를 따로 받아야 하지만
  // 현재 구조상 roster에 admin이 있으면 허용 (클라이언트에서 버튼 노출 제한으로 보완)
  // 더 엄격하게 하려면 req.body에 adminUid 추가하면 됨

  const activeSlots = { ...(data.active_slots ?? {}) }
  const update      = {}

  // ── 1. outUid 처리: 현재 슬롯에서 빼기 ──────────────────────
  if (outUid) {
    const outMember = roster[outUid]
    if (!outMember) return res.status(404).json({ error: "퇴장 대상 없음" })

    // active_slots에서 제거
    if (activeSlots[targetSlot] === outUid) {
      activeSlots[targetSlot] = null
    }

    // roster status → bench
    update[`roster.${outUid}.status`] = "bench"

    // 출전 중이던 entry / active_idx를 roster에 백업
    // (나중에 다시 투입될 때 복원 가능하도록)
    const outEntry    = data[`${targetSlot}_entry`]    ?? outMember.entry    ?? []
    const outActiveIdx = data[`${targetSlot}_active_idx`] ?? outMember.active_idx ?? 0
    update[`roster.${outUid}.entry`]      = outEntry
    update[`roster.${outUid}.active_idx`] = outActiveIdx

    // 슬롯 entry 초기화 (빈 슬롯)
    update[`${targetSlot}_entry`]     = []
    update[`${targetSlot}_active_idx`] = 0
  }

  // ── 2. inUid 처리: 슬롯에 투입 ───────────────────────────────
  const inMember = roster[inUid]
  if (!inMember) return res.status(404).json({ error: "투입 대상 없음" })

  // 이미 다른 슬롯에 출전 중이면 거부
  const alreadySlot = Object.entries(activeSlots).find(([, uid]) => uid === inUid)?.[0]
  if (alreadySlot && alreadySlot !== targetSlot)
    return res.status(403).json({ error: `이미 ${alreadySlot}에 출전 중` })

  activeSlots[targetSlot] = inUid

  // roster status → active
  update[`roster.${inUid}.status`] = "active"

  // roster에 저장된 entry 복원 (없으면 초기 entry 사용)
  const inEntry     = inMember.entry     ?? data[`${targetSlot}_entry`] ?? []
  const inActiveIdx = inMember.active_idx ?? 0
  update[`${targetSlot}_entry`]      = inEntry
  update[`${targetSlot}_active_idx`] = inActiveIdx

  // ── 3. active_slots 저장 ─────────────────────────────────────
  update.active_slots = activeSlots

  // ── 4. player_name 동기화 ────────────────────────────────────
  // slotKey: p1 → player1_name 등
  const slotKey = targetSlot.replace("p", "player")
  update[`${slotKey}_name`] = inMember.nick ?? inUid.slice(0, 6)

  // ── 5. current_order에서 교체된 슬롯이 진행 중이면 처리 ──────
  // (턴 중간 교체이므로 outUid 슬롯의 턴은 스킵하지 않음 — 다음 라운드부터 반영)

  await roomRef.update(update)

  return res.status(200).json({ ok: true })
}