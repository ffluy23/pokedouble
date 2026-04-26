// lib/bosses/ninjask.js
// 보스: 아이스크 (닌자스크 → 껍질몬)

import { PLAYER_SLOTS, getAlivePlayers, makeLog, defaultRanks } from "../raidBossAction.js"

const BOSS_NAME = "아이스크"
const SHEDINJA_ROUND_LIMIT = 8

const PHASE1_CYCLE = ["시저크로스", "시저크로스", "제비반환", "random"]
const PHASE2_RANDOM_ULT_CHANCE = 0.30

// ────────────────────────────────────────────────────────────────────
//  내부 헬퍼
// ────────────────────────────────────────────────────────────────────
function getPhase(data) {
  if (data.boss_state?.isShedinja) return 3
  if (data._phase2Entered) return 2
  return 1
}

function getAliveTarget(data, entries) {
  const alive = getAlivePlayers(data, entries)
  if (alive.length === 0) return null
  return alive[Math.floor(Math.random() * alive.length)]
}

// ────────────────────────────────────────────────────────────────────
//  껍질몬 전환 데이터 빌더 (raidUseMove.js에서 직접 호출)
// ────────────────────────────────────────────────────────────────────
export function buildShedinjaTransition(data, shedinja, logEntries) {
  data.boss_current_hp   = 1
  data.boss_max_hp       = 1
  data.boss_name         = shedinja.boss_name  ?? "껍질몬"
  data.boss_attack       = shedinja.attack      ?? 1
  data.boss_defense      = shedinja.defense     ?? 1
  data.boss_speed        = shedinja.speed       ?? 2
  data.boss_portrait     = shedinja.portrait    ?? null
  data.boss_type         = shedinja.type        ?? ["벌레", "고스트"]
  data.boss_state = {
    ...(data.boss_state ?? {}),
    isShedinja:      true,
    shedinjaRound:   0,
    shedinjaCleared: false,
  }
  data._phase3Entered = true

  logEntries.push(makeLog("normal", "...?!"))
  logEntries.push(makeLog("normal", "아이스크의 모습이 변해간다..."))
  logEntries.push(makeLog("normal", "껍질몬이 나타났다! 텅 빈 껍질만이 서 있다."))
  logEntries.push(makeLog("hp", "", { slot: "boss", hp: 1, maxHp: 1 }))
}

// ────────────────────────────────────────────────────────────────────
//  3페이즈 전환 조건 체크 헬퍼 (raidUseMove.js에서 사용)
// ────────────────────────────────────────────────────────────────────
export function isNinjaskPhase3Trigger(data) {
  return (
    data.boss_name === "아이스크" &&
    (data.boss_current_hp ?? 0) <= 0 &&
    !data.boss_state?.isShedinja &&
    !data._phase3Entered
  )
}

// ────────────────────────────────────────────────────────────────────
//  보스 소개 로그
// ────────────────────────────────────────────────────────────────────
export function getBossIntroLogs() {
  return [
    "아이스크가 나타났다!",
    "날개짓 소리가 귀를 찢을 듯이 울린다...",
    "엄청난 속도다! 눈으로 쫓을 수조차 없어!",
  ]
}

// ────────────────────────────────────────────────────────────────────
//  사망 로그
// ────────────────────────────────────────────────────────────────────
export function getDeathLogs() {
  return ["껍질몬이 조용히 무너진다. 아무것도 남지 않았다."]
}

// ────────────────────────────────────────────────────────────────────
//  ult 관련 (AI 내부에서 직접 제어)
// ────────────────────────────────────────────────────────────────────
export function shouldTriggerUlt(_data) { return false }
export function getUltTarget(_data, _entries, _slots) { return null }
export function nextUltCooldown() { return 0 }

// ────────────────────────────────────────────────────────────────────
//  2페이즈 진입 체크
// ────────────────────────────────────────────────────────────────────
export function checkPhase2Enter(data, nextState, _command) {
  if (data._phase2Entered) return null
  const hpRatio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (hpRatio > 0.5) return null

  return {
    logs: [
      `${BOSS_NAME}의 속도가 극에 달했다!`,
      "2페이즈 돌입! 이제 아이스크의 진면목을 보게 될 것이다!",
    ],
    nextState: {
      ...nextState,
      phase1CycleIdx:   0,
      phase2RoundCount: 0,
    },
    setPhase2Entered: true,
  }
}

// ────────────────────────────────────────────────────────────────────
//  3페이즈 진입 체크 (executeBossAction 용 — 보스 EOT 사망 대비)
// ────────────────────────────────────────────────────────────────────
export function checkPhase3Enter(_data, _nextState, _command) {
  return null
}

// ────────────────────────────────────────────────────────────────────
//  껍질몬 라운드 로그
// ────────────────────────────────────────────────────────────────────
function getShedinjaRoundLog(round) {
  const logs = {
    1: "껍질몬이 미동도 하지 않는다... 텅 빈 껍질만이 서 있다.",
    2: "공격이 스쳐지나간다... 아무것도 닿지 않는 느낌이다.",
    3: "껍질몬은 여전히 반응이 없다. 마치 존재하지 않는 것 같다.",
    4: "바람이 스쳐 지나간다... 껍질몬은 그 자리에 남아있다.",
    5: "버티고 있는 것인지... 남아 있는 것인지 알 수 없다.",
    6: "미련? 후회? 아니면?",
    7: "껍질몬의 기운이 점점 사라진다. 마치 놓아주려는 듯하다.",
    8: "껍질몬이 조용히 무너진다. 아무것도 남지 않았다.",
  }
  return logs[round] ?? ""
}

// ────────────────────────────────────────────────────────────────────
//  메인 AI: decideBossMove
// ────────────────────────────────────────────────────────────────────
export function decideBossMove(data, entries, slots) {
  const phase = getPhase(data)
  const state = data.boss_state ?? {}

  // ── 껍질몬 페이즈 ───────────────────────────────────────────────
  if (phase === 3) {
    const round = (state.shedinjaRound ?? 0) + 1
    const roundLog = getShedinjaRoundLog(round)

    if (round >= SHEDINJA_ROUND_LIMIT) {
      return {
        command:    "shedinja_clear",
        log:        roundLog,
        moveName:   null,
        targetSlot: null,
        nextState: {
          ...state,
          shedinjaRound:   round,
          shedinjaCleared: true,
        },
      }
    }

    return {
      command:    "shedinja_idle",
      log:        roundLog,
      moveName:   "버티기",
      targetSlot: null,
      nextState: {
        ...state,
        shedinjaRound: round,
      },
    }
  }

  // ── 1페이즈 ─────────────────────────────────────────────────────
  if (phase === 1) {
    const cycleIdx = state.phase1CycleIdx ?? 0
    let moveName   = PHASE1_CYCLE[cycleIdx % PHASE1_CYCLE.length]
    if (moveName === "random") moveName = Math.random() < 0.5 ? "시저크로스" : "제비반환"

    const isAoe      = moveName === "시저크로스"
    const targetSlot = isAoe ? null : getAliveTarget(data, entries)

    return {
      command:   "direct",
      moveName,
      targetSlot,
      log:       null,
      nextState: {
        ...state,
        phase1CycleIdx: (cycleIdx + 1) % PHASE1_CYCLE.length,
      },
    }
  }

  // ── 2페이즈 ─────────────────────────────────────────────────────
  const phase2Round = (state.phase2RoundCount ?? 0) + 1

  // 짝수 라운드: 흡혈
  if (phase2Round % 2 === 0) {
    const targetSlot = getAliveTarget(data, entries)
    return {
      command:   "direct",
      moveName:  "흡혈",
      targetSlot,
      log:       null,
      nextState: {
        ...state,
        phase1CycleIdx:   state.phase1CycleIdx ?? 0,
        phase2RoundCount: phase2Round,
      },
    }
  }

  // 랜덤 벌레의야단법석
  if (Math.random() < PHASE2_RANDOM_ULT_CHANCE) {
    return {
      command:   "direct",
      moveName:  "벌레의야단법석",
      targetSlot: null,
      log:       null,
      nextState: {
        ...state,
        phase2RoundCount: phase2Round,
      },
    }
  }

  // 1페이즈 패턴 유지
  const cycleIdx = state.phase1CycleIdx ?? 0
  let moveName   = PHASE1_CYCLE[cycleIdx % PHASE1_CYCLE.length]
  if (moveName === "random") moveName = Math.random() < 0.5 ? "시저크로스" : "제비반환"

  const isAoe      = moveName === "시저크로스"
  const targetSlot = isAoe ? null : getAliveTarget(data, entries)

  return {
    command:   "direct",
    moveName,
    targetSlot,
    log:       null,
    nextState: {
      ...state,
      phase1CycleIdx:   (cycleIdx + 1) % PHASE1_CYCLE.length,
      phase2RoundCount: phase2Round,
    },
  }
}

// ────────────────────────────────────────────────────────────────────
//  껍질몬 EOT (raidBossAction에서 호출)
// ────────────────────────────────────────────────────────────────────
export function processNinjaskEot(data, _entries, logEntries) {
  if (!data.boss_state?.isShedinja) return
  const round = data.boss_state?.shedinjaRound ?? 0
  if (round >= SHEDINJA_ROUND_LIMIT && !data.boss_state?.shedinjaCleared) {
    data.boss_current_hp = 0
    logEntries.push(makeLog("faint", "껍질몬이 쓰러졌다!", { slot: "boss" }))
    data.boss_state = { ...data.boss_state, shedinjaCleared: true }
  }
}