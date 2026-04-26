// lib/bosses/zoroark.js
// 조로아크 보스 AI

import { getTypeMultiplier } from "../typeChart.js"
import { josa }              from "../effecthandler.js"
import { bossMoves }         from "../bossMoves.js"
import { moves }             from "../moves.js"
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
const BOSS_NAME       = "조로아크"
const PHASE2_HP_RATIO = 0.80
const PHASE3_HP_RATIO = 0.50

// 도발 메시지 3종
const TAUNT_MESSAGES = [
  "자, 나를 공격해봐. 그게 정답이야.",
  "지금이 기회야, 다음 턴엔 늦어.",
  "아무것도 안 하는 건 최악의 선택이지.",
]

// ════════════════════════════════════════════════════════════════════
//  유틸
// ════════════════════════════════════════════════════════════════════
function activePkmn(slot, data, entries) {
  const idx = data[`${slot}_active_idx`] ?? 0
  return entries[slot]?.[idx] ?? null
}

function getPhase(data) {
  return data.boss_state?.phase ?? 1
}

function randomAlive(data, entries) {
  const alive = getAlivePlayers(data, entries)
  if (alive.length === 0) return null
  return alive[Math.floor(Math.random() * alive.length)]
}

// [원한] 상태인 슬롯 목록
function getGrudgeSlots(data, entries) {
  return PLAYER_SLOTS.filter(s => {
    const p = activePkmn(s, data, entries)
    return p && p.hp > 0 && p.grudge === true
  })
}

// [원한] 없는 생존 슬롯 목록
function getNonGrudgeAlive(data, entries) {
  return getAlivePlayers(data, entries).filter(s => {
    const p = activePkmn(s, data, entries)
    return p && !p.grudge
  })
}

// ════════════════════════════════════════════════════════════════════
//  [원한] 부여 / 제거
// ════════════════════════════════════════════════════════════════════
function applyGrudge(targetSlot, data, entries, logEntries) {
  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn || pkmn.hp <= 0) return false
  pkmn.grudge = true
  logEntries.push(makeLog("normal",
    `${BOSS_NAME}${josa(BOSS_NAME, "이가")} ${pkmn.name}${josa(pkmn.name, "에게")} 원한을 품었다!`
  ))
  return true
}

function clearGrudge(targetSlot, data, entries, logEntries) {
  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn) return
  pkmn.grudge = false
  if (logEntries) logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "의")} 원한이 사라졌다!`))
}

function clearAllGrudges(data, entries, logEntries) {
  for (const s of PLAYER_SLOTS) {
    const p = activePkmn(s, data, entries)
    if (p && p.grudge) {
      p.grudge = false
    }
  }
  if (logEntries) logEntries.push(makeLog("normal", "원한이 전부 사라졌다!"))
}

// ════════════════════════════════════════════════════════════════════
//  보스 공격 헬퍼 (싱크로 + 블래키 포함)
// ════════════════════════════════════════════════════════════════════
function _attackTarget(moveName, targetSlot, data, entries, logEntries, powerMult = 1.0) {
  const moveInfo = bossMoves[moveName] ?? moves[moveName]
  if (!moveInfo) {
    logEntries.push(makeLog("normal", `기술 정보 없음: ${moveName}`))
    return 0
  }

  const pkmn = activePkmn(targetSlot, data, entries)
  if (!pkmn || pkmn.hp <= 0) {
    logEntries.push(makeLog("normal", "공격할 대상이 이미 쓰러졌다!"))
    return 0
  }

  const dice     = rollD10()
  const defTypes = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
  let mult = 1
  for (const t of defTypes) mult *= getTypeMultiplier(moveInfo.type, t)

  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} ${moveName}!`))
  logEntries.push(makeLog("dice", "", { slot: "boss", roll: dice }))

  if (mult === 0) {
    logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`))
    return 0
  }

  const bossAtk = (data.boss_attack ?? 5) + getActiveRankVal(data.boss_rank ?? {}, "atk")
  const defStat = pkmn.defense ?? 3
  const defRank = getActiveRankVal(pkmn.ranks ?? {}, "def")
  const power   = Math.floor((moveInfo.power ?? 40) * powerMult)
  const wMult   = getWeatherDamageMult(data.weather ?? null, moveInfo.type)
  const raw     = Math.floor((power + bossAtk * 4 + dice) * mult * wMult)
  let damage    = Math.max(1, raw - defStat * 3 - defRank * 3)

  // 리플렉터 경감
  if ((data.boss_reflectorTurns ?? 0) > 0) {
    damage = Math.max(1, Math.floor(damage * 0.75))
    logEntries.push(makeLog("normal", "리플렉터가 피해를 줄였다!"))
  }

  // 빛의장막 경감
  if ((pkmn.lightScreen ?? 0) > 0) {
    damage = Math.max(1, Math.floor(damage * 0.75))
    logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "의")} 빛의장막이 피해를 줄였다!`))
  }

  if (mult > 1) logEntries.push(makeLog("after_hit", "효과가 굉장했다!"))
  if (mult < 1) logEntries.push(makeLog("after_hit", "효과가 별로인 듯하다…"))

  // 싱크로 처리
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

  activateUmbreon(damagesMap, data, entries, logEntries)

  let totalDealt = 0
  for (const [slot, dmg] of Object.entries(damagesMap)) {
    if (dmg <= 0) continue
    const target = activePkmn(slot, data, entries)
    if (!target || target.hp <= 0) continue

    if (target.defending) {
      logEntries.push(makeLog("normal", `${target.name}${josa(target.name, "은는")} 방어했다!`))
      target.defending   = false
      target.defendTurns = 0
      continue
    }

    if (target.enduring && dmg >= target.hp) {
      target.hp      = 1
      target.enduring = false
      logEntries.push(makeLog("after_hit", `${target.name}${josa(target.name, "은는")} 버텼다!`))
    } else {
      target.hp = Math.max(0, target.hp - dmg)
    }
    target.tookDamageLastTurn = true
    target.last_damage_taken  = dmg
    totalDealt += dmg

    logEntries.push(makeLog("hit", "", { defender: slot }))
    logEntries.push(makeLog("hp",  "", { slot, hp: target.hp, maxHp: target.maxHp }))
    if (target.hp <= 0)
      logEntries.push(makeLog("faint", `${target.name}${josa(target.name, "은는")} 쓰러졌다!`, { slot }))
  }

  return totalDealt
}

// ════════════════════════════════════════════════════════════════════
//  [저주] — 랜덤 타깃에게 원한 부여
// ════════════════════════════════════════════════════════════════════
function processZoroarkCurse(data, entries, logEntries) {
  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 저주!`))
  const target = randomAlive(data, entries)
  if (!target) { logEntries.push(makeLog("normal", "대상이 없다!")); return }
  applyGrudge(target, data, entries, logEntries)
}

// ════════════════════════════════════════════════════════════════════
//  [섀도크루] — 원한 없는 대상 랜덤 공격, 누적 데미지 저장
// ════════════════════════════════════════════════════════════════════
function processShadowClaw(data, entries, logEntries) {
  const nonGrudge = getNonGrudgeAlive(data, entries)
  const alive     = getAlivePlayers(data, entries)

  // 원한 없는 대상이 없으면 그냥 랜덤 공격
  const pool   = nonGrudge.length > 0 ? nonGrudge : alive
  const target = pool[Math.floor(Math.random() * pool.length)]
  if (!target) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); return }

  const dealt = _attackTarget("섀도크루", target, data, entries, logEntries)

  // 누적 데미지 저장
  data.boss_state = {
    ...(data.boss_state ?? {}),
    shadowClawTotalDmg: ((data.boss_state?.shadowClawTotalDmg ?? 0) + dealt),
  }
}

// ════════════════════════════════════════════════════════════════════
//  [앙갚음] — 누적 데미지 60%를 원한 대상에게
// ════════════════════════════════════════════════════════════════════
function processRevenge(data, entries, logEntries) {
  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 앙갚음!`))

  const grudgeSlots = getGrudgeSlots(data, entries)
  if (grudgeSlots.length === 0) {
    logEntries.push(makeLog("normal", "원한 대상이 없다!"))
    return
  }

  const totalDmg  = data.boss_state?.shadowClawTotalDmg ?? 0
  const revengeDmg = Math.max(1, totalDmg * 2)

  for (const slot of grudgeSlots) {
    const pkmn = activePkmn(slot, data, entries)
    if (!pkmn || pkmn.hp <= 0) continue

    const dice     = rollD10()
    const defTypes = Array.isArray(pkmn.type) ? pkmn.type : [pkmn.type]
    let mult = 1
    for (const t of defTypes) mult *= getTypeMultiplier("악", t)

    let damage = mult === 0 ? 0 : Math.max(1, Math.floor(revengeDmg * mult))

    if ((data.boss_reflectorTurns ?? 0) > 0) damage = Math.max(1, Math.floor(damage * 0.75))
    if ((pkmn.lightScreen ?? 0) > 0)          damage = Math.max(1, Math.floor(damage * 0.75))

    logEntries.push(makeLog("dice", "", { slot: "boss", roll: dice }))

    if (mult === 0) {
      logEntries.push(makeLog("normal", `${pkmn.name}에게는 효과가 없다…`))
    } else {
      const damagesMap = { [slot]: damage }
      activateUmbreon(damagesMap, data, entries, logEntries)
      const finalDmg = damagesMap[slot] ?? damage

      if (pkmn.defending) {
        logEntries.push(makeLog("normal", `${pkmn.name}${josa(pkmn.name, "은는")} 방어했다!`))
        pkmn.defending = false; pkmn.defendTurns = 0
      } else if (pkmn.enduring && finalDmg >= pkmn.hp) {
        pkmn.hp = 1; pkmn.enduring = false
        logEntries.push(makeLog("after_hit", `${pkmn.name}${josa(pkmn.name, "은는")} 버텼다!`))
      } else {
        pkmn.hp = Math.max(0, pkmn.hp - finalDmg)
      }
      pkmn.tookDamageLastTurn = true
      pkmn.last_damage_taken  = finalDmg

      logEntries.push(makeLog("hit", "", { defender: slot }))
      logEntries.push(makeLog("hp",  "", { slot, hp: pkmn.hp, maxHp: pkmn.maxHp }))
      if (pkmn.hp <= 0)
        logEntries.push(makeLog("faint", `${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`, { slot }))
    }

    clearGrudge(slot, data, entries, logEntries)
  }

  // 누적 데미지 초기화
  data.boss_state = { ...(data.boss_state ?? {}), shadowClawTotalDmg: 0 }
}

// ════════════════════════════════════════════════════════════════════
//  [분풀이] — 단일 공격
// ════════════════════════════════════════════════════════════════════
function processVenting(targetSlot, data, entries, logEntries, powerMult = 1.0) {
  const target = targetSlot ?? randomAlive(data, entries)
  if (!target) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); return }
  _attackTarget("분풀이", target, data, entries, logEntries, powerMult)
}

// ════════════════════════════════════════════════════════════════════
//  [일루전] — 페이크 HP + 포켓몬 외형 복사
// ════════════════════════════════════════════════════════════════════
function processIllusion(data, entries, logEntries) {
  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 일루전!`))

  // 페이크 HP: 실제 HP의 40%~120% 구간 랜덤
  const realHp   = data.boss_current_hp ?? 0
  const ratio    = 0.40 + Math.random() * 0.80  // 0.40 ~ 1.20
  const fakeHp   = Math.max(1, Math.floor(realHp * ratio))
  data.boss_illusion_hp = fakeHp  // 클라이언트에서 이 값을 표시

  // 살아있는 플레이어 중 랜덤 1명 외형 복사
  const alive = getAlivePlayers(data, entries)
  if (alive.length > 0) {
    const copiedSlot = alive[Math.floor(Math.random() * alive.length)]
    const pkmn = activePkmn(copiedSlot, data, entries)
    if (pkmn) {
      data.boss_illusion_name    = pkmn.name
      data.boss_illusion_portrait = pkmn.portrait ?? null
      logEntries.push(makeLog("normal",
        `${BOSS_NAME}${josa(BOSS_NAME, "이가")} ${pkmn.name}${josa(pkmn.name, "의")} 모습을 베껴냈다!`
      ))
      // 이후 도둑질 기준 포켓몬으로도 사용
      data.boss_state = {
        ...(data.boss_state ?? {}),
        illusionName:    pkmn.name,
        illusionPortrait: pkmn.portrait ?? null,
        illusionSlot:    copiedSlot,
      }
    }
  }

  logEntries.push(makeLog("zoroark_illusion", "", {
    fakeHp,
    realHp,
    illusionName:     data.boss_illusion_name    ?? BOSS_NAME,
    illusionPortrait: data.boss_illusion_portrait ?? null,
  }))
}

// ════════════════════════════════════════════════════════════════════
//  [깨트리기] — 빛의장막 / 리플렉터 제거 (우선행동)
// ════════════════════════════════════════════════════════════════════
function processBreaker(data, entries, logEntries) {
  let broke = false

  // 플레이어 빛의장막 체크
  for (const s of PLAYER_SLOTS) {
    const p = activePkmn(s, data, entries)
    if (p && (p.lightScreen ?? 0) > 0) {
      p.lightScreen = 0
      logEntries.push(makeLog("normal", `${p.name}${josa(p.name, "의")} 빛의장막이 부서졌다!`))
      broke = true
    }
  }

  // 보스 측 리플렉터 체크 (플레이어가 친 경우)
  if ((data.boss_reflectorTurns ?? 0) > 0) {
    data.boss_reflectorTurns = 0
    logEntries.push(makeLog("normal", `리플렉터가 부서졌다!`))
    broke = true
  }

  if (broke) {
    logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 깨트리기!`))
  }
}

// ════════════════════════════════════════════════════════════════════
//  [도둑질] — 플레이어 기술 훔치기 & 최적 사용
// ════════════════════════════════════════════════════════════════════

// 기술 후보 점수 계산
function scoreStolenMove(moveName, targetSlot, data, entries) {
  const moveInfo = moves[moveName]
  if (!moveInfo || !moveInfo.power) return -Infinity

  const target   = activePkmn(targetSlot, data, entries)
  if (!target) return -Infinity

  const defTypes = Array.isArray(target.type) ? target.type : [target.type]
  let mult = 1
  for (const t of defTypes) mult *= getTypeMultiplier(moveInfo.type, t)
  if (mult === 0) return -Infinity

  return (moveInfo.power ?? 40) * mult
}

// 각 플레이어에서 가장 높은 위력 기술 훔치기
function stealBestMoves(data, entries, logEntries) {
  const storedMoves = {}

  for (const s of PLAYER_SLOTS) {
    const pkmn = activePkmn(s, data, entries)
    if (!pkmn || pkmn.hp <= 0) continue

    const movesArr = pkmn.moves ?? []
    if (movesArr.length === 0) continue

    // 공격 기술만 후보
    const attackMoves = movesArr.filter(m => (moves[m.name]?.power ?? 0) > 0)
    if (attackMoves.length === 0) continue

    // 최대 위력 기준 정렬
    attackMoves.sort((a, b) => {
      const pa = moves[a.name]?.power ?? 0
      const pb = moves[b.name]?.power ?? 0
      return pb - pa
    })

    storedMoves[s] = attackMoves[0].name
  }

  data.boss_state = {
    ...(data.boss_state ?? {}),
    stolenMoves: storedMoves,
  }

  logEntries.push(makeLog("normal", "조로아크가 재빠르게 움직였다!"))
}

// 타겟 결정 후 최적 훔친 기술 선택해 공격
function useStolenMove(data, entries, logEntries) {
  const stolenMoves = data.boss_state?.stolenMoves ?? {}
  const illusionName = data.boss_state?.illusionName ?? BOSS_NAME

  const alive = getAlivePlayers(data, entries)
  if (alive.length === 0) { logEntries.push(makeLog("normal", "공격할 대상이 없다!")); return }

  // 타겟: 원한 없는 대상 우선, 없으면 랜덤
  const nonGrudge = alive.filter(s => {
    const p = activePkmn(s, data, entries)
    return p && !p.grudge
  })
  const targetSlot = nonGrudge.length > 0
    ? nonGrudge[Math.floor(Math.random() * nonGrudge.length)]
    : alive[Math.floor(Math.random() * alive.length)]

  // 훔친 기술 중 타겟 기준 최고 점수 기술 선택
  let bestMoveName  = null
  let bestScore     = -Infinity

  for (const [, moveName] of Object.entries(stolenMoves)) {
    const score = scoreStolenMove(moveName, targetSlot, data, entries)
    if (score > bestScore) {
      bestScore    = score
      bestMoveName = moveName
    }
  }

  if (!bestMoveName) {
    logEntries.push(makeLog("normal", "사용할 수 있는 훔친 기술이 없다!"))
    return
  }

  const nameWithJosa = `${illusionName}${josa(illusionName, "이가")}`
  logEntries.push(makeLog("normal", `${nameWithJosa} 어둠 속으로 몸을 숨겼다...`))
  logEntries.push(makeLog("normal", `${nameWithJosa} 재빠르게 움직였다!`))
  logEntries.push(makeLog("move_announce",
    `${nameWithJosa} 훔쳐온 ${bestMoveName}${josa(bestMoveName, "을를")} 사용했다!`
  ))

  _attackTarget(bestMoveName, targetSlot, data, entries, logEntries)
}

// ════════════════════════════════════════════════════════════════════
//  [도발] 처리 — 3페이즈 핵심 메커니즘
// ════════════════════════════════════════════════════════════════════
function processTaunt(data, entries, logEntries, msgIndex) {
  const msg          = TAUNT_MESSAGES[msgIndex ?? 0]
  const grudgeSlots  = getGrudgeSlots(data, entries)
  const hasGrudge    = grudgeSlots.length > 0

  logEntries.push(makeLog("move_announce", `${BOSS_NAME}${josa(BOSS_NAME, "의")} 도발!`))
  // taunt_text 타입: 클라이언트에서 5초간 화면 상단 표시
  logEntries.push(makeLog("taunt_text", msg))

  // 도발 상태 저장 — 라운드 끝에 판정
  data.boss_state = {
    ...(data.boss_state ?? {}),
    tauntActive:      true,
    tauntMsg:         msg,
    tauntMsgIndex:    msgIndex ?? 0,
    tauntHasGrudge:   hasGrudge,
    tauntAttackedBy:  [],   // 이번 라운드에 조로아크 공격한 슬롯 목록
    tauntRoundDmg:    {},   // slot -> 이번 라운드 조로아크에게 입힌 데미지 합계
  }
}

// 도발 결과 처리 — 라운드 끝(다음 조로아크 턴)에 호출
function resolveTaunt(data, entries, logEntries) {
  const state        = data.boss_state ?? {}
  const msgIndex     = state.tauntMsgIndex ?? 0
  const hasGrudge    = state.tauntHasGrudge ?? false
  const attackedBy   = state.tauntAttackedBy ?? []
  const wasAttacked  = attackedBy.length > 0
  const grudgeSlots  = getGrudgeSlots(data, entries)
  const alive        = getAlivePlayers(data, entries)

  // 상태 초기화
  data.boss_state = { ...state, tauntActive: false, tauntMsg: null, tauntAttackedBy: [], tauntRoundDmg: {} }

  // ── 메시지 0: "자, 나를 공격해봐. 그게 정답이야." ──────────────
  if (msgIndex === 0) {
    if (hasGrudge) {
      // 진실: 공격하면 그대로 데미지, 안 하면 다음 라운드 원한 대상에게 1.5배 분풀이
      if (wasAttacked) {
        logEntries.push(makeLog("normal", "정답이야! 잘했어!"))
        // 데미지는 이미 정상 처리됨 (raidUseMove에서)
      } else {
        logEntries.push(makeLog("normal", "틀렸다... 조로아크가 비웃는다..."))
        const grudgeTarget = grudgeSlots[Math.floor(Math.random() * grudgeSlots.length)]
        if (grudgeTarget) {
          data.boss_state = {
            ...(data.boss_state ?? {}),
            pendingVenting: { target: grudgeTarget, powerMult: 1.5, clearGrudge: true },
          }
        }
      }
    } else {
      // 거짓말: 공격하면 70% 돌려줌, 안 하면 그대로 + 원한 부여
      if (wasAttacked) {
        logEntries.push(makeLog("normal", "거짓말이었다... 조로아크가 비웃는다!"))
        const attacker = attackedBy[0]
        const dealDmg  = state.tauntRoundDmg?.[attacker] ?? 0
        if (dealDmg > 0) {
          const reflected = Math.max(1, Math.floor(dealDmg * 0.70))
          const pkmn = activePkmn(attacker, data, entries)
          if (pkmn && pkmn.hp > 0) {
            pkmn.hp = Math.max(0, pkmn.hp - reflected)
            logEntries.push(makeLog("hit",  "", { defender: attacker }))
            logEntries.push(makeLog("hp",   "", { slot: attacker, hp: pkmn.hp, maxHp: pkmn.maxHp }))
            if (pkmn.hp <= 0)
              logEntries.push(makeLog("faint", `${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`, { slot: attacker }))
          }
        }
      } else {
        logEntries.push(makeLog("normal", "거짓말이었다! 속지 않았어!"))
        // 데미지는 정상 처리(공격 안 했으니 없음), 원한 부여
        const newTarget = alive[Math.floor(Math.random() * alive.length)]
        if (newTarget) applyGrudge(newTarget, data, entries, logEntries)
      }
    }
  }

  // ── 메시지 1: "지금이 기회야, 다음 턴엔 늦어." ─────────────────
  else if (msgIndex === 1) {
    if (!hasGrudge) {
      // 진실: 공격하면 데미지 + 원한 부여, 안 하면 다음 라운드 최대 데미지 입힌 대상에게 1.5배 분풀이
      if (wasAttacked) {
        logEntries.push(makeLog("normal", "정답이야! 잘했어! 조로아크가 원한을 품었다!"))
        const newTarget = alive[Math.floor(Math.random() * alive.length)]
        if (newTarget) applyGrudge(newTarget, data, entries, logEntries)
      } else {
        logEntries.push(makeLog("normal", "틀렸다... 조로아크가 비웃는다..."))
        // 직전 라운드 최대 데미지 입힌 플레이어
        const roundDmg = state.tauntRoundDmg ?? {}
        let maxSlot = null, maxDmg = -1
        for (const s of alive) {
          const d = roundDmg[s] ?? 0
          if (d > maxDmg) { maxDmg = d; maxSlot = s }
        }
        if (maxSlot) {
          data.boss_state = {
            ...(data.boss_state ?? {}),
            pendingVenting: { target: maxSlot, powerMult: 1.5, clearGrudge: false },
          }
        }
      }
    } else {
      // 거짓말: 공격하면 즉시 자신에게 1.5배 분풀이, 안 하면 다음 라운드 랜덤에게 새 원한
      if (wasAttacked) {
        logEntries.push(makeLog("normal", "거짓말이었다... 조로아크가 비웃는다!"))
        const attacker = attackedBy[Math.floor(Math.random() * attackedBy.length)]
        processVenting(attacker, data, entries, logEntries, 1.5)
      } else {
        logEntries.push(makeLog("normal", "거짓말이었다! 속지 않았어!"))
        const newTarget = alive[Math.floor(Math.random() * alive.length)]
        if (newTarget) {
          data.boss_state = {
            ...(data.boss_state ?? {}),
            pendingCurse: { target: newTarget },
          }
        }
      }
    }
  }

  // ── 메시지 2: "아무것도 안 하는 건 최악의 선택이지." ────────────
  else if (msgIndex === 2) {
    if (!hasGrudge) {
      // 진실: 공격하면 데미지 + 원한 부여, 안 하면 다음 라운드 랜덤 1명에게 1.5배 분풀이
      if (wasAttacked) {
        logEntries.push(makeLog("normal", "정답이야! 잘했어!"))
        const newTarget = alive[Math.floor(Math.random() * alive.length)]
        if (newTarget) applyGrudge(newTarget, data, entries, logEntries)
      } else {
        logEntries.push(makeLog("normal", "틀렸다... 조로아크가 비웃는다..."))
        const newTarget = alive[Math.floor(Math.random() * alive.length)]
        if (newTarget) {
          data.boss_state = {
            ...(data.boss_state ?? {}),
            pendingVenting: { target: newTarget, powerMult: 1.5, clearGrudge: false },
          }
        }
      }
    } else {
      // 거짓말: 공격하면 원한 대상에게 1.5배 분풀이(원한 사라짐), 안 하면 다음 라운드 행동 불가
      if (wasAttacked) {
        logEntries.push(makeLog("normal", "거짓말이었다... 조로아크가 비웃는다!"))
        const grudgeTarget = grudgeSlots[Math.floor(Math.random() * grudgeSlots.length)]
        if (grudgeTarget) {
          processVenting(grudgeTarget, data, entries, logEntries, 1.5)
          clearGrudge(grudgeTarget, data, entries, logEntries)
        }
      } else {
        logEntries.push(makeLog("normal", "거짓말이었다! 조로아크는 움직이지 못하는 것 같다...! 잘했어!"))
        data.boss_state = {
          ...(data.boss_state ?? {}),
          tauntSkipNext: true,
        }
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  페이즈 행동 결정
// ════════════════════════════════════════════════════════════════════
function decidePhase1(data, entries) {
  const state = data.boss_state ?? {}
  const step  = state.p1Step ?? 1

  // pendingVenting / pendingCurse 처리 우선
  if (state.pendingVenting) {
    return { command: "zoroark_pending_venting", nextState: { ...state } }
  }
  if (state.pendingCurse) {
    return { command: "zoroark_pending_curse", nextState: { ...state } }
  }

  switch (step) {
    case 1: return { command: "zoroark_curse",       nextState: { ...state, p1Step: 2, shadowClawTotalDmg: 0 } }
    case 2: return { command: "zoroark_shadowclaw",  nextState: { ...state, p1Step: 3 } }
    case 3: return { command: "zoroark_shadowclaw",  nextState: { ...state, p1Step: 4 } }
    case 4: return { command: "zoroark_revenge",     nextState: { ...state, p1Step: 1 } }
    default: return { command: "zoroark_curse",      nextState: { ...state, p1Step: 2, shadowClawTotalDmg: 0 } }
  }
}

function decidePhase2(data, entries) {
  const state = data.boss_state ?? {}

  if (state.pendingVenting) return { command: "zoroark_pending_venting", nextState: { ...state } }
  if (state.pendingCurse)   return { command: "zoroark_pending_curse",   nextState: { ...state } }

  const p2Step = state.p2Step ?? 1

  switch (p2Step) {
    case 1:
      // 깨트리기 + 일루전 동시
      return { command: "zoroark_p2_open", nextState: { ...state, p2Step: 2 } }
    case 2:
      // 도둑질: 기술 훔치기
      return { command: "zoroark_steal",   nextState: { ...state, p2Step: 3 } }
    default:
      // 도둑질: 훔친 기술 사용 (p2Step 3 이후 반복)
      return { command: "zoroark_use_stolen", nextState: { ...state, p2Step: p2Step >= 5 ? 3 : p2Step + 1 } }
  }
}

function decidePhase3(data, entries) {
  const state = data.boss_state ?? {}

  if (state.pendingVenting) return { command: "zoroark_pending_venting", nextState: { ...state } }
  if (state.pendingCurse)   return { command: "zoroark_pending_curse",   nextState: { ...state } }

  // 도발 결과 판정 대기 중
  if (state.tauntActive) {
    return { command: "zoroark_resolve_taunt", nextState: { ...state } }
  }

  // 행동 불가 (도발 거짓 패널티)
  if (state.tauntSkipNext) {
    return { command: "zoroark_skip", nextState: { ...state, tauntSkipNext: false } }
  }

  const p3Step = state.p3Step ?? 1

  // 깨트리기 체크 (빛의장막/리플렉터 있으면 우선)
  const hasScreen = PLAYER_SLOTS.some(s => (activePkmn(s, data, entries)?.lightScreen ?? 0) > 0)
    || (data.boss_reflectorTurns ?? 0) > 0
  if (hasScreen) {
    return { command: "zoroark_breaker", nextState: { ...state } }
  }

  // 3페이즈 사이클: 저주(랜덤) + 도발
  switch (p3Step) {
    case 1: {
      const useCurse  = Math.random() < 0.5
      const msgIndex  = Math.floor(Math.random() * TAUNT_MESSAGES.length)
      return {
        command:   useCurse ? "zoroark_p3_curse_taunt" : "zoroark_p3_taunt",
        msgIndex,
        nextState: { ...state, p3Step: 2 },
      }
    }
    case 2:
      return { command: "zoroark_resolve_taunt", nextState: { ...state, p3Step: 3 } }
    default:
      return { command: "zoroark_venting", nextState: { ...state, p3Step: 1 } }
  }
}

// ════════════════════════════════════════════════════════════════════
//  export: decideBossMove
// ════════════════════════════════════════════════════════════════════
export function decideBossMove(data, entries, playerSlots) {
  const phase = getPhase(data)
  if (phase >= 3) return decidePhase3(data, entries)
  if (phase >= 2) return decidePhase2(data, entries)
  return decidePhase1(data, entries)
}

// ════════════════════════════════════════════════════════════════════
//  export: processZoroarkCommand  (raidBossAction.js에서 호출)
// ════════════════════════════════════════════════════════════════════
export function processZoroarkCommand(command, decision, data, entries, logEntries) {
  const state = data.boss_state ?? {}

  switch (command) {
    // ── 1페이즈 ──────────────────────────────────────────────────
    case "zoroark_curse": {
      processZoroarkCurse(data, entries, logEntries)
      break
    }
    case "zoroark_shadowclaw": {
      processShadowClaw(data, entries, logEntries)
      break
    }
    case "zoroark_revenge": {
      processRevenge(data, entries, logEntries)
      break
    }

    // ── 2페이즈 오프닝 ────────────────────────────────────────────
    case "zoroark_p2_open": {
      processBreaker(data, entries, logEntries)
      processIllusion(data, entries, logEntries)
      break
    }
    case "zoroark_steal": {
      const illusionName = state.illusionName ?? BOSS_NAME
      logEntries.push(makeLog("normal",
        `${illusionName}${josa(illusionName, "이가")} 어둠 속으로 몸을 숨겼다...`
      ))
      stealBestMoves(data, entries, logEntries)
      logEntries.push(makeLog("normal",
        `${illusionName}${josa(illusionName, "이가")} 재빠르게 움직였다!`
      ))
      break
    }
    case "zoroark_use_stolen": {
      useStolenMove(data, entries, logEntries)
      break
    }

    // ── 3페이즈 ──────────────────────────────────────────────────
    case "zoroark_breaker": {
      processBreaker(data, entries, logEntries)
      break
    }
    case "zoroark_p3_curse_taunt": {
      // 저주 먼저, 이후 도발
      processZoroarkCurse(data, entries, logEntries)
      processTaunt(data, entries, logEntries, decision.msgIndex ?? 0)
      break
    }
    case "zoroark_p3_taunt": {
      processTaunt(data, entries, logEntries, decision.msgIndex ?? 0)
      break
    }
    case "zoroark_resolve_taunt": {
      resolveTaunt(data, entries, logEntries)
      break
    }
    case "zoroark_skip": {
      logEntries.push(makeLog("normal", `${BOSS_NAME}${josa(BOSS_NAME, "은는")} 충격으로 행동할 수 없다!`))
      break
    }
    case "zoroark_venting": {
      const target = randomAlive(data, entries)
      processVenting(target, data, entries, logEntries)
      break
    }

    // ── 공통: pending 처리 ────────────────────────────────────────
    case "zoroark_pending_venting": {
      const pv = state.pendingVenting
      processVenting(pv?.target ?? null, data, entries, logEntries, pv?.powerMult ?? 1.0)
      if (pv?.clearGrudge && pv?.target) {
        clearGrudge(pv.target, data, entries, logEntries)
      }
      data.boss_state = { ...(data.boss_state ?? {}), pendingVenting: null }
      break
    }
    case "zoroark_pending_curse": {
      const pc = state.pendingCurse
      if (pc?.target) applyGrudge(pc.target, data, entries, logEntries)
      data.boss_state = { ...(data.boss_state ?? {}), pendingCurse: null }
      break
    }

    default:
      logEntries.push(makeLog("normal", `[zoroark] 알 수 없는 커맨드: ${command}`))
  }
}

// ════════════════════════════════════════════════════════════════════
//  export: ult 훅
// ════════════════════════════════════════════════════════════════════
export function shouldTriggerUlt(data) {
  // ult는 2/3페이즈 전환 시점에 깨트리기/일루전/도발로 처리
  // 별도 쿨다운 ult 없음
  return false
}
export function getUltTarget(data, entries, playerSlots) { return null }
export function nextUltCooldown() { return 0 }

// ════════════════════════════════════════════════════════════════════
//  export: 보스 소개 / 사망 로그
// ════════════════════════════════════════════════════════════════════
export function getBossIntroLogs() {
  return [
    `${BOSS_NAME}가 나타났다!`,
  ]
}

export function getDeathLogs() {
  return [
    `${BOSS_NAME}가 쓰러졌다!`,
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
      `${BOSS_NAME}가 뒤로 물러났다! 원한이 전부 사라졌다!`,
    ],
    nextState:        { ...nextState, phase: 2, p2Step: 1 },
    clearBeedrills:   false,
    setPhase2Entered: true,
    _clearGrudges:    true,  // raidBossAction에서 처리
  }
}

export function checkPhase3Enter(data, nextState, command) {
  if (getPhase(data) >= 3) return null
  if (data._phase3Entered) return null
  const ratio = (data.boss_current_hp ?? 0) / (data.boss_max_hp ?? 1)
  if (ratio > PHASE3_HP_RATIO) return null
  return {
    logs: [
      `${BOSS_NAME}가 웃고 있다...! 조심해!`,
    ],
    nextState:        { ...nextState, phase: 3, p3Step: 1 },
    clearBeedrills:   false,
    setPhase3Entered: true,
  }
}

// ════════════════════════════════════════════════════════════════════
//  export: EOT 처리
// ════════════════════════════════════════════════════════════════════
export function processZoroarkEot(data, entries, logEntries) {
  // 리플렉터 턴 감소
  if ((data.boss_reflectorTurns ?? 0) > 0) {
    data.boss_reflectorTurns--
    if (data.boss_reflectorTurns <= 0)
      logEntries.push(makeLog("normal", `리플렉터가 사라졌다!`))
  }
}

// ════════════════════════════════════════════════════════════════════
//  export: 플레이어가 조로아크 공격할 때 추적 훅
//  raidUseMove.js에서 보스 HP 깎은 직후 호출
// ════════════════════════════════════════════════════════════════════
export function recordZoroarkHit(mySlot, damage, data) {
  if (data.boss_name !== "조로아크") return
  const state = data.boss_state ?? {}
  if (!state.tauntActive) return

  const attacked = state.tauntAttackedBy ?? []
  if (!attacked.includes(mySlot)) attacked.push(mySlot)

  const roundDmg = state.tauntRoundDmg ?? {}
  roundDmg[mySlot] = (roundDmg[mySlot] ?? 0) + damage

  data.boss_state = {
    ...state,
    tauntAttackedBy: attacked,
    tauntRoundDmg:   roundDmg,
  }
}