// api/raidStartRound.js
import { db } from "../lib/firestore.js"
import { rollD10, corsHeaders } from "../lib/gameUtils.js"
import { josa } from "../lib/effecthandler.js"
import { executeBossAction, deepCopyEntries as deepCopyRaidEntries2, hydrateSlotData } from "../lib/raidBossAction.js"


const PLAYER_SLOTS = ["p1", "p2", "p3"]

// ── 레거시 방(active_slots 비어있음) 호환 패치 ───────────────────────
// - roster에 유효한 entry가 있으면 절대 덮어쓰지 않음 (교체/데미지 반영값 보존)
// - roster entry가 없을 때만 p1_entry 최상위 필드로 초기화
function patchLegacySlots(data) {
  const activeSlots = data.active_slots ?? {}
  const hasActiveSlots = Object.values(activeSlots).some(v => !!v)
  if (hasActiveSlots) return

  const SLOT_MAP = { p1: "player1", p2: "player2", p3: "player3" }
  for (const [slot, playerKey] of Object.entries(SLOT_MAP)) {
    const uid = data[`${playerKey}_uid`]
    if (!uid) continue

    data.active_slots = data.active_slots ?? {}
    data.active_slots[slot] = uid
    data.roster = data.roster ?? {}

    // roster에 이미 유효한 entry가 있으면 entry는 건드리지 않음
    if (data.roster[uid]?.entry?.length > 0) {
      data.roster[uid] = {
        ...data.roster[uid],
        status: "active",
        slot,
        nick: (data[`${playerKey}_name`] ?? uid).split("]").pop().trim(),
      }
      continue
    }

    // entry가 없을 때만 p1_entry로 초기화
    const entry = data[`${slot}_entry`]
    if (!entry) continue
    data.roster[uid] = {
      ...(data.roster[uid] ?? {}),
      entry:      JSON.parse(JSON.stringify(entry)),
      active_idx: data[`${slot}_active_idx`] ?? 0,
      status:     "active",
      slot,
      nick:       (data[`${playerKey}_name`] ?? uid).split("]").pop().trim(),
    }
  }
}

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId, mySlot } = req.body
  if (!roomId || !mySlot) return res.status(400).json({ error: "roomId/mySlot 필요" })

  const roomRef = db.collection("raid").doc(roomId)
  const logsRef = db.collection("raid").doc(roomId).collection("logs")

  try {
    const result = await db.runTransaction(async tx => {
      const snap = await tx.get(roomRef)
      const data = snap.data()
      console.log("[DEBUG]", JSON.stringify({
        game_started:    data.game_started,
        game_over:       data.game_over,
        active_slots:    data.active_slots,
        boss_current_hp: data.boss_current_hp,
      }))
      if (!data)              return { ok: false, reason: "no_data" }
      if (!data.game_started) return { ok: false, reason: "not_started" }
      if (data.game_over)     return { ok: false, reason: "game_over" }
      if ((data.current_order ?? []).length > 0) return { ok: false, reason: "already_started" }

      patchLegacySlots(data)
      hydrateSlotData(data)

      const bossHp    = data.boss_current_hp ?? 0
      const bossMaxHp = data.boss_max_hp     ?? 1
      const isPhase2  = bossHp / bossMaxHp <= 0.7
      const alwaysFirst = data.boss_name === "누클라바스"

      const activeSlots = PLAYER_SLOTS.filter(s => {
        if (data.active_slots && !data.active_slots[s]) return false
        return (data[`${s}_entry`] ?? []).some(p => p.hp > 0)
      })

      console.log("[DEBUG] activeSlots:", activeSlots)

      const bossAlive = bossHp > 0
      if (activeSlots.length === 0 && !bossAlive) return { ok: false, reason: "no_active_slots" }

      const allSlots = bossAlive ? [...activeSlots, "boss"] : activeSlots

      const rolls  = {}
      const scores = {}

      activeSlots.forEach(s => {
        const idx  = data[`${s}_active_idx`] ?? 0
        const pkmn = data[`${s}_entry`]?.[idx]
        const spd  = (pkmn?.hp ?? 0) > 0 ? (pkmn?.speed ?? 3) : 0
        rolls[s]   = rollD10()
        scores[s]  = spd + rolls[s]
      })

      if (bossAlive) {
        rolls["boss"]  = rollD10()
        scores["boss"] = (data.boss_speed ?? 5) + rolls["boss"]
      }

      let order = [...allSlots].sort((a, b) => {
        const diff = scores[b] - scores[a]
        return diff !== 0 ? diff : (Math.random() < 0.5 ? -1 : 1)
      })

      if ((isPhase2 || alwaysFirst) && bossAlive) {
        order = ["boss", ...order.filter(s => s !== "boss")]
      }

      const ultCooldown     = data.boss_ult_cooldown ?? 0
      const nextUltCooldown = Math.max(0, ultCooldown - 1)
      const roundNum        = (data.round_count ?? 0) + 1

      tx.update(roomRef, {
        round_count:       roundNum,
        current_order:     order,
        turn_started_at:   Date.now(),
        boss_ult_cooldown: nextUltCooldown,
        dice_event: { type: "all", rolls, order, slots: allSlots, ts: Date.now() }
      })

      return { ok: true, order, rolls, roundNum, isPhase2, alwaysFirst, data }
    })

    if (!result.ok) return res.status(200).json(result)

    const { order, rolls, roundNum, isPhase2, alwaysFirst, data } = result
    const bossName = data.boss_name ?? "보스"

    const orderStr = order.map(s => {
      if (s === "boss") return `${bossName}`
      const idx    = data[`${s}_active_idx`] ?? 0
      const pkmn   = data[`${s}_entry`]?.[idx]
      const uid    = (data.active_slots ?? {})[s]
      const player = (data[`${s.replace("p", "player")}_name`]
        ?? data.roster?.[uid]?.nick
        ?? s).split("]").pop().trim()
      return `${pkmn?.name ?? s}(${player})`
    }).join(" → ")

    const firstSlot = order[0]
    let firstName, firstPkmnName
    if (firstSlot === "boss") {
      firstName     = bossName
      firstPkmnName = bossName
    } else {
      const firstIdx  = data[`${firstSlot}_active_idx`] ?? 0
      const firstPkmn = data[`${firstSlot}_entry`]?.[firstIdx]
      const uid       = (data.active_slots ?? {})[firstSlot]
      firstName     = (data[`${firstSlot.replace("p", "player")}_name`]
        ?? data.roster?.[uid]?.nick
        ?? firstSlot).split("]").pop().trim()
      firstPkmnName = firstPkmn?.name ?? firstSlot
    }

    const base  = Date.now()
    const batch = db.batch()
    const logEntries = [
      { type: "normal", text: `── ROUND ${roundNum} ──`, ts: base },
      ...(alwaysFirst && order[0] === "boss"
        ? []
        : isPhase2 && order[0] === "boss"
          ? [{ type: "normal", text: `${bossName}${josa(bossName, "이가")} 선공을 빼앗았다!`, ts: base + 1 }]
          : []
      ),
      { type: "normal", text: `순서: ${orderStr}`,                       ts: base + 2 },
      { type: "normal", text: `${firstPkmnName}의 선공! (${firstName})`, ts: base + 3 },
    ]
    logEntries.forEach(entry => batch.set(logsRef.doc(), entry))
    await batch.commit()

    const { data: _d, ...safeResult } = result

    if (result.order?.[0] === "boss") {
      const snap2     = await db.collection("raid").doc(roomId).get()
      const freshData = snap2.data()

      if (freshData && !freshData.game_over) {
        patchLegacySlots(freshData)
        const freshEntries = deepCopyRaidEntries2(freshData)
        await executeBossAction(roomId, freshData, freshEntries, freshData.current_order ?? [])
          .catch(e => console.warn("보스 선공 처리 오류:", e.message))
      }
    }

    return res.status(200).json(safeResult)

  } catch (e) {
    console.error("raidStartRound error:", e)
    return res.status(500).json({ error: e.message })
  }
}