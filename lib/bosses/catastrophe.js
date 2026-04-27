// lib/bosses/catastrophe.js

const IDLE_LOGS = [
  "타격이 사라졌다.",
  "흔적조차 남지 않았다.",
  "아무 일도 일어나지 않았다.",
  "공격은 닿지 않았다.",
  "대기가 일그러진다.",
  "정적이 이어진다.",
  "시간만 흐른다.",
]

const MISS_LOGS_A = [
  (mv) => `누클라바스의 ${mv}!... 빗나갔다?`,
  (mv) => `누클라바스의 ${mv}!... 맞지 않았다?`,
]
const MISS_LOGS_B = [
  (mv) => `누클라바스의 ${mv}!... 명중하지 않았다!`,
  (mv) => `누클라바스의 ${mv}!... 분명히 맞지 않았다!`,
  (mv) => `누클라바스의 ${mv}!... 뭔가 이상하다!`,
  (mv) => `누클라바스의 ${mv}!... 실패했다!`,
]

const PHASE1_MOVES = ["해수스파우팅", "분화", "지진", "번개", "눈보라", "하드플랜트"]
const PHASE2_MOVES = ["파괴광선", "에어슬래시", "아이언테일", "드래곤크루"]

const PART_MAP = {
  "파괴광선":   { part: "eye",  label: "눈"   },
  "에어슬래시": { part: "wing", label: "날개" },
  "아이언테일": { part: "tail", label: "꼬리" },
  "드래곤크루": { part: "claw", label: "발톱" },
}

const CORE_DESTROY_LOGS = [
  (n) => `${n}가 파괴되었다! 누클라바스는... 귀를 찢는 듯한 비명을 내지른다...!`,
  (n) => `${n}가 파괴되었다! 누클라바스는 거칠게 숨을 헐떡인다!`,
  (n) => `${n}가 파괴되었다! 누클라바스는 크게 휘청인다!`,
  (n) => `${n}가 파괴되었다! 효과가 있는 듯하다...!`,
]

// ── 4페이즈 로그 ──────────────────────────────────────────────────
export const PHASE4_INTRO_LOGS = [
  "누클라바스는 공간을 뒤흔들며 크게 격분하기 시작한다...!",
  "...",
  "누클라바스는 정확하게 이쪽을 응시하고 있다.",
  "누클라바스는 ■■을 $3#할 준비를 하고 있다...!",
]

const PHASE4_OMINOUS_LOG = "곧 ■■이 다가올 것 같다...!"
const PHASE4_EYESORE_LOG = "눈엣가시를 찾는 듯하다...!"
const PHASE4_ENDURE_LOG  = "곧 ■■이 다가올 것 같다...! 버틸 수 있을까?"
const PHASE4_STAND_LOG   = "곧 ■■이 다가올 것 같다...! 버텨야 해!"
const PHASE4_DOOM_LOG    = "혼자서는 무리지만, 동료와 함께라면...?"

const ULT_WINDUP_LOGS = [
  "누클라바스의 눈이 검게 물들기 시작한다...!",
  "공간이 뒤틀린다... 뭔가 거대한 것이 모이고 있다!",
  "...카타스트로피.",
]
const ULT_AFTER_LOGS = [
  "누클라바스는 다시 한번 힘을 모으기 시작한다...",
  "끝나지 않았다...",
  "...아직 남아있다.",
]
const RESONANCE_PLAYER_LOGS = [
  (nick) => `${nick}이/가 힘을 보탠다! 믿고 있어!`,
  (nick) => `${nick}이/가 힘을 보탠다! 믿을게!`,
  (nick) => `${nick}이/가 힘을 보탠다! 믿는다!`,
]
const RESONANCE_FIRE_LOG = "레조넌스 출력 상승! 모두 믿고 있어! — 프로토콜 실행!"

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── 초기 boss_state ────────────────────────────────────────────────
export function getInitialState() {
  return {
    phase:         1,
    roundStep:     0,
    totalDmgTaken: 0,
    fired300:      false,
    missPhase:     0,
    missAt:        -1,
    missUsed:      false,

    // 2페이즈
    exposedPart:       null,
    partHp:            { eye: 500, wing: 500, tail: 500, claw: 500 },
    partDestroyed:     { eye: false, wing: false, tail: false, claw: false },
    allPartsDestroyed: false,

    // 3페이즈
    coreOrder:      [],
    coreIndex:      0,
    coreHp:         {},
    coreData:       {},
    coresDestroyed: 0,

    // 4페이즈
    phase4TotalDmg:    0,
    phase4CoreSeq:     0,   // 0=불꽃 1=전기 2=땅 3=얼음 4=물풀
    phase4SubStep:     0,
    phase4DmgWindow:   { p1: 0, p2: 0, p3: 0 },
    phase4DmgWindowOn: false,
    phase4Introduced:  false,
    phase4TankSlot:    null,
    ultPhase:          0,   // 0=없음 1=1발 후 2=레조넌스 대기
    resonanceReady:    false,
  }
}

// ── 페이즈 전환 체크 ───────────────────────────────────────────────
export function checkPhase2Enter(data, nextState) {
  if (nextState.phase !== 1) return null
  if (nextState.totalDmgTaken <= 900) return null
  return {
    logs: ["어딘가 이상하다... 할 수 있을지도?"],
    nextState: { ...nextState, phase: 2, roundStep: 0, exposedPart: null },
  }
}

export function checkPhase3Enter(data, nextState) {
  if (nextState.phase !== 2) return null
  if (!nextState.allPartsDestroyed) return null
  const coreIds = Object.keys(nextState.coreHp).length > 0
    ? Object.keys(nextState.coreHp)
    : ["water", "grass", "electric", "ground", "ice", "fire"]
  return {
    logs: ["누클라바스의 내부가 드러난다...!"],
    nextState: {
      ...nextState,
      phase:       3,
      roundStep:   0,
      exposedPart: null,
      coreOrder:   shuffle(coreIds),
      coreIndex:   0,
    },
    setPhase3Entered: true,
  }
}

export function checkPhase4Enter(data, nextState) {
  if (nextState.phase !== 3) return null
  const coreOrder = nextState.coreOrder ?? []
  const coreIdx   = nextState.coreIndex  ?? 0
  // 모든 코어 인덱스를 넘어섰을 때 진입
  if (coreIdx < coreOrder.length) return null
  return {
    logs: PHASE4_INTRO_LOGS,
    nextState: {
      ...nextState,
      phase:             4,
      roundStep:         0,
      phase4TotalDmg:    0,
      phase4CoreSeq:     0,
      phase4SubStep:     0,
      phase4DmgWindow:   { p1: 0, p2: 0, p3: 0 },
      phase4DmgWindowOn: false,
      phase4Introduced:  true,
      phase4TankSlot:    null,
      ultPhase:          0,
      resonanceReady:    false,
    },
    setPhase4Entered: true,
  }
}

// ── 보스 AI 진입점 ─────────────────────────────────────────────────
export function decideBossMove(data, entries, PLAYER_SLOTS) {
  const state = data.boss_state ?? getInitialState()
  const phase = state.phase ?? 1

  if (phase === 1) return decidePhase1(state, data, entries, PLAYER_SLOTS)
  if (phase === 2) return decidePhase2(state, data, entries, PLAYER_SLOTS)
  if (phase === 3) return decidePhase3(state, data, entries, PLAYER_SLOTS)
  if (phase === 4) return decidePhase4(state, data, entries, PLAYER_SLOTS)

  return { command: "idle", log: rand(IDLE_LOGS), nextState: state }
}

// ════════════════════════════════════════════════════════════════════
//  1페이즈
// ════════════════════════════════════════════════════════════════════
function decidePhase1(state, data, entries, PLAYER_SLOTS) {
  const step  = state.roundStep     ?? 0
  const total = state.totalDmgTaken ?? 0

  if (step < 3) {
    // 300 돌파 직후 — step 0일 때 파괴광선 연출
    if (!state.fired300 && total >= 300 && step === 0) {
      return {
        command:   "catastro_fake_beam",
        log:       null,
        moveName:  "파괴광선",
        nextState: { ...state, roundStep: step + 1, fired300: true },
      }
    }
    return {
      command:   "idle",
      log:       rand(IDLE_LOGS),
      nextState: { ...state, roundStep: step + 1 },
    }
  }

  // step === 3: 공격 전에도 300 체크 (공격 라운드에 300 돌파한 경우 대비)
  if (!state.fired300 && total >= 300) {
    return {
      command:   "catastro_fake_beam",
      log:       null,
      moveName:  "파괴광선",
      nextState: { ...state, roundStep: 0, fired300: true },
    }
  }

  const moveName = rand(PHASE1_MOVES)
  let missPhase = state.missPhase ?? 0
  let missAt    = state.missAt    ?? -1
  let missUsed  = state.missUsed  ?? false
  let shouldMiss = false

  if (total >= 500 && missPhase < 2)      { missPhase = 2; missAt = randInt(0, 3); missUsed = false }
  else if (total >= 300 && missPhase < 1) { missPhase = 1; missAt = randInt(0, 4); missUsed = false }

  if (missPhase > 0 && !missUsed) {
    if (missAt <= 0) { shouldMiss = true; missUsed = true }
    else             { missAt-- }
  }

  const nextMissAt = missPhase === 2 ? randInt(0, 3) : randInt(0, 4)
  const nextState  = {
    ...state,
    roundStep: 0,
    missPhase,
    missAt:   shouldMiss ? nextMissAt : missAt,
    missUsed: shouldMiss ? false      : missUsed,
  }

  if (shouldMiss) {
    const missLog = total >= 500
      ? rand(MISS_LOGS_B)(moveName)
      : rand(MISS_LOGS_A)(moveName)
    return { command: "catastro_miss", log: missLog, moveName, nextState }
  }
  return { command: "catastro_phase1_attack", log: null, moveName, nextState }
}

// ════════════════════════════════════════════════════════════════════
//  2페이즈
// ════════════════════════════════════════════════════════════════════
function decidePhase2(state, data, entries, PLAYER_SLOTS) {
  const step = state.roundStep ?? 0

  if (step === 0) {
    const moveName = rand(PHASE2_MOVES)
    const partInfo = PART_MAP[moveName]
    return {
      command:          "direct",
      log:              null,
      moveName,
      exposedPartLabel: partInfo?.label ?? "",
      nextState: {
        ...state,
        roundStep:   1,
        exposedPart: partInfo?.part ?? null,
      },
    }
  }

  const isLast = step >= 3
  return {
    command:   "idle",
    log:       rand(IDLE_LOGS),
    nextState: {
      ...state,
      roundStep:   isLast ? 0 : step + 1,
      exposedPart: isLast ? null : state.exposedPart,
    },
  }
}

// ════════════════════════════════════════════════════════════════════
//  3페이즈
// ════════════════════════════════════════════════════════════════════
function decidePhase3(state, data, entries, PLAYER_SLOTS) {
  const coreOrder = state.coreOrder ?? []
  const coreIdx   = state.coreIndex  ?? 0
  const currentId = coreOrder[coreIdx] ?? null

  if (!currentId) {
    return { command: "idle", log: "...", nextState: state }
  }

  const alivePlayers = PLAYER_SLOTS.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = data[`${s}_entry`]?.[idx]
    return pkmn && pkmn.hp > 0
  })
  const targetSlot = alivePlayers.length > 0
    ? alivePlayers[Math.floor(Math.random() * alivePlayers.length)]
    : null

  return {
    command:   "catastro_core_attack",
    log:       null,
    targetSlot,
    coreId:    currentId,
    nextState: state,
  }
}

// ════════════════════════════════════════════════════════════════════
//  4페이즈
// ════════════════════════════════════════════════════════════════════
function decidePhase4(state, data, entries, PLAYER_SLOTS) {
  const seq      = state.phase4CoreSeq  ?? 0
  const subStep  = state.phase4SubStep  ?? 0
  const total    = state.phase4TotalDmg ?? 0
  const ultPhase = state.ultPhase       ?? 0

  // 레조넌스 대기 중
  if (ultPhase === 2) {
    return { command: "catastro_resonance_wait", log: null, nextState: state }
  }

  // 딜 체크에 따른 코어 섭취 전환
  const THRESHOLDS = [0, 1500, 3000, 4500, 7500]
  const nextThresh = THRESHOLDS[seq + 1] ?? Infinity
  if (seq < 4 && total >= nextThresh) {
    // raidBossAction에서 처리 (커맨드로 위임)
    return {
      command:  "catastro_core_eat",
      log:      null,
      nextSeq:  seq + 1,
      nextState: { ...state, phase4SubStep: 0 },
    }
  }

  if (seq === 0) return decidePhase4Fire(state, data, entries, PLAYER_SLOTS, subStep)
  if (seq === 1) return decidePhase4Electric(state, data, entries, PLAYER_SLOTS, subStep)
  if (seq === 2) return decidePhase4Ground(state, data, entries, PLAYER_SLOTS, subStep)
  if (seq === 3) return decidePhase4Ice(state, data, entries, PLAYER_SLOTS, subStep)
  if (seq === 4) return decidePhase4WaterGrass(state, data, entries, PLAYER_SLOTS, subStep)

  return { command: "idle", log: "...", nextState: state }
}

// ── 불꽃 코어: [흉조] → 휴식 → 휴식 → 분화 ──────────────────────
function decidePhase4Fire(state, data, entries, PLAYER_SLOTS, subStep) {
  const alivePlayers = PLAYER_SLOTS.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = data[`${s}_entry`]?.[idx]
    return pkmn && pkmn.hp > 0
  })

  if (subStep === 0) {
    const target = alivePlayers.length > 0
      ? alivePlayers[Math.floor(Math.random() * alivePlayers.length)]
      : null
    return {
      command:    "catastro_ominous",
      log:        null,
      targetSlot: target,
      nextState:  { ...state, phase4SubStep: 1 },
    }
  }

  if (subStep === 1 || subStep === 2) {
    return {
      command:   "idle",
      log:       PHASE4_OMINOUS_LOG,
      nextState: { ...state, phase4SubStep: subStep + 1 },
    }
  }

  // subStep === 3: 분화
  const ominousSlot = PLAYER_SLOTS.find(s => data[`${s}_ominous`]) ?? null
  return {
    command:    "catastro_eruption",
    log:        null,
    moveName:   "분화",
    targetSlot: ominousSlot,
    nextState:  { ...state, phase4SubStep: 0 },
  }
}

// ── 전기 코어: 딜체크 시작 → 딜체크 종료+[사멸] → 번개 ──────────
function decidePhase4Electric(state, data, entries, PLAYER_SLOTS, subStep) {
  if (subStep === 0) {
    return {
      command:   "catastro_dmg_window_start",
      log:       PHASE4_EYESORE_LOG,
      nextState: {
        ...state,
        phase4SubStep:     1,
        phase4DmgWindowOn: true,
        phase4DmgWindow:   { p1: 0, p2: 0, p3: 0 },
      },
    }
  }

  if (subStep === 1) {
    const window = state.phase4DmgWindow ?? {}
    const doomed = getTopDmgSlot(window, PLAYER_SLOTS, data, entries)
    return {
      command:    "catastro_doom",
      log:        PHASE4_ENDURE_LOG,
      targetSlot: doomed,
      nextState:  {
        ...state,
        phase4SubStep:     2,
        phase4DmgWindowOn: false,
        phase4DmgWindow:   { p1: 0, p2: 0, p3: 0 },
      },
    }
  }

  // subStep === 2: 번개
  const doomedSlot = PLAYER_SLOTS.find(s => data[`${s}_doomed`]) ?? null
  const syncActive = data.sync_active ?? false
  return {
    command:     "catastro_lightning",
    log:         PHASE4_DOOM_LOG,
    moveName:    "번개",
    targetSlot:  doomedSlot,
    syncReduced: syncActive,
    nextState:   { ...state, phase4SubStep: 0 },
  }
}

// ── 땅 코어: [붕괴]+선택지 → 지진 ───────────────────────────────
function decidePhase4Ground(state, data, entries, PLAYER_SLOTS, subStep) {
  if (subStep === 0) {
    const tankSlot = getHighestDefSlot(PLAYER_SLOTS, data, entries)
    return {
      command:    "catastro_collapse",
      log:        PHASE4_STAND_LOG,
      tankSlot,
      nextState:  { ...state, phase4SubStep: 1, phase4TankSlot: tankSlot },
    }
  }

  // subStep === 1: 지진
  const tankSlot = state.phase4TankSlot ?? null
  const didStand = data.phase4StandChoice === "stand"
  return {
    command:   "catastro_earthquake",
    log:       null,
    moveName:  "지진",
    tankSlot,
    didStand,
    nextState: { ...state, phase4SubStep: 0, phase4TankSlot: null },
  }
}

// ── 얼음 코어: [비극] → 휴식 → 눈보라 ───────────────────────────
function decidePhase4Ice(state, data, entries, PLAYER_SLOTS, subStep) {
  const alivePlayers = PLAYER_SLOTS.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = data[`${s}_entry`]?.[idx]
    return pkmn && pkmn.hp > 0
  })

  if (subStep === 0) {
    const target = alivePlayers.length > 0
      ? alivePlayers[Math.floor(Math.random() * alivePlayers.length)]
      : null
    return {
      command:    "catastro_tragedy",
      log:        PHASE4_STAND_LOG,
      targetSlot: target,
      nextState:  { ...state, phase4SubStep: 1 },
    }
  }

  if (subStep === 1) {
    return {
      command:   "idle",
      log:       rand(IDLE_LOGS),
      nextState: { ...state, phase4SubStep: 2 },
    }
  }

  // subStep === 2: 눈보라
  return {
    command:   "direct",
    log:       null,
    moveName:  "눈보라",
    nextState: { ...state, phase4SubStep: 0 },
  }
}

// ── 물+풀 코어: 카타스트로피 1발 → 레조넌스 대기 ────────────────
function decidePhase4WaterGrass(state, data, entries, PLAYER_SLOTS, subStep) {
  if (subStep === 0) {
    return {
      command:   "catastro_ult_first",
      log:       null,
      moveName:  "카타스트로피",
      nextState: { ...state, phase4SubStep: 1, ultPhase: 1 },
    }
  }
  // subStep === 1: 레조넌스 대기 모달 트리거
  return {
    command:   "catastro_ult_second_windup",
    log:       null,
    nextState: { ...state, ultPhase: 2 },
  }
}

// ── 헬퍼 ──────────────────────────────────────────────────────────
function getTopDmgSlot(window, PLAYER_SLOTS, data, entries) {
  const alive = PLAYER_SLOTS.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = data[`${s}_entry`]?.[idx]
    return pkmn && pkmn.hp > 0
  })
  if (alive.length === 0) return null
  let top = alive[0], topDmg = window[alive[0]] ?? 0
  for (const s of alive) {
    const d = window[s] ?? 0
    if (d > topDmg) { top = s; topDmg = d }
  }
  return top
}

function getHighestDefSlot(PLAYER_SLOTS, data, entries) {
  const alive = PLAYER_SLOTS.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = data[`${s}_entry`]?.[idx]
    return pkmn && pkmn.hp > 0
  })
  if (alive.length === 0) return null
  alive.sort((a, b) => {
    const pA = entries[a]?.[data[`${a}_active_idx`] ?? 0]
    const pB = entries[b]?.[data[`${b}_active_idx`] ?? 0]
    const defDiff = (pB?.defense ?? 0) - (pA?.defense ?? 0)
    if (defDiff !== 0) return defDiff
    const atkDiff = (pB?.attack ?? 0) - (pA?.attack ?? 0)
    if (atkDiff !== 0) return atkDiff
    return Math.random() < 0.5 ? -1 : 1
  })
  return alive[0]
}

// ── 외부 export ───────────────────────────────────────────────────
export function getPartLabel(partKey) {
  return { eye: "눈", wing: "날개", tail: "꼬리", claw: "발톱" }[partKey] ?? partKey
}
export function getPartSlotKey(partKey) {
  return { eye: "eyehp", wing: "winghp", tail: "tailhp", claw: "clawhp" }[partKey] ?? null
}
export function getCoreDestroyLog(name)        { return rand(CORE_DESTROY_LOGS)(name) }
export function getBossIntroLogs()             { return ["누클라바스가 나타났다!", "...아무 반응이 없다."] }
export function getDeathLogs()                 { return ["누클라바스는 쓰러졌다..."] }
export function getUltWindupLog()              { return rand(ULT_WINDUP_LOGS) }
export function getUltAfterLogs()              { return ULT_AFTER_LOGS }
export function getResonancePlayerLog(nick)    { return rand(RESONANCE_PLAYER_LOGS)(nick) }
export function getResonanceFireLog()          { return RESONANCE_FIRE_LOG }

export const PHASE4_THRESHOLDS = {
  electric:   1500,
  ground:     3000,
  ice:        4500,
  waterGrass: 7500,
}

// catastrophe는 자체 ult 트리거 안 씀 (phase4CoreSeq로 직접 관리)
export function shouldTriggerUlt() { return false }
export function getUltTarget()     { return null  }
export function nextUltCooldown()  { return 0     }