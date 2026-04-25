// lib/bosses/malamar.js
// 칼라마네로 보스 AI

import { PLAYER_SLOTS, getAlivePlayers, getActiveRankVal, defaultRanks, makeLog } from "../raidBossAction.js"
import { moves } from "../moves.js"
import { bossMoves } from "../bossMoves.js"
import { getTypeMultiplier } from "../typeChart.js"

// ─────────────────────────────────────────────────────────────────────────────
//  상수
// ─────────────────────────────────────────────────────────────────────────────
const PHASE2_HP_RATIO   = 0.85   // 최대 HP 대비 2페이즈 진입 임계치
const PSYCHO_SHOCK_POWER = 75    // 사이코쇼크 고정 위력

// 기술 카테고리 분류 (moves.js 기반)
const MOVE_CATEGORY = {
  heal:    new Set(["HP회복","태만함","게으름피우기","아침햇살","달빛","생명의물방울","알낳기","우유마시기","날개쉬기","희망사항","치유소원","아쿠아링","씨뿌리기"]),
  defend:  new Set(["방어","킹실드","판별","버티기","빛의장막","리플렉터","코튼가드","철벽","단단해지기","웅크리기","비축하기","신비의부적","망각술","껍질에숨기","그림자분신"]),
  rank:    new Set(["칼춤","고속이동","명상","벌크업","용의춤","나쁜음모","나비춤","똬리틀기","성장","분발","원시의힘","기합구슬","메타크로우","코멧펀치","강철날개"]),
  attack:  null,  // 나머지 전부
}

function getMoveCategory(moveName) {
  if (MOVE_CATEGORY.heal.has(moveName))   return "heal"
  if (MOVE_CATEGORY.defend.has(moveName)) return "defend"
  if (MOVE_CATEGORY.rank.has(moveName))   return "rank"
  return "attack"
}

// ─────────────────────────────────────────────────────────────────────────────
//  플레이어 스타일 프로필 갱신
//  storedMoves: { slot: [ { moveName, category, turn } ] }
// ─────────────────────────────────────────────────────────────────────────────
function buildPlayerProfiles(storedMoves) {
  const profiles = {}
  for (const [slot, moveList] of Object.entries(storedMoves)) {
    const total   = moveList.length
    if (total === 0) { profiles[slot] = { aggressive: 0.5, defensive: 0.5, buffHeavy: 0.5 }; continue }
    const atk  = moveList.filter(m => m.category === "attack").length
    const def  = moveList.filter(m => m.category === "defend" || m.category === "heal").length
    const buff = moveList.filter(m => m.category === "rank").length
    profiles[slot] = {
      aggressive: atk  / total,
      defensive:  def  / total,
      buffHeavy:  buff / total,
    }
  }
  return profiles
}

// ─────────────────────────────────────────────────────────────────────────────
//  보스 현재 HP 비율
// ─────────────────────────────────────────────────────────────────────────────
function bossHpRatio(data) {
  return (data.boss_current_hp ?? 0) / Math.max(1, data.boss_max_hp ?? 1)
}

// ─────────────────────────────────────────────────────────────────────────────
//  2턴 간이 시뮬레이션: 기술을 이번 턴 쓰면 얼마나 가치 있나?
//  반환: 0~1 (높을수록 좋음)
// ─────────────────────────────────────────────────────────────────────────────
function simulateValue(moveName, moveInfo, data, entries, profiles) {
  const category = getMoveCategory(moveName)
  const hpRatio  = bossHpRatio(data)
  const alive    = getAlivePlayers(data, entries)
  const n        = alive.length

  // ── 기본 점수 ────────────────────────────────────────────────────────────
  let score = 0

  if (category === "attack") {
    const power = moveInfo?.power ?? 40
    const isAoe = !!(moveInfo?.aoe || moveInfo?.aoeEnemy)
    const bossAtk = (data.boss_attack ?? 5) + getActiveRankVal(data.boss_rank ?? {}, "atk")

    // 타겟들의 타입 상성 계산
    let totalTypeMult = 0
    let typedCount = 0
    let minHpRatio = 1

    for (const s of alive) {
      const idx  = data[`${s}_active_idx`] ?? 0
      const pkmn = entries[s]?.[idx]
      if (!pkmn) continue
      const r = pkmn.hp / Math.max(1, pkmn.maxHp)
      if (r < minHpRatio) minHpRatio = r

      const defTypes = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
      let mult = 1
      for (const dt of defTypes) mult *= getTypeMultiplier(moveInfo?.type, dt)
      totalTypeMult += mult
      typedCount++
    }

    // 타입 무효(0)인 기술이면 점수 0
    const avgTypeMult = typedCount > 0 ? totalTypeMult / typedCount : 1
    if (avgTypeMult === 0) return 0

    const targetCount  = isAoe ? n : 1
    const baseDmgScore = (power + bossAtk * 4) / 150
    score = baseDmgScore * targetCount * 0.5 * avgTypeMult

    score += (1 - minHpRatio) * 0.3
    if (n === 1 && !isAoe) score += 0.1
  }

  else if (category === "heal") {
    // 보스가 체력 낮을수록 힐 가치 ↑
    score = (1 - hpRatio) * 0.8
    // 이미 HP 높으면 힐 낭비
    if (hpRatio > 0.7) score *= 0.3
  }

  else if (category === "defend") {
    // 적들이 공격적일수록 방어 가치 ↑
    const avgAggro = alive.reduce((acc, s) => acc + (profiles[s]?.aggressive ?? 0.5), 0) / Math.max(1, n)
    score = avgAggro * 0.6
    // 이미 방어 랭크 높으면 낮춤
    const bossDefRank = getActiveRankVal(data.boss_rank ?? {}, "def")
    if (bossDefRank >= 2) score *= 0.4
  }

  else if (category === "rank") {
    // 버프형 기술: 아직 랭크 낮고 턴이 남아있으면 가치 ↑
    const bossAtkRank = getActiveRankVal(data.boss_rank ?? {}, "atk")
    score = (1 - bossAtkRank / 4) * 0.6
    // HP 낮으면 버프 쓸 여유 없음
    if (hpRatio < 0.3) score *= 0.5
  }

  // ── 플레이어 패턴 카운터 보너스 ──────────────────────────────────────────
  for (const s of alive) {
    const prof = profiles[s] ?? {}
    // 적이 방어 위주면 상태이상/디버프 기술 우선
    if (prof.defensive > 0.6 && (moveInfo?.effect?.status || moveInfo?.rank?.targetDef !== undefined)) {
      score += 0.15
    }
    // 적이 버프 위주면 클리어류 기술 우선
    if (prof.buffHeavy > 0.6 && (moveInfo?.clearSmog || moveInfo?.haze)) {
      score += 0.2
    }
    // 적이 공격 위주면 방어/힐 가치 ↑
    if (prof.aggressive > 0.7 && (category === "defend" || category === "heal")) {
      score += 0.1
    }
  }

  // ── AOE 추가 보너스 ──────────────────────────────────────────────────────
  if ((moveInfo?.aoe || moveInfo?.aoeEnemy) && n >= 2) score += 0.1 * n

  return Math.min(1, score)
}

// ─────────────────────────────────────────────────────────────────────────────
//  바꿔치기 AI: 수집된 기술 중 가장 효율적인 것 선택
//  사이코쇼크와도 비교
// ─────────────────────────────────────────────────────────────────────────────
function selectBestMove(data, entries, storedMovesFlat) {
  const profiles = buildPlayerProfiles(data.boss_state?.storedMoves ?? {})
  const alive    = getAlivePlayers(data, entries)
  const hpRatio  = bossHpRatio(data)

  // 사이코쇼크 점수 계산
  const psychoInfo   = { power: PSYCHO_SHOCK_POWER, type: "에스퍼", alwaysHit: true }
  const psychoScore  = simulateValue("사이코쇼크", psychoInfo, data, entries, profiles)

  let bestMove  = "사이코쇼크"
  let bestScore = psychoScore
  let bestTarget = null
  let bestIsAoe  = false

  for (const { moveName, moveInfo } of storedMovesFlat) {
    const s = simulateValue(moveName, moveInfo, data, entries, profiles)
    if (s > bestScore) {
      bestScore  = s
      bestMove   = moveName
      bestTarget = null
      bestIsAoe  = !!(moveInfo?.aoe || moveInfo?.aoeEnemy)
    }
  }

  // 타겟 결정: 타입 상성 고려 후 HP 가장 낮은 생존자
  function pickTarget(moveInfo) {
    if (alive.length === 0) return null
    const isAoe = !!(moveInfo?.aoe || moveInfo?.aoeEnemy)
    if (isAoe) return null

    // 타입 무효 아닌 타겟 중 HP 가장 낮은 놈
    let best = null, bestHp = Infinity
    for (const s of alive) {
      const idx  = data[`${s}_active_idx`] ?? 0
      const pkmn = entries[s]?.[idx]
      if (!pkmn) continue
      const defTypes = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
      let mult = 1
      for (const dt of defTypes) mult *= getTypeMultiplier(moveInfo?.type, dt)
      if (mult === 0) continue  // 무효면 패스
      if (pkmn.hp < bestHp) { bestHp = pkmn.hp; best = s }
    }
    return best ?? alive[0]  // 전부 무효면 그냥 첫 번째
  }

  if (bestMove !== "사이코쇼크") {
    const mi = storedMovesFlat.find(m => m.moveName === bestMove)?.moveInfo ?? {}
    bestTarget = pickTarget(mi)
  } else {
    bestTarget = pickTarget({ type: "에스퍼" })
  }

  return { moveName: bestMove, targetSlot: bestTarget, score: bestScore }
}

// ─────────────────────────────────────────────────────────────────────────────
//  현혹 대상 선택: 가능한 골고루 (현혹 횟수 적은 쪽 우선)
// ─────────────────────────────────────────────────────────────────────────────
function selectFascinateTarget(data, entries) {
  const alive = getAlivePlayers(data, entries)
  if (alive.length === 0) return null

  const charmCount = data.boss_state?.charmCount ?? {}

  // 현혹이 없거나 카운트 적은 쪽 우선
  let minCount = Infinity
  let chosen   = alive[0]
  for (const s of alive) {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    if (!pkmn || pkmn.hp <= 0) continue
    // 이미 현혹 중이면 패스 (중복 부여 지양)
    if ((pkmn.fascinatedTurns ?? 0) > 0) continue
    const cnt = charmCount[s] ?? 0
    if (cnt < minCount) { minCount = cnt; chosen = s }
  }

  // 전원 현혹 중이면 그냥 가장 적게 받은 쪽
  if (chosen === alive[0] && alive.every(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    return (entries[s]?.[idx]?.fascinatedTurns ?? 0) > 0
  })) {
    let minC = Infinity
    for (const s of alive) {
      const c = charmCount[s] ?? 0
      if (c < minC) { minC = c; chosen = s }
    }
  }

  return chosen
}

// ─────────────────────────────────────────────────────────────────────────────
//  [현혹] 상태의 플레이어가 직전에 쓴 기술 수집 (나쁜음모)
//  실제 기술 기록은 raidUseMove.js에서 boss_state.storedMoves에 쌓인다고 가정
//  여기서는 storedMovesFlat 빌드 + 로그만 담당
// ─────────────────────────────────────────────────────────────────────────────
function buildStoredMovesFlat(storedMoves) {
  const seen = new Set()
  const flat = []
  for (const [slot, moveList] of Object.entries(storedMoves)) {
    for (const entry of moveList) {
      if (seen.has(entry.moveName)) continue
      seen.add(entry.moveName)
      const moveInfo = moves[entry.moveName] ?? bossMoves[entry.moveName] ?? null
      if (!moveInfo) continue
      if (moveInfo.targetSelf) continue  // ← 자신 대상 기술 제외
      flat.push({ moveName: entry.moveName, moveInfo, category: entry.category })
    }
  }
  return flat
}
// ─────────────────────────────────────────────────────────────────────────────
//  getPhase
// ─────────────────────────────────────────────────────────────────────────────
export function getPhase(data) {
  const ratio = bossHpRatio(data)
  return ratio <= PHASE2_HP_RATIO || data._phase2Entered ? 2 : 1
}

// ─────────────────────────────────────────────────────────────────────────────
//  decideBossMove  (raidBossAction.js가 호출)
// ─────────────────────────────────────────────────────────────────────────────
export function decideBossMove(data, entries, playerSlots) {
  const phase     = getPhase(data)
  const bossName  = data.boss_name ?? "칼라마네로"
  const bossState = data.boss_state ?? {}
  const storedMoves     = bossState.storedMoves ?? {}
  const storedMovesFlat = buildStoredMovesFlat(storedMoves)
  const charmCount      = bossState.charmCount  ?? {}

  // ── 1페이즈 ─────────────────────────────────────────────────────────────
  if (phase === 1) {
    const step = bossState.step ?? "fascinate"  // "fascinate" | "collect"

    if (step === "fascinate") {
      // 이상한빛: 현혹 부여
      const target = selectFascinateTarget(data, entries)
      const newCharmCount = { ...charmCount, [target]: (charmCount[target] ?? 0) + 1 }
      return {
        command:   "malamar_fascinate",
        moveName:  "이상한빛",
        targetSlot: target,
        log:       `${bossName}${bossName.endsWith("로") ? "가" : "이"} 이상한빛을 사용했다!`,
        nextState: {
          ...bossState,
          step:       "collect",
          charmCount: newCharmCount,
        },
      }
    } else {
      // 나쁜음모: 현혹된 플레이어 기술 수집 (로그만, 실제 수집은 raidUseMove에서)
      return {
        command:   "malamar_collect",
        moveName:  "나쁜음모",
        targetSlot: null,
        log:       `${bossName}${bossName.endsWith("로") ? "가" : "이"} 나쁜음모를 꾸미고 있다…`,
        nextState: {
          ...bossState,
          step: "fascinate",
        },
      }
    }
  }

  // ── 2페이즈 ─────────────────────────────────────────────────────────────
  const { moveName, targetSlot, score } = selectBestMove(data, entries, storedMovesFlat)
  const isPsycho = moveName === "사이코쇼크"

  return {
    command:    "malamar_swap",
    moveName,
    targetSlot,
    log:        isPsycho
      ? `${bossName}${bossName.endsWith("로") ? "가" : "이"} 사이코쇼크를 날렸다!`
      : `칼라마네로는 기억한 기술 [${moveName}]을 사용한다!`,
    nextState: { ...bossState },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  shouldTriggerUlt / getUltTarget / nextUltCooldown
//  칼라마네로는 별도 ult 없음 (바꿔치기가 2페이즈 메인이므로)
// ─────────────────────────────────────────────────────────────────────────────
export function shouldTriggerUlt(_data) { return false }
export function getUltTarget(_data, _entries, _slots) { return null }
export function nextUltCooldown() { return 0 }

// ─────────────────────────────────────────────────────────────────────────────
//  checkPhase2Enter
// ─────────────────────────────────────────────────────────────────────────────
export function checkPhase2Enter(data, nextState, command) {
  if (data._phase2Entered) return null
  const ratio = bossHpRatio(data)
  if (ratio > PHASE2_HP_RATIO) return null

  const bossName = data.boss_name ?? "칼라마네로"
  return {
    logs: [
      `${bossName}의 눈빛이 변했다!`,
    ],
    nextState:        { ...nextState, step: "swap" },
    setPhase2Entered: true,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  getBossIntroLogs / getDeathLogs
// ─────────────────────────────────────────────────────────────────────────────
export function getBossIntroLogs() {
  return [
    "칼라마네로가 등장했다!",
    "칼라마네로의 커다란 눈이 빛나기 시작한다…",
    "무언가를 관찰하고 있는 것 같다!",
  ]
}

export function getDeathLogs() {
  return [
    "칼라마네로는 쓰러졌다!",
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
//  raidUseMove.js 연동: 현혹 상태 플레이어 기술 기록
// ─────────────────────────────────────────────────────────────────────────────

const HEAL_MOVES_SET   = new Set(["HP회복","태만함","게으름피우기","아침햇살","달빛","생명의물방울","알낳기","우유마시기","날개쉬기","희망사항","치유소원","아쿠아링","씨뿌리기"])
const DEFEND_MOVES_SET = new Set(["방어","킹실드","판별","버티기","빛의장막","리플렉터","코튼가드","철벽","단단해지기","웅크리기","비축하기","신비의부적","망각술","껍질에숨기","그림자분신"])
const RANK_MOVES_SET   = new Set(["칼춤","고속이동","명상","벌크업","용의춤","나비춤","똬리틀기","성장","분발","원시의힘","코멧펀치","강철날개"])

function classifyMove(moveName) {
  if (HEAL_MOVES_SET.has(moveName))   return "heal"
  if (DEFEND_MOVES_SET.has(moveName)) return "defend"
  if (RANK_MOVES_SET.has(moveName))   return "rank"
  return "attack"
}

/**
 * 현혹 상태인 슬롯이 기술을 썼을 때 boss_state.storedMoves 에 기록
 * raidUseMove.js 에서 플레이어 기술 처리 완료 직후 호출
 */
export function recordMalamarMove(slot, moveName, data, entries) {
  if (data.boss_name !== "칼라마네로") return null

  const idx  = data[`${slot}_active_idx`] ?? 0
  const pkmn = entries[slot]?.[idx]
  if (!pkmn || pkmn.hp <= 0) return null
  if ((pkmn.fascinatedTurns ?? 0) <= 0) return null

  const bossState   = data.boss_state ?? {}
  const storedMoves = JSON.parse(JSON.stringify(bossState.storedMoves ?? {}))
  if (!storedMoves[slot]) storedMoves[slot] = []

  storedMoves[slot].push({ moveName, category: classifyMove(moveName), turn: data.turn_count ?? 0 })

  return { boss_state: { ...bossState, storedMoves } }
}