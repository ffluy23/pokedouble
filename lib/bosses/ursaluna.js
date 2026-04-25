// lib/bosses/ursaluna.js
// ══════════════════════════════════════════════════════════════════
//  다투곰 보스 AI
//  - 기믹 없음, 고체력 + 강력한 단일기 기반
//  - 특성 [심안]: 노말/격투 타입이 고스트 타입에게 명중
//  - 1페이즈: 파괴충동 / 돌진 랜덤
//  - 2페이즈(HP 50%↓): 광폭화 → 블러드문 → 재충전 → 이판사판태클 루프
// ══════════════════════════════════════════════════════════════════

const PHASE2_THRESHOLD = 0.50

// ── 환경 로그 풀 ─────────────────────────────────────────────────
const AMBIENT_LOGS_P1 = [
  "땅이 울렁거린다.",
  "다투곰의 숨소리가 귓가를 스친다.",
  "발밑이 점점 무거워진다.",
  "다투곰의 시선이 우릴 붙잡는다.",
  "땅이 눈에 띄게 흔들린다.",
]

const AMBIENT_LOGS_P2 = [
  "바닥이 진흙처럼 무너져 내린다.",
  "충격이 발밑으로 퍼진다!",
  "주변의 땅이 무너져 내린다!",
  "다투곰은 점점 거칠게 행동한다.",
  "다투곰은 마지막 힘을 쥐어짜고 있다.",
]

function pickAmbient(pool) {
  return pool[Math.floor(Math.random() * pool.length)]
}

// ── 페이즈 판별 ───────────────────────────────────────────────────
function getPhase(data) {
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  return ratio <= PHASE2_THRESHOLD ? 2 : 1
}

// ── 타겟: HP 최고 ─────────────────────────────────────────────────
function getHighestHpTarget(data, entries, playerSlots) {
  const alive = playerSlots.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0
  })
  if (alive.length === 0) return null
  return alive.reduce((best, s) => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const hp   = entries[s]?.[idx]?.hp ?? 0
    const bidx = data[`${best}_active_idx`] ?? 0
    const bhp  = entries[best]?.[bidx]?.hp ?? 0
    return hp > bhp ? s : best
  })
}

// ── 타겟: HP 최저 ─────────────────────────────────────────────────
function getLowestHpTarget(data, entries, playerSlots) {
  const alive = playerSlots.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0
  })
  if (alive.length === 0) return null
  return alive.reduce((best, s) => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const hp   = entries[s]?.[idx]?.hp ?? 0
    const bidx = data[`${best}_active_idx`] ?? 0
    const bhp  = entries[best]?.[bidx]?.hp ?? 0
    return hp < bhp ? s : best
  })
}

// ── 랜덤 생존 타겟 ───────────────────────────────────────────────
function getRandomAliveTarget(data, entries, playerSlots) {
  const alive = playerSlots.filter(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = entries[s]?.[idx]
    return pkmn && pkmn.hp > 0
  })
  if (alive.length === 0) return null
  return alive[Math.floor(Math.random() * alive.length)]
}

// ════════════════════════════════════════════════════════════════
//  decideBossMove
// ════════════════════════════════════════════════════════════════
export function decideBossMove(data, entries, playerSlots) {
  const phase    = getPhase(data)
  const state    = data.boss_state ?? {}
  const bossName = data.boss_name ?? "다투곰"

  // ─── 1페이즈 ───────────────────────────────────────────────────
  if (phase === 1) {
    const ambient = Math.random() < 0.4 ? pickAmbient(AMBIENT_LOGS_P1) : null

    // 파괴충동 지속 중이면 계속
    if ((state.furyTurnsLeft ?? 0) > 0) {
      const nextFury = state.furyTurnsLeft - 1
      return {
        command:   "direct",
        moveName:  "파괴충동",
        targetSlot: null,           // AOE
        log:       `${bossName}은 계속해서 날뛰고 있다!`,
        nextState: { ...state, furyTurnsLeft: nextFury },
        ...(ambient ? { moveLog: ambient } : {}),
      }
    }

    // 파괴충동 vs 돌진 50:50
    if (Math.random() < 0.5) {
      // 파괴충동: 2~3턴 지속
      const furyDuration = Math.floor(Math.random() * 2) + 2   // 2 or 3
      return {
        command:   "direct",
        moveName:  "파괴충동",
        targetSlot: null,
        log:       `${bossName}은 거칠게 날뛰기 시작한다!`,
        nextState: { ...state, furyTurnsLeft: furyDuration - 1 },
        ...(ambient ? { moveLog: ambient } : {}),
      }
    } else {
      // 돌진: 단일기
      const target = getRandomAliveTarget(data, entries, playerSlots)
      return {
        command:   "direct",
        moveName:  "돌진",
        targetSlot: target,
        log:       `${bossName}은 거칠게 몸을 휘두른다!`,
        nextState: { ...state },
        ...(ambient ? { moveLog: ambient } : {}),
      }
    }
  }

  // ─── 2페이즈 ───────────────────────────────────────────────────
  const ambient = Math.random() < 0.4 ? pickAmbient(AMBIENT_LOGS_P2) : null
  const p2step  = state.p2step ?? "fury"   // fury → bloodmoon → recharge → tackle_loop

  // 광폭화 (2페이즈 진입 직후 1회)
  if (p2step === "fury") {
    return {
      command:   "ursaluna_fury",
      moveName:  "광폭화",
      targetSlot: null,
      log:       null,
      nextState: { ...state, p2step: "bloodmoon" },
      ...(ambient ? { moveLog: ambient } : {}),
    }
  }

  // 블러드문 (1턴)
  if (p2step === "bloodmoon") {
    const target = getHighestHpTarget(data, entries, playerSlots)
                ?? getRandomAliveTarget(data, entries, playerSlots)
    return {
      command:   "direct",
      moveName:  "블러드문",
      targetSlot: target,
      log:       `${bossName}의 시선이 단단한 상대를 향한다!`,
      nextState: { ...state, p2step: "recharge" },
      ...(ambient ? { moveLog: ambient } : {}),
    }
  }

  // 재충전 (블러드문 패널티)
  if (p2step === "recharge") {
    return {
      command:   "recharge",
      moveName:  null,
      targetSlot: null,
      log:       `${bossName}은 잠시 숨을 고른다...`,
      nextState: { ...state, p2step: "tackle_loop" },
      ...(ambient ? { moveLog: ambient } : {}),
    }
  }

  // 이판사판태클 루프
  const target = getLowestHpTarget(data, entries, playerSlots)
              ?? getRandomAliveTarget(data, entries, playerSlots)
  return {
    command:   "direct",
    moveName:  "이판사판태클",
    targetSlot: target,
    log:       `${bossName}은 멈추지 않는다!`,
    nextState: { ...state, p2step: "tackle_loop" },
    ...(ambient ? { moveLog: ambient } : {}),
  }
}

// ════════════════════════════════════════════════════════════════
//  shouldTriggerUlt / ult 관련 (다투곰은 ult 없음)
// ════════════════════════════════════════════════════════════════
export function shouldTriggerUlt(_data) { return false }
export function getUltTarget()          { return null  }
export function nextUltCooldown()       { return 0     }

// ════════════════════════════════════════════════════════════════
//  페이즈2 진입 체크
// ════════════════════════════════════════════════════════════════
export function checkPhase2Enter(data, nextState, _command) {
  if (data._phase2Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > PHASE2_THRESHOLD) return null

  return {
    logs: [
      "다투곰의 숨소리가 점점 거칠어진다.",
      "다투곰은 고통을 느끼지 않는 것 같다.",
    ],
    nextState:        { ...nextState, p2step: "fury" },
    setPhase2Entered: true,
  }
}

// ════════════════════════════════════════════════════════════════
//  등장 / 사망 로그
// ════════════════════════════════════════════════════════════════
export function getBossIntroLogs() {
  return ["다투곰은 붉은 하늘을 향해 포효한다!"]
}

export function getDeathLogs() {
  return [
    "땅의 떨림이 멈췄다.",
    "다투곰은 더 이상 움직이지 않는다.",
  ]
}

// 독침붕 없음
export function getBeedrillIdleLog() { return null }