// lib/raidBossAction.js
// 보스 턴 처리 공통 로직
// [40인 레이드 지원] roster 기반 슬롯 추상화 적용

import { db } from "./firestore.js"
import { bossMoves } from "./bossMoves.js"
import { moves } from "./moves.js"
import { getTypeMultiplier } from "./typeChart.js"
import { josa } from "./effecthandler.js"
import { rollD10 } from "./gameUtils.js"
import { getBossAI } from "./bossRegistry.js"
import { activateUmbreon } from "./umbreon.js"
import { getWeatherDamageMult } from "./weather.js"
import { processNuriCommand } from "./nuricommands.js"
import { getDealCheckLog } from "./bosses/garbodor.js"
import { processDelphoxCommand, checkPhase3Enter, processDelphoxEot, checkTrickeryRedirect } from "./bosses/delphox.js"
import { processZoroarkCommand, checkPhase2Enter as zoroarkP2, checkPhase3Enter as zoroarkP3, processZoroarkEot } from "./bosses/zoroark.js"
import { processNinjaskEot } from "./bosses/ninjask.js"
import {
  getPartLabel, getPartSlotKey, getCoreDestroyLog,
  checkPhase2Enter as catastroP2,
  checkPhase3Enter as catastroP3,
  checkPhase4Enter as catastroP4,
  getUltAfterLogs, getResonancePlayerLog, getResonanceFireLog,
  PHASE4_INTRO_LOGS,
} from "./bosses/catastrophe.js"


export const PLAYER_SLOTS = ["p1", "p2", "p3"]

// ════════════════════════════════════════════════════════════════════
//  [40인 레이드] Roster 추상화 레이어
//
//  Firestore에는 이제 roster 맵과 active_slots이 존재:
//    data.roster = { uid: { entry, active_idx, status, slot, ... } }
//    data.active_slots = { p1: uid, p2: uid, p3: uid }
//
//  raidBossAction 내부 로직은 기존처럼 p1_entry / p1_active_idx를 씀.
//  진입 시 hydrate → 처리 → 퇴장 시 dehydrate로 호환성 유지.
// ════════════════════════════════════════════════════════════════════

/**
 * active_slots + roster → 기존 p1_entry / p1_active_idx 필드로 펼쳐줌.
 * executeBossAction / executeMoveAction 진입 직후 딱 한 번 호출.
 */
export function hydrateSlotData(data) {
  const slots  = data.active_slots ?? {}
  const roster = data.roster       ?? {}
  for (const slot of PLAYER_SLOTS) {
    const uid    = slots[slot]
    const member = uid ? roster[uid] : null
    if (member) {
      data[`${slot}_entry`]      = JSON.parse(JSON.stringify(member.entry      ?? []))
      data[`${slot}_active_idx`] = member.active_idx ?? 0
    } else {
      // 슬롯이 비어있으면 빈 배열로 (getAlivePlayers에서 자연스럽게 스킵됨)
      data[`${slot}_entry`]      = []
      data[`${slot}_active_idx`] = 0
    }
  }
  return data
}

/**
 * 처리 완료된 entries / active_idx → roster 업데이트 객체로 변환.
 * Firestore update()에 spread해서 사용.
 * 
 * 반환 형태:
 *   { "roster.{uid}.entry": [...], "roster.{uid}.active_idx": 0, ... }
 */
export function dehydrateSlotData(data, entries) {
  const slots       = data.active_slots ?? {}
  const rosterPatch = {}
  for (const slot of PLAYER_SLOTS) {
    const uid = slots[slot]
    if (!uid) continue
    rosterPatch[`roster.${uid}.entry`]      = entries[slot] ?? []
    rosterPatch[`roster.${uid}.active_idx`] = data[`${slot}_active_idx`] ?? 0
  }
  return rosterPatch
}

/**
 * active_slots에서 uid → slot 역방향 조회.
 */
export function getSlotByUid(data, uid) {
  const slots = data.active_slots ?? {}
  for (const [slot, slotUid] of Object.entries(slots)) {
    if (slotUid === uid) return slot
  }
  return null
}

/**
 * 슬롯에 해당하는 uid 조회.
 */
export function getUidBySlot(data, slot) {
  return (data.active_slots ?? {})[slot] ?? null
}

// ════════════════════════════════════════════════════════════════════
//  기존 헬퍼 (변경 없음 — hydrate 이후엔 p1_entry 등이 정상 존재)
// ════════════════════════════════════════════════════════════════════

export function makeLog(type, text = "", meta = null) {
  return { type, text, ...(meta ? { meta } : {}) }
}

export async function writeLogs(roomId, logEntries) {
  const logsRef = db.collection("raid").doc(roomId).collection("logs")
  const base    = Date.now()
  const batch   = db.batch()
  logEntries.forEach((entry, i) => batch.set(logsRef.doc(), { ...entry, ts: base + i }))
  await batch.commit()
}

export function defaultRanks() {
  return { atk: 0, atkTurns: 0, def: 0, defTurns: 0, spd: 0, spdTurns: 0 }
}

export function getActiveRankVal(ranks, key) {
  return (ranks?.[`${key}Turns`] ?? 0) > 0 ? (ranks?.[key] ?? 0) : 0
}

export function deepCopyEntries(data) {
  const entries = {}
  PLAYER_SLOTS.forEach(s => {
    entries[s] = JSON.parse(JSON.stringify(data[`${s}_entry`] ?? []))
  })
  return entries
}

/**
 * buildEntryUpdate: roster 기반으로 변경.
 * dehydrateSlotData를 래핑하는 형태.
 * raidBossAction 내부에서 기존처럼 호출 가능.
 */
export function buildEntryUpdate(entries, data) {
  // data가 전달된 경우(신규 호출) → roster patch 반환
  if (data) return dehydrateSlotData(data, entries)

  // data 없이 호출된 레거시 경로 — 이 경우 호출부에서 data 전달하도록 마이그레이션 필요
  console.warn("[buildEntryUpdate] data 인자 없이 호출됨. 레거시 경로.")
  const update = {}
  PLAYER_SLOTS.forEach(s => { update[`${s}_entry`] = entries[s] })
  return update
}

export function getAlivePlayers(data, entries) {
  return PLAYER_SLOTS.filter(s => {
    const uid  = (data.active_slots ?? {})[s]
    if (!uid) return false                          // 슬롯이 비어있으면 제외
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0
  })
}

export function checkRaidWin(entries, bossHp, data) {
  if (bossHp <= 0) return "victory"
  // active_slots가 있으면 출전 중인 슬롯만 체크
  const slots = data ? (data.active_slots ?? {}) : null
  const allDead = PLAYER_SLOTS.every(s => {
    if (slots && !slots[s]) return true            // 빈 슬롯은 "죽은 것"으로 취급
    return (entries[s] ?? []).every(p => p.hp <= 0)
  })
  if (allDead) return "defeat"
  return null
}

function getBossAtk(data) {
  const base = data.boss_attack ?? 5
  const rank = getActiveRankVal(data.boss_rank, "atk")
  return base + rank
}

function calcBossDamage(data, moveName, targetPkmn, diceOverride = null, powerOverride = null) {
  const moveInfo = bossMoves[moveName] ?? moves[moveName]
  if (!moveInfo) return { damage: 0, multiplier: 1, critical: false, dice: 0 }

  const dice     = diceOverride ?? rollD10()
  const defTypes = Array.isArray(targetPkmn.type) ? targetPkmn.type : [targetPkmn.type]
  let mult = 1
  for (const dt of defTypes) mult *= getTypeMultiplier(moveInfo.type, dt)
  if (mult === 0) return { damage: 0, multiplier: 0, critical: false, dice }

  const bossAtk  = getBossAtk(data)
  const defStat  = targetPkmn.defense ?? 3
  const defRank  = getActiveRankVal(targetPkmn.ranks, "def")
  const power    = powerOverride ?? moveInfo.power ?? 40
  const base     = power + bossAtk * 4 + dice
  const weatherMult = getWeatherDamageMult(data.weather ?? null, moveInfo.type)
  const raw         = Math.floor(base * mult * weatherMult)
  const afterDef = Math.max(1, raw - defStat * 3 - defRank * 3)
  const lightScreenMult = (data.boss_lightScreen ?? 0) > 0 ? 0.75 : 1.0
  const finalAfterDef   = Math.floor(afterDef * lightScreenMult)
  const critRate = Math.min(100, bossAtk * 2)
  const critical = Math.random() * 100 < critRate
  return { damage: critical ? Math.floor(finalAfterDef * 1.5) : finalAfterDef, multiplier: mult, critical, dice }
}

function calcBeedrilDamage(data, beedrill, moveName, targetPkmn, diceOverride = null) {
  const moveInfo = bossMoves[moveName] ?? moves[moveName]
  if (!moveInfo) return { damage: 0, multiplier: 1, critical: false, dice: 0 }

  const dice     = diceOverride ?? rollD10()
  const defTypes = Array.isArray(targetPkmn.type) ? targetPkmn.type : [targetPkmn.type]
  let mult = 1
  for (const dt of defTypes) mult *= getTypeMultiplier(moveInfo.type, dt)
  if (mult === 0) return { damage: 0, multiplier: 0, critical: false, dice }

  const beeAtk   = (beedrill.attack ?? 3) + getActiveRankVal(beedrill.ranks, "atk")
  const defStat  = targetPkmn.defense ?? 3
  const defRank  = getActiveRankVal(targetPkmn.ranks, "def")
  const power    = powerOverride ?? moveInfo.power ?? 40
  const base     = power + beeAtk * 4 + dice
  const weatherMult = getWeatherDamageMult(data.weather ?? null, moveInfo.type)
  const raw         = Math.floor(base * mult * weatherMult)
  const afterDef = Math.max(1, raw - defStat * 3 - defRank * 3)
  const lightScreenMult = (data.boss_lightScreen ?? 0) > 0 ? 0.75 : 1.0
  const finalAfterDef   = Math.floor(afterDef * lightScreenMult)
  const critRate = Math.min(100, beeAtk * 2)
  const critical = Math.random() * 100 < critRate
  return { damage: critical ? Math.floor(finalAfterDef * 1.5) : finalAfterDef, multiplier: mult, critical, dice }
}

function applySyncDistribution(rawDamage, targetSlot, data, entries, logEntries, isAoe = false) {
  if (!data.sync_active) return { damages: { [targetSlot]: rawDamage }, clearSync: false }

  const alivePlayers = getAlivePlayers(data, entries)
  if (alivePlayers.length <= 1) return { damages: { [targetSlot]: rawDamage }, clearSync: true }

  const damages = {}
  if (isAoe) {
    const reduced = Math.max(1, Math.floor(rawDamage * 0.75))
    alivePlayers.forEach(s => { damages[s] = reduced })
    logEntries.push(makeLog("sync", ""))
    logEntries.push(makeLog("after_hit", `💠 싱크로나이즈! 광역 공격을 ${alivePlayers.length}명이 함께 버텼다! (×0.75)`))
  } else {
    const share = Math.max(1, Math.floor(rawDamage / alivePlayers.length))
    alivePlayers.forEach(s => { damages[s] = share })
    logEntries.push(makeLog("sync", ""))
    logEntries.push(makeLog("after_hit", `💠 싱크로나이즈! ${alivePlayers.length}명이 데미지를 균등 분산! (각 ${share})`))
  }
  data.sync_used = true
  return { damages, clearSync: true }
}

function applyDamagesToPlayers(damages, entries, data, logEntries) {
  for (const [slot, dmg] of Object.entries(damages)) {
    if (dmg <= 0) continue
    const idx  = data[`${slot}_active_idx`] ?? 0
    const pkmn = entries[slot]?.[idx]
    if (!pkmn || pkmn.hp <= 0) continue
    if (pkmn.defending) {
      logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "은는")} 방어했다!`))
      pkmn.defending = false
      pkmn.defendTurns = 0
      continue
    }
    if (pkmn.enduring && dmg >= pkmn.hp) {
      pkmn.hp = 1; pkmn.enduring = false
      logEntries.push(makeLog("after_hit", `${pkmn.name}${josa(pkmn.name, "은는")} 버텼다!`))
    } else {
      pkmn.hp = Math.max(0, pkmn.hp - dmg)
      pkmn.tookDamageLastTurn = true
    }
    pkmn.last_damage_taken = dmg
    pkmn.defending = false; pkmn.defendTurns = 0
    logEntries.push(makeLog("hit", "", { defender: slot }))
    logEntries.push(makeLog("hp",  "", { slot, hp: pkmn.hp, maxHp: pkmn.maxHp }))
    if (pkmn.hp <= 0) logEntries.push(makeLog("faint", `${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`, { slot }))
    if (pkmn.bideState) {
      pkmn.bideState.damage = (pkmn.bideState.damage ?? 0) + dmg
      pkmn.bideState.lastAttackerSlot = "boss"
    }
  }
}

function getTauntSelfTarget(data, entries) {
  const taunters = PLAYER_SLOTS.filter(s => {
    if (!(data.active_slots ?? {})[s]) return false
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0 && (pkmn.tauntSelfTurns ?? 0) > 0
  })
  if (taunters.length === 0) return null
  return taunters[Math.floor(Math.random() * taunters.length)]
}

function logTauntRedirect(tauntTarget, originalTarget, data, entries, logEntries) {
  if (!tauntTarget || tauntTarget === originalTarget) return
  const pkmn = entries[tauntTarget]?.[data[`${tauntTarget}_active_idx`] ?? 0]
  const name = pkmn?.name ?? "포켓몬"
  logEntries.push(makeLog("normal", `${name}에게 시선이 집중되었다!`))
}

function processBossSelfHeal(moveName, data, logEntries, bossName) {
  const moveInfo = bossMoves[moveName] ?? moves[moveName]
  if (!moveInfo?.effect?.heal) return
  const healRatio = moveInfo.effect.heal
  const maxHp     = data.boss_max_hp ?? 1
  const healAmt   = Math.max(1, Math.floor(maxHp * healRatio))
  data.boss_current_hp = Math.min(maxHp, (data.boss_current_hp ?? 0) + healAmt)
  logEntries.push(makeLog("hp", "", { slot: "boss", hp: data.boss_current_hp, maxHp }))
  logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} ${healAmt} HP를 회복했다!`))
}

const CORRUPTION_THRESHOLD = 500

function applyCorruption(targetSlot, data, entries, logEntries) {
  const idx  = data[`${targetSlot}_active_idx`] ?? 0
  const pkmn = entries[targetSlot]?.[idx]
  if (!pkmn || pkmn.hp <= 0) return
  const tName = pkmn.name
  pkmn.corrupted = true
  logEntries.push(makeLog("normal", `${tName}${josa(tName, "은는")} 오염되었다!`))
  if (!data.boss_state?.corruptedSlot) {
    data.boss_state = { ...(data.boss_state ?? {}), corruptedSlot: targetSlot, dealCheckDmg: 0 }
  }
}

function processCorruptionBlast(targetSlot, data, entries, logEntries) {
  const state      = data.boss_state ?? {}
  const realTarget = targetSlot ?? state.corruptedSlot
  const dmgSoFar   = state.dealCheckDmg ?? 0

  if (dmgSoFar >= CORRUPTION_THRESHOLD) {
    logEntries.push(makeLog("normal", "오염이 흩어졌다! 부식이 사라졌다!"))
    logEntries.push(makeLog("normal", "더스트나의 오염이 약화되었다!"))
    logEntries.push(makeLog("normal", "부식이 제거되었다!"))
    if (realTarget) {
      const idx  = data[`${realTarget}_active_idx`] ?? 0
      const pkmn = entries[realTarget]?.[idx]
      if (pkmn) pkmn.corrupted = false
    }
    data.boss_state = { ...state, corruptedSlot: null, dealCheckDmg: 0 }
    return
  }

  if (!realTarget) {
    logEntries.push(makeLog("normal", "부식 대상이 없다!"))
    data.boss_state = { ...state, corruptedSlot: null, dealCheckDmg: 0 }
    return
  }

  const idx  = data[`${realTarget}_active_idx`] ?? 0
  const pkmn = entries[realTarget]?.[idx]
  if (!pkmn) { data.boss_state = { ...state, corruptedSlot: null, dealCheckDmg: 0 }; return }

  const tName = pkmn.name ?? "????"
  logEntries.push(makeLog("normal", `${tName}${josa(tName, "의")} 부식이 폭발했다!`))

  const BLAST_POWER = 70
  const defTypes    = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
  let mult = 1
  for (const dt of defTypes) mult *= getTypeMultiplier("독", dt)

  if (mult === 0) {
    logEntries.push(makeLog("normal", `${tName}에게는 효과가 없다…`))
  } else {
    const defStat  = pkmn.defense ?? 3
    const defRank  = getActiveRankVal(pkmn.ranks ?? {}, "def")
    const raw      = Math.floor(BLAST_POWER * mult)
    const damage   = Math.max(1, raw - defStat * 3 - defRank * 3)
    if (mult > 1) logEntries.push(makeLog("after_hit", "효과가 굉장했다!"))
    if (mult < 1) logEntries.push(makeLog("after_hit", "효과가 별로인 듯하다…"))
    if (pkmn.enduring && damage >= pkmn.hp) {
      pkmn.hp = 1; pkmn.enduring = false
      logEntries.push(makeLog("after_hit", `${tName}${josa(tName, "은는")} 버텼다!`))
    } else {
      pkmn.hp = Math.max(0, pkmn.hp - damage)
    }
    pkmn.tookDamageLastTurn = true
    logEntries.push(makeLog("hit", "", { defender: realTarget }))
    logEntries.push(makeLog("hp",  "", { slot: realTarget, hp: pkmn.hp, maxHp: pkmn.maxHp }))
    if (pkmn.hp <= 0) logEntries.push(makeLog("faint", `${tName}${josa(tName, "은는")} 쓰러졌다!`, { slot: realTarget }))
  }

  if (pkmn) pkmn.corrupted = false
  data.boss_state = { ...state, corruptedSlot: null, dealCheckDmg: 0, corruptionExploded: true }
}

function processBossAttack(moveName, targetSlot, isAoe, data, entries, logEntries, bossName) {
  const moveInfo = bossMoves[moveName] ?? moves[moveName]

  if (moveInfo?.targetSelf) {
    processBossSelfHeal(moveName, data, logEntries, bossName)
    return
  }

  if (moveInfo?.effect?.corrosion) {
    logEntries.push(makeLog("move_announce", `${bossName}${josa(bossName, "의")} ${moveName}!`))
    if (targetSlot) applyCorruption(targetSlot, data, entries, logEntries)
    return
  }

  const dice = rollD10()
  logEntries.push(makeLog("move_announce", `${bossName}${josa(bossName, "의")} ${moveName}!`))

  if (isAoe) {
    const alive = getAlivePlayers(data, entries)
    if (alive.length === 0) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); return }
    const wideGuarded = alive.some(s => {
      const idx = data[`${s}_active_idx`] ?? 0
      return entries[s]?.[idx]?.wideGuard
    })
    if (wideGuarded) {
      logEntries.push(makeLog("normal", "와이드가드! 동료를 지켜냈다!"))
      alive.forEach(s => {
        const pkmn = entries[s]?.[data[`${s}_active_idx`] ?? 0]
        if (pkmn) pkmn.wideGuard = false
      })
      return
    }
    const repIdx  = data[`${alive[0]}_active_idx`] ?? 0
    const repPkmn = entries[alive[0]]?.[repIdx]
    const { damage: rawDmg, multiplier, critical } = calcBossDamage(data, moveName, repPkmn, dice)
    if (multiplier === 0) { logEntries.push(makeLog("normal", `효과가 없다…`)); return }
    if (multiplier > 1) logEntries.push(makeLog("after_hit", "효과가 굉장했다!"))
    if (multiplier < 1) logEntries.push(makeLog("after_hit", "효과가 별로인 듯하다…"))
    if (critical)       logEntries.push(makeLog("after_hit", "급소에 맞았다!"))

    const finalDamages = {}
    for (const s of alive) {
      const idx  = data[`${s}_active_idx`] ?? 0
      const pkmn = entries[s]?.[idx]
      if (!pkmn || pkmn.hp <= 0) continue
      let { damage: d } = calcBossDamage(data, moveName, pkmn, dice)
      if (moveInfo?.venomShock && pkmn.status === "독") {
        d = Math.floor(d * 1.2)
        logEntries.push(makeLog("after_hit", "독 상태라 피해가 커졌다!"))
      }
      if ((pkmn.lightScreen ?? 0) > 0) {
        d = Math.max(1, Math.floor(d * 0.75))
        logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "은는")} 빛의장막으로 피해를 줄였다!`))
      }
      finalDamages[s] = d
    }

    if (data.sync_active && alive.length > 1) {
      const share = Math.max(1, Math.floor(rawDmg * 0.75 / alive.length))
      logEntries.push(makeLog("sync", ""))
      logEntries.push(makeLog("after_hit", `💠 싱크로나이즈! 광역 공격을 ${alive.length}명이 함께 버텼다! (×0.75 후 ${alive.length}등분, 각 ${share})`))
      alive.forEach(s => { finalDamages[s] = share })
      data.sync_used   = true
      data.sync_active = false
    }

    activateUmbreon(finalDamages, data, entries, logEntries)
    for (const s of alive) {
      const idx  = data[`${s}_active_idx`] ?? 0
      const pkmn = entries[s]?.[idx]
      if (!pkmn || pkmn.hp <= 0) continue
      const dmg = finalDamages[s] ?? 0
      if (dmg <= 0) continue
      logEntries.push(makeLog("hit", "", { defender: s }))
      if (pkmn.enduring && dmg >= pkmn.hp) {
        pkmn.hp = 1; pkmn.enduring = false
        logEntries.push(makeLog("after_hit", `${pkmn.name}${josa(pkmn.name, "은는")} 버텼다!`))
      } else {
        pkmn.hp = Math.max(0, pkmn.hp - dmg)
      }
      pkmn.defending = false; pkmn.defendTurns = 0
      pkmn.tookDamageLastTurn = true
      logEntries.push(makeLog("hp", "", { slot: s, hp: pkmn.hp, maxHp: pkmn.maxHp }))
      if (pkmn.hp <= 0) logEntries.push(makeLog("faint", `${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`, { slot: s }))
      if (pkmn.bideState) { pkmn.bideState.damage = (pkmn.bideState.damage ?? 0) + dmg; pkmn.bideState.lastAttackerSlot = "boss" }
    }
  } else {
    const tauntTarget = getTauntSelfTarget(data, entries)
    const realTarget  = tauntTarget ?? targetSlot
    logTauntRedirect(tauntTarget, targetSlot, data, entries, logEntries)

    if (!realTarget) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); return }
    const idx  = data[`${realTarget}_active_idx`] ?? 0
    const pkmn = entries[realTarget]?.[idx]
    if (!pkmn || pkmn.hp <= 0) { logEntries.push(makeLog("normal", "공격할 대상이 이미 쓰러졌다!")); return }

    const _gutsPower = (bossMoves[moveName]?.gutsLike &&
      data.boss_status && ["독", "마비", "화상"].includes(data.boss_status))
      ? (bossMoves[moveName].power ?? 70) * 2
      : null
    const { damage, multiplier, critical } = calcBossDamage(data, moveName, pkmn, dice, _gutsPower)
    logEntries.push(makeLog("dice", "", { slot: "boss", roll: dice }))
    if (multiplier === 0) { logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`)); return }

    if (multiplier > 1) logEntries.push(makeLog("after_hit", "효과가 굉장했다!"))
    if (multiplier < 1) logEntries.push(makeLog("after_hit", "효과가 별로인 듯하다…"))
    if (critical)       logEntries.push(makeLog("after_hit", "급소에 맞았다!"))

    let damages
    if (data.sync_active) {
      const alive = getAlivePlayers(data, entries)
      const share = Math.max(1, Math.floor(damage / Math.max(1, alive.length)))
      damages = {}
      alive.forEach(s => { damages[s] = share })
      logEntries.push(makeLog("sync", ""))
      logEntries.push(makeLog("after_hit", `💠 싱크로나이즈! 믿고 있었어!`))
      data.sync_active = false
      data.sync_used   = true
    } else {
      damages = { [realTarget]: damage }
    }

    for (const slot of Object.keys(damages)) {
      const idx      = data[`${slot}_active_idx`] ?? 0
      const defender = entries[slot]?.[idx]
      if ((defender?.lightScreen ?? 0) > 0 && damages[slot] > 0) {
        damages[slot] = Math.max(1, Math.floor(damages[slot] * 0.75))
        logEntries.push(makeLog("normal", `${defender.name}${josa(defender.name, "은는")} 이상한 힘으로 피해를 줄였다!`))
      }
    }

    activateUmbreon(damages, data, entries, logEntries)
    applyDamagesToPlayers(damages, entries, data, logEntries)

    if (bossMoves[moveName]?.effect?.drain && damage > 0 && (data.boss_current_hp ?? 0) > 0) {
      const healAmt = Math.max(1, Math.floor(damage * bossMoves[moveName].effect.drain))
      const maxHp   = data.boss_max_hp ?? 1
      data.boss_current_hp = Math.min(maxHp, (data.boss_current_hp ?? 0) + healAmt)
      logEntries.push(makeLog("hp", "", { slot: "boss", hp: data.boss_current_hp, maxHp }))
      logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} 체력을 흡수했다! (+${healAmt})`))
    }

    if (moveInfo?.rank?.targetDef !== undefined) {
      const pkmn2 = entries[realTarget]?.[data[`${realTarget}_active_idx`] ?? 0]
      if (pkmn2 && pkmn2.hp > 0) {
        const chance = moveInfo.rank.chance ?? 1
        if (Math.random() < chance) {
          const r    = pkmn2.ranks ?? defaultRanks()
          const cur  = r.def ?? 0
          const next = Math.max(-3, cur + moveInfo.rank.targetDef)
          pkmn2.ranks = { ...r, def: next, defTurns: next !== cur ? (moveInfo.rank.turns ?? 2) : r.defTurns }
          if (next < cur) logEntries.push(makeLog("normal", `${pkmn2.name}${josa(pkmn2.name, "의")} 방어 랭크가 내려갔다!`))
        }
      }
    }

    if (moveName === "인파이트") {
      const bRank  = data.boss_rank ?? defaultRanks()
      const cur    = bRank.def ?? 0
      if (cur > -3) {
        const next = Math.max(-3, cur - 1)
        data.boss_rank = { ...bRank, def: next, defTurns: 2 }
        logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "의")} 방어 랭크가 내려갔다! (${next > 0 ? "+" : ""}${next})`))
      }
    }

    if (moveInfo?.effect?.volatile === "풀죽음" && moveInfo.effect.chance) {
      const pkmn3 = entries[realTarget]?.[data[`${realTarget}_active_idx`] ?? 0]
      if (pkmn3 && pkmn3.hp > 0 && Math.random() < moveInfo.effect.chance) {
        pkmn3.flinch = true
        logEntries.push(makeLog("normal", `${pkmn3.name}${josa(pkmn3.name, "은는")} 풀죽었다!`))
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  비퀸 전용 (변경 없음)
// ════════════════════════════════════════════════════════════════════

async function fetchBeedrilStats(roomId) {
  const snap = await db.collection("boss").doc("beequeen").get()
  const base = snap.data()?.Beedrill ?? {}
  return {
    attack:    base.attack   ?? 3,
    defense:   base.defense  ?? 3,
    speed:     base.speed    ?? 3,
    hp:        base.hp       ?? 60,
    maxHp:     base.hp       ?? 60,
    moves:     base.moves    ?? [],
    type:      base.type     ?? ["벌레", "독"],
    portrait:  base.portrait ?? null,
    name:      base.name     ?? "독침붕",
    ranks:     defaultRanks(),
    wasHealed: false,
  }
}

async function processSummon(roomId, data, logEntries, beedrillLog) {
  const stats     = await fetchBeedrilStats(roomId)
  const beedrill1 = { ...JSON.parse(JSON.stringify(stats)), _idx: 0 }
  const beedrill2 = { ...JSON.parse(JSON.stringify(stats)), _idx: 1 }
  data.Beedrill   = [beedrill1, beedrill2]
  logEntries.push(makeLog("beedrill_summon", "", { beedrills: data.Beedrill }))
  if (beedrillLog) logEntries.push(makeLog("normal", beedrillLog))
}

const MAGU_NAME = "마구찌르기"

function processAttackCommand(data, entries, targetSlot, beedrillLog, logEntries) {
  const beedrills = data.Beedrill ?? []
  const aliveBees = beedrills.filter(b => b.hp > 0)
  if (aliveBees.length === 0) { logEntries.push(makeLog("normal", "독침붕이 없다!")); return }

  const alive = getAlivePlayers(data, entries)
  if (alive.length === 0) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); return }

  const tauntTarget = getTauntSelfTarget(data, entries)
  const realTarget  = tauntTarget && alive.includes(tauntTarget)
    ? tauntTarget
    : (targetSlot && alive.includes(targetSlot) ? targetSlot : alive[Math.floor(Math.random() * alive.length)])
  logTauntRedirect(tauntTarget, targetSlot, data, entries, logEntries)

  const maguInfo = bossMoves[MAGU_NAME]
  if (!maguInfo?.multiHit) { logEntries.push(makeLog("normal", "마구찌르기 정보가 없다!")); return }

  const { min, max, fixedDamage } = maguInfo.multiHit
  const accuracy = maguInfo.accuracy ?? 85

  for (const bee of aliveBees) {
    const idx  = data[`${realTarget}_active_idx`] ?? 0
    const pkmn = entries[realTarget]?.[idx]
    if (!pkmn || pkmn.hp <= 0) continue

    logEntries.push(makeLog("move_announce", `독침붕${josa("독침붕", "의")} ${MAGU_NAME}!`))
    if (beedrillLog) logEntries.push(makeLog("normal", beedrillLog))

    if (Math.random() * 100 >= accuracy) {
      logEntries.push(makeLog("normal", "독침붕의 공격은 빗나갔다!"))
      continue
    }

    const hitCount = Math.floor(Math.random() * (max - min + 1)) + min
    let totalDmg   = 0
    const defTypes = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
    let mult = 1
    for (const dt of defTypes) mult *= getTypeMultiplier(maguInfo.type, dt)

    if (mult === 0) {
      logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`))
    } else {
      const dmgPerHit = Math.max(1, Math.floor(fixedDamage * mult))
      for (let h = 0; h < hitCount; h++) {
        if (pkmn.hp <= 0) break
        if (pkmn.enduring && dmgPerHit >= pkmn.hp) {
          pkmn.hp = 1; pkmn.enduring = false
          logEntries.push(makeLog("after_hit", `${pkmn.name}${josa(pkmn.name, "은는")} 버텼다!`))
        } else {
          pkmn.hp = Math.max(0, pkmn.hp - dmgPerHit)
        }
        totalDmg += dmgPerHit
        pkmn.tookDamageLastTurn = true
        pkmn.last_damage_taken = (pkmn.last_damage_taken ?? 0) + dmgPerHit
        logEntries.push(makeLog("hit", "", { defender: realTarget }))
        logEntries.push(makeLog("hp",  "", { slot: realTarget, hp: pkmn.hp, maxHp: pkmn.maxHp }))
        if (pkmn.hp <= 0) {
          logEntries.push(makeLog("faint", `${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`, { slot: realTarget }))
          break
        }
      }
      if (pkmn.hp > 0 || totalDmg > 0)
        logEntries.push(makeLog("after_hit", `${hitCount}번 공격했다! (총 ${totalDmg} 데미지)`))
      if (mult > 1) logEntries.push(makeLog("after_hit", "효과가 굉장했다!"))
      if (mult < 1) logEntries.push(makeLog("after_hit", "효과가 별로인 듯하다…"))
      if (pkmn.bideState) {
        pkmn.bideState.damage = (pkmn.bideState.damage ?? 0) + totalDmg
        pkmn.bideState.lastAttackerSlot = "boss"
      }
    }
  }
}

function processDefendCommand(data, logEntries, beedrillLog) {
  const beedrills = data.Beedrill ?? []
  const DEF_BOOST = 2, DEF_MAX = 3, DEF_TURNS = 2
  let applied = false
  for (const bee of beedrills) {
    if (bee.hp <= 0) continue
    const r   = bee.ranks ?? defaultRanks()
    const cur = r.def ?? 0
    if (cur >= DEF_MAX) {
      logEntries.push(makeLog("normal", `독침붕${josa("독침붕", "의")} 방어 랭크는 이미 최대다!`))
    } else {
      const next = Math.min(DEF_MAX, cur + DEF_BOOST)
      bee.ranks  = { ...r, def: next, defTurns: DEF_TURNS }
      logEntries.push(makeLog("normal", `독침붕${josa("독침붕", "의")} 방어 랭크가 ${next - cur} 올라갔다! (+${next})`))
      applied = true
    }
  }
  if (applied && beedrillLog) logEntries.push(makeLog("normal", beedrillLog))
}

function processHealCommand(data, logEntries, beedrillLog) {
  const beedrills  = data.Beedrill ?? []
  const HEAL_RATIO = 0.22
  let anyAbove50   = false
  for (const bee of beedrills) {
    if (bee.hp <= 0) continue
    const heal = Math.max(1, Math.floor((bee.maxHp ?? bee.hp) * HEAL_RATIO))
    bee.hp        = Math.min(bee.maxHp ?? bee.hp, bee.hp + heal)
    bee.wasHealed = true
    logEntries.push(makeLog("normal", `독침붕${josa("독침붕", "은는")} 체력을 회복했다! (+${heal})`))
    logEntries.push(makeLog("beedrill_hp", "", { beedrills: data.Beedrill }))
    if (bee.hp / (bee.maxHp ?? 1) >= 0.5) anyAbove50 = true
  }
  if (beedrillLog) logEntries.push(makeLog("normal", beedrillLog))
  return anyAbove50
}

function checkBeedrilDeath(data, nextState) {
  const beedrills = data.Beedrill ?? []
  const allDead   = beedrills.length > 0 && beedrills.every(b => b.hp <= 0)
  if (!allDead) return { allDead: false, nextState }
  const newKillCount = (data.boss_state?.beedrillKillCount ?? 0) + 1
  return {
    allDead: true,
    nextState: { ...nextState, step: "recharge", beedrillKillCount: newKillCount },
  }
}

// ════════════════════════════════════════════════════════════════════
//  Admin 슬롯 교체 (신규)
//
//  사용법: raidUseMove.js 또는 전용 API에서 호출
//    await swapRosterSlot(roomId, outUid, inUid, targetSlot, data)
//
//  규칙:
//  - outUid: 현재 active 상태인 슬롯의 uid (null이면 빈 슬롯에 넣기)
//  - inUid:  bench 또는 spectator 상태인 uid
//  - targetSlot: "p1" | "p2" | "p3"
//  - 진행 중 턴에 해당 슬롯이 포함된 경우 current_order는 그대로 유지
//    (슬롯 이름 자체는 안 바뀌므로 order 수정 불필요)
// ════════════════════════════════════════════════════════════════════

export async function swapRosterSlot(roomId, outUid, inUid, targetSlot, data) {
  const roomRef = db.collection("raid").doc(roomId)

  await db.runTransaction(async (tx) => {
    const snap    = await tx.get(roomRef)
    const current = snap.data()
    if (!current) throw new Error("방 데이터 없음")

    const roster      = { ...(current.roster ?? {}) }
    const activeSlots = { ...(current.active_slots ?? {}) }

    // 검증
    const inMember = roster[inUid]
    if (!inMember) throw new Error(`uid ${inUid}가 roster에 없음`)
    if (inMember.status === "active") throw new Error(`${inUid}는 이미 출전 중`)

    const update = {}

    // 기존 슬롯 점유자 → bench로
    if (outUid && roster[outUid]) {
      update[`roster.${outUid}.status`] = "bench"
      update[`roster.${outUid}.slot`]   = null
    }

    // 새 플레이어 → active로
    update[`roster.${inUid}.status`]   = "active"
    update[`roster.${inUid}.slot`]     = targetSlot
    update[`active_slots.${targetSlot}`] = inUid

    tx.update(roomRef, update)
  })
}

// ════════════════════════════════════════════════════════════════════
//  핵심 export
// ════════════════════════════════════════════════════════════════════
export async function executeBossAction(roomId, data, entries, currentOrder, extraUpdate = {}) {
  // ── [40인 레이드] hydrate: roster → p1_entry 등으로 펼치기 ──
  hydrateSlotData(data)

  const bossName   = data.boss_name ?? "보스"
  const logEntries = []

  let bossAI
  try { bossAI = getBossAI(bossName) }
  catch (e) { throw new Error(`보스 AI 없음: ${bossName}`) }

  const {
    decideBossMove,
    shouldTriggerUlt, getUltTarget, nextUltCooldown,
    getBeedrillIdleLog, getDeathLogs,
    getBossIntroLogs,
    getUltWindupLog, getUltStrikeLog,
    processKangaskhanTurn,
  } = bossAI

  if ((data.turn_count ?? 1) === 1 && getBossIntroLogs) {
    for (const text of getBossIntroLogs()) logEntries.push(makeLog("normal", text))
  }

  let bossUltCooldownNext = data.boss_ult_cooldown ?? 0
  if (shouldTriggerUlt(data)) {
    const ultTarget = getUltTarget(data, entries, PLAYER_SLOTS)
    if (ultTarget) {
      if (getUltWindupLog) logEntries.push(makeLog("normal", getUltWindupLog()))
      if (getUltStrikeLog) logEntries.push(makeLog("normal", getUltStrikeLog()))
      processBossAttack("기습", ultTarget, false, data, entries, logEntries, bossName)
      bossUltCooldownNext = nextUltCooldown ? nextUltCooldown() : 0
    }
  }

  const hasBeedrills = (data.Beedrill ?? []).some(b => b.hp > 0)
  if (hasBeedrills && getBeedrillIdleLog) {
    logEntries.push(makeLog("normal", getBeedrillIdleLog(data)))
  }

  const decision = decideBossMove(data, entries, PLAYER_SLOTS)
  const {
    command,
    log:         commandLog,
    beedrillLog: beedrillActionLog,
    moveLog,
    nextState:   rawNextState,
  } = decision
  let { moveName, targetSlot } = decision
  let nextState = {
    phase: 1,
    ...(data.boss_state ?? {}),
    ...(rawNextState ?? {}),
  }

  const isNuriCommand     = command?.startsWith("nuri_") || command === "wave_warning"
  const isCorruptionCmd   = command === "corruption_blast" || command === "idle"
  const isDelphoxCommand  = command?.startsWith("delphox_")
  const isMalamarCommand  = command?.startsWith("malamar_")
  const isZoroarkCommand  = command?.startsWith("zoroark_")
  const isCatastroCommand = command?.startsWith("catastro_")

  if ((data.boss_volatile?.confused ?? 0) > 0) {
    data.boss_volatile = { ...data.boss_volatile, confused: data.boss_volatile.confused - 1 }
    if (data.boss_volatile.confused <= 0) {
      logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} 혼란에서 깨어났다!`))
    } else {
      logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} 혼란 상태다!`))
      if (Math.random() < 1/3) {
        logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} 혼란으로 행동할 수 없다!`))
        data._bossConfusionBlocked = true
      }
    }
  }

  if (data.boss_volatile?.flinch) {
    data.boss_volatile = { ...(data.boss_volatile ?? {}), flinch: false }
    logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} 풀이 죽어서 움직이지 못했다!`))
    await writeLogs(roomId, logEntries)
    const newOrder = currentOrder.slice(1)
    await db.collection("raid").doc(roomId).update({
      ...dehydrateSlotData(data, entries),   // ← roster 기반 저장
      boss_volatile:   data.boss_volatile,
      boss_state:      data.boss_state ?? {},
      current_order:   newOrder,
      turn_count:      (data.turn_count ?? 1) + 1,
      turn_started_at: newOrder.length > 0 ? Date.now() : null,
    })
    return null
  }

  const isStatusBlocked =
    command !== "kangaskhan_dual" &&
    !isNuriCommand &&
    !isCorruptionCmd &&
    !isDelphoxCommand &&
    !isMalamarCommand &&
    !isZoroarkCommand &&
    !isCatastroCommand &&
    ((data._bossConfusionBlocked) ||
     (data.boss_status === "마비" && Math.random() < 0.25) ||
     (data.boss_status === "얼음" && Math.random() < 0.2))

  data._bossConfusionBlocked = false

  if (isStatusBlocked) {
    if (data.boss_status === "마비")
      logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} 마비로 움직일 수 없다!`))
    if (data.boss_status === "얼음") {
      logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} 얼어붙어 있다!`))
      if (Math.random() < 0.2) {
        logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} 얼음이 녹았다!`))
        data.boss_status = null
      }
    }

  } else if (isNuriCommand) {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    const nuriResult = processNuriCommand(command, decision, data, entries, logEntries)
    if (nuriResult.nextState) nextState = nuriResult.nextState

  } else if (command === "kangaskhan_dual") {
    if (processKangaskhanTurn) {
      processKangaskhanTurn(data, entries, logEntries)
      nextState = data.boss_state ?? nextState
    }

  } else if (command === "idle") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    if (moveLog) {
      for (const line of moveLog.split("\n")) logEntries.push(makeLog("normal", line))
    }

  } else if (isDelphoxCommand) {
    processDelphoxCommand(command, decision, data, entries, logEntries)

  } else if (command === "corruption_blast") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    processCorruptionBlast(targetSlot, data, entries, logEntries)

  } else if (command === "malamar_fascinate") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    if (targetSlot) {
      const idx  = data[`${targetSlot}_active_idx`] ?? 0
      const pkmn = entries[targetSlot]?.[idx]
      if (pkmn && pkmn.hp > 0) {
        pkmn.fascinatedTurns = 3
        logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "은는")} 현혹되었다! (3턴)`))
      }
    }

  } else if (command === "malamar_collect") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    const stored = data.boss_state?.storedMoves ?? {}
    const total  = Object.values(stored).flat().length
    const unique = new Set(Object.values(stored).flat().map(m => m.moveName)).size
    if (total > 0) logEntries.push(makeLog("normal", `기억된 기술: ${unique}종류 (총 ${total}회 관찰)`))

  } else if (command === "malamar_swap") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    if (moveName === "사이코쇼크") {
      processBossAttack("사이코쇼크", targetSlot, false, data, entries, logEntries, bossName)
    } else if (moveName) {
      const moveInfo = moves[moveName] ?? bossMoves[moveName]
      if (moveInfo) {
        processBossAttack(moveName, targetSlot, !!(moveInfo.aoe || moveInfo.aoeEnemy), data, entries, logEntries, bossName)
      } else {
        logEntries.push(makeLog("normal", `${moveName} — 기술 정보를 찾을 수 없다!`))
      }
    }

  } else if (isZoroarkCommand) {
    processZoroarkCommand(command, decision, data, entries, logEntries)

  // ════════════════════════════════════════════════════════════════
  //  [누클라바스] 커맨드 (변경 없음)
  // ════════════════════════════════════════════════════════════════

  } else if (command === "catastro_fake_beam") {
    logEntries.push(makeLog("move_announce", `${bossName}의 파괴광선!`))
    logEntries.push(makeLog("normal", `누클라바스의 파괴광선!... 빗나갔다?`))

  } else if (command === "catastro_miss") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))

  } else if (command === "catastro_phase1_attack") {
    const moveInfo = bossMoves[moveName] ?? moves[moveName]
    const isAoe    = !!(moveInfo?.aoe)
    processBossAttack(moveName, targetSlot, isAoe, data, entries, logEntries, bossName)

  } else if (command === "catastro_core_attack") {
    const coreId   = decision.coreId
    const coreData = data.boss_state?.coreData?.[coreId]
    if (!coreData) {
      logEntries.push(makeLog("normal", "코어 정보를 찾을 수 없다!"))
    } else {
      const coreName = coreData.name ?? `${coreId} 코어`
      const coreMove = coreData.moves?.[0]
      if (!coreMove || !targetSlot) {
        logEntries.push(makeLog("normal", `${coreName}은 잠시 조용해졌다...`))
      } else {
        logEntries.push(makeLog("move_announce", `${coreName}의 ${coreMove}!`))
        processBossAttack(coreMove, targetSlot, false, data, entries, logEntries, coreName)
      }
    }

  } else if (command === "catastro_core_eat") {
    const nextSeq   = decision.nextSeq ?? 1
    const SEQ_NAMES = ["불꽃 코어", "전기 코어", "땅 코어", "얼음 코어", "물+풀 코어"]
    data.boss_current_hp = Math.max(0, (data.boss_current_hp ?? 0) - 500)
    logEntries.push(makeLog("normal", `누클라바스는 ${SEQ_NAMES[nextSeq] ?? "코어"}를 삼켰다!`))
    logEntries.push(makeLog("hp", "", { slot: "boss", hp: data.boss_current_hp, maxHp: data.boss_max_hp }))
    if (nextSeq === 1) {
      PLAYER_SLOTS.forEach(s => {
        data[`${s}_ominous`] = false
        const idx  = data[`${s}_active_idx`] ?? 0
        const pkmn = entries[s]?.[idx]
        if (!pkmn || pkmn.hp <= 0) return
        if (pkmn.status === "화상") { pkmn.status = null; logEntries.push(makeLog("normal", `${pkmn.name}의 화상이 사라졌다!`)) }
        pkmn.status = "마비"
        logEntries.push(makeLog("normal", `${pkmn.name}은(는) 마비되었다!`))
      })
    }
    if (nextSeq === 2) {
      PLAYER_SLOTS.forEach(s => {
        data[`${s}_doomed`] = false
        const idx  = data[`${s}_active_idx`] ?? 0
        const pkmn = entries[s]?.[idx]
        if (!pkmn || pkmn.hp <= 0) return
        if (pkmn.status === "마비") { pkmn.status = null; logEntries.push(makeLog("normal", `${pkmn.name}의 마비가 사라졌다!`)) }
      })
      data.sync_used = false
      logEntries.push(makeLog("normal", "싱크로나이즈를 다시 사용할 수 있다!"))
    }
    if (nextSeq === 3) PLAYER_SLOTS.forEach(s => { data[`${s}_collapse`] = false })
    if (nextSeq === 4) {
      PLAYER_SLOTS.forEach(s => { data[`${s}_tragedy`] = false })
      data.boss_current_hp = Math.max(0, (data.boss_current_hp ?? 0) - 500)
      logEntries.push(makeLog("normal", "누클라바스는 풀 코어마저 삼켰다!"))
      logEntries.push(makeLog("hp", "", { slot: "boss", hp: data.boss_current_hp, maxHp: data.boss_max_hp }))
    }
    nextState = { ...nextState, phase4CoreSeq: nextSeq, phase4SubStep: 0 }

  } else if (command === "catastro_ominous") {
    const target = decision.targetSlot
    PLAYER_SLOTS.forEach(s => {
      const idx  = data[`${s}_active_idx`] ?? 0
      const pkmn = entries[s]?.[idx]
      if (!pkmn || pkmn.hp <= 0) return
      if (!pkmn.status) { pkmn.status = "화상"; logEntries.push(makeLog("normal", `${pkmn.name}은(는) 화상을 입었다!`)) }
    })
    if (target) {
      data[`${target}_ominous`] = true
      const idx  = data[`${target}_active_idx`] ?? 0
      const pkmn = entries[target]?.[idx]
      if (pkmn) logEntries.push(makeLog("normal", `${pkmn.name}에게 [흉조]가 깃들었다! (받는 피해 +10%)`))
    }

  } else if (command === "catastro_eruption") {
    const target = decision.targetSlot
    if (!target) {
      logEntries.push(makeLog("normal", `${bossName}의 분화!... 대상이 없다.`))
    } else {
      data[`${target}_ominous`] = false
      const idx  = data[`${target}_active_idx`] ?? 0
      const pkmn = entries[target]?.[idx]
      if (pkmn && pkmn.hp > 0) {
        logEntries.push(makeLog("move_announce", `${bossName}의 분화!`))
        const { damage, multiplier, critical, dice } = calcBossDamage(data, "분화", pkmn)
        logEntries.push(makeLog("dice", "", { slot: "boss", roll: dice }))
        if (multiplier === 0) {
          logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`))
        } else {
          const ominousDmg = Math.floor(damage * 1.1)
          logEntries.push(makeLog("normal", "[흉조]의 저주로 피해가 증가했다!"))
          if (multiplier > 1) logEntries.push(makeLog("after_hit", "효과가 굉장했다!"))
          if (critical)       logEntries.push(makeLog("after_hit", "급소에 맞았다!"))
          if (pkmn.enduring && ominousDmg >= pkmn.hp) {
            pkmn.hp = 1; pkmn.enduring = false
            logEntries.push(makeLog("after_hit", `${pkmn.name}은(는) 버텼다!`))
          } else {
            pkmn.hp = Math.max(0, pkmn.hp - ominousDmg)
          }
          pkmn.last_damage_taken = ominousDmg; pkmn.tookDamageLastTurn = true
          logEntries.push(makeLog("hit", "", { defender: target }))
          logEntries.push(makeLog("hp",  "", { slot: target, hp: pkmn.hp, maxHp: pkmn.maxHp }))
          if (pkmn.hp <= 0) logEntries.push(makeLog("faint", `${pkmn.name}은(는) 쓰러졌다!`, { slot: target }))
        }
      }
    }

  } else if (command === "catastro_dmg_window_start") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))

  } else if (command === "catastro_doom") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    const target = decision.targetSlot
    if (target) {
      PLAYER_SLOTS.forEach(s => { data[`${s}_doomed`] = false })
      data[`${target}_doomed`] = true
      const idx  = data[`${target}_active_idx`] ?? 0
      const pkmn = entries[target]?.[idx]
      if (pkmn) logEntries.push(makeLog("normal", `${pkmn.name}에게 [사멸]이 지정되었다!`))
    }

  } else if (command === "catastro_lightning") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    const target     = decision.targetSlot
    const syncReduce = decision.syncReduced ?? false
    if (!target) {
      logEntries.push(makeLog("normal", `${bossName}의 번개!... 대상이 없다.`))
    } else {
      const idx  = data[`${target}_active_idx`] ?? 0
      const pkmn = entries[target]?.[idx]
      if (pkmn && pkmn.hp > 0) {
        logEntries.push(makeLog("move_announce", `${bossName}의 번개!`))
        const { damage, multiplier, critical, dice } = calcBossDamage(data, "번개", pkmn, null, syncReduce ? 50 : null)
        logEntries.push(makeLog("dice", "", { slot: "boss", roll: dice }))
        if (syncReduce) logEntries.push(makeLog("normal", "싱크로나이즈로 위력이 줄어들었다!"))
        if (multiplier === 0) {
          logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`))
        } else {
          if (multiplier > 1) logEntries.push(makeLog("after_hit", "효과가 굉장했다!"))
          if (critical)       logEntries.push(makeLog("after_hit", "급소에 맞았다!"))
          if (pkmn.enduring && damage >= pkmn.hp) {
            pkmn.hp = 1; pkmn.enduring = false
            logEntries.push(makeLog("after_hit", `${pkmn.name}은(는) 버텼다!`))
          } else {
            pkmn.hp = Math.max(0, pkmn.hp - damage)
          }
          pkmn.last_damage_taken = damage; pkmn.tookDamageLastTurn = true
          logEntries.push(makeLog("hit", "", { defender: target }))
          logEntries.push(makeLog("hp",  "", { slot: target, hp: pkmn.hp, maxHp: pkmn.maxHp }))
          if (pkmn.hp <= 0) logEntries.push(makeLog("faint", `${pkmn.name}은(는) 쓰러졌다!`, { slot: target }))
        }
        data[`${target}_doomed`] = false
        data.sync_used = false
      }
    }

  } else if (command === "catastro_collapse") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    const tankSlot = decision.tankSlot
    PLAYER_SLOTS.forEach(s => {
      data[`${s}_collapse`] = s !== tankSlot
      if (s !== tankSlot) {
        const idx  = data[`${s}_active_idx`] ?? 0
        const pkmn = entries[s]?.[idx]
        if (pkmn && pkmn.hp > 0) logEntries.push(makeLog("normal", `${pkmn.name}에게 [붕괴]가 지정되었다!`))
      }
    })
    if (tankSlot) {
      const idx  = data[`${tankSlot}_active_idx`] ?? 0
      const pkmn = entries[tankSlot]?.[idx]
      if (pkmn) logEntries.push(makeLog("normal", `${pkmn.name}! 막아선다 / 물러난다?`))
      logEntries.push(makeLog("stand_choice", "", { tankSlot }))
    }
    data.phase4StandChoice = "step_back"

  } else if (command === "catastro_earthquake") {
    const tankSlot = decision.tankSlot
    const didStand = decision.didStand ?? false
    logEntries.push(makeLog("move_announce", `${bossName}의 지진!`))
    const alive = getAlivePlayers(data, entries)
    if (alive.length === 0) {
      logEntries.push(makeLog("normal", "공격할 대상이 없다!"))
    } else {
      const repPkmn = entries[alive[0]]?.[data[`${alive[0]}_active_idx`] ?? 0]
      const { damage: baseDmg, multiplier } = calcBossDamage(data, "지진", repPkmn)
      if (multiplier === 0) {
        logEntries.push(makeLog("normal", "효과가 없다…"))
      } else {
        logEntries.push(makeLog("normal", didStand && tankSlot ? "막아선다!" : "물러난다!"))
        for (const s of alive) {
          const idx  = data[`${s}_active_idx`] ?? 0
          const pkmn = entries[s]?.[idx]
          if (!pkmn || pkmn.hp <= 0) continue
          const dmg = (didStand && tankSlot)
            ? (s === tankSlot ? Math.max(1, Math.floor(baseDmg * 0.70)) : Math.max(1, Math.floor(baseDmg * 0.15)))
            : baseDmg
          if (pkmn.enduring && dmg >= pkmn.hp) {
            pkmn.hp = 1; pkmn.enduring = false
            logEntries.push(makeLog("after_hit", `${pkmn.name}은(는) 버텼다!`))
          } else {
            pkmn.hp = Math.max(0, pkmn.hp - dmg)
          }
          pkmn.last_damage_taken = dmg; pkmn.tookDamageLastTurn = true
          logEntries.push(makeLog("hit", "", { defender: s }))
          logEntries.push(makeLog("hp",  "", { slot: s, hp: pkmn.hp, maxHp: pkmn.maxHp }))
          if (pkmn.hp <= 0) logEntries.push(makeLog("faint", `${pkmn.name}은(는) 쓰러졌다!`, { slot: s }))
        }
        PLAYER_SLOTS.forEach(s => { data[`${s}_collapse`] = false })
      }
    }

  } else if (command === "catastro_tragedy") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    PLAYER_SLOTS.forEach(s => { data[`${s}_tragedy`] = false })
    const target = decision.targetSlot
    if (target) {
      data[`${target}_tragedy`] = true
      const idx  = data[`${target}_active_idx`] ?? 0
      const pkmn = entries[target]?.[idx]
      if (pkmn) logEntries.push(makeLog("normal", `${pkmn.name}에게 [비극]이 깃들었다! 누클라바스와 피해를 공유한다!`))
    }

  } else if (command === "catastro_ult_first") {
    logEntries.push(makeLog("move_announce", `${bossName}의 카타스트로피!`))
    for (const s of getAlivePlayers(data, entries)) {
      const idx  = data[`${s}_active_idx`] ?? 0
      const pkmn = entries[s]?.[idx]
      if (!pkmn || pkmn.hp <= 0) continue
      pkmn.hp = 0
      logEntries.push(makeLog("hp",    "", { slot: s, hp: 0, maxHp: pkmn.maxHp }))
      logEntries.push(makeLog("faint", `${pkmn.name}은(는) 쓰러졌다!`, { slot: s }))
    }
    for (const text of getUltAfterLogs()) logEntries.push(makeLog("normal", text))

  } else if (command === "catastro_ult_second_windup") {
    logEntries.push(makeLog("normal", "누클라바스는 다시 한번 힘을 모으기 시작한다..."))
    logEntries.push(makeLog("catastro_resonance_modal", "", {}))

  } else if (command === "catastro_resonance_wait") {
    logEntries.push(makeLog("normal", "..."))

  } else if (command === "summon") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    await processSummon(roomId, data, logEntries, beedrillActionLog)

  } else if (command === "shedinja_clear") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    data.boss_current_hp = 0
    logEntries.push(makeLog("hp",    "", { slot: "boss", hp: 0, maxHp: data.boss_max_hp }))
    logEntries.push(makeLog("faint", "껍질몬이 쓰러졌다!", { slot: "boss" }))

  } else if (command === "shedinja_idle") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    processBossAttack("버티기", null, true, data, entries, logEntries, bossName)

  } else if (command === "recharge") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))

  } else if (command === "attack") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    processAttackCommand(data, entries, targetSlot, beedrillActionLog, logEntries)

  } else if (command === "defend") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    processDefendCommand(data, logEntries, beedrillActionLog)

  } else if (command === "heal") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    const anyAbove50 = processHealCommand(data, logEntries, beedrillActionLog)
    nextState = { ...nextState, step: anyAbove50 ? "defend" : "attack" }

  } else if (command === "direct") {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    if (moveLog)    logEntries.push(makeLog("normal", moveLog))
    const moveInfo = bossMoves[moveName] ?? moves[moveName]
    if (moveInfo?.targetSelf) {
      logEntries.push(makeLog("move_announce", `${bossName}${josa(bossName, "의")} ${moveName}!`))
      processBossSelfHeal(moveName, data, logEntries, bossName)
    } else {
      processBossAttack(moveName, targetSlot, !!(moveInfo?.aoe), data, entries, logEntries, bossName)
    }

  } else if (moveName) {
    if (commandLog) logEntries.push(makeLog("normal", commandLog))
    if (moveLog)    logEntries.push(makeLog("normal", moveLog))
    const moveInfo = bossMoves[moveName] ?? moves[moveName]
    processBossAttack(moveName, targetSlot, !!(moveInfo?.aoe), data, entries, logEntries, bossName)
  }

  // ── 독침붕 전멸 체크 ────────────────────────────────────────────
  if (command !== "direct" && command !== "recharge" && command !== "summon" &&
      command !== "kangaskhan_dual" && !isNuriCommand && !isCorruptionCmd &&
      !isMalamarCommand && !isZoroarkCommand && !isCatastroCommand) {
    const deathCheck = checkBeedrilDeath(data, nextState)
    if (deathCheck.allDead) {
      nextState = deathCheck.nextState
      const killCount = nextState.beedrillKillCount ?? 0
      logEntries.push(makeLog("normal", killCount < 3
        ? "독침붕이 모두 쓰러졌다! 여왕은 힘을 비축하고 있다!"
        : "독침붕이 모두 쓰러졌다! 비퀸이 직접 나선다!"))
      data.Beedrill = []
    }
  }

  // ── 페이즈 전환 체크들 (변경 없음) ──────────────────────────────
  if (bossAI.checkPhase2Enter) {
    const p2 = bossAI.checkPhase2Enter(data, nextState, command)
    if (p2) {
      for (const text of (p2.logs ?? [])) logEntries.push(makeLog("normal", text))
      nextState = p2.nextState
      if (p2.clearBeedrills)  data.Beedrill     = []
      if (p2.setPhase2Entered) data._phase2Entered = true
      if (p2._clearGrudges) PLAYER_SLOTS.forEach(s => { data[`${s}_grudge`] = false })
    }
  }

  if (bossAI.checkPhase3Enter) {
    const p3 = bossAI.checkPhase3Enter(data, nextState, command)
    if (p3) {
      for (const text of (p3.logs ?? [])) logEntries.push(makeLog("normal", text))
      nextState = p3.nextState
      if (p3.setPhase3Entered) data._phase3Entered = true
      if (data.boss_name === "조로아크") {
        data.boss_state = {
          ...(data.boss_state ?? {}),
          illusionActive: false, illusionHp: null,
          illusionName: null, illusionPortrait: null, illusionSlot: null,
        }
      }
    }
  }

  if (data.boss_name === "누클라바스") {
    const cp2 = catastroP2(data, nextState)
    if (cp2) {
      for (const text of (cp2.logs ?? [])) logEntries.push(makeLog("normal", text))
      nextState = cp2.nextState
    }

    const cp3 = catastroP3(data, nextState)
    if (cp3) {
      for (const text of (cp3.logs ?? [])) logEntries.push(makeLog("normal", text))
      try {
        const coreSnap = await db.collection("boss").doc("catastrophe").get()
        const coreArr  = coreSnap.data()?.core ?? []
        const coreData = {}, coreHp = {}
        coreArr.forEach(c => {
          if (!c.id) return
          coreData[c.id] = {
            name: c.name ?? `${c.id} 코어`, hp: c.hp ?? 300,
            attack: c.attack ?? 3, defense: c.defense ?? 3, speed: c.speed ?? 3,
            type: c.type ?? ["노말"], moves: c.moves ?? [],
          }
          coreHp[c.id] = c.hp ?? 300
        })
        nextState = { ...cp3.nextState, coreData, coreHp }
      } catch (e) {
        console.warn("코어 데이터 로드 실패:", e.message)
        nextState = cp3.nextState
      }
      if (cp3.setPhase3Entered) data._phase3Entered = true
    }

    const cp4 = catastroP4(data, nextState)
    if (cp4) {
      for (const text of (cp4.logs ?? [])) logEntries.push(makeLog("normal", text))
      nextState = cp4.nextState
      if (cp4.setPhase4Entered) data._phase4Entered = true
      data.boss_current_hp = Math.max(0, (data.boss_current_hp ?? 0) - 500)
      logEntries.push(makeLog("normal", "누클라바스는 불꽃 코어를 삼켰다!"))
      logEntries.push(makeLog("hp", "", { slot: "boss", hp: data.boss_current_hp, maxHp: data.boss_max_hp }))
      PLAYER_SLOTS.forEach(s => {
        const idx  = data[`${s}_active_idx`] ?? 0
        const pkmn = entries[s]?.[idx]
        if (!pkmn || pkmn.hp <= 0) return
        if (!pkmn.status) {
          pkmn.status = "화상"
          logEntries.push(makeLog("normal", `${pkmn.name}은(는) 화상을 입었다!`))
        }
      })
    }
  }

  // ── 보스 사망 처리 ───────────────────────────────────────────────
  const bossJustDied = (data.boss_current_hp ?? 0) <= 0
  if (bossJustDied && getDeathLogs) {
    for (const text of getDeathLogs()) logEntries.push(makeLog("normal", text))
  }

  if (bossAI.processUnitSwap && !bossJustDied) {
    const swapResult = bossAI.processUnitSwap(data, nextState)
    if (swapResult) {
      for (const text of swapResult.logs) logEntries.push(makeLog("normal", text))
      nextState = swapResult.nextState
      if (bossAI.applyInheritedRanks) bossAI.applyInheritedRanks(data, swapResult.nextState.inheritedRanks)
    }
  }

  if (!bossJustDied && bossAI.processDelphoxEot) processDelphoxEot(data, entries, logEntries)
  if (!bossJustDied && data.boss_name === "껍질몬") processNinjaskEot(data, entries, logEntries)

  if (!bossJustDied && data.boss_name === "칼라마네로") {
    for (const s of PLAYER_SLOTS) {
      if (!(data.active_slots ?? {})[s]) continue   // 빈 슬롯 스킵
      const idx  = data[`${s}_active_idx`] ?? 0
      const pkmn = entries[s]?.[idx]
      if (!pkmn || pkmn.hp <= 0) continue
      if ((pkmn.fascinatedTurns ?? 0) > 0) {
        pkmn.fascinatedTurns -= 1
        if (pkmn.fascinatedTurns <= 0) {
          pkmn.fascinatedTurns = 0
          logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "은는")} 현혹에서 벗어났다!`))
        }
      }
    }
  }

  if (!bossJustDied && data.boss_name === "조로아크") processZoroarkEot(data, entries, logEntries)

  if (!bossJustDied && (data.boss_status === "독" || data.boss_status === "화상")) {
    const dmg = Math.max(1, Math.floor((data.boss_max_hp ?? 1) / 64))
    data.boss_current_hp = Math.max(0, (data.boss_current_hp ?? 0) - dmg)
    const label = data.boss_status === "독" ? "독" : "화상"
    logEntries.push(makeLog("normal", `${bossName}${josa(bossName, "은는")} ${label} 데미지로 ${dmg} HP를 잃었다!`))
    logEntries.push(makeLog("hp", "", { slot: "boss", hp: data.boss_current_hp, maxHp: data.boss_max_hp }))
  }

  if (data.boss_name === "조로아크") {
    const tauntActive = data.boss_state?.tauntActive ?? false
    nextState = {
      ...nextState,
      shadowClawTotalDmg: data.boss_state?.shadowClawTotalDmg ?? 0,
      stolenMoves:        data.boss_state?.stolenMoves        ?? {},
      tauntActive,
      tauntMsg:           tauntActive ? (data.boss_state?.tauntMsg        ?? null)  : null,
      tauntMsgIndex:      tauntActive ? (data.boss_state?.tauntMsgIndex   ?? 0)     : 0,
      tauntHasGrudge:     tauntActive ? (data.boss_state?.tauntHasGrudge  ?? false) : false,
      tauntAttackedBy:    tauntActive ? (data.boss_state?.tauntAttackedBy ?? [])    : [],
      tauntRoundDmg:      tauntActive ? (data.boss_state?.tauntRoundDmg   ?? {})    : {},
      tauntSkipNext:      data.boss_state?.tauntSkipNext      ?? false,
      illusionActive:     data.boss_state?.illusionActive     ?? false,
      illusionHp:         data.boss_state?.illusionHp         ?? null,
      illusionName:       data.boss_state?.illusionName       ?? null,
      illusionPortrait:   data.boss_state?.illusionPortrait   ?? null,
      illusionSlot:       data.boss_state?.illusionSlot       ?? null,
      pendingVenting:     data.boss_state?.pendingVenting     ?? null,
      pendingCurse:       data.boss_state?.pendingCurse       ?? null,
    }
  }

  const result = checkRaidWin(entries, data.boss_current_hp ?? 0, data)
  await writeLogs(roomId, logEntries)

  const newOrder = currentOrder.slice(1)

  function sanitize(obj) {
    return JSON.parse(JSON.stringify(obj, (_, v) => v === undefined ? null : v))
  }

  // ── [40인 레이드] dehydrate: 처리된 entries → roster로 역변환 ──
  const rosterPatch = dehydrateSlotData(data, entries)

  const update = {
    ...rosterPatch,                          // roster.{uid}.entry / active_idx
    active_slots:      data.active_slots ?? {},
    boss_current_hp:   data.boss_current_hp ?? 0,
    boss_status:       data.boss_status     ?? null,
    boss_rank:         data.boss_rank       ?? defaultRanks(),
    boss_volatile:     data.boss_volatile   ?? {},
    boss_state:        sanitize(nextState),
    boss_last_move:    moveName ?? null,
    boss_ult_cooldown: bossUltCooldownNext,
    Beedrill:          data.Beedrill        ?? [],
    sync_active:       data.sync_active     ?? false,
    sync_used:         data.sync_used       ?? false,
    umbreon_used:      data.umbreon_used    ?? false,
    current_order:     newOrder,
    turn_count:        (data.turn_count ?? 1) + 1,
    turn_started_at:   newOrder.length > 0 ? Date.now() : null,
    weather:           data.weather         ?? null,
    weatherTurns:      data.weatherTurns    ?? 0,
    boss_seeded:       data.boss_seeded     ?? false,
    boss_seeder:       data.boss_seeder     ?? null,
    _phase2Entered:    data._phase2Entered  ?? false,
    _phase3Entered:    data._phase3Entered  ?? false,
    _phase4Entered:    data._phase4Entered  ?? false,
    boss_brandedSlot:        data.boss_brandedSlot        ?? null,
    boss_reflectorTurns:     data.boss_reflectorTurns     ?? 0,
    boss_trickery:           data.boss_trickery           ?? false,
    boss_trickTurns:         data.boss_trickTurns         ?? 0,
    boss_trickState:         data.boss_trickState         ?? null,
    boss_prophecy:           data.boss_prophecy           ?? null,
    boss_lastHitSlot:        data.boss_lastHitSlot        ?? null,
    boss_prophecyLastMoves:  data.boss_prophecyLastMoves  ?? {},
    boss_illusion_hp:        data.boss_illusion_hp        ?? null,
    boss_illusion_name:      data.boss_illusion_name      ?? null,
    boss_illusion_portrait:  data.boss_illusion_portrait  ?? null,
    phase4StandChoice:       data.phase4StandChoice       ?? null,
    ...Object.fromEntries(PLAYER_SLOTS.map(s => [`${s}_grudge`,   data[`${s}_grudge`]   ?? false])),
    ...Object.fromEntries(PLAYER_SLOTS.flatMap(s => [
      [`${s}_ominous`,  data[`${s}_ominous`]  ?? false],
      [`${s}_doomed`,   data[`${s}_doomed`]   ?? false],
      [`${s}_collapse`, data[`${s}_collapse`] ?? false],
      [`${s}_tragedy`,  data[`${s}_tragedy`]  ?? false],
    ])),
    ...(data.boss_baby !== undefined ? { boss_baby: data.boss_baby } : {}),
    ...extraUpdate,
  }

  // active_idx도 roster patch에 포함되어 있으나 명시적으로도 보존
  PLAYER_SLOTS.forEach(s => {
    if (data[`${s}_active_idx`] !== undefined)
      update[`roster.${getUidBySlot(data, s)}.active_idx`] = data[`${s}_active_idx`]
  })

  // ── 강제 교체 플래그 (포켓몬 전멸 시 admin이 수동 교체) ─────────
  // 기존: force_switch_p1 등 → admin 패널에서 확인 후 swapRosterSlot 호출
  // 여기선 플래그만 세팅, 실제 교체는 admin이 판단
  PLAYER_SLOTS.forEach(s => {
    const uid        = getUidBySlot(data, s)
    const idx        = data[`${s}_active_idx`] ?? 0
    const pkmn       = entries[s]?.[idx]
    const benchAlive = (entries[s] ?? []).some((p, i) => i !== idx && p.hp > 0)
    if (pkmn && pkmn.hp <= 0 && benchAlive && !result) {
      update[`force_switch_${s}`] = true
    } else {
      update[`force_switch_${s}`] = false
    }
    // roster에도 force_switch 마킹
    if (uid && pkmn && pkmn.hp <= 0 && !benchAlive && !result) {
      update[`roster.${uid}.allFainted`] = true
    }
  })

  if (result) {
    update.game_over       = true
    update.raid_result     = result
    update.current_order   = []
    update.turn_started_at = null
  }

  await db.collection("raid").doc(roomId).update(update)
  return result
}