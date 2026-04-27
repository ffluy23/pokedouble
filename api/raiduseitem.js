// api/raidUseItem.js
import { db } from "../lib/firestore.js"
import { corsHeaders } from "../lib/gameUtils.js"
import { josa } from "../lib/effecthandler.js"
import {
  executeBossAction,
  deepCopyEntries,
  dehydrateSlotData,
  hydrateSlotData,
  checkRaidWin,
} from "../lib/raidBossAction.js"

const PLAYER_SLOTS = ["p1", "p2", "p3"]

export const ITEMS = {
  "회복약": {
    name: "회복약",
    desc: "모든 상태이상을 없애고 HP를 완전히 회복한다.",
    canUse: (pkmn) => pkmn.hp > 0,
    apply: (pkmn) => {
      pkmn.hp        = pkmn.maxHp ?? pkmn.hp
      pkmn.status    = null
      pkmn.confusion = 0
    },
    logText: (pkmnName) =>
      `${pkmnName}${josa(pkmnName, "의")} 상태이상이 사라지고 HP가 완전히 회복됐다!`,
  },
  "기력의덩어리": {
    name: "기력의덩어리",
    desc: "기절한 포켓몬을 HP 가득 채워서 부활시킨다.",
    canUse: (pkmn) => pkmn.hp <= 0,
    apply: (pkmn) => {
      pkmn.hp     = pkmn.maxHp ?? 1
      pkmn.status = null
    },
    logText: (pkmnName) =>
      `${pkmnName}${josa(pkmnName, "은는")} 기력의덩어리로 부활했다!`,
  },
}

function makeLog(type, text = "", meta = null) {
  return { type, text, ...(meta ? { meta } : {}) }
}

async function writeLogs(roomId, logEntries) {
  const logsRef = db.collection("raid").doc(roomId).collection("logs")
  const base    = Date.now()
  const batch   = db.batch()
  logEntries.forEach((entry, i) => batch.set(logsRef.doc(), { ...entry, ts: base + i }))
  await batch.commit()
}

// 레거시 + roster 둘 다 저장
function buildEntryUpdate(entries, data) {
  const update = {}
  PLAYER_SLOTS.forEach(s => { update[`${s}_entry`] = entries[s] })
  if (data) Object.assign(update, dehydrateSlotData(data, entries))
  return update
}

async function runBossIfNext(roomId) {
  const snap      = await db.collection("raid").doc(roomId).get()
  const freshData = snap.data()
  if (!freshData || freshData.game_over) return
  const order = freshData.current_order ?? []
  if (order[0] !== "boss") return
  const freshEntries = deepCopyEntries(freshData)
  return executeBossAction(roomId, freshData, freshEntries, order)
}

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId, mySlot, itemName, targetIdx } = req.body
  if (!roomId || !mySlot || !itemName || targetIdx === undefined)
    return res.status(400).json({ error: "파라미터 부족" })

  const itemDef = ITEMS[itemName]
  if (!itemDef) return res.status(400).json({ error: "존재하지 않는 아이템" })

  const roomRef = db.collection("raid").doc(roomId)
  const snap    = await roomRef.get()
  const data    = snap.data()
  if (!data) return res.status(404).json({ error: "방 없음" })

  // hydrate: roster → p1_entry 등으로 펼치기
  hydrateSlotData(data)

  const order = data.current_order ?? []
  if (order[0] !== mySlot)
    return res.status(403).json({ error: "내 턴이 아님" })

  const inventory = data.inventory ?? {}
  const itemCount = inventory[itemName] ?? 0
  if (itemCount <= 0)
    return res.status(403).json({ error: "아이템이 없음" })

  const entries = deepCopyEntries(data)
  const target  = entries[mySlot][targetIdx]
  if (!target)
    return res.status(400).json({ error: "대상 포켓몬 없음" })

  if (!itemDef.canUse(target))
    return res.status(403).json({ error: `${itemName}을(를) 이 포켓몬에게 사용할 수 없음` })

  itemDef.apply(target)

  const playerName = data[`${mySlot.replace("p", "player")}_name`]
    ?? data.roster?.[(data.active_slots ?? {})[mySlot]]?.nick
    ?? mySlot

  const logEntries = [
    makeLog("normal", `${playerName}${josa(playerName, "은는")} ${itemName}을(를) 사용했다!`),
    makeLog("hp", itemDef.logText(target.name), {
      slot:  mySlot,
      hp:    target.hp,
      maxHp: target.maxHp,
    }),
  ]
  if (itemDef.name === "기력의덩어리") {
    logEntries.push(makeLog("revive", `${target.name}${josa(target.name, "은는")} 다시 싸울 수 있다!`, { slot: mySlot, pkmnIdx: targetIdx }))
  }

  await writeLogs(roomId, logEntries)

  const newInventory = { ...inventory, [itemName]: itemCount - 1 }
  const newOrder     = order.slice(1)

  const update = {
    ...buildEntryUpdate(entries, data),   // 레거시 + roster 둘 다
    inventory:       newInventory,
    current_order:   newOrder,
    turn_count:      (data.turn_count ?? 1) + 1,
    turn_started_at: newOrder.length > 0 ? Date.now() : null,
  }

  PLAYER_SLOTS.forEach(s => {
    if (data[`${s}_active_idx`] !== undefined)
      update[`${s}_active_idx`] = data[`${s}_active_idx`]
  })

  const result = checkRaidWin(entries, data.boss_current_hp ?? 0, data)
  if (result) {
    update.game_over       = true
    update.raid_result     = result
    update.current_order   = []
    update.turn_started_at = null
  }

  await roomRef.update(update)

  if (!result) {
    await runBossIfNext(roomId).catch(e => console.warn("보스 연속 처리 오류:", e.message))
  }

  return res.status(200).json({ ok: true, ...(result ? { result } : {}) })
}