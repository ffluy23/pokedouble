// api/raidSwitchPokemon.js
import { db } from "../lib/firestore.js"
import {
  executeBossAction,
  deepCopyEntries,
  dehydrateSlotData,
  hydrateSlotData,
  checkRaidWin,
} from "../lib/raidBossAction.js"
import { josa } from "../lib/effecthandler.js"
import { corsHeaders } from "../lib/gameUtils.js"

const PLAYER_SLOTS = ["p1", "p2", "p3"]

function defaultRanks() {
  return { atk: 0, atkTurns: 0, def: 0, defTurns: 0, spd: 0, spdTurns: 0 }
}

// ── 레거시 + roster 둘 다 저장 ────────────────────────────────────
function buildEntryUpdate(entries, data) {
  const update = {}
  // 레거시 최상위 필드
  PLAYER_SLOTS.forEach(s => { update[`${s}_entry`] = entries[s] })
  // roster 기반 저장 (있는 경우)
  if (data) {
    const rosterPatch = dehydrateSlotData(data, entries)
    Object.assign(update, rosterPatch)
  }
  return update
}

function resetOnSwitch(pkmn) {
  pkmn.lastRankMove   = null
  pkmn.rankStack      = 0
  if (pkmn.ranks) pkmn.ranks = defaultRanks()
  pkmn.rollState      = { active: false, turn: 0 }
  pkmn.bideState      = null
  pkmn.seeded         = false
  pkmn.defending      = false
  pkmn.defendTurns    = 0
  pkmn.aquaRing       = false
  pkmn.cursed         = false
  pkmn.futureSight    = null
  pkmn.healBlocked    = 0
  pkmn.throatChopped  = 0
  pkmn.tormented      = false
  pkmn.outrageState   = null
  pkmn.hyperBeamState = false
}

async function writeLogs(roomId, texts) {
  const logsRef = db.collection("raid").doc(roomId).collection("logs")
  const base    = Date.now()
  const batch   = db.batch()
  texts.forEach((text, i) => batch.set(logsRef.doc(), { type: "normal", text, ts: base + i }))
  await batch.commit()
}

async function runBossIfNext(roomId) {
  const snap = await db.collection("raid").doc(roomId).get()
  const freshData = snap.data()
  if (!freshData || freshData.game_over) return null
  const order = freshData.current_order ?? []
  if (order[0] !== "boss") return null
  const freshEntries = deepCopyEntries(freshData)
  return executeBossAction(roomId, freshData, freshEntries, order)
}

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId, mySlot, newIdx } = req.body
  if (!roomId || !mySlot || newIdx === undefined)
    return res.status(400).json({ error: "파라미터 부족" })

  const roomRef = db.collection("raid").doc(roomId)
  const snap    = await roomRef.get()
  const data    = snap.data()
  if (!data) return res.status(404).json({ error: "방 없음" })

  // hydrate: roster → p1_entry 등으로 펼치기 (레거시 호환)
  hydrateSlotData(data)

  const order     = data.current_order ?? []
  const activeIdx = data[`${mySlot}_active_idx`] ?? 0
  const entries   = deepCopyEntries(data)
  const prevPkmn  = entries[mySlot][activeIdx]
  const nextPkmn  = entries[mySlot][newIdx]

  const isFainted     = !prevPkmn || prevPkmn.hp <= 0
  const isForceSwitch = !!data[`force_switch_${mySlot}`]

  if (!isFainted && !isForceSwitch && order[0] !== mySlot)
    return res.status(403).json({ error: "내 턴이 아님" })

  if (!nextPkmn || nextPkmn.hp <= 0)
    return res.status(403).json({ error: "교체 대상 포켓몬이 없거나 기절 상태" })

  const myName = data[`${mySlot.replace("p", "player")}_name`]
    ?? data.roster?.[(data.active_slots ?? {})[mySlot]]?.nick
    ?? mySlot
  const prev = prevPkmn?.name ?? "?"
  const next = nextPkmn.name

  resetOnSwitch(prevPkmn)
  nextPkmn.seeded = false

  data[`${mySlot}_active_idx`] = newIdx

  const logs = [
    `돌아와, ${prev}!`,
    `${myName}${josa(myName, "은는")} ${next}${josa(next, "을를")} 내보냈다!`,
  ]

  // 치유소원 회복
  if (data[`${mySlot}_healWish`]) {
    const heal = Math.max(1, Math.floor((nextPkmn.maxHp ?? nextPkmn.hp) * 0.5))
    nextPkmn.hp = Math.min(nextPkmn.maxHp ?? nextPkmn.hp, nextPkmn.hp + heal)
    if (nextPkmn.status) {
      nextPkmn.status = null
      logs.push(`${nextPkmn.name}${josa(nextPkmn.name, "의")} 상태이상이 치유됐다!`)
    }
    logs.push(`${nextPkmn.name}${josa(nextPkmn.name, "은는")} 치유소원으로 HP를 회복했다! (+${heal})`)
    data[`${mySlot}_healWish`] = false
  }

  // ── 기절 교체 or 유턴 강제교체 ───────────────────────────────
  if (isFainted || isForceSwitch) {
    const newOrder = order
    const isEot    = newOrder.length === 0

    const update = {
  ...buildEntryUpdate(entries, data),
  [`${mySlot}_active_idx`]:   newIdx,
  [`force_switch_${mySlot}`]: false,
  [`${mySlot}_healWish`]:     false,
  current_order: newOrder,
  turn_count: data.turn_count ?? 1,
}

    PLAYER_SLOTS.forEach(s => {
      if (data[`${s}_active_idx`] !== undefined) update[`${s}_active_idx`] = data[`${s}_active_idx`]
    })
    update[`${mySlot}_active_idx`] = newIdx

    if (isEot) {
      const result = checkRaidWin(entries, data.boss_current_hp ?? 0, data)
      if (result) {
        update.game_over       = true
        update.raid_result     = result
        update.current_order   = []
        update.turn_started_at = null
      }
      update.boss_current_hp = data.boss_current_hp ?? 0
    }

    await writeLogs(roomId, logs)
    await roomRef.update(update)
    await runBossIfNext(roomId).catch(e => console.warn("보스 연속 처리 오류:", e.message))
    return res.status(200).json({ ok: true })
  }

  // ── 일반 교체: 턴 소모 ───────────────────────────────────────
  const newOrder = order.slice(1)
  const isEot    = newOrder.length === 0

  const update = {
    ...buildEntryUpdate(entries, data),     // ← roster + 레거시 둘 다
    [`${mySlot}_active_idx`]:   newIdx,
    [`force_switch_${mySlot}`]: false,
    [`${mySlot}_healWish`]:     false,
    current_order:   newOrder,
    turn_count:      (data.turn_count ?? 1) + 1,
    turn_started_at: newOrder.length > 0 ? Date.now() : null,
  }

  PLAYER_SLOTS.forEach(s => {
    if (data[`${s}_active_idx`] !== undefined) update[`${s}_active_idx`] = data[`${s}_active_idx`]
  })
  update[`${mySlot}_active_idx`] = newIdx

  if (isEot) {
    const result = checkRaidWin(entries, data.boss_current_hp ?? 0, data)
    if (result) {
      update.game_over       = true
      update.raid_result     = result
      update.current_order   = []
      update.turn_started_at = null
    }
    update.boss_current_hp = data.boss_current_hp ?? 0
  }

  await writeLogs(roomId, logs)
  await roomRef.update(update)
  await runBossIfNext(roomId).catch(e => console.warn("보스 연속 처리 오류:", e.message))

  const result = checkRaidWin(entries, data.boss_current_hp ?? 0, data)
  return res.status(200).json({ ok: true, ...(result ? { result } : {}) })
}