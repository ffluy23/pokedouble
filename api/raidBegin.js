// api/raidBegin.js
import { db } from "../lib/firestore.js"
import { corsHeaders } from "../lib/gameUtils.js"
import { getInitialState } from "../lib/bosses/catastrophe.js"

const PLAYER_SLOTS = ["p1", "p2", "p3"]

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId } = req.body
  if (!roomId) return res.status(400).json({ error: "roomId 필요" })

  const roomRef = db.collection("raid").doc(roomId)

  try {
    const snap = await roomRef.get()
    const data = snap.data()
    if (!data)              return res.status(404).json({ error: "방 없음" })
    if (data.game_started)  return res.status(200).json({ ok: true, already: true })
    if (data.game_over)     return res.status(400).json({ error: "게임 종료됨" })

    // ── 모든 entry 확인 — 최대 10초 대기 ────────────────────────
    let allEntryReady = false
    for (let i = 0; i < 20; i++) {
      const freshSnap = await roomRef.get()
      const freshData = freshSnap.data()
      allEntryReady = PLAYER_SLOTS.every(s =>
        Array.isArray(freshData[`${s}_entry`]) && freshData[`${s}_entry`].length > 0
      )
      if (allEntryReady) { Object.assign(data, freshData); break }
      await new Promise(r => setTimeout(r, 500))
    }
    if (!allEntryReady) return res.status(400).json({ error: "entry 미완료 (타임아웃)" })

    // ── 보스 데이터 로드 ─────────────────────────────────────────
    const bossId = data.boss_id ?? null
    if (!bossId) return res.status(400).json({ error: "보스 미선택" })

    const bossSnap = await db.collection("boss").doc(bossId).get()
    const bossData = bossSnap.data()
    if (!bossData) return res.status(400).json({ error: "보스 데이터 없음" })

    // ── boss_state 초기화 (보스별 분기) ─────────────────────────
    let bossState = {}
    if (bossData.boss_name === "누클라바스") {
      const init = getInitialState()
      const coreData = {}
      const coreHp   = {}
      ;(bossData.core ?? []).forEach(c => {
        coreData[c.id] = {
          name:    c.name,
          hp:      c.hp,
          type:    c.type,
          attack:  c.attack,
          defense: c.defense,
          speed:   c.speed,
          moves:   c.moves,
        }
        coreHp[c.id] = c.hp
      })
      bossState = {
        ...init,
        coreData,
        coreHp,
        partHp: {
          eye:  bossData.eyehp  ?? 500,
          wing: bossData.winghp ?? 500,
          tail: bossData.tailhp ?? 500,
          claw: bossData.clawhp ?? 500,
        },
      }
    } else {
      bossState = { phase1Step: "bite", repeatLeft: 0 }
    }

    // ── roster / active_slots 생성 ───────────────────────────────
    const roster      = {}
    const activeSlots = {}

    PLAYER_SLOTS.forEach((slot, i) => {
      const legacyKey = `player${i + 1}`
      const uid  = data[`${legacyKey}_uid`]
      const nick = data[`${legacyKey}_name`] ?? uid?.slice(0, 6) ?? "?"
      if (!uid) return
      roster[uid] = {
        status:     "active",
        nick,
        role:       i === 0 ? "admin" : null,
        entry:      JSON.parse(JSON.stringify(data[`${slot}_entry`] ?? [])),
        active_idx: data[`${slot}_active_idx`] ?? 0,
      }
      activeSlots[slot] = uid
    })

    ;(data.spectators ?? []).forEach((uid, i) => {
      const nick = (data.spectator_names ?? [])[i] ?? uid.slice(0, 6)
      roster[uid] = {
        status: "spectator",
        nick,
        role:   null,
        entry:  [],
        active_idx: 0,
      }
    })

    // ── Firestore 업데이트 ───────────────────────────────────────
    await roomRef.update({
      boss_name:         bossData.boss_name ?? bossId,
      boss_current_hp:   bossData.hp        ?? 1000,
      boss_max_hp:       bossData.hp        ?? 1000,
      boss_attack:       bossData.attack    ?? 5,
      boss_defense:      bossData.defense   ?? 5,
      boss_speed:        bossData.speed     ?? 5,
      boss_type:         bossData.type      ?? ["노말"],
      boss_moves:        bossData.moves     ?? [],
      boss_ult:          bossData.ult       ?? [],
      boss_portrait_url: bossData.portrait  ?? null,
      boss_status:       null,
      boss_rank:         { atk:0, atkTurns:0, def:0, defTurns:0, spd:0, spdTurns:0 },
      boss_volatile:     {},
      boss_state:        bossState,
      boss_last_move:    null,
      boss_last_attacker: null,
      boss_ult_cooldown:  0,
      game_started:      true,
      game_started_at:   Date.now(),
      round_count:       0,
      turn_count:        0,
      current_order:     [],
      roster,
      active_slots:      activeSlots,
    })

    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error("raidBegin error:", e)
    return res.status(500).json({ error: e.message })
  }
}