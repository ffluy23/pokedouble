// lib/bosses/froslass.js
// 눈여아 (Froslass) 보스 AI

const FLAVOR_LOGS_GENERAL = [
  "눈이 조용히 내리고 있다.",
  "바람이 스친다… 누군가 지나간 것 같았다.",
  "숨을 내쉴 때마다 공기가 더 차가워진다.",
  "눈보라가 잠깐 시야를 가린다.",
  "창백한 시선이 우릴 향한다.",
  "눈발 사이에서 형태가 흐려진다.",
  "눈여아는 소리 없이 떠 있다.",
  "미소인지… 아닌지 구분이 가지 않는다.",
  "차가운 기운이 전장을 덮는다.",
  "발밑에 얇은 얼음이 생긴다.",
  "눈이 더 촘촘하게 내리기 시작한다.",
]

const FLAVOR_LOGS_PHASE2 = [
  "시야가 급격히 좁아진다!",
  "차가운 바람이 몸을 스친다!",
  "숨이 점점 하얗게 흩어진다.",
  "발이 눈에 파묻힌다.",
  "시선이 계속 뒤따라온다.",
  "손끝 감각이 사라진다.",
  "숨이 제대로 나오지 않는다.",
  "시야가 하얗게 잠식된다.",
  "몸이 굳어간다!",
  "움직일 수 없다!",
]

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// 얼음 상태인 플레이어 슬롯 반환
function getFrozenPlayers(data, entries, PLAYER_SLOTS) {
  return PLAYER_SLOTS.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0 && pkmn.status === "얼음"
  })
}

// 살아있는 플레이어 슬롯 반환
function getAlivePlayers(data, entries, PLAYER_SLOTS) {
  return PLAYER_SLOTS.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0
  })
}

// ────────────────────────────────────────────────────────────────────
//  phase 판정
// ────────────────────────────────────────────────────────────────────
function getPhase(data) {
  if (data._phase2Entered) return 2
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  return ratio <= 1/3 ? 2 : 1
}

// ────────────────────────────────────────────────────────────────────
//  1페이즈 순서: 냉동빔 > 고드름떨구기 > 섀도볼 > 냉동빔 (반복)
//  step: 0=냉동빔 1=고드름떨구기 2=섀도볼
// ────────────────────────────────────────────────────────────────────
const PHASE1_CYCLE = ["냉동빔", "고드름떨구기", "섀도볼"]

function decideBossMove(data, entries, PLAYER_SLOTS) {
  const phase      = getPhase(data)
  const state      = data.boss_state ?? {}
  const alive      = getAlivePlayers(data, entries, PLAYER_SLOTS)
  const frozen     = getFrozenPlayers(data, entries, PLAYER_SLOTS)
  const bossName   = data.boss_name ?? "눈여아"

  // ── 첫 턴: 무조건 눈보라 ──────────────────────────────────────
  if ((data.turn_count ?? 1) === 1) {
    return {
      command:    "froslass_blizzard_open",
      moveName:   "눈보라",
      targetSlot: null,
      log:        "눈보라가 거세진다.",
      nextState:  { ...state, phase: 1, cycleStep: 0, blizzardCooldown: 0 },
    }
  }

  if (phase === 2 && !data._phase2Entered) {
    // 페이즈 진입은 checkPhase2Enter에서 처리
  }

  // ── 2페이즈 ──────────────────────────────────────────────────
  if (phase === 2 && data._phase2Entered) {
    return decidePhase2Move(data, entries, PLAYER_SLOTS, state, alive, frozen, bossName)
  }

  // ── 1페이즈 ──────────────────────────────────────────────────
  // 조건 0: 얼음 플레이어가 있으면 병상첨병 최우선
  if (frozen.length > 0) {
    const target = frozen[Math.floor(Math.random() * frozen.length)]
    return {
      command:    "direct",
      moveName:   "병상첨병",
      targetSlot: target,
      log:        randomFrom(FLAVOR_LOGS_GENERAL),
      nextState:  state,
    }
  }

  // 사이클 진행
  const step     = state.cycleStep ?? 0
  const moveName = PHASE1_CYCLE[step % PHASE1_CYCLE.length]
  const isAoe    = moveName === "섀도볼"
  const target   = isAoe ? null : (alive.length > 0 ? alive[Math.floor(Math.random() * alive.length)] : null)

  return {
    command:    "direct",
    moveName,
    targetSlot: target,
    log:        randomFrom(FLAVOR_LOGS_GENERAL),
    nextState:  { ...state, cycleStep: (step + 1) % PHASE1_CYCLE.length },
  }
}

// ────────────────────────────────────────────────────────────────────
//  2페이즈 행동 결정
//  blizzardCooldown: 눈보라 쓴 후 카운터 (0이면 쓸 수 있음, 매 턴 감소)
//  mirageActive: 눈속임 활성화 여부 (서버 로직에서 관리)
// ────────────────────────────────────────────────────────────────────
function decidePhase2Move(data, entries, PLAYER_SLOTS, state, alive, frozen, bossName) {
  const blizzardCooldown = state.blizzardCooldown ?? 0

  // 조건 0: 얼음 플레이어가 있으면 병상첨병
  if (frozen.length > 0) {
    const target = frozen[Math.floor(Math.random() * frozen.length)]
    return {
      command:    "direct",
      moveName:   "병상첨병",
      targetSlot: target,
      log:        randomFrom(FLAVOR_LOGS_PHASE2),
      nextState:  { ...state, blizzardCooldown: Math.max(0, blizzardCooldown - 1) },
    }
  }

  // 주기적 눈보라 (쿨다운 0이면 사용)
  if (blizzardCooldown <= 0) {
    return {
      command:    "froslass_blizzard_phase2",
      moveName:   "눈보라",
      targetSlot: null,
      log:        "눈보라가 시야를 완전히 덮는다!",
      nextState:  { ...state, blizzardCooldown: 3, mirageActive: true, mirageRealIdx: Math.floor(Math.random() * 3) },
    }
  }

  // 고드름떨구기 / 냉동빔 랜덤
  const moveName = Math.random() < 0.5 ? "고드름떨구기" : "냉동빔"
  const target   = alive.length > 0 ? alive[Math.floor(Math.random() * alive.length)] : null
  return {
    command:    "direct",
    moveName,
    targetSlot: target,
    log:        randomFrom(FLAVOR_LOGS_PHASE2),
    nextState:  { ...state, blizzardCooldown: Math.max(0, blizzardCooldown - 1) },
  }
}

// ────────────────────────────────────────────────────────────────────
//  2페이즈 진입 체크
// ────────────────────────────────────────────────────────────────────
function checkPhase2Enter(data, nextState, command) {
  if (data._phase2Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > 1/3) return null

  // 눈보라 + 눈속임 동시 발동
  const mirageRealIdx = Math.floor(Math.random() * 3)
  return {
    logs: [
      "눈보라가 시야를 완전히 덮는다!",
      "눈여아가 모든 것을 얼려버린다!",
      "냉기가 폭주하고 있다.",
      "눈보라 속에서 눈여아의 형상이 흩어진다... 어느 것이 진짜인지 알 수 없다!",
    ],
    nextState: {
      ...nextState,
      phase: 2,
      blizzardCooldown: 3,
      mirageActive:   true,
      mirageRealIdx,
      cycleStep: 0,
    },
    setPhase2Entered: true,
  }
}

// ────────────────────────────────────────────────────────────────────
//  등장 로그
// ────────────────────────────────────────────────────────────────────
function getBossIntroLogs() {
  return [
    "눈이 조용히 내리고 있다.",
    "눈여아는 소리 없이 떠 있다.",
    "차가운 기운이 전장을 덮는다.",
  ]
}

// ────────────────────────────────────────────────────────────────────
//  사망 로그
// ────────────────────────────────────────────────────────────────────
function getDeathLogs() {
  return [
    "눈보라가 잦아든다.",
    "눈여아의 모습이 흐려진다.",
    "차가운 기운이 서서히 사라진다.",
    "발밑의 얼음이 녹기 시작한다.",
  ]
}

// ────────────────────────────────────────────────────────────────────
//  ult 관련 (눈여아는 ult 없음)
// ────────────────────────────────────────────────────────────────────
function shouldTriggerUlt()  { return false }
function getUltTarget()      { return null }
function nextUltCooldown()   { return 0 }

export {
  decideBossMove,
  checkPhase2Enter,
  getBossIntroLogs,
  getDeathLogs,
  shouldTriggerUlt,
  getUltTarget,
  nextUltCooldown,
}