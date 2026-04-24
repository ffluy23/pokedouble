// lib/bosses/delphox.js
// 마폭시 보스 AI

import { getTypeMultiplier } from "../typeChart.js"
import { josa }              from "../effecthandler.js"
import { makeLog, PLAYER_SLOTS, getAlivePlayers, defaultRanks, getActiveRankVal } from "../raidBossAction.js"

// ════════════════════════════════════════════════════════════════════
//  상수
// ════════════════════════════════════════════════════════════════════
const BOSS_NAME          = "마폭시"
const PHASE2_HP_RATIO    = 0.80   // 80% 이하 → 2페이즈
const PHASE3_HP_RATIO    = 0.60   // 60% 이하 → 3페이즈
const BRAND_DMG_BONUS    = 0.10   // [낙인] 피해 +10%
const REFLECTOR_TURNS    = 3      // 리플렉터 지속 턴
const REFLECTOR_MULT     = 0.75   // 리플렉터 경감
const TRICKERY_REDUCE    = 0.70   // 속임수 70%만 아군이 받음 (30% 경감)
const SEAL_TURNS         = 3      // 봉인 지속 턴
const TRICK_TURNS        = 3      // 트릭 HP 교환 지속 턴
const TRICK_MIN_RATIO    = 0.22   // 트릭 종료 시 최소 보장 HP 비율
const BRAND_BLAST_DMG    = 100    // 질투의불꽃 고정 데미지
const PROPHECY_POWER     = 70     // 미래예지 발동 데미지
const PROPHECY_ROUNDS    = 2      // 미래예지 발동 라운드

// ════════════════════════════════════════════════════════════════════
//  유틸
// ════════════════════════════════════════════════════════════════════

/** 살아있는 플레이어 중 랜덤 1명 */
function randomAlive(data, entries) {
  const alive = getAlivePlayers(data, entries)
  if (alive.length === 0) return null
  return alive[Math.floor(Math.random() * alive.length)]
}

/** 특정 슬롯의 현재 활성 포켓몬 */
function activePkmn(slot, data, entries) {
  const idx = data[`${slot}_active_idx`] ?? 0
  return entries[slot]?.[idx] ?? null
}

/** 가장 약한 타입으로 공격할 기술 선택 (환상빔 vs 매지컬플레임) */
function chooseBestAttack(data, entries) {
  const targets = getAlivePlayers(data, entries)
  if (targets.length === 0) return "환상빔"

  // 전체 살아있는 포켓몬의 타입 배열을 모아서 평균 배율 계산
  const candidates = ["환상빔", "매지컬플레임"]
  const moveTypes  = { "환상빔": "에스퍼", "매지컬플레임": "불" }

  let bestMove  = "환상빔"
  let bestScore = -Infinity

  for (const mv of candidates) {
    let totalMult = 0
    let count     = 0
    for (const s of targets) {
      const pkmn  = activePkmn(s, data, entries)
      if (!pkmn) continue
      const types = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
      let mult = 1
      for (const t of types) mult *= getTypeMultiplier(moveTypes[mv], t)
      totalMult += mult
      count++
    }
    const avg = count > 0 ? totalMult / count : 1
    if (avg > bestScore) { bestScore = avg; bestMove = mv }
  }
  return bestMove
}

// ════════════════════════════════════════════════════════════════════
//  [낙인] 처리
// ════════════════════════════════════════════════════════════════════

/** 낙인 부여 */
function applyBrand(targetSlot, data, entries, logEntries) {
  // 기존 낙인 제거
  PLAYER_SLOTS.forEach(s => {
    const p = activePkmn(s, data, entries)
    if (p) p.branded = false
  })

  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn || pkmn.hp <= 0) return null
  pkmn.branded = true
  data.boss_state = { ...(data.boss_state ?? {}), brandedSlot: targetSlot }
  logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "은는")} [낙인]을 받았다!`))
  return targetSlot
}

/** 낙인 대상 슬롯 반환 */
function getBrandedSlot(data, entries) {
  const stored = data.boss_state?.brandedSlot
  if (stored) {
    const p = activePkmn(stored, data, entries)
    if (p && p.branded && p.hp > 0) return stored
  }
  // fallback: 엔트리 스캔
  for (const s of PLAYER_SLOTS) {
    const p = activePkmn(s, data, entries)
    if (p?.branded) return s
  }
  return null
}

/** 낙인 제거 */
function clearBrand(data, entries, logEntries) {
  PLAYER_SLOTS.forEach(s => {
    const p = activePkmn(s, data, entries)
    if (p) p.branded = false
  })
  data.boss_state = { ...(data.boss_state ?? {}), brandedSlot: null }
  if (logEntries) logEntries.push(makeLog("normal", "[낙인]이 사라졌다!"))
}

// ════════════════════════════════════════════════════════════════════
//  [리플렉터] 처리
// ════════════════════════════════════════════════════════════════════

function applyReflector(data, logEntries) {
  data.boss_reflectorTurns = REFLECTOR_TURNS
  logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "은는")} 리플렉터를 펼쳤다! (${REFLECTOR_TURNS}턴)`))
}

// ════════════════════════════════════════════════════════════════════
//  [속임수] 처리
// ════════════════════════════════════════════════════════════════════

function activateTrickery(data, logEntries) {
  data.boss_trickery = true
  logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 속임수! 낙인 받은 자의 공격은 아군에게 향한다!`))
}

// ════════════════════════════════════════════════════════════════════
//  [봉인] 처리
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
  logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 봉인! ${pkmn.name}${josa(pkmn.name, "의")} ${lastMove}${josa(lastMove, "을를")} ${SEAL_TURNS}턴간 봉인했다!`))
}

// ════════════════════════════════════════════════════════════════════
//  [질투의불꽃] 처리
// ════════════════════════════════════════════════════════════════════

function processBrandBlast(data, entries, logEntries) {
  const targetSlot = getBrandedSlot(data, entries)
  if (!targetSlot) {
    logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 질투의불꽃! 하지만 낙인 대상이 없다…`))
    return
  }
  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn || pkmn.hp <= 0) { clearBrand(data, entries, null); return }

  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 질투의불꽃!`))
  logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "의")} [낙인]이 폭발했다!`))

  if (pkmn.enduring && BRAND_BLAST_DMG >= pkmn.hp) {
    pkmn.hp = 1; pkmn.enduring = false
    logEntries.push(makeLog("after_hit", `${pkmn.name}${josa(pkmn.name, "은는")} 버텼다!`))
  } else {
    pkmn.hp = Math.max(0, pkmn.hp - BRAND_BLAST_DMG)
  }
  pkmn.tookDamageLastTurn = true
  logEntries.push(makeLog("hit", "", { defender: targetSlot }))
  logEntries.push(makeLog("hp",  "", { slot: targetSlot, hp: pkmn.hp, maxHp: pkmn.maxHp }))
  if (pkmn.hp <= 0) logEntries.push(makeLog("faint", `${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`, { slot: targetSlot }))

  clearBrand(data, entries, null)
}

// ════════════════════════════════════════════════════════════════════
//  [트릭] 처리
// ════════════════════════════════════════════════════════════════════

function processTrick(data, entries, logEntries) {
  const alive = getAlivePlayers(data, entries)
  if (alive.length < 2) {
    logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 트릭! 하지만 대상이 부족하다…`))
    return
  }

  // 현재 HP 스냅샷 저장 (원래 주인 추적용)
  const snapshot = {}
  alive.forEach(s => {
    const p = activePkmn(s, data, entries)
    if (p) snapshot[s] = { hp: p.hp, maxHp: p.maxHp, owner: s }
  })

  // 섞기 — 자기 자신에게 돌아오지 않도록 Fisher-Yates 변형
  const slots  = alive.slice()
  const hpList = slots.map(s => snapshot[s].hp)
  let shuffled

  // 최대 20번 시도해서 모든 슬롯이 다른 사람 HP 받도록
  for (let attempt = 0; attempt < 20; attempt++) {
    shuffled = [...hpList]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const noSelf = slots.every((s, i) => hpList[i] !== shuffled[i] || slots.length <= 1)
    if (noSelf) break
  }

  // HP 교환 적용 + 원래 HP 백업 저장 (복원용)
  const trickState = { ownerHp: {}, assignedSlot: {} }
  slots.forEach((s, i) => {
    const p = activePkmn(s, data, entries)
    if (!p) return
    trickState.ownerHp[s]     = snapshot[s].hp      // 복원 시 사용할 원래 주인의 HP
    trickState.assignedSlot[s] = slots[hpList.indexOf(shuffled[i])] ?? s  // 이 슬롯에 붙은 HP의 원래 주인
    p.hp = shuffled[i]
    // HP가 교환으로 0 이하 방지
    if (p.hp <= 0) p.hp = 1
  })

  data.boss_trickTurns = TRICK_TURNS
  data.boss_trickState = trickState

  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 트릭!`))
  logEntries.push(makeLog("normal", `플레이어들의 HP가 뒤죽박죽 섞였다! (${TRICK_TURNS}턴 후 반환)`))
  slots.forEach(s => {
    const p = activePkmn(s, data, entries)
    if (p) logEntries.push(makeLog("hp", "", { slot: s, hp: p.hp, maxHp: p.maxHp }))
  })
}

/** 트릭 종료 시 HP 반환 */
function resolveTrick(data, entries, logEntries) {
  const trickState = data.boss_trickState
  if (!trickState) return

  logEntries.push(makeLog("normal", "트릭이 종료되었다! HP가 원래 주인에게 돌아간다!"))

  PLAYER_SLOTS.forEach(s => {
    const p = activePkmn(s, data, entries)
    if (!p) return
    const minHp = Math.max(1, Math.floor(p.maxHp * TRICK_MIN_RATIO))

    if (trickState.ownerHp[s] !== undefined) {
      // 이 슬롯의 원래 HP = 교환 당시 자기 HP였던 값 (trickState에 보관)
      // 단, 이미 죽은 경우 최솟값 보장
      const returnHp = Math.max(minHp, trickState.ownerHp[s])
      p.hp = Math.min(returnHp, p.maxHp)
    } else {
      p.hp = Math.max(p.hp, minHp)
    }

    logEntries.push(makeLog("hp", "", { slot: s, hp: p.hp, maxHp: p.maxHp }))
  })

  data.boss_trickTurns = 0
  data.boss_trickState = null
}

// ════════════════════════════════════════════════════════════════════
//  [미래예지] 처리
// ════════════════════════════════════════════════════════════════════

const PROPHECY_TYPES = ["strongest", "wounded", "passive", "repeat"]

/**
 * 미래예지 발동
 * prophecyType: "strongest" | "wounded" | "passive" | "repeat"
 */
function activateProphecy(prophecyType, data, entries, logEntries) {
  const roundNow = data.round_count ?? 1

  data.boss_prophecy = {
    type:        prophecyType,
    activateAt:  roundNow + PROPHECY_ROUNDS,
    triggered:   false,
    // 예언 3번용: 이번 라운드 passive 행동자 추적
    passiveSlots: [],
    // 예언 4번용: 같은 기술 2회 연속 사용자 추적
    repeatSlots:  [],
  }

  const PROPHECY_TEXTS = {
    strongest: `"${BOSS_NAME}: ${PROPHECY_ROUNDS}라운드 후, 가장 강한 자는 피할 수 없다."`,
    wounded:   `"${BOSS_NAME}: ${PROPHECY_ROUNDS}라운드 후, 상처 입은 자는 보호받지 못한다."`,
    passive:   `"${BOSS_NAME}: 다음 행동에서 검을 들지 않은 자는 고통스럽다."`,
    repeat:    `"${BOSS_NAME}: ${PROPHECY_ROUNDS}라운드 이내에 같은 길을 걷는 자는 벌을 받는다."`,
  }

  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 미래예지!`))
  // 예언 텍스트는 화면에 둥둥 뜨는 스타일로 — 특수 타입 사용
  logEntries.push(makeLog("prophecy_text", PROPHECY_TEXTS[prophecyType]))
}

/**
 * 미래예지 발동 체크 (매 라운드 시작 시 또는 보스 턴에서 호출)
 * 반환: { fired: boolean, targetSlots: string[], success: boolean }
 */
function checkProphecyFire(data, entries, logEntries) {
  const prophecy = data.boss_prophecy
  if (!prophecy || prophecy.triggered) return { fired: false }

  const roundNow = data.round_count ?? 1
  if (roundNow < prophecy.activateAt) return { fired: false }

  // 발동
  prophecy.triggered = true
  data.boss_prophecy = prophecy

  let targetSlots = []

  switch (prophecy.type) {
    case "strongest": {
      // 가장 많은 데미지를 보스에게 넣은 플레이어
      let maxDmg  = -1
      let maxSlot = null
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
      // 가장 마지막에 피해를 받은 플레이어
      const lastSlot = data.boss_lastHitSlot ?? null
      if (lastSlot) {
        const p = activePkmn(lastSlot, data, entries)
        if (p && p.hp > 0) targetSlots = [lastSlot]
      }
      break
    }
    case "passive": {
      // 예언 라운드 동안 power>0 기술 안 쓴 플레이어
      targetSlots = (prophecy.passiveSlots ?? []).filter(s => {
        const p = activePkmn(s, data, entries)
        return p && p.hp > 0
      })
      break
    }
    case "repeat": {
      // 같은 기술을 2회 연속 사용한 플레이어
      targetSlots = (prophecy.repeatSlots ?? []).filter(s => {
        const p = activePkmn(s, data, entries)
        return p && p.hp > 0
      })
      break
    }
  }

  return { fired: true, targetSlots, success: targetSlots.length > 0 }
}

/**
 * 미래예지 데미지 적용
 */
function applyProphecyDamage(targetSlots, data, entries, logEntries) {
  const { fired, success } = checkProphecyFire(data, entries, logEntries)
  // 이미 checkProphecyFire 에서 처리됨 — 여기선 데미지만 적용
  for (const s of targetSlots) {
    const pkmn = activePkmn(s, data, entries)
    if (!pkmn || pkmn.hp <= 0) continue

    const defTypes = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
    let mult = 1
    for (const t of defTypes) mult *= getTypeMultiplier("에스퍼", t)

    if (mult === 0) {
      logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`))
      continue
    }

    const damage = Math.max(1, Math.floor(PROPHECY_POWER * mult))
    if (pkmn.enduring && damage >= pkmn.hp) {
      pkmn.hp = 1; pkmn.enduring = false
      logEntries.push(makeLog("after_hit", `${pkmn.name}${josa(pkmn.name, "은는")} 버텼다!`))
    } else {
      pkmn.hp = Math.max(0, pkmn.hp - damage)
    }
    pkmn.tookDamageLastTurn = true
    logEntries.push(makeLog("hit",  "", { defender: s }))
    logEntries.push(makeLog("hp",   "", { slot: s, hp: pkmn.hp, maxHp: pkmn.maxHp }))
    if (pkmn.hp <= 0) logEntries.push(makeLog("faint", `${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`, { slot: s }))
  }
}

// ════════════════════════════════════════════════════════════════════
//  페이즈 체크
// ════════════════════════════════════════════════════════════════════

function getPhase(data) {
  return data.boss_state?.phase ?? 1
}

function checkPhase2Enter(data, nextState, command) {
  if (getPhase(data) >= 2) return null
  if (data._phase2Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > PHASE2_HP_RATIO) return null

  return {
    logs: [
      `${BOSS_NAME}${josa(BOSS_NAME, "의")} HP가 80% 아래로 내려갔다!`,
      `${BOSS_NAME}: "재미있군. 이제부터 진지하게 놀아볼까?"`,
      "2페이즈 돌입! 마폭시가 반드시 먼저 행동한다!",
    ],
    nextState: { ...nextState, phase: 2, step: 1, p2PhaseStep: 1 },
    clearBeedrills: false,
    forceFirst: true,
    setPhase2Entered: true,
  }
}

function checkPhase3Enter(data, nextState, command) {
  if (getPhase(data) >= 3) return null
  if (data._phase3Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > PHASE3_HP_RATIO) return null

  return {
    logs: [
      `${BOSS_NAME}${josa(BOSS_NAME, "의")} HP가 60% 아래로 내려갔다!`,
      `${BOSS_NAME}: "이 정도면 충분히 놀았어. 이제 예언을 들어."`,
      "3페이즈 돌입! 마폭시가 반드시 먼저 행동한다!",
    ],
    nextState: { ...nextState, phase: 3, step: 1, p3ProphecyDone: false },
    clearBeedrills: false,
    forceFirst: true,
    setPhase3Entered: true,
  }
}

// ════════════════════════════════════════════════════════════════════
//  보스 AI 소개 / 사망 로그
// ════════════════════════════════════════════════════════════════════

function getBossIntroLogs() {
  return [
    `${BOSS_NAME}이/가 등장했다!`,
    `${BOSS_NAME}: "나의 예언을 비웃을 수 있다고 생각해?"`,
  ]
}

function getDeathLogs() {
  return [
    `${BOSS_NAME}: "…설마. 내 미래에 이런 결말이 있었다니."`,
    `${BOSS_NAME}이/가 쓰러졌다!`,
  ]
}

// ════════════════════════════════════════════════════════════════════
//  1페이즈 행동 결정
// ════════════════════════════════════════════════════════════════════

function decidePhase1(data, entries) {
  const state = data.boss_state ?? {}
  const step  = state.step ?? 1

  // step 1: 도깨비불 → 낙인 부여
  if (step === 1) {
    return {
      command:   "delphox_brand",
      commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 도깨비불!`,
      nextState: { ...state, step: 2 },
    }
  }

  // step 2: 낙인 대상에게 매지컬플레임 (낙인 소멸)
  if (step === 2) {
    return {
      command:   "delphox_magical_flame",
      commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 매지컬플레임!`,
      nextState: { ...state, step: 3 },
    }
  }

  // step 3: 랜덤 타깃에게 환상빔
  return {
    command:   "delphox_psybeam",
    commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 환상빔!`,
    nextState: { ...state, step: 1 },
  }
}

// ════════════════════════════════════════════════════════════════════
//  2페이즈 행동 결정
// ════════════════════════════════════════════════════════════════════

function decidePhase2(data, entries) {
  const state = data.boss_state ?? {}
  const step  = state.p2PhaseStep ?? 1

  // step 1: 도깨비불 + 속임수 동시 발동
  if (step === 1) {
    return {
      command:    "delphox_p2_brand_trickery",
      commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 도깨비불 & 속임수!`,
      nextState:  { ...state, p2PhaseStep: 2 },
    }
  }

  // step 2: 리플렉터 + 봉인 동시 발동
  if (step === 2) {
    return {
      command:    "delphox_p2_reflector_seal",
      commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 리플렉터 & 봉인!`,
      nextState:  { ...state, p2PhaseStep: 3 },
    }
  }

  // step 3: 질투의불꽃 (낙인 폭발)
  if (step === 3) {
    return {
      command:    "delphox_brand_blast",
      commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 질투의불꽃!`,
      nextState:  { ...state, p2PhaseStep: 4 },
    }
  }

  // step 4+: 환상빔 or 매지컬플레임 (타입 유리 우선)
  return {
    command:    "delphox_best_attack",
    commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 공격!`,
    nextState:  { ...state, p2PhaseStep: step < 5 ? step + 1 : 1 },
  }
}

// ════════════════════════════════════════════════════════════════════
//  3페이즈 행동 결정
// ════════════════════════════════════════════════════════════════════

function decidePhase3(data, entries) {
  const state       = data.boss_state ?? {}
  const step        = state.p3Step ?? 1
  const prophecy    = data.boss_prophecy
  const roundNow    = data.round_count ?? 1

  // step 1: 트릭 + 리플렉터
  if (step === 1) {
    return {
      command:    "delphox_p3_trick_reflector",
      commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 트릭 & 리플렉터!`,
      nextState:  { ...state, p3Step: 2 },
    }
  }

  // step 2: 미래예지 선택
  if (step === 2) {
    const typeIdx    = Math.floor(Math.random() * PROPHECY_TYPES.length)
    const pType      = PROPHECY_TYPES[typeIdx]
    return {
      command:     "delphox_prophecy",
      prophecyType: pType,
      commandLog:  `${BOSS_NAME}${josa(BOSS_NAME, "의")} 미래예지!`,
      nextState:   { ...state, p3Step: 3 },
    }
  }

  // step 3~4 (미래예지 진행 중): 공격 기술
  if (step === 3 || step === 4) {
    // 미래예지 발동 체크
    if (prophecy && !prophecy.triggered && roundNow >= prophecy.activateAt) {
      return {
        command:    "delphox_prophecy_fire",
        commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 예언이 실현된다!`,
        nextState:  { ...state, p3Step: 1 },
      }
    }
    // 아직 발동 전 → 공격
    return {
      command:    "delphox_best_attack",
      commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 공격!`,
      nextState:  { ...state, p3Step: step + 1 },
    }
  }

  // step 5: 예언 발동 (늦게 발동되는 경우)
  if (prophecy && !prophecy.triggered) {
    return {
      command:    "delphox_prophecy_fire",
      commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 예언이 실현된다!`,
      nextState:  { ...state, p3Step: 1 },
    }
  }

  // 예언 끝났으면 처음으로
  return {
    command:    "delphox_best_attack",
    commandLog: `${BOSS_NAME}${josa(BOSS_NAME, "의")} 공격!`,
    nextState:  { ...state, p3Step: 1 },
  }
}

// ════════════════════════════════════════════════════════════════════
//  메인 decideBossMove
// ════════════════════════════════════════════════════════════════════

export function decideBossMove(data, entries, playerSlots) {
  const phase = getPhase(data)
  if (phase === 3) return decidePhase3(data, entries)
  if (phase === 2) return decidePhase2(data, entries)
  return decidePhase1(data, entries)
}

// ════════════════════════════════════════════════════════════════════
//  executeBossAction 에서 호출할 커맨드 처리 함수 모음
//  raidBossAction.js 의 executeBossAction 안에서
//  command 별 분기에 아래 함수를 추가해야 함
// ════════════════════════════════════════════════════════════════════

/**
 * 마폭시 전용 커맨드 일괄 처리
 * raidBossAction.js 의 executeBossAction 분기에서:
 *   else if (command?.startsWith("delphox_")) {
 *     processDelphoxCommand(command, decision, data, entries, logEntries)
 *   }
 * 로 호출
 */
export function processDelphoxCommand(command, decision, data, entries, logEntries) {
  const bossName = BOSS_NAME

  switch (command) {

    // ── 1페이즈 ──────────────────────────────────────────────────
    case "delphox_brand": {
      const target = randomAlive(data, entries)
      if (!target) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); break }
      applyBrand(target, data, entries, logEntries)
      break
    }

    case "delphox_magical_flame": {
      const branded = getBrandedSlot(data, entries)
      const target  = branded ?? randomAlive(data, entries)
      if (!target) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); break }
      _attackTarget("매지컬플레임", target, data, entries, logEntries, bossName)
      // 낙인 제거
      if (branded) clearBrand(data, entries, logEntries)
      break
    }

    case "delphox_psybeam": {
      const target = randomAlive(data, entries)
      if (!target) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); break }
      _attackTarget("환상빔", target, data, entries, logEntries, bossName)
      break
    }

    // ── 2페이즈 ──────────────────────────────────────────────────
    case "delphox_p2_brand_trickery": {
      const target = randomAlive(data, entries)
      if (target) applyBrand(target, data, entries, logEntries)
      activateTrickery(data, logEntries)
      break
    }

    case "delphox_p2_reflector_seal": {
      applyReflector(data, logEntries)
      const branded = getBrandedSlot(data, entries)
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
      _attackTarget(mv, target, data, entries, logEntries, bossName)
      break
    }

    // ── 3페이즈 ──────────────────────────────────────────────────
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
      const prophecy = data.boss_prophecy
      if (!prophecy) break

      // 발동 대상 계산
      const result = checkProphecyFire(data, entries, logEntries)

      if (result.fired && result.targetSlots.length > 0) {
        // 예언 성공
        logEntries.push(makeLog("prophecy_text", `"${bossName}: 감히 나를 의심해?"`))
        logEntries.push(makeLog("move_announce", `${bossName}${josa(bossName, "의")} 미래예지 발동!`))
        applyProphecyDamage(result.targetSlots, data, entries, logEntries)
      } else {
        // 예언 실패 (플레이어가 조건 지킴)
        logEntries.push(makeLog("prophecy_text", `"${bossName}: 그 선택, 몇 번이나 반복할 생각이지?"`))
      }

      // 트릭 종료 체크
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
//  공격 헬퍼 (낙인 +10% 포함)
// ════════════════════════════════════════════════════════════════════

import { bossMoves } from "../bossMoves.js"
import { getWeatherDamageMult } from "../weather.js"
import { rollD10 } from "../gameUtils.js"

function _attackTarget(moveName, targetSlot, data, entries, logEntries, bossName) {
  const { bossMoves: bm } = { bossMoves }
  const moveInfo  = bossMoves[moveName]
  if (!moveInfo) { logEntries.push(makeLog("normal", `기술 정보 없음: ${moveName}`)); return }

  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn || pkmn.hp <= 0) { logEntries.push(makeLog("normal", "공격할 대상이 이미 쓰러졌다!")); return }

  const dice     = rollD10()
  const defTypes = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
  let mult = 1
  for (const t of defTypes) mult *= getTypeMultiplier(moveInfo.type, t)

  logEntries.push(makeLog("move_announce", `${bossName}${josa(bossName, "의")} ${moveName}!`))
  logEntries.push(makeLog("dice", "", { slot: "boss", roll: dice }))

  if (mult === 0) {
    logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`))
    return
  }

  const bossAtk  = (data.boss_attack ?? 5) + getActiveRankVal(data.boss_rank ?? {}, "atk")
  const defStat  = pkmn.defense ?? 3
  const defRank  = getActiveRankVal(pkmn.ranks ?? {}, "def")
  const power    = moveInfo.power ?? 40
  const wMult    = getWeatherDamageMult(data.weather ?? null, moveInfo.type)
  const raw      = Math.floor((power + bossAtk * 4 + dice) * mult * wMult)
  let   damage   = Math.max(1, raw - defStat * 3 - defRank * 3)

  // [리플렉터] 경감
  if ((data.boss_reflectorTurns ?? 0) > 0) {
    damage = Math.max(1, Math.floor(damage * REFLECTOR_MULT))
    logEntries.push(makeLog("normal", `리플렉터가 피해를 줄였다!`))
  }

  // [낙인] +10%
  if (pkmn.branded) {
    damage = Math.floor(damage * (1 + BRAND_DMG_BONUS))
    logEntries.push(makeLog("after_hit", `[낙인] 상태라 피해가 10% 증가했다!`))
  }

  if (mult > 1) logEntries.push(makeLog("after_hit", "효과가 굉장했다!"))
  if (mult < 1) logEntries.push(makeLog("after_hit", "효과가 별로인 듯하다…"))

  if (pkmn.enduring && damage >= pkmn.hp) {
    pkmn.hp = 1; pkmn.enduring = false
    logEntries.push(makeLog("after_hit", `${pkmn.name}${josa(pkmn.name, "은는")} 버텼다!`))
  } else {
    pkmn.hp = Math.max(0, pkmn.hp - damage)
  }
  pkmn.tookDamageLastTurn = true
  pkmn.last_damage_taken  = damage

  // 마지막으로 피해받은 슬롯 추적 (예언 2번용)
  data.boss_lastHitSlot = targetSlot

  logEntries.push(makeLog("hit", "", { defender: targetSlot }))
  logEntries.push(makeLog("hp",  "", { slot: targetSlot, hp: pkmn.hp, maxHp: pkmn.maxHp }))
  if (pkmn.hp <= 0) logEntries.push(makeLog("faint", `${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`, { slot: targetSlot }))
}

// ════════════════════════════════════════════════════════════════════
//  shouldTriggerUlt / getUltTarget — 마폭시는 패턴형 ult라 불필요
// ════════════════════════════════════════════════════════════════════

export function shouldTriggerUlt(data) { return false }
export function getUltTarget(data, entries, playerSlots) { return null }
export function nextUltCooldown() { return 0 }

// ════════════════════════════════════════════════════════════════════
//  페이즈 체크 훅 (raidBossAction 에서 호출)
// ════════════════════════════════════════════════════════════════════

export { checkPhase2Enter, getBossIntroLogs, getDeathLogs }

/**
 * checkPhase2Enter 와 같은 방식으로 3페이즈 체크
 * raidBossAction.js 의 executeBossAction 에서:
 *   if (bossAI.checkPhase3Enter) { ... }
 * 로 호출
 */
export function checkPhase3Enter(data, nextState, command) {
  if (getPhase(data) >= 3) return null
  if (data._phase3Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > PHASE3_HP_RATIO) return null

  return {
    logs: [
      `${BOSS_NAME}${josa(BOSS_NAME, "의")} HP가 60% 아래로 내려갔다!`,
      `${BOSS_NAME}: "이 정도면 충분히 놀았어. 이제 예언을 들어."`,
      "3페이즈 돌입! 마폭시가 반드시 먼저 행동한다!",
    ],
    nextState: { ...nextState, phase: 3, p3Step: 1, p3ProphecyDone: false },
    clearBeedrills: false,
    forceFirst: true,
    setPhase3Entered: true,
  }
}

// ════════════════════════════════════════════════════════════════════
//  트릭 EOT 처리 (매 턴 boss_trickTurns 감소)
//  raidBossAction.js 의 executeBossAction 마지막 부분에서:
//    if (bossAI.processDelphoxEot) bossAI.processDelphoxEot(data, entries, logEntries)
//  로 호출
// ════════════════════════════════════════════════════════════════════

export function processDelphoxEot(data, entries, logEntries) {
  // 리플렉터 턴 감소
  if ((data.boss_reflectorTurns ?? 0) > 0) {
    data.boss_reflectorTurns--
    if (data.boss_reflectorTurns <= 0) {
      logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 리플렉터가 사라졌다!`))
    }
  }

  // 봉인 턴 감소
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

  // 예언 passive/repeat 추적은 raidUseMove.js 에서 처리 필요
}

// ════════════════════════════════════════════════════════════════════
//  예언 추적용 훅 (raidUseMove.js 에서 호출)
//  플레이어가 기술을 사용할 때마다 아래 함수로 추적 데이터 업데이트
// ════════════════════════════════════════════════════════════════════

/**
 * 플레이어 기술 사용 후 호출
 * @param {string} slot        사용자 슬롯 (p1/p2/p3)
 * @param {string} moveName    사용한 기술 이름
 * @param {boolean} hasPower   power > 0 인지
 * @param {number}  damage     실제 가한 데미지
 * @param {object}  data       현재 room data (mutable)
 */
export function trackProphecyData(slot, moveName, hasPower, damage, data) {
  const prophecy = data.boss_prophecy
  if (!prophecy || prophecy.triggered) return

  // 예언 3번: power 없는 기술 사용자 추적
  if (prophecy.type === "passive" && !hasPower) {
    const arr = prophecy.passiveSlots ?? []
    if (!arr.includes(slot)) arr.push(slot)
    prophecy.passiveSlots = arr
    data.boss_prophecy    = prophecy
  }

  // 예언 4번: 같은 기술 2회 연속 사용 추적
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

  // 예언 1번: 보스에게 넣은 누적 데미지 추적
  if (prophecy.type === "strongest" && damage > 0) {
    data[`${slot}_total_damage_to_boss`] =
      (data[`${slot}_total_damage_to_boss`] ?? 0) + damage
  }
}

// ════════════════════════════════════════════════════════════════════
//  속임수 훅 (raidUseMove.js 에서 플레이어 공격 직전 체크)
//  낙인 대상이 보스를 공격할 때 → 아군이 대신 데미지 받음
// ════════════════════════════════════════════════════════════════════

/**
 * 속임수 발동 여부 체크
 * @returns {{ redirected: true, friendlySlot: string } | { redirected: false }}
 */
export function checkTrickeryRedirect(attackerSlot, targetSlot, data, entries) {
  if (!data.boss_trickery) return { redirected: false }
  if (targetSlot !== "boss") return { redirected: false }

  const pkmn = activePkmn(attackerSlot, data, entries)
  if (!pkmn?.branded) return { redirected: false }

  // 살아있는 아군 중 랜덤 1명 (자신 제외)
  const allies = getAlivePlayers(data, entries).filter(s => s !== attackerSlot)
  if (allies.length === 0) return { redirected: false }

  const friendlySlot = allies[Math.floor(Math.random() * allies.length)]
  return { redirected: true, friendlySlot }
}