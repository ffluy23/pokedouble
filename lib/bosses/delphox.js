// lib/bosses/delphox.js
// 마폭시 보스 AI

import { getTypeMultiplier } from "../typeChart.js"
import { josa }              from "../effecthandler.js"
import { bossMoves }         from "../bossMoves.js"
import { getWeatherDamageMult } from "../weather.js"
import { rollD10 }           from "../gameUtils.js"
import { activateUmbreon }   from "../umbreon.js"
import {
  makeLog, PLAYER_SLOTS, getAlivePlayers,
  defaultRanks, getActiveRankVal
} from "../raidBossAction.js"

// ════════════════════════════════════════════════════════════════════
//  상수
// ════════════════════════════════════════════════════════════════════
const BOSS_NAME        = "마폭시"
const PHASE2_HP_RATIO  = 0.80
const PHASE3_HP_RATIO  = 0.60
const BRAND_DMG_BONUS  = 0.10
const REFLECTOR_TURNS  = 3
const REFLECTOR_MULT   = 0.75
const SEAL_TURNS       = 3
const TRICK_TURNS      = 3
const TRICK_MIN_RATIO  = 0.22
const BRAND_BLAST_DMG  = 100
const PROPHECY_POWER   = 70
const PROPHECY_ROUNDS  = 2
const PROPHECY_TYPES   = ["strongest", "wounded", "passive", "repeat"]

// ════════════════════════════════════════════════════════════════════
//  유틸
// ════════════════════════════════════════════════════════════════════
function randomAlive(data, entries) {
  const alive = getAlivePlayers(data, entries)
  if (alive.length === 0) return null
  return alive[Math.floor(Math.random() * alive.length)]
}

function activePkmn(slot, data, entries) {
  const idx = data[`${slot}_active_idx`] ?? 0
  return entries[slot]?.[idx] ?? null
}

function getPhase(data) {
  return data.boss_state?.phase ?? 1
}

function chooseBestAttack(data, entries) {
  const targets   = getAlivePlayers(data, entries)
  const moveTypes = { "환상빔": "에스퍼", "매지컬플레임": "불" }
  let bestMove  = "환상빔"
  let bestScore = -Infinity
  for (const mv of ["환상빔", "매지컬플레임"]) {
    let total = 0, count = 0
    for (const s of targets) {
      const pkmn  = activePkmn(s, data, entries)
      if (!pkmn) continue
      const types = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
      let mult = 1
      for (const t of types) mult *= getTypeMultiplier(moveTypes[mv], t)
      total += mult; count++
    }
    const avg = count > 0 ? total / count : 1
    if (avg > bestScore) { bestScore = avg; bestMove = mv }
  }
  return bestMove
}

// ════════════════════════════════════════════════════════════════════
//  [낙인] — boss_brandedSlot 별도 필드로 관리 (nextState 덮어씌움 방지)
// ════════════════════════════════════════════════════════════════════
function applyBrand(targetSlot, data, entries, logEntries) {
  data.boss_brandedSlot = targetSlot
  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn || pkmn.hp <= 0) return null
  logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "은는")} [낙인]을 받았다!`))
  return targetSlot
}

function getBrandedSlot(data) {
  return data.boss_brandedSlot ?? null
}

function clearBrand(data, logEntries) {
  data.boss_brandedSlot = null
  if (logEntries) logEntries.push(makeLog("normal", "[낙인]이 사라졌다!"))
}

// ════════════════════════════════════════════════════════════════════
//  [리플렉터]
// ════════════════════════════════════════════════════════════════════
function applyReflector(data, logEntries) {
  data.boss_reflectorTurns = REFLECTOR_TURNS
  logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "은는")} 리플렉터를 펼쳤다! (${REFLECTOR_TURNS}턴)`))
}

// ════════════════════════════════════════════════════════════════════
//  [속임수]
// ════════════════════════════════════════════════════════════════════
function activateTrickery(data, logEntries) {
  data.boss_trickery = true
  logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 속임수! 낙인 받은 자의 공격은 아군에게 향한다!`))
}

// ════════════════════════════════════════════════════════════════════
//  [봉인]
// ════════════════════════════════════════════════════════════════════
function applySeal(targetSlot, data, entries, logEntries) {
  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn || pkmn.hp <= 0) return
  const lastMove = pkmn.lastUsedMove
  if (!lastMove) {
    logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 봉인! 하지만 봉인할 기술이 없다…`))
    return
  }
  pkmn.sealedMove      = lastMove
  pkmn.sealedMoveTurns = SEAL_TURNS
  logEntries.push(makeLog("normal",
    `${BOSS_NAME}${josa(BOSS_NAME, "의")} 봉인! ${pkmn.name}${josa(pkmn.name, "의")} ${lastMove}${josa(lastMove, "을를")} ${SEAL_TURNS}턴간 봉인했다!`
  ))
}

// ════════════════════════════════════════════════════════════════════
//  [질투의불꽃]
// ════════════════════════════════════════════════════════════════════
function processBrandBlast(data, entries, logEntries) {
  const targetSlot = getBrandedSlot(data)
  if (!targetSlot) {
    logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 질투의불꽃! 하지만 낙인 대상이 없다…`))
    return
  }
  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn || pkmn.hp <= 0) { clearBrand(data, null); return }

  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 질투의불꽃!`))
  logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "의")} [낙인]이 폭발했다!`))

  // 싱크로 체크
  let damagesMap
  if (data.sync_active) {
    const alive = getAlivePlayers(data, entries)
    const share = Math.max(1, Math.floor(BRAND_BLAST_DMG / Math.max(1, alive.length)))
    damagesMap = {}
    alive.forEach(s => { damagesMap[s] = share })
    logEntries.push(makeLog("sync", ""))
    logEntries.push(makeLog("after_hit", `💠 싱크로나이즈! 믿고 있었어!`))
    data.sync_active = false
    data.sync_used   = true
  } else {
    damagesMap = { [targetSlot]: BRAND_BLAST_DMG }
  }

  activateUmbreon(damagesMap, data, entries, logEntries)

  for (const [slot, dmg] of Object.entries(damagesMap)) {
    if (dmg <= 0) continue
    const target = activePkmn(slot, data, entries)
    if (!target || target.hp <= 0) continue
    if (target.defending) {
  logEntries.push(makeLog("normal", `${target.name}${josa(target.name, "은는")} 방어했다!`))
  target.defending = false
  target.defendTurns = 0
  continue
}
    if (target.enduring && dmg >= target.hp) {
      target.hp = 1; target.enduring = false
      logEntries.push(makeLog("after_hit", `${target.name}${josa(target.name, "은는")} 버텼다!`))
    } else {
      target.hp = Math.max(0, target.hp - dmg)
    }
    target.tookDamageLastTurn = true
    logEntries.push(makeLog("hit", "", { defender: slot }))
    logEntries.push(makeLog("hp",  "", { slot, hp: target.hp, maxHp: target.maxHp }))
    if (target.hp <= 0)
      logEntries.push(makeLog("faint", `${target.name}${josa(target.name, "은는")} 쓰러졌다!`, { slot }))
  }

  clearBrand(data, null)
}

// ════════════════════════════════════════════════════════════════════
//  [트릭]
// ════════════════════════════════════════════════════════════════════
function processTrick(data, entries, logEntries) {
  const alive = getAlivePlayers(data, entries)
  if (alive.length < 2) {
    logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 트릭! 하지만 대상이 부족하다…`))
    return
  }

  const snapshot = {}
  alive.forEach(s => {
    const p = activePkmn(s, data, entries)
    if (p) snapshot[s] = p.hp
  })

  const slots  = alive.slice()
  const hpList = slots.map(s => snapshot[s])
  let shuffled = [...hpList]

  for (let attempt = 0; attempt < 20; attempt++) {
    shuffled = [...hpList]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    if (slots.every((s, i) => hpList[i] !== shuffled[i])) break
  }

  const trickState = { ownerHp: {} }
  slots.forEach((s, i) => {
    const p = activePkmn(s, data, entries)
    if (!p) return
    trickState.ownerHp[s] = snapshot[s]
    p.hp = Math.max(1, shuffled[i])
  })

  data.boss_trickTurns = TRICK_TURNS
  data.boss_trickState = trickState

  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 트릭!`))
  logEntries.push(makeLog("normal", `포켓몬들의 HP가 뒤죽박죽 섞였다!`))
  slots.forEach(s => {
    const p = activePkmn(s, data, entries)
    if (p) logEntries.push(makeLog("hp", "", { slot: s, hp: p.hp, maxHp: p.maxHp }))
  })
}

function resolveTrick(data, entries, logEntries) {
  if (!data.boss_trickState) return
  logEntries.push(makeLog("normal", "트릭은 여기까지!"))
  PLAYER_SLOTS.forEach(s => {
    const p = activePkmn(s, data, entries)
    if (!p) return
    const minHp = Math.max(1, Math.floor(p.maxHp * TRICK_MIN_RATIO))
    p.hp = Math.max(minHp, p.hp)
    logEntries.push(makeLog("hp", "", { slot: s, hp: p.hp, maxHp: p.maxHp }))
  })
  data.boss_trickTurns = 0
  data.boss_trickState = null
}

// ════════════════════════════════════════════════════════════════════
//  [미래예지]
// ════════════════════════════════════════════════════════════════════
function activateProphecy(prophecyType, data, entries, logEntries) {
  const roundNow = data.round_count ?? 1
  data.boss_prophecy = {
    type:         prophecyType,
    activateAt:   roundNow + PROPHECY_ROUNDS,
    triggered:    false,
    passiveSlots: [],
    repeatSlots:  [],
  }
  const TEXTS = {
    strongest: `"${BOSS_NAME}: ${PROPHECY_ROUNDS}라운드 후, 가장 강한 자는 피할 수 없다."`,
    wounded:   `"${BOSS_NAME}: ${PROPHECY_ROUNDS}라운드 후, 상처 입은 자는 보호받지 못한다."`,
    passive:   `"${BOSS_NAME}: 다음 행동에서 검을 들지 않은 자는 고통스럽다."`,
    repeat:    `"${BOSS_NAME}: ${PROPHECY_ROUNDS}라운드 이내에 같은 길을 걷는 자는 벌을 받는다."`,
  }
  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 미래예지!`))
  logEntries.push(makeLog("prophecy_text", TEXTS[prophecyType]))
}

function resolveProphecy(data, entries, logEntries) {
  const prophecy = data.boss_prophecy
  if (!prophecy || prophecy.triggered) return { fired: false, targetSlots: [] }
  prophecy.triggered = true
  data.boss_prophecy = prophecy

  let targetSlots = []
  switch (prophecy.type) {
    case "strongest": {
      let maxDmg = -1, maxSlot = null
      PLAYER_SLOTS.forEach(s => {
        const dmg = data[`${s}_total_damage_to_boss`] ?? 0
        if (dmg > maxDmg) { maxDmg = dmg; maxSlot = s }
      })
      if (maxSlot) {
        const p = activePkmn(maxSlot, data, entries)
        if (p && p.hp > 0) targetSlots = [maxSlot]
      }
      break
    }
    case "wounded": {
      const lastSlot = data.boss_lastHitSlot ?? null
      if (lastSlot) {
        const p = activePkmn(lastSlot, data, entries)
        if (p && p.hp > 0) targetSlots = [lastSlot]
      }
      break
    }
    case "passive":
      targetSlots = (prophecy.passiveSlots ?? []).filter(s => {
        const p = activePkmn(s, data, entries); return p && p.hp > 0
      })
      break
    case "repeat":
      targetSlots = (prophecy.repeatSlots ?? []).filter(s => {
        const p = activePkmn(s, data, entries); return p && p.hp > 0
      })
      break
  }
  return { fired: true, targetSlots, success: targetSlots.length > 0 }
}

function applyProphecyDamage(targetSlots, data, entries, logEntries) {
  for (const s of targetSlots) {
    const pkmn = activePkmn(s, data, entries)
    if (!pkmn || pkmn.hp <= 0) continue
    const defTypes = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
    let mult = 1
    for (const t of defTypes) mult *= getTypeMultiplier("에스퍼", t)
    if (mult === 0) { logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`)); continue }

    const damage = Math.max(1, Math.floor(PROPHECY_POWER * mult))

    const damagesMap = { [s]: damage }
    activateUmbreon(damagesMap, data, entries, logEntries)
    const finalDmg = damagesMap[s]
    if (finalDmg <= 0) continue

    if (pkmn.enduring && finalDmg >= pkmn.hp) {
      pkmn.hp = 1; pkmn.enduring = false
      logEntries.push(makeLog("after_hit", `${pkmn.name}${josa(pkmn.name, "은는")} 버텼다!`))
    } else {
      pkmn.hp = Math.max(0, pkmn.hp - finalDmg)
    }
    pkmn.tookDamageLastTurn = true
    data.boss_lastHitSlot   = s
    logEntries.push(makeLog("hit", "", { defender: s }))
    logEntries.push(makeLog("hp",  "", { slot: s, hp: pkmn.hp, maxHp: pkmn.maxHp }))
    if (pkmn.hp <= 0)
      logEntries.push(makeLog("faint", `${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`, { slot: s }))
  }
}

// ════════════════════════════════════════════════════════════════════
//  공격 헬퍼 — 싱크로 + 블래키 처리 포함
// ════════════════════════════════════════════════════════════════════
function _attackTarget(moveName, targetSlot, data, entries, logEntries) {
  const moveInfo = bossMoves[moveName]
  if (!moveInfo) { logEntries.push(makeLog("normal", `기술 정보 없음: ${moveName}`)); return }

  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn || pkmn.hp <= 0) { logEntries.push(makeLog("normal", "공격할 대상이 이미 쓰러졌다!")); return }

  const dice     = rollD10()
  const defTypes = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
  let mult = 1
  for (const t of defTypes) mult *= getTypeMultiplier(moveInfo.type, t)

  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} ${moveName}!`))
  logEntries.push(makeLog("dice", "", { slot: "boss", roll: dice }))

  if (mult === 0) { logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`)); return }

  const bossAtk = (data.boss_attack ?? 5) + getActiveRankVal(data.boss_rank ?? {}, "atk")
  const defStat = pkmn.defense ?? 3
  const defRank = getActiveRankVal(pkmn.ranks ?? {}, "def")
  const power   = moveInfo.power ?? 40
  const wMult   = getWeatherDamageMult(data.weather ?? null, moveInfo.type)
  const raw     = Math.floor((power + bossAtk * 4 + dice) * mult * wMult)
  let damage    = Math.max(1, raw - defStat * 3 - defRank * 3)

  // 리플렉터 경감
  if ((data.boss_reflectorTurns ?? 0) > 0) {
    damage = Math.max(1, Math.floor(damage * REFLECTOR_MULT))
    logEntries.push(makeLog("normal", "리플렉터가 피해를 줄였다!"))
  }

  // 낙인 +10%
  if (data.boss_brandedSlot === targetSlot) {
    damage = Math.floor(damage * (1 + BRAND_DMG_BONUS))
    logEntries.push(makeLog("after_hit", "[낙인] 때문에 피해가 증가했다!"))
  }

  if (mult > 1) logEntries.push(makeLog("after_hit", "효과가 굉장했다!"))
  if (mult < 1) logEntries.push(makeLog("after_hit", "효과가 별로인 듯하다…"))

  // ── 싱크로 처리 ─────────────────────────────────────────────────
  let damagesMap
  if (data.sync_active) {
    const alive = getAlivePlayers(data, entries)
    const share = Math.max(1, Math.floor(damage / Math.max(1, alive.length)))
    damagesMap = {}
    alive.forEach(s => { damagesMap[s] = share })
    logEntries.push(makeLog("sync", ""))
    logEntries.push(makeLog("after_hit", `💠 싱크로나이즈! 믿고 있었어!`))
    data.sync_active = false
    data.sync_used   = true
  } else {
    damagesMap = { [targetSlot]: damage }
  }

  // ── 블래키 최우선 체크 ──────────────────────────────────────────
  activateUmbreon(damagesMap, data, entries, logEntries)

  for (const [slot, dmg] of Object.entries(damagesMap)) {
    if (dmg <= 0) continue
    const target = activePkmn(slot, data, entries)
    if (!target || target.hp <= 0) continue

    if (target.defending) {
      logEntries.push(makeLog("normal", `${target.name}${josa(target.name, "은는")} 방어했다!`))
      target.defending = false
      target.defendTurns = 0
      continue
    }

    if (target.enduring && dmg >= target.hp) {
      target.hp = 1; target.enduring = false
      logEntries.push(makeLog("after_hit", `${target.name}${josa(target.name, "은는")} 버텼다!`))
    } else {
      target.hp = Math.max(0, target.hp - dmg)
    }
    target.tookDamageLastTurn = true
    target.last_damage_taken  = dmg
    data.boss_lastHitSlot     = slot

    logEntries.push(makeLog("hit", "", { defender: slot }))
    logEntries.push(makeLog("hp",  "", { slot, hp: target.hp, maxHp: target.maxHp }))
    if (target.hp <= 0)
      logEntries.push(makeLog("faint", `${target.name}${josa(target.name, "은는")} 쓰러졌다!`, { slot }))
  }
}

// ════════════════════════════════════════════════════════════════════
//  페이즈 행동 결정
// ════════════════════════════════════════════════════════════════════
function decidePhase1(data) {
  const state = data.boss_state ?? {}
  const step  = state.step ?? 1
  if (step === 1) return { command: "delphox_brand",         nextState: { ...state, step: 2 } }
  if (step === 2) return { command: "delphox_magical_flame", nextState: { ...state, step: 3 } }
  return                 { command: "delphox_psybeam",       nextState: { ...state, step: 1 } }
}

function decidePhase2(data) {
  const state = data.boss_state ?? {}
  const step  = state.p2PhaseStep ?? 1
  if (step === 1) return { command: "delphox_p2_brand_trickery", nextState: { ...state, p2PhaseStep: 2 } }
  if (step === 2) return { command: "delphox_p2_reflector_seal", nextState: { ...state, p2PhaseStep: 3 } }
  if (step === 3) return { command: "delphox_brand_blast",       nextState: { ...state, p2PhaseStep: 4 } }
  return                 { command: "delphox_best_attack",       nextState: { ...state, p2PhaseStep: step < 5 ? step + 1 : 1 } }
}

function decidePhase3(data, entries) {
  const state    = data.boss_state ?? {}
  const step     = state.p3Step ?? 1
  const prophecy = data.boss_prophecy
  const roundNow = data.round_count ?? 1

  if (step === 1) return { command: "delphox_p3_trick_reflector", nextState: { ...state, p3Step: 2 } }
  if (step === 2) {
    const typeIdx = Math.floor(Math.random() * PROPHECY_TYPES.length)
    return { command: "delphox_prophecy", prophecyType: PROPHECY_TYPES[typeIdx], nextState: { ...state, p3Step: 3 } }
  }
  if (prophecy && !prophecy.triggered && roundNow >= prophecy.activateAt) {
    return { command: "delphox_prophecy_fire", nextState: { ...state, p3Step: 1 } }
  }
  return { command: "delphox_best_attack", nextState: { ...state, p3Step: Math.min((state.p3Step ?? 3) + 1, 5) } }
}

// ════════════════════════════════════════════════════════════════════
//  export: decideBossMove
// ════════════════════════════════════════════════════════════════════
export function decideBossMove(data, entries, playerSlots) {
  const phase = getPhase(data)
  if (phase >= 3) return decidePhase3(data, entries)
  if (phase >= 2) return decidePhase2(data)
  return decidePhase1(data)
}

// ════════════════════════════════════════════════════════════════════
//  export: processDelphoxCommand
// ════════════════════════════════════════════════════════════════════
export function processDelphoxCommand(command, decision, data, entries, logEntries) {
  switch (command) {
    case "delphox_brand": {
      const target = randomAlive(data, entries)
      if (!target) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); break }
      applyBrand(target, data, entries, logEntries)
      break
    }
    case "delphox_magical_flame": {
      const branded = getBrandedSlot(data)
      const target  = branded ?? randomAlive(data, entries)
      if (!target) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); break }
      _attackTarget("매지컬플레임", target, data, entries, logEntries)
      if (branded) clearBrand(data, logEntries)
      break
    }
    case "delphox_psybeam": {
      const target = randomAlive(data, entries)
      if (!target) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); break }
      _attackTarget("환상빔", target, data, entries, logEntries)
      break
    }
    case "delphox_p2_brand_trickery": {
      const target = randomAlive(data, entries)
      if (target) applyBrand(target, data, entries, logEntries)
      activateTrickery(data, logEntries)
      break
    }
    case "delphox_p2_reflector_seal": {
      applyReflector(data, logEntries)
      const branded = getBrandedSlot(data)
      if (branded) applySeal(branded, data, entries, logEntries)
      else logEntries.push(makeLog("normal", "봉인할 낙인 대상이 없다…"))
      break
    }
    case "delphox_brand_blast": {
      processBrandBlast(data, entries, logEntries)
      break
    }
    case "delphox_best_attack": {
      const mv     = chooseBestAttack(data, entries)
      const target = randomAlive(data, entries)
      if (!target) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); break }
      _attackTarget(mv, target, data, entries, logEntries)
      break
    }
    case "delphox_p3_trick_reflector": {
      processTrick(data, entries, logEntries)
      applyReflector(data, logEntries)
      break
    }
    case "delphox_prophecy": {
      activateProphecy(decision.prophecyType, data, entries, logEntries)
      break
    }
    case "delphox_prophecy_fire": {
      const result = resolveProphecy(data, entries, logEntries)
      if (result.fired) {
        if (result.success) {
          logEntries.push(makeLog("prophecy_text", `"${BOSS_NAME}: 감히 나를 의심해?"`))
          logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 미래예지 발동!`))
          applyProphecyDamage(result.targetSlots, data, entries, logEntries)
        } else {
          logEntries.push(makeLog("prophecy_text", `"${BOSS_NAME}: 그 선택, 몇 번이나 반복할 생각이지?"`))
        }
      }
      if ((data.boss_trickTurns ?? 0) > 0) {
        data.boss_trickTurns--
        if (data.boss_trickTurns <= 0) resolveTrick(data, entries, logEntries)
      }
      data.boss_prophecy = null
      break
    }
    default:
      logEntries.push(makeLog("normal", `[delphox] 알 수 없는 커맨드: ${command}`))
  }
}

// ════════════════════════════════════════════════════════════════════
//  export: ult 훅
// ════════════════════════════════════════════════════════════════════
export function shouldTriggerUlt(data) { return false }
export function getUltTarget(data, entries, playerSlots) { return null }
export function nextUltCooldown() { return 0 }

// ════════════════════════════════════════════════════════════════════
//  export: 보스 소개 / 사망 로그
// ════════════════════════════════════════════════════════════════════
export function getBossIntroLogs() {
  return [
    `${BOSS_NAME}이/가 등장했다!`,
    `${BOSS_NAME}: "나의 예언을 비웃을 수 있다고 생각해?"`,
  ]
}

export function getDeathLogs() {
  return [
    `${BOSS_NAME}: "…설마. 내 미래에 이런 결말이 있었다니."`,
    `${BOSS_NAME}이/가 쓰러졌다!`,
  ]
}

// ════════════════════════════════════════════════════════════════════
//  export: 2페이즈 / 3페이즈 진입 체크
// ════════════════════════════════════════════════════════════════════
export function checkPhase2Enter(data, nextState, command) {
  if (getPhase(data) >= 2) return null
  if (data._phase2Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > PHASE2_HP_RATIO) return null
  return {
    logs: [
      `${BOSS_NAME}${josa(BOSS_NAME, "의")} HP가 80% 아래로 내려갔다!`,
      `${BOSS_NAME}: 재미있군. 이제부터 진지하게 놀아볼까?`,
      "마폭시는 기세등등하다!",
    ],
    nextState:        { ...nextState, phase: 2, step: 1, p2PhaseStep: 1 },
    clearBeedrills:   false,
    forceFirst:       true,
    setPhase2Entered: true,
  }
}

export function checkPhase3Enter(data, nextState, command) {
  if (getPhase(data) >= 3) return null
  if (data._phase3Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > PHASE3_HP_RATIO) return null
  return {
    logs: [
      `${BOSS_NAME}${josa(BOSS_NAME, "의")} HP가 60% 아래로 내려갔다!`,
      `${BOSS_NAME}: "이 정도면 충분히 놀았어. 이제 예언을 들어."`,
      "3페이즈 돌입! 마폭시가 예언한다!",
    ],
    nextState:        { ...nextState, phase: 3, p3Step: 1 },
    clearBeedrills:   false,
    forceFirst:       true,
    setPhase3Entered: true,
  }
}

// ════════════════════════════════════════════════════════════════════
//  export: EOT 처리
// ════════════════════════════════════════════════════════════════════
export function processDelphoxEot(data, entries, logEntries) {
  if ((data.boss_reflectorTurns ?? 0) > 0) {
    data.boss_reflectorTurns--
    if (data.boss_reflectorTurns <= 0)
      logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 리플렉터가 사라졌다!`))
  }
  PLAYER_SLOTS.forEach(s => {
    const p = activePkmn(s, data, entries)
    if (!p) return
    if ((p.sealedMoveTurns ?? 0) > 0) {
      p.sealedMoveTurns--
      if (p.sealedMoveTurns <= 0) {
        logEntries.push(makeLog("normal", `${p.name}${josa(p.name, "의")} ${p.sealedMove} 봉인이 풀렸다!`))
        p.sealedMove      = null
        p.sealedMoveTurns = 0
      }
    }
  })
}

// ════════════════════════════════════════════════════════════════════
//  export: 예언 추적 훅 (raidUseMove.js 에서 호출)
// ════════════════════════════════════════════════════════════════════
export function trackProphecyData(slot, moveName, hasPower, damage, data) {
  const prophecy = data.boss_prophecy
  if (!prophecy || prophecy.triggered) return

  if (prophecy.type === "passive" && !hasPower) {
    const arr = prophecy.passiveSlots ?? []
    if (!arr.includes(slot)) arr.push(slot)
    prophecy.passiveSlots = arr
    data.boss_prophecy    = prophecy
  }
  if (prophecy.type === "repeat") {
    const lastMoves = data.boss_prophecyLastMoves ?? {}
    if (lastMoves[slot] === moveName) {
      const arr = prophecy.repeatSlots ?? []
      if (!arr.includes(slot)) arr.push(slot)
      prophecy.repeatSlots = arr
      data.boss_prophecy   = prophecy
    }
    lastMoves[slot] = moveName
    data.boss_prophecyLastMoves = lastMoves
  }
  if (prophecy.type === "strongest" && damage > 0) {
    data[`${slot}_total_damage_to_boss`] =
      (data[`${slot}_total_damage_to_boss`] ?? 0) + damage
  }
}

// ════════════════════════════════════════════════════════════════════
//  export: 속임수 리다이렉트 체크 (raidUseMove.js 에서 호출)
// ════════════════════════════════════════════════════════════════════
export function checkTrickeryRedirect(attackerSlot, targetSlot, data, entries) {
  if (!data.boss_trickery) return { redirected: false }
  if (targetSlot !== "boss") return { redirected: false }
  if (data.boss_brandedSlot !== attackerSlot) return { redirected: false }

  const allies = getAlivePlayers(data, entries).filter(s => s !== attackerSlot)
  if (allies.length === 0) return { redirected: false }

  const friendlySlot = allies[Math.floor(Math.random() * allies.length)]
  return { redirected: true, friendlySlot }
}