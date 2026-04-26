// lib/bosses/zoroark.js
// 조로아크 보스 AI

import { moves } from "../moves.js"
import { bossMoves } from "../bossMoves.js"
import { getTypeMultiplier } from "../typeChart.js"
import { PLAYER_SLOTS } from "../raidBossAction.js"

// ── 페이즈 판별 ─────────────────────────────────────────────────────
function getPhase(data) {
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (data._phase3Entered) return 3
  if (data._phase2Entered) return 2
  if (ratio <= 0.5)  return 3   // 50% 이하 → 3페이즈
  if (ratio <= 0.80) return 2   // 80% 이하 → 2페이즈
  return 1
}

// ── 살아있는 플레이어 목록 ───────────────────────────────────────────
function getAlivePlayers(data, entries) {
  return PLAYER_SLOTS.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0
  })
}

// ── [원한] 부여된 플레이어 목록 ─────────────────────────────────────
function getGrudgePlayers(data, entries) {
  return PLAYER_SLOTS.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0 && pkmn.grudge
  })
}

// ── [원한] 없는 살아있는 플레이어 ───────────────────────────────────
function getNonGrudgePlayers(data, entries) {
  const alive  = getAlivePlayers(data, entries)
  const grudge = getGrudgePlayers(data, entries)
  return alive.filter(s => !grudge.includes(s))
}

// ── 랜덤 선택 헬퍼 ──────────────────────────────────────────────────
function pickRandom(arr) {
  if (!arr || arr.length === 0) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── 빛의장막/리플렉터 적용 여부 ─────────────────────────────────────
function hasBarrier(data, entries) {
  return PLAYER_SLOTS.some(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0 && ((pkmn.lightScreen ?? 0) > 0)
  })
}

// ── 도둑질: 플레이어 기술 중 최적 선택 ──────────────────────────────
// targetSlot을 정해두고 약점 고려해서 가장 효율적인 기술 선택
function selectStealMove(data, entries, targetSlot) {
  const bossTypes = Array.isArray(data.boss_type)
    ? data.boss_type
    : [data.boss_type ?? "악"]

  // 타겟 타입
  const tIdx  = data[`${targetSlot}_active_idx`] ?? 0
  const tPkmn = entries[targetSlot]?.[tIdx]
  const defTypes = tPkmn
    ? (Array.isArray(tPkmn.type) ? tPkmn.type : [tPkmn.type])
    : ["노말"]

  // 각 플레이어 기술 수집
  const candidates = []
  for (const s of PLAYER_SLOTS) {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    if (!pkmn || pkmn.hp <= 0) continue
    for (const mv of (pkmn.moves ?? [])) {
      const info = moves[mv.name] ?? bossMoves[mv.name]
      if (!info || !info.power || info.power <= 0) continue
      // 특수 플래그 있는 기술 제외 (fly, dig, ghostDive, outrage, bide 등)
      if (info.fly || info.dig || info.ghostDive || info.outrage || info.bide
        || info.rollout || info.uTurn || info.hyperBeam || info.solarBlade
        || info.futureSight || info.healWish) continue

      let typeMult = 1
      for (const dt of defTypes) typeMult *= getTypeMultiplier(info.type, dt)

      // STAB 여부 (조로아크 타입: 악, 고스트)
      const stab = bossTypes.includes(info.type) ? 1.3 : 1

      const effectivePower = info.power * typeMult * stab
      candidates.push({ name: mv.name, info, effectivePower, typeMult, from: s })
    }
  }

  if (candidates.length === 0) return null

  // 정렬: effectivePower 내림차순
  candidates.sort((a, b) => b.effectivePower - a.effectivePower)
  return candidates[0]
}

// ── 도발 대사 3종 ────────────────────────────────────────────────────
const PROVOKE_LINES = [
  "자, 나를 공격해봐. 그게 정답이야.",
  "지금이 기회야, 다음 턴엔 늦어.",
  "아무것도 안 하는 건 최악의 선택이지.",
]

// ── getBossIntroLogs ─────────────────────────────────────────────────
export function getBossIntroLogs() {
  return [
    "어둠 속에서 조로아크가 나타났다!",
  ]
}

// ── shouldTriggerUlt ────────────────────────────────────────────────
export function shouldTriggerUlt() { return false }
export function getUltTarget()     { return null }
export function nextUltCooldown()  { return 0 }
export function getDeathLogs() {
  return ["조로아크는 쓰러졌다!"]
}

// ── 2페이즈 진입 체크 ────────────────────────────────────────────────
export function checkPhase2Enter(data, nextState, command) {
  if (data._phase2Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > 0.80) return null
  return {
    logs: [
      "조로아크가 모습을 감추려고 한다!",
    ],
    nextState: {
      ...nextState,
      phase: 2,
      step:  "barrier_check",
      shadowClueDamage: 0,
      grudgeTarget: null,
      stolenMove: null,
      stolenMoveTarget: null,
    },
    setPhase2Entered: true,
  }
}

// ── 3페이즈 진입 체크 ────────────────────────────────────────────────
export function checkPhase3Enter(data, nextState, command) {
  if (data._phase3Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > 0.50) return null

  // 3페이즈 진입 시 원한 전부 제거 + 일루전 해제
  return {
    logs: [
      "일루전이 해제되었다! 조로아크의 진짜 모습이 드러났다!",
    ],
    nextState: {
      ...nextState,
      phase: 3,
      step:  "barrier_check",
      illusionActive: false,
      illusionHp:     null,
      illusionName:   null,
      illusionPortrait: null,
      shadowClueDamage: 0,
      grudgeTarget: null,
      provokeState: null,
    },
    setPhase3Entered: true,
  }
}

// ════════════════════════════════════════════════════════════════════
//  decideBossMove — 메인 AI
// ════════════════════════════════════════════════════════════════════
export function decideBossMove(data, entries, playerSlots) {
  const phase     = getPhase(data)
  const state     = data.boss_state ?? {}
  const bossName  = data.boss_name ?? "조로아크"
  const alive     = getAlivePlayers(data, entries)
  const grudged   = getGrudgePlayers(data, entries)
  const nonGrudge = getNonGrudgePlayers(data, entries)

  if (alive.length === 0) {
    return { command: "idle", log: "공격할 대상이 없다...", nextState: state }
  }

  // ── 도발 후속 처리 (보스 턴 진입 시 이전 라운드 도발 결과 정산) ─
  if (state.provokeResolve) {
    return resolveProvoke(data, entries, state, alive, grudged, nonGrudge, bossName)
  }

  // ── 1페이즈 ──────────────────────────────────────────────────────
  if (phase === 1) {
    return phase1Move(data, entries, state, alive, grudged, nonGrudge, bossName)
  }

  // ── 2페이즈 ──────────────────────────────────────────────────────
  if (phase === 2) {
    return phase2Move(data, entries, state, alive, grudged, nonGrudge, bossName)
  }

  // ── 3페이즈 ──────────────────────────────────────────────────────
  return phase3Move(data, entries, state, alive, grudged, nonGrudge, bossName)
}

// ════════════════════════════════════════════════════════════════════
//  1페이즈: 저주 → 섀도크루 → 섀도크루 → 앙갚음 → 반복
// ════════════════════════════════════════════════════════════════════
function phase1Move(data, entries, state, alive, grudged, nonGrudge, bossName) {
  const step = state.step ?? "curse"

  // STEP 1: 저주 → 원한 부여
  if (step === "curse" || (!step && grudged.length === 0)) {
    const target = pickRandom(alive)
    return {
      command:    "zoroark_curse",
      moveName:   "저주",
      targetSlot: target,
      log:        `${bossName}${josa(bossName, "은는")} 원한을 새겼다!`,
      nextState:  { ...state, step: "shadow1", shadowClueDamage: 0, grudgeTarget: target },
    }
  }

  // STEP 2: 섀도크루 1번째
  if (step === "shadow1") {
    const target = pickRandom(nonGrudge.length > 0 ? nonGrudge : alive)
    return {
      command:    "zoroark_shadowclaw",
      moveName:   "섀도크루",
      targetSlot: target,
      log:        `${bossName}${josa(bossName, "의")} 섀도크루!`,
      nextState:  { ...state, step: "shadow2" },
    }
  }

  // STEP 3: 섀도크루 2번째
  if (step === "shadow2") {
    const target = pickRandom(nonGrudge.length > 0 ? nonGrudge : alive)
    return {
      command:    "zoroark_shadowclaw",
      moveName:   "섀도크루",
      targetSlot: target,
      log:        `${bossName}${josa(bossName, "의")} 섀도크루!`,
      nextState:  { ...state, step: "vengeance" },
    }
  }

  // STEP 4: 앙갚음
  if (step === "vengeance") {
    const target = grudged.length > 0 ? grudged[0] : pickRandom(alive)
    const accDmg = state.shadowClueDamage ?? 0
    return {
      command:    "zoroark_vengeance",
      moveName:   "앙갚음",
      targetSlot: target,
      log:        `${bossName}${josa(bossName, "은는")} 원한을 돌려줬다!`,
      nextState:  { ...state, step: "curse", shadowClueDamage: 0, grudgeTarget: null },
    }
  }

  // 예외: 초기 상태
  return {
    command:    "zoroark_curse",
    moveName:   "저주",
    targetSlot: pickRandom(alive),
    log:        `${bossName}${josa(bossName, "은는")} 원한을 새겼다!`,
    nextState:  { ...state, step: "shadow1", shadowClueDamage: 0 },
  }
}

// ════════════════════════════════════════════════════════════════════
//  2페이즈
// ════════════════════════════════════════════════════════════════════
function phase2Move(data, entries, state, alive, grudged, nonGrudge, bossName) {
  const step = state.step ?? "barrier_check"

  // STEP 1: 깨트리기(장막 있으면) + 일루전
  if (step === "barrier_check") {
    const barrier = hasBarrier(data, entries)
    return {
      command:   "zoroark_phase2_open",
      moveName:  barrier ? "깨트리기" : null,
      log:       barrier
        ? `${bossName}${josa(bossName, "은는")} 장막을 부쉈다!`
        : `${bossName}${josa(bossName, "은는")} 일루전을 펼쳤다!`,
      nextState: { ...state, step: "steal", illusionActive: true },
    }
  }

  // STEP 2: 도둑질 (기술 훔치기 + 공격)
  if (step === "steal") {
    const target   = pickRandom(alive)
    const stolen   = selectStealMove(data, entries, target)
    if (!stolen) {
      // 훔칠 기술 없으면 분풀이
      return {
        command:    "direct",
        moveName:   "분풀이",
        targetSlot: pickRandom(alive),
        log:        `${bossName}${josa(bossName, "은는")} 분풀이를 사용했다!`,
        nextState:  { ...state, step: "barrier_check" },
      }
    }
    return {
      command:    "zoroark_steal",
      moveName:   stolen.name,
      targetSlot: target,
      log:        `${bossName}${josa(bossName, "은는")} 빠르게 움직였다!`,
      nextState:  {
        ...state,
        step:              "stolen_attack",
        stolenMove:        stolen.name,
        stolenMoveTarget:  target,
      },
    }
  }

  // STEP 3: 훔친 기술로 공격 반복 (barrier_check 거치지 않고)
  if (step === "stolen_attack") {
    const stolenMove = state.stolenMove
    if (!stolenMove) {
      // 기술 없으면 다시 steal
      return phase2Move(data, entries, { ...state, step: "steal" }, alive, grudged, nonGrudge, bossName)
    }
    const target = pickRandom(alive)
    return {
      command:    "zoroark_steal",
      moveName:   stolenMove,
      targetSlot: target,
      log:        `${bossName}${josa(bossName, "은는")} 훔쳐온 기술 [${stolenMove}]을 사용했다!`,
      nextState:  { ...state, step: "stolen_attack" },
    }
  }

  // 예외
  return {
    command:   "zoroark_phase2_open",
    moveName:  null,
    log:       `${bossName}${josa(bossName, "은는")} 일루전을 펼쳤다!`,
    nextState: { ...state, step: "steal", illusionActive: true },
  }
}

// ════════════════════════════════════════════════════════════════════
//  3페이즈
// ════════════════════════════════════════════════════════════════════
function phase3Move(data, entries, state, alive, grudged, nonGrudge, bossName) {
  const step = state.step ?? "barrier_check"

  // STEP 1: 깨트리기(장막 있으면) + 저주(랜덤) + 도발
  if (step === "barrier_check") {
    const barrier    = hasBarrier(data, entries)
    const useCurse   = Math.random() < 0.5
    const curseTarget = useCurse ? pickRandom(alive) : null
    const provokeLine = PROVOKE_LINES[Math.floor(Math.random() * PROVOKE_LINES.length)]

    // 원한 있는지 여부는 provokeLine + 현재 grudge 상태로 판별
    const grudgeExists = grudged.length > 0

    return {
      command:    "zoroark_phase3_open",
      moveName:   barrier ? "깨트리기" : null,
      targetSlot: curseTarget,
      log:        provokeLine,
      nextState:  {
        ...state,
        step:          "provoke_wait",
        provokeLine,
        grudgeOnProvoke: grudgeExists,
        useCurse,
        curseTarget,
        provokeAttackers: [],   // 이번 라운드에 조로아크를 공격한 플레이어
        provokeTurnCount: (data.turn_count ?? 0),  // 도발 사용 턴 기록
      },
    }
  }

  // STEP 2: 도발 대기 → 다음 보스 턴에 결과 정산
  if (step === "provoke_wait") {
    return {
      command:    "zoroark_provoke_resolve",
      moveName:   null,
      log:        null,
      nextState:  {
        ...state,
        step:           "barrier_check",
        provokeResolve: true,
      },
    }
  }

  // 예외
  return {
    command:    "zoroark_phase3_open",
    moveName:   null,
    targetSlot: null,
    log:        PROVOKE_LINES[0],
    nextState:  {
      ...state,
      step:             "provoke_wait",
      provokeLine:      PROVOKE_LINES[0],
      grudgeOnProvoke:  grudged.length > 0,
      useCurse:         false,
      curseTarget:      null,
      provokeAttackers: [],
      provokeTurnCount: data.turn_count ?? 0,
    },
  }
}

// ════════════════════════════════════════════════════════════════════
//  도발 결과 정산
// ════════════════════════════════════════════════════════════════════
function resolveProvoke(data, entries, state, alive, grudged, nonGrudge, bossName) {
  const line      = state.provokeLine ?? PROVOKE_LINES[0]
  const attackers = state.provokeAttackers ?? []
  const wasAttacked = attackers.length > 0
  const grudgeOnProvoke = state.grudgeOnProvoke ?? false

  let command    = "zoroark_provoke_result"
  let moveName   = null
  let targetSlot = null
  let log        = ""
  let nextState  = { ...state, provokeResolve: false, step: "barrier_check" }

  // ── "자, 나를 공격해봐. 그게 정답이야." ─────────────────────────
  if (line === PROVOKE_LINES[0]) {
    if (grudgeOnProvoke) {
      // 진실: 원한 있음
      if (wasAttacked) {
        // 조로아크에게 그대로 데미지 (이미 반영됨) → 추가 처리 없음
        log = `정답이야, 잘했어!`
        nextState.grudgeTarget = null
        // 원한 제거
        nextState.clearGrudge = true
      } else {
        // 원한 대상에게 1.5배 분풀이
        const gTarget = grudged.length > 0 ? grudged[0] : pickRandom(alive)
        moveName   = "분풀이"
        targetSlot = gTarget
        log        = `${bossName}는 분풀이를 사용했다! 조로아크에게 속아버렸다...`
        command    = "zoroark_vengeance_boost"
        nextState.grudgeTarget = null
        nextState.clearGrudge  = true
      }
    } else {
      // 거짓말: 원한 없음
      if (wasAttacked) {
        // 공격한 플레이어에게 받은 데미지의 70% 되돌림
        command    = "zoroark_reflect_damage"
        targetSlot = attackers[0]
        log        = `${bossName}에게 속아버렸다...`
      } else {
        // 조로아크에게 그대로 데미지 + 랜덤 1명 원한
        const newTarget = pickRandom(alive)
        command    = "zoroark_curse_after"
        targetSlot = newTarget
        log        = `정답이야, 잘했어!`
        nextState.grudgeTarget = newTarget
      }
    }
  }

  // ── "지금이 기회야, 다음 턴엔 늦어." ───────────────────────────
  else if (line === PROVOKE_LINES[1]) {
    if (!grudgeOnProvoke) {
      // 진실: 원한 없음
      if (wasAttacked) {
        // 그대로 데미지 + 랜덤 원한
        const newTarget = pickRandom(alive)
        command    = "zoroark_curse_after"
        targetSlot = newTarget
        log        = `정답이야, 잘했어!`
        nextState.grudgeTarget = newTarget
      } else {
        // 가장 큰 데미지 입힌 플레이어에게 1.5배 분풀이
        const topDmgSlot = getTopDamageSlot(data, entries)
        moveName   = "분풀이"
        targetSlot = topDmgSlot ?? pickRandom(alive)
        log        = `${bossName}는 화가 나서 분풀이를 사용했다!`
        command    = "zoroark_vengeance_boost"
      }
    } else {
      // 거짓말: 원한 있음
      if (wasAttacked) {
        // 공격한 플레이어에게 즉시 1.5배 분풀이
        moveName   = "분풀이"
        targetSlot = attackers[0]
        log        = `${bossName}는 비웃으며 분풀이를 사용했다!`
        command    = "zoroark_vengeance_boost"
      } else {
        // 랜덤 1명 새 원한 부여
        const newTarget = pickRandom(alive)
        command    = "zoroark_curse_after"
        targetSlot = newTarget
        log        = `${bossName}는 어쩐지 웃고 있는 듯하다...`
        nextState.grudgeTarget = newTarget
      }
    }
  }

  // ── "아무것도 안 하는 건 최악의 선택이지." ──────────────────────
  else {
    if (!grudgeOnProvoke) {
      // 진실: 원한 없음
      if (wasAttacked) {
        // 그대로 데미지 + 랜덤 원한
        const newTarget = pickRandom(alive)
        command    = "zoroark_curse_after"
        targetSlot = newTarget
        log        = `${bossName}는 화가 나서 원한을 새겼다!`
        nextState.grudgeTarget = newTarget
      } else {
        // 랜덤 1명에게 1.5배 분풀이
        moveName   = "분풀이"
        targetSlot = pickRandom(alive)
        log        = `${bossName}에게 속아버렸다...`
        command    = "zoroark_vengeance_boost"
      }
    } else {
      // 거짓말: 원한 있음
      if (wasAttacked) {
        // 원한 대상에게 1.5배 분풀이, 원한 제거
        const gTarget = grudged.length > 0 ? grudged[0] : pickRandom(alive)
        moveName   = "분풀이"
        targetSlot = gTarget
        log        = `${bossName}는 웃으면서 분풀이를 사용했다! 속아버렸다...`
        command    = "zoroark_vengeance_boost"
        nextState.clearGrudge = true
      } else {
        // 다음 라운드 행동 불가 (idle)
        command = "zoroark_skip_next"
        log     = `${bossName}는 움직일 수 없다, 정답이야!`
        nextState.skipNextTurn = true
      }
    }
  }

  return { command, moveName, targetSlot, log, nextState }
}

// ── 가장 큰 데미지를 입힌 플레이어 ────────────────────────────────
function getTopDamageSlot(data, entries) {
  let top = null, topDmg = -1
  for (const s of PLAYER_SLOTS) {
    const dmg = data[`${s}_total_damage`] ?? 0
    if (dmg > topDmg) { topDmg = dmg; top = s }
  }
  return top
}

// ── josa 헬퍼 (간략) ────────────────────────────────────────────────
function josa(word, type) {
  if (!word) return type === "은는" ? "은" : type === "이가" ? "이" : type === "을를" ? "을" : "의"
  const last = word[word.length - 1]
  const code = last.charCodeAt(0)
  const jong  = (code - 0xAC00) % 28
  if (type === "은는") return jong ? "은" : "는"
  if (type === "이가") return jong ? "이" : "가"
  if (type === "을를") return jong ? "을" : "를"
  if (type === "의")   return "의"
  if (type === "에게") return "에게"
  return ""
}