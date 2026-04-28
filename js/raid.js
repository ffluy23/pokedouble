import { auth, db } from "../js/firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import {
  doc, collection, getDoc, onSnapshot, query, orderBy, updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
import { moves } from "./moves.js"
import { josa } from "./effecthandler.js"
import { openItemModal, closeItemModal, updateBagBadge } from "./item.js"

window.__moves = moves

const API = "https://sonnetpc.vercel.app/api"

const SFX_DICE = "https://slippery-copper-mzpmcmc2ra.edgeone.app/soundreality-bicycle-bell-155622.mp3"
const SFX_BTN  = "https://usual-salmon-mnqxptwyvw.edgeone.app/Pokemon%20(A%20Button)%20-%20Sound%20Effect%20(HD)%20(1)%20(1).mp3"
// ── BGM ──────────────────────────────────────────────────────────────
const BGM_URLS = {
  1: "https://added-blush-ab2rk5nplp.edgeone.app/Edge%20of%20War%20Trailer%20Music%20-%20Cinematic%20IA%20Brasil.mp3",
  2: "https://confidential-crimson-iadnxol3mz.edgeone.app/PerituneMaterial_Dramatic5.mp3",
  3: "https://colourful-harlequin-7dtqfctl65.edgeone.app/unleash-.mp3",
  4: "https://ok-tomato-1tclxjrhed.edgeone.app/逆転.mp3",
}
let bgmAudio        = null
let currentBgmPhase = 0

function playBgm(phase) {
  const url = BGM_URLS[phase]
  if (!url || currentBgmPhase === phase) return
  currentBgmPhase = phase

  // 기존 브금 페이드 아웃
  if (bgmAudio) {
    const old = bgmAudio
    bgmAudio  = null
    const iv  = setInterval(() => {
      if (old.volume > 0.06) { old.volume = Math.max(0, old.volume - 0.06) }
      else { clearInterval(iv); old.pause(); old.src = "" }
    }, 80)
  }

  const audio  = new Audio(url)
  audio.loop   = true
  audio.volume = 0
  bgmAudio     = audio

  audio.play().then(() => {
    const getTarget = () => {
      const slider = document.getElementById("bgm-volume")
      return slider ? parseFloat(slider.value) : 0.7
    }
    const iv = setInterval(() => {
      if (!bgmAudio || bgmAudio !== audio) { clearInterval(iv); return }
      const target = getTarget()
      if (audio.volume < target - 0.04) audio.volume = Math.min(target, audio.volume + 0.04)
      else { audio.volume = target; clearInterval(iv) }
    }, 80)
  }).catch(() => {})
}

function playSound(url) {
  const a = new Audio(url); a.volume = 0.6; a.play().catch(() => {})
}

async function callApi(endpoint, data) {
  const res = await fetch(`${API}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? "API 오류")
  return json
}

const _startRound    = (data) => callApi("raidstartround",    data)
const _useMove       = (data) => callApi("raidusemove",       data)
const _useItem       = (data) => callApi("raiduseitem",       data)
const _switchPkmn    = (data) => callApi("raidswitchpokemon", data)
const _skipTurn      = (data) => callApi("raidskipturn",      data)
const _requestAssist = (data) => callApi("raidrequestassist", data)
const _agreeAssist   = (data) => callApi("raidagreeassist",   data)
const _rejectAssist  = (data) => callApi("raidrejectassist",  data)
const _requestSync   = (data) => callApi("raidrequestsync",   data)
const _agreeSync     = (data) => callApi("raidagreesync",     data)
const _rejectSync    = (data) => callApi("raidrejectsync",    data)
const _leaveGame     = (data) => callApi("raidleavegame",     data)
const _bossTurn      = (data) => callApi("raidbossturn",      data)
const _passFireball  = (data) => callApi("raidPassFireball",  data)
const _attackMirage   = (data) => callApi("raidAttackMirage",  data)
const _standChoice    = (data) => callApi("raidStandChoice",   data)
const _resonanceAgree = (data) => callApi("raidResonance",     { ...data, action: "agree" })
const _resonanceFire  = (data) => callApi("raidResonance",     { ...data, action: "fire"  })
// ── [40인] Admin 슬롯 교체 API ──────────────────────────────────────
const _adminSwapSlot  = (data) => callApi("raidAdminSwap",    data)

const roomRef = doc(db, "raid", ROOM_ID)
const logsRef = collection(db, "raid", ROOM_ID, "logs")

let mySlot = null, myUid = null
// ── [40인] 내 roster 상태: "active" | "bench" | "spectator" | null
let myRosterStatus = null

let myTurn = false, actionDone = false, gameOver = false
let renderedLogIds = new Set()
let isSpectator    = new URLSearchParams(location.search).get("spectator") === "true"

let logQueue        = []
let isProcessing    = false
let pendingRoomData = null
let currentRoomData = null

let pendingMoveIdx     = -1
let pendingMoveInfo    = null
let beedrillTargetMode = false

const TYPE_COLORS = {
  "노말":"#949495","불":"#e56c3e","물":"#5185c5","전기":"#fbb917","풀":"#66a945",
  "얼음":"#6dc8eb","격투":"#e09c40","독":"#735198","땅":"#9c7743","바위":"#bfb889",
  "비행":"#a2c3e7","에스퍼":"#dd6b7b","벌레":"#9fa244","고스트":"#684870",
  "드래곤":"#535ca8","악":"#4c4948","강철":"#69a9c7","페어리":"#dab4d4",
  "불꽃":"#e56c3e"
}

let lastTurnSlot = null
let mirageSelectMode = false
const PLAYER_SLOTS = ["p1", "p2", "p3"]

function $(id) { return document.getElementById(id) }
function rollD10() { return Math.floor(Math.random() * 10) + 1 }
function wait(ms)  { return new Promise(r => setTimeout(r, ms)) }

function otherPlayerSlots() { return PLAYER_SLOTS.filter(s => s !== mySlot) }
function isPlayerSlot(slot) { return PLAYER_SLOTS.includes(slot) }
function isBeedrillSlot(slot) { return slot === "beedrill_0" || slot === "beedrill_1" }
function isPartSlot(slot) { return ["eye","wing","tail","claw"].includes(slot) }

function anyBeedrillAlive(data) {
  return (data.Beedrill ?? []).some(b => b.hp > 0)
}

// ── [40인] active_slots에서 실제 출전 중인 슬롯만 체크
function isAllPlayersDead(data) {
  const slots = data.active_slots ?? {}
  return PLAYER_SLOTS.every(s => {
    if (!slots[s]) return true  // 빈 슬롯은 dead로 취급
    const entry = data[`${s}_entry`] ?? []
    return entry.every(p => p.hp <= 0)
  })
}

function cannotRequestSupport(data) {
  if (!mySlot) return true
  const myActiveIdx = data[`${mySlot}_active_idx`] ?? 0
  const myPkmn      = data[`${mySlot}_entry`]?.[myActiveIdx]
  return !myPkmn || myPkmn.hp <= 0
}

const SPECTATOR_PREFIX = { p1: "my", p2: "ally1", p3: "ally2" }

function slotToPrefix(slot) {
  if (slot === "boss") return "boss"
  if (isBeedrillSlot(slot)) return null
  if (!mySlot) return SPECTATOR_PREFIX[slot] ?? null
  if (slot === mySlot) return "my"
  const others = otherPlayerSlots()
  return slot === others[0] ? "ally1" : "ally2"
}

// ════════════════════════════════════════════════════════════════════
//  [40인] mySlot 결정
//  active_slots에서 myUid를 찾아 p1/p2/p3 반환
//  없으면 roster에서 status 확인 → bench/spectator
// ════════════════════════════════════════════════════════════════════
function resolveMySlotAndStatus(data, uid) {
  // 1. active_slots에서 찾기
  const activeSlots = data.active_slots ?? {}
  for (const [slot, slotUid] of Object.entries(activeSlots)) {
    if (slotUid === uid) return { slot, status: "active" }
  }

  // 2. roster에서 찾기
  const member = (data.roster ?? {})[uid]
  if (member) return { slot: null, status: member.status ?? "spectator" }

  // 3. 레거시: player_uid 필드 (이전 구조 호환)
  for (const s of PLAYER_SLOTS) {
    const slotKey = s.replace("p", "player")
    if (data[`${slotKey}_uid`] === uid) return { slot: s, status: "active" }
  }

  return { slot: null, status: "spectator" }
}

// ── HP바 / 포트레이트 ────────────────────────────────────────────────
function updateHpBar(barId, textId, hp, maxHp, showNum) {
  const bar = $(barId), txt = textId ? $(textId) : null
  if (!bar) return
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, hp / maxHp * 100)) : 0
  bar.style.width           = pct + "%"
  bar.style.backgroundColor = pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"
  if (txt) txt.innerText    = showNum ? `HP: ${hp} / ${maxHp}` : ""
}

function updatePortrait(prefix, pokemon) {
  const img = $(`${prefix}-portrait`)
  const ph  = $(`${prefix}-portrait-placeholder`)
  if (!img) return
  if (!pokemon?.portrait) {
    img.classList.remove("visible"); img.style.display = "none"
    if (ph) ph.style.display = "block"
    return
  }
  if (ph) ph.style.display = "none"
  if (img.dataset.loadedSrc === pokemon.portrait) return
  img.dataset.loadedSrc = pokemon.portrait
  img.classList.remove("visible")
  img.style.display = "block"; img.src = pokemon.portrait; img.alt = pokemon.name
  setTimeout(() => img.classList.add("visible"), 60)
}

// ── 플레이어 슬롯 UI ─────────────────────────────────────────────────
function updateSlotUI(slot, data) {
  // [40인] active_slots에 없는 슬롯은 빈 슬롯으로 표시
  const activeSlots = data.active_slots ?? {}
  const isSlotEmpty = Object.keys(activeSlots).length > 0 && !activeSlots[slot]

  const prefix = slotToPrefix(slot)
  if (!prefix) return

  if (isSlotEmpty) {
    // 빈 슬롯 — UI를 "대기 중" 상태로 표시
    const nameLabel = $(`${prefix}-name-label`)
    if (nameLabel) nameLabel.innerText = "대기 중"
    const nameEl = $(`${prefix}-active-name`)
    if (nameEl) nameEl.innerText = "-"
    updateHpBar(`${prefix}-hp-bar`, `${prefix}-active-hp`, 0, 1, false)
    return
  }

  const activeIdx = data[`${slot}_active_idx`] ?? 0
  const pokemon   = data[`${slot}_entry`]?.[activeIdx]
  if (!pokemon) return

  const slotKey   = slot.replace("p", "player")
  const nameLabel = $(`${prefix}-name-label`)
  if (nameLabel) nameLabel.innerText = data[`${slotKey}_name`] ?? slot

  const nameEl = $(`${prefix}-active-name`)
  if (nameEl) {
    const STATUS_LABEL = { "마비":"[마비]","화상":"[화상]","독":"[독]","얼음":"[얼음]" }
    const statusTag    = pokemon.status ? " " + (STATUS_LABEL[pokemon.status] ?? "") : ""
    const confusionTag = (pokemon.confusion ?? 0) > 0 ? " [혼란]" : ""
    const flyTag       = pokemon.flyState?.flying  ? " ✈" : ""
    const digTag       = pokemon.digState?.digging ? " ⛏" : ""
    const grudgeTag    = pokemon.grudge ? " [원한]" : ""
    nameEl.innerText   = (pokemon.name ?? "???") + statusTag + confusionTag + flyTag + digTag + grudgeTag
  }

  updateHpBar(`${prefix}-hp-bar`, `${prefix}-active-hp`, pokemon.hp, pokemon.maxHp, prefix === "my")
  updatePortrait(prefix, pokemon)

  if (currentRoomData?.boss_name === "누클라바스") {
    const BADGES = [
      { key: `${slot}_ominous`,  id: `${prefix}-badge-ominous`,  label: "🔴 흉조",  color: "#c0392b" },
      { key: `${slot}_doomed`,   id: `${prefix}-badge-doomed`,   label: "💀 사멸",  color: "#6c3483" },
      { key: `${slot}_collapse`, id: `${prefix}-badge-collapse`, label: "💥 붕괴",  color: "#784212" },
      { key: `${slot}_tragedy`,  id: `${prefix}-badge-tragedy`,  label: "🔗 비극",  color: "#1a5276" },
    ]
    const hpCard = document.querySelector(`#${prefix}-pokemon-area .hp-card`)
               ?? document.getElementById(`${prefix}-active-hp`)?.closest(".hp-card")
    if (hpCard) {
      BADGES.forEach(({ key, id, label, color }) => {
        let el = document.getElementById(id)
        const active = !!(currentRoomData[key])
        if (!active) { if (el) el.style.display = "none"; return }
        if (!el) {
          el = document.createElement("div")
          el.id = id
          el.style.cssText = `
            font-size: 10px; font-weight: bold; color: #fff;
            padding: 1px 7px; border-radius: 8px; margin-top: 2px;
            display: inline-block;
          `
          hpCard.appendChild(el)
        }
        el.style.display    = "inline-block"
        el.style.background = color
        el.textContent      = label
      })
    }
  }
}

// ── 보스 UI ──────────────────────────────────────────────────────────
function updateBossUI(data) {
  
  const bossHp    = data.boss_current_hp ?? 0
  const bossMaxHp = data.boss_max_hp ?? 1
  const bossName  = data.boss_name       ?? "보스"

  const illusionActive  = data.boss_state?.illusionActive  ?? false
  const displayHp       = illusionActive && data.boss_state?.illusionHp != null
                          ? data.boss_state.illusionHp : bossHp
  const displayName     = illusionActive && data.boss_state?.illusionName
                          ? data.boss_state.illusionName : bossName
  const displayPortrait = illusionActive && data.boss_state?.illusionPortrait
    ? data.boss_state.illusionPortrait : (data.boss_portrait ?? data.boss_portrait_url ?? null)

  const nameEl = $("boss-name")
  if (nameEl) nameEl.innerText = displayName

  updateHpBar("boss-hp-bar", "boss-hp-text", displayHp, bossMaxHp, true)

  const img = $("boss-portrait")
  const ph  = document.querySelector(".boss-portrait-placeholder")
  if (img) {
    const portrait = displayPortrait
    if (!portrait) {
      img.classList.remove("visible"); img.style.display = "none"
      if (ph) ph.style.display = "block"
    } else if (img.dataset.loadedSrc !== portrait) {
      img.dataset.loadedSrc = portrait
      if (ph) ph.style.display = "none"
      img.classList.remove("visible")
      img.style.display = "block"
      img.src = portrait
      img.alt = displayName
      setTimeout(() => img.classList.add("visible"), 60)
    }
  }

  const statusEl = $("boss-status")
  if (statusEl) {
    const s = data.boss_status ?? null
    statusEl.innerText = s ? `[${s}]` : ""
  }

  const rankEl = $("boss-rank")
  if (rankEl) {
    const rank = data.boss_rank ?? {}
    const tags = []
    if ((rank.atk ?? 0) > 0) tags.push(`공+${rank.atk}`)
    else if ((rank.atk ?? 0) < 0) tags.push(`공${rank.atk}`)
    if ((rank.def ?? 0) > 0) tags.push(`방+${rank.def}`)
    else if ((rank.def ?? 0) < 0) tags.push(`방${rank.def}`)
    rankEl.innerText = tags.join(" / ")
  }

  updateBabyBossUI(data)
}

function updateBabyBossUI(data) {
  const baby    = data.boss_baby ?? null
  const bossRow = $("boss-row")
  if (!bossRow) return

  if (!baby) {
    bossRow.classList.remove("has-baby")
    return
  }

  bossRow.classList.add("has-baby")

  const nameEl = $("baby-name")
  if (nameEl) nameEl.innerText = baby.name ?? "아기 캥카"

  const hp    = baby.hp    ?? 0
  const maxHp = baby.maxHp ?? 1
  const pct   = maxHp > 0 ? Math.max(0, Math.min(100, hp / maxHp * 100)) : 0
  const hpBar = $("baby-hp-bar")
  const hpTxt = $("baby-hp-text")
  if (hpBar) {
    hpBar.style.width           = `${pct}%`
    hpBar.style.backgroundColor = pct > 50 ? "#e67e22" : pct > 20 ? "#e74c3c" : "#c0392b"
  }
  if (hpTxt) hpTxt.innerText = `HP: ${hp} / ${maxHp}`

  const card = $("baby-hp-card")
  if (card) card.classList.toggle("fainted", hp <= 0)

  const babyImg = $("baby-portrait")
  const babyPh  = document.querySelector(".baby-portrait-placeholder")
  if (babyImg) {
    const portrait = baby.portrait ?? null
    if (!portrait) {
      babyImg.classList.remove("visible"); babyImg.style.display = "none"
      if (babyPh) babyPh.style.display = "block"
    } else if (babyImg.dataset.loadedSrc !== portrait) {
      babyImg.dataset.loadedSrc = portrait
      if (babyPh) babyPh.style.display = "none"
      babyImg.classList.remove("visible")
      babyImg.style.display = "block"
      babyImg.src = portrait
      babyImg.alt = baby.name ?? "아기 캥카"
      setTimeout(() => babyImg.classList.add("visible"), 60)
    }
  }
}

function animateBabyHpBar(targetHp, maxHp) {
  return new Promise(resolve => {
    const hpBar = $("baby-hp-bar")
    const hpTxt = $("baby-hp-text")
    if (!hpBar) { resolve(); return }
    const pct   = maxHp > 0 ? Math.max(0, Math.min(100, targetHp / maxHp * 100)) : 0
    const color = pct > 50 ? "#e67e22" : pct > 20 ? "#e74c3c" : "#c0392b"
    hpBar.style.transition      = "width 0.4s ease, background-color 0.4s ease"
    hpBar.style.width           = `${pct}%`
    hpBar.style.backgroundColor = color
    if (hpTxt) hpTxt.innerText  = `HP: ${targetHp} / ${maxHp}`
    setTimeout(() => { hpBar.style.transition = ""; resolve() }, 420)
  })
}

function updateBeedrillUI(data) {
  const beedrills = data.Beedrill ?? []
  const row       = $("beedrill-row")
  if (!row) return

  if (beedrills.length === 0) {
    row.classList.remove("visible")
    return
  }
  row.classList.add("visible")

  beedrills.forEach((bee, i) => {
    const card     = $(`beedrill-card-${i}`)
    const hpBar    = $(`beedrill-hp-bar-${i}`)
    const hpNum    = $(`beedrill-hp-num-${i}`)
    const rankEl   = $(`beedrill-rank-${i}`)
    const portrait = $(`beedrill-portrait-${i}`)
    if (!card) return

    const pct = (bee.maxHp ?? bee.hp) > 0
      ? Math.max(0, bee.hp / (bee.maxHp ?? bee.hp) * 100) : 0

    card.classList.toggle("fainted", bee.hp <= 0)

    if (hpBar) {
      hpBar.style.width           = `${pct}%`
      hpBar.style.backgroundColor = pct > 50 ? "#c0a020" : pct > 20 ? "#e67e22" : "#e74c3c"
    }
    if (hpNum) hpNum.textContent = `${bee.hp}/${bee.maxHp ?? bee.hp}`
    if (rankEl) {
      const def = bee.ranks?.def ?? 0
      rankEl.textContent = def !== 0 ? `방어 ${def > 0 ? "+" : ""}${def}` : ""
    }
    if (portrait && bee.portrait && portrait.dataset.loadedSrc !== bee.portrait) {
      portrait.dataset.loadedSrc = bee.portrait
      portrait.src               = bee.portrait
      portrait.style.display     = "block"
      setTimeout(() => portrait.classList.add("visible"), 60)
    }
  })
}

function enterBeedrillTargetMode(data) {
  beedrillTargetMode = true
  const hint = $("beedrill-target-hint")
  if (hint) hint.style.display = "block"

  const beedrills = data.Beedrill ?? []
  beedrills.forEach((bee, i) => {
    const card = $(`beedrill-card-${i}`)
    if (!card || bee.hp <= 0) return
    card.classList.add("targetable")
    card.onclick = () => {
      const idx = pendingMoveIdx
      exitBeedrillTargetMode(data)
      actionDone = false
      doUseMove(idx, [`beedrill_${i}`], data)
    }
  })
}

function exitBeedrillTargetMode(data) {
  beedrillTargetMode = false
  const hint = $("beedrill-target-hint")
  if (hint) hint.style.display = "none"

  const beedrills = data.Beedrill ?? []
  beedrills.forEach((_, i) => {
    const card = $(`beedrill-card-${i}`)
    if (!card) return
    card.classList.remove("targetable")
    card.onclick = null
  })

  pendingMoveIdx  = -1
  pendingMoveInfo = null
}

function triggerAutoAction(data) {
  if (actionDone || !myTurn || isSpectator) return
  const myActiveIdx = data[`${mySlot}_active_idx`] ?? 0
  const myPkmn      = data[`${mySlot}_entry`]?.[myActiveIdx]
  if (!myPkmn || myPkmn.hp <= 0) return

  const movesArr   = myPkmn.moves ?? []
  const chainBound = myPkmn.chainBound ?? null
  const usable     = movesArr
    .map((mv, i) => ({ mv, i }))
    .filter(({ mv }) => mv.pp > 0 && !(chainBound && chainBound.moveName === mv.name))

  if (usable.length === 0) { actionDone = true; doSkipTurn(true); return }

  const { mv, i: moveIdx } = usable[Math.floor(Math.random() * usable.length)]
  const moveInfo = moves[mv.name] ?? {}

  if (anyBeedrillAlive(data)) {
    const aliveBees = (data.Beedrill ?? [])
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.hp > 0)
    if (aliveBees.length > 0) {
      const { i: bIdx } = aliveBees[Math.floor(Math.random() * aliveBees.length)]
      const tSlot = moveInfo.aoe ? [] : [`beedrill_${bIdx}`]
      doUseMove(moveIdx, tSlot, data)
      return
    }
  }

  if (moveInfo.aoe || moveInfo.aoeEnemy) {
    doUseMove(moveIdx, ["boss"], data); return
  }

  if (moveInfo.helper) {
    const aliveAllies = otherPlayerSlots().filter(s => {
      // [40인] 빈 슬롯 제외
      if ((data.active_slots ?? {})[s] === undefined) return false
      const aIdx = data[`${s}_active_idx`] ?? 0
      const p    = data[`${s}_entry`]?.[aIdx]
      return p && p.hp > 0
    })
    if (aliveAllies.length > 0) {
      const target = aliveAllies[Math.floor(Math.random() * aliveAllies.length)]
      doUseMove(moveIdx, [target], data)
    } else {
      doUseMove(moveIdx, [], data)
    }
    return
  }

  const needsTarget = moveInfo.power || moveInfo.ghostDive || moveInfo.futureSight
    || moveInfo.taunt || moveInfo.memento || moveInfo.leechSeed || moveInfo.chainBind
    || moveInfo.poisonPowder || moveInfo.pollenPuff || moveInfo.curse
    || moveInfo.telekinesis
    || (moveInfo.effect?.volatile && !moveInfo.targetSelf)
    || (moveInfo.effect?.status && moveInfo.targetSelf === false) || moveInfo.helper

  doUseMove(moveIdx, needsTarget ? ["boss"] : [], data)
}

// ── 로그 처리 (변경 없음) ─────────────────────────────────────────────
async function handleLogEntry(entry) {
  const { type, text, meta } = entry
  const logEl = $("battle-log")
  switch (type) {
    case "normal":
    case "after_hit":
    case "move_announce": {
      if (!text) break
      await typeText(logEl, text)
      await wait(type === "move_announce" ? 200 : 120)
      break
    }
    case "dice": {
      if (!meta) break
      await animateAttackDice(meta.slot, meta.roll)
      break
    }
    case "hit": {
      if (!meta?.defender) break
      if (meta.defender === "boss_baby") {
        const babyArea = $("baby-boss-area")
        if (babyArea) {
          babyArea.classList.remove("defender-hit"); void babyArea.offsetWidth
          babyArea.classList.add("defender-hit")
          await new Promise(r => babyArea.addEventListener("animationend", r, { once: true }))
        }
      } else if (isBeedrillSlot(meta.defender)) {
        const card = $(`beedrill-card-${meta.defender.replace("beedrill_", "")}`)
        if (card) {
          card.classList.remove("defender-hit"); void card.offsetWidth
          card.classList.add("defender-hit")
          await new Promise(r => card.addEventListener("animationend", r, { once: true }))
        }
      } else {
        const prefix = slotToPrefix(meta.defender)
        if (prefix) { await triggerAttackEffect(prefix); await triggerBlink(prefix) }
      }
      break
    }
    case "hp": {
      if (!meta?.slot) break
      if (meta.slot === "boss_baby") {
        await animateBabyHpBar(meta.hp, meta.maxHp)
        const card = $("baby-hp-card")
        if (card) card.classList.toggle("fainted", meta.hp <= 0)
        if (text) await typeText(logEl, text)
      } else if (isBeedrillSlot(meta.slot)) {
        const idx    = parseInt(meta.slot.replace("beedrill_", ""), 10)
        const hpBar  = $(`beedrill-hp-bar-${idx}`)
        const hpNum  = $(`beedrill-hp-num-${idx}`)
        const card   = $(`beedrill-card-${idx}`)
        if (hpBar && meta.maxHp > 0) {
          const pct = Math.max(0, meta.hp / meta.maxHp * 100)
          hpBar.style.width           = `${pct}%`
          hpBar.style.backgroundColor = pct > 50 ? "#c0a020" : pct > 20 ? "#e67e22" : "#e74c3c"
        }
        if (hpNum) hpNum.textContent = `${meta.hp}/${meta.maxHp}`
        if (text) await typeText(logEl, text)
      } else {
        const prefix  = slotToPrefix(meta.slot)
        if (!prefix) break
        const showNum = prefix === "my" || prefix === "boss"
        if (prefix === "boss" && currentRoomData?.boss_state?.illusionActive) {
          // 일루전 HP 유지
        } else {
          await animateHpBar(prefix, meta.hp, meta.maxHp, showNum)
        }
        if (text) await typeText(logEl, text)
      }
      await wait(100)
      break
    }
    case "beedrill_summon": {
      if (text) await typeText(logEl, text)
      await wait(200)
      break
    }
    case "beedrill_hp": {
      if (meta?.beedrills) {
        meta.beedrills.forEach((bee, i) => {
          const hpBar = $(`beedrill-hp-bar-${i}`)
          const hpNum = $(`beedrill-hp-num-${i}`)
          if (!hpBar) return
          const pct = (bee.maxHp ?? bee.hp) > 0
            ? Math.max(0, bee.hp / (bee.maxHp ?? bee.hp) * 100) : 0
          hpBar.style.width           = `${pct}%`
          hpBar.style.backgroundColor = pct > 50 ? "#c0a020" : pct > 20 ? "#e67e22" : "#e74c3c"
          if (hpNum) hpNum.textContent = `${bee.hp}/${bee.maxHp ?? bee.hp}`
        })
      }
      if (text) await typeText(logEl, text)
      await wait(100)
      break
    }
    case "part_hp": {
      if (meta?.part) {
        const bar = $(`part-hp-bar-${meta.part}`)
        const num = $(`part-hp-num-${meta.part}`)
        if (bar && meta.maxHp > 0) {
          const pct = Math.max(0, meta.hp / meta.maxHp * 100)
          bar.style.transition      = "width 0.4s ease"
          bar.style.width           = `${pct}%`
          bar.style.backgroundColor = pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"
          setTimeout(() => { bar.style.transition = "" }, 420)
        }
        if (num) num.textContent = `${meta.hp} / ${meta.maxHp}`
        if (meta.hp <= 0) {
          const card = $(`part-card-${meta.part}`)
          if (card) card.classList.add("part-destroyed")
        }
      }
      await wait(100)
      break
    }
    case "core_hp": {
      if (meta?.coreId) {
        const bar = $("core-hp-bar")
        const num = $("core-hp-num")
        const nameEl = $("core-name")
        if (nameEl) nameEl.textContent = meta.name ?? ""
        if (bar && meta.maxHp > 0) {
          const pct = Math.max(0, meta.hp / meta.maxHp * 100)
          bar.style.transition      = "width 0.4s ease"
          bar.style.width           = `${pct}%`
          bar.style.backgroundColor = pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"
          setTimeout(() => { bar.style.transition = "" }, 420)
        }
        if (num) num.textContent = `${meta.hp} / ${meta.maxHp}`
        if (meta.hp <= 0) {
          const card = $("core-hp-card")
          if (card) card.classList.add("core-destroyed")
        }
      }
      await wait(100)
      break
    }
    case "assist":  { await showAssistAnimation();  break }
    case "sync":    { await showSyncAnimation();    break }
    case "umbreon": { await showUmbreonAnimation(); break }
    case "prophecy_text": {
      if (entry.text) await showProphecyText(entry.text)
      break
    }
    case "taunt_text": {
      if (entry.text) await showTauntText(entry.text)
      break
    }
    case "zoroark_illusion": {
      if (meta) activateIllusionUI(meta)
      await wait(400)
      break
    }
    case "stand_choice": {
      if (meta?.tankSlot && meta.tankSlot === mySlot && !isSpectator) {
        showStandChoicePopup(meta.tankSlot, currentRoomData)
      }
      await wait(200)
      break
    }
    case "catastro_resonance_modal": {
  await showSonnetRadio()           // 무전 대화 먼저
  showResonanceModal(currentRoomData)
  await wait(400)
  break
}
    case "revive": {
      if (meta?.slot) {
        const prefix = slotToPrefix(meta.slot)
        const area   = $(`${prefix}-pokemon-area`)
        if (area) area.classList.remove("fainted")
      }
      if (text) await typeText(logEl, text)
      await wait(200)
      break
    }
    case "faint": {
      if (text) await typeText(logEl, text)
      if (meta?.slot) {
        if (meta.slot === "boss_baby") {
          const card    = $("baby-hp-card")
          const babyImg = $("baby-portrait")
          if (card)    card.classList.add("fainted")
          if (babyImg) babyImg.style.opacity = "0.35"
        } else if (isBeedrillSlot(meta.slot)) {
          const idx  = parseInt(meta.slot.replace("beedrill_", ""), 10)
          const card = $(`beedrill-card-${idx}`)
          if (card) card.classList.add("fainted")
        } else {
          const prefix = slotToPrefix(meta.slot)
          const area   = $(`${prefix}-pokemon-area`)
          if (area) area.classList.add("fainted")
        }
      }
      await wait(300)
      break
    }
    default: { if (text) await typeText(logEl, text); break }
  }
}

function typeText(logEl, text) {
  return new Promise(resolve => {
    if (!logEl) { resolve(); return }
    const line  = document.createElement("p")
    logEl.appendChild(line)
    const chars = [...text]; let i = 0
    function next() {
      if (i >= chars.length) { logEl.scrollTop = logEl.scrollHeight; resolve(); return }
      line.textContent += chars[i++]
      logEl.scrollTop = logEl.scrollHeight
      setTimeout(next, 18)
    }
    next()
  })
}

function enqueueLogs(entries) {
  entries.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
  entries.forEach(e => { if (!e.type) e.type = "normal" })
  logQueue.push(...entries)
  processLogQueue()
}

async function processLogQueue() {
  if (isProcessing) return
  if (logQueue.length === 0) {
    if (pendingRoomData) {
      const data = pendingRoomData
      pendingRoomData = null
      setTimeout(async () => {
        if (data.dice_event && data.dice_event.ts > lastDiceEventTs) {
          lastDiceEventTs = data.dice_event.ts
          await animateRoundDice(data.dice_event.rolls, data.dice_event.slots)
        }
        applyRoomData(data)
      }, 80)
    }
    return
  }
  isProcessing = true
  const entry  = logQueue.shift()
  try { await handleLogEntry(entry) } catch (e) { console.warn("logEntry 처리 오류:", e) }
  isProcessing = false
  setTimeout(processLogQueue, 50)
}

// ── 애니메이션 (변경 없음) ───────────────────────────────────────────
function animateHpBar(prefix, targetHp, maxHp, showNum) {
  return new Promise(resolve => {
    const bar = $(`${prefix}-hp-bar`)
    const txt = $(`${prefix}-active-hp`) ?? $(`${prefix}-hp-text`)
    if (!bar) { resolve(); return }
    const targetPct = maxHp > 0 ? Math.max(0, Math.min(100, targetHp / maxHp * 100)) : 0
    const color = targetPct > 50 ? "#4caf50" : targetPct > 20 ? "#ff9800" : "#f44336"
    bar.style.transition      = "width 0.4s ease, background-color 0.4s ease"
    bar.style.width           = targetPct + "%"
    bar.style.backgroundColor = color
    if (txt && showNum) txt.innerText = `HP: ${targetHp} / ${maxHp}`
    setTimeout(() => { bar.style.transition = ""; resolve() }, 420)
  })
}

function triggerAttackEffect(defPrefix) {
  return new Promise(resolve => {
    const defArea = $(`${defPrefix}-pokemon-area`)
    const wrapper = $("battle-wrapper")
    if (wrapper) {
      wrapper.classList.remove("screen-shake"); void wrapper.offsetWidth
      wrapper.classList.add("screen-shake")
      wrapper.addEventListener("animationend", () => wrapper.classList.remove("screen-shake"), { once: true })
    }
    if (defArea) {
      defArea.classList.remove("defender-hit"); void defArea.offsetWidth
      defArea.classList.add("defender-hit")
      defArea.addEventListener("animationend", () => { defArea.classList.remove("defender-hit"); resolve() }, { once: true })
    } else resolve()
  })
}

function triggerBlink(prefix) {
  return new Promise(resolve => {
    const area = $(`${prefix}-pokemon-area`)
    if (!area) { resolve(); return }
    const targets = [
      area.querySelector(".portrait-wrap"),
      area.querySelector(".hp-card")
    ].filter(Boolean)
    if (targets.length === 0) { resolve(); return }
    let done = 0
    targets.forEach(el => {
      el.classList.remove("blink-damage"); void el.offsetWidth
      el.classList.add("blink-damage")
      el.addEventListener("animationend", () => {
        el.classList.remove("blink-damage")
        if (++done >= targets.length) resolve()
      }, { once: true })
    })
  })
}

function animateAttackDice(slot, finalRoll) {
  return new Promise(resolve => {
    const wrap   = $("dice-wrap")
    const diceEl = $(`dice-${slot}`)
    if (!wrap || !diceEl) { resolve(); return }
    ;["p1","p2","p3","boss"].forEach(s => {
      const box = $(`dice-box-${s}`)
      if (box) box.style.display = s === slot ? "block" : "none"
    })
    wrap.style.display = "flex"
    let count = 0
    const iv = setInterval(() => {
      diceEl.innerText = rollD10()
      if (++count >= 16) {
        clearInterval(iv)
        diceEl.innerText = finalRoll
        diceEl.classList.remove("pop"); void diceEl.offsetWidth; diceEl.classList.add("pop")
        playSound(SFX_DICE)
        setTimeout(() => { wrap.style.display = "none"; resolve() }, 900)
      }
    }, 55)
  })
}

function animateRoundDice(rolls, slots) {
  return new Promise(resolve => {
    const wrap = $("dice-wrap")
    if (!wrap) { resolve(); return }
    ;["p1","p2","p3","boss"].forEach(s => {
      const box = $(`dice-box-${s}`)
      if (box) box.style.display = slots.includes(s) ? "block" : "none"
    })
    wrap.style.display = "flex"
    let count = 0
    const iv = setInterval(() => {
      slots.forEach(s => {
        const el = $(`dice-${s}`)
        if (el) el.innerText = rollD10()
      })
      if (++count >= 20) {
        clearInterval(iv)
        slots.forEach(s => {
          const el = $(`dice-${s}`)
          if (el) { el.innerText = rolls[s]; el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop") }
        })
        playSound(SFX_DICE)
        setTimeout(() => { wrap.style.display = "none"; resolve() }, 1600)
      }
    }, 60)
  })
}

function showAssistAnimation() {
  return new Promise(resolve => {
    const el = $("assist-anim")
    if (!el) { resolve(); return }
    el.classList.remove("assist-show"); void el.offsetWidth; el.classList.add("assist-show")
    setTimeout(resolve, 800)
  })
}

function showSyncAnimation() {
  return new Promise(resolve => {
    const el = $("sync-anim")
    if (!el) { resolve(); return }
    el.classList.remove("sync-show"); void el.offsetWidth; el.classList.add("sync-show")
    setTimeout(resolve, 800)
  })
}

function showUmbreonAnimation() {
  return new Promise(resolve => {
    const el      = $("umbreon-anim")
    const wrapper = $("battle-wrapper")
    if (!el) { resolve(); return }
    playSound(SFX_DICE)
    if (wrapper) {
      let shakeCount = 0
      const doShake = () => {
        wrapper.classList.remove("screen-shake-heavy"); void wrapper.offsetWidth
        wrapper.classList.add("screen-shake-heavy")
        wrapper.addEventListener("animationend", () => {
          wrapper.classList.remove("screen-shake-heavy")
          shakeCount++
          if (shakeCount < 3) setTimeout(doShake, 50)
        }, { once: true })
      }
      doShake()
    }
    el.classList.remove("umbreon-show"); void el.offsetWidth; el.classList.add("umbreon-show")
    setTimeout(resolve, 1400)
  })
}

function showProphecyText(text) {
  return new Promise(resolve => {
    const el = $("prophecy-anim")
    if (!el) { resolve(); return }
    const isShort = text.length <= 40
    const cls     = isShort ? "prophecy-show-short" : "prophecy-show"
    const dur     = isShort ? 2800 : 4500
    el.textContent = text
    el.classList.remove("prophecy-show", "prophecy-show-short")
    void el.offsetWidth
    el.classList.add(cls)
    setTimeout(() => {
      el.classList.remove("prophecy-show", "prophecy-show-short")
      resolve()
    }, dur)
  })
}

function showTauntText(text) {
  return new Promise(resolve => {
    let el = $("taunt-anim")
    if (!el) {
      el = document.createElement("div")
      el.id = "taunt-anim"
      el.style.cssText = `
        position: fixed; top: 60px; left: 50%;
        transform: translateX(-50%);
        background: rgba(76,73,72,0.92);
        color: #fff; font-size: 13px; font-weight: bold;
        padding: 10px 20px; border-radius: 10px;
        border: 2px solid #684870;
        box-shadow: 0 4px 18px rgba(0,0,0,0.4);
        z-index: 9999; text-align: center;
        max-width: 80vw; word-break: keep-all;
        display: none;
        font-style: italic;
        letter-spacing: 0.3px;
      `
      document.body.appendChild(el)
    }
    el.innerText = `🎭 "${text}"`
    el.style.display = "block"
    el.style.opacity = "1"
    setTimeout(() => {
      el.style.transition = "opacity 0.6s"
      el.style.opacity    = "0"
      setTimeout(() => {
        el.style.display    = "none"
        el.style.transition = ""
        resolve()
      }, 600)
    }, 5000)
  })
}

function showStandChoicePopup(tankSlot, data) {
  const existing = document.getElementById("stand-choice-popup")
  if (existing) existing.remove()

  const popup = document.createElement("div")
  popup.id = "stand-choice-popup"
  popup.style.cssText = `
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    z-index: 9800;
    background: #1a1a2e; border: 2px solid #535ca8;
    border-radius: 14px; padding: 20px 22px;
    font-size: 13px; color: #e0e0ff;
    display: flex; flex-direction: column; gap: 14px;
    box-shadow: 0 0 40px rgba(83,92,168,0.5);
    min-width: 240px; text-align: center;
  `
  const title = document.createElement("div")
  title.style.cssText = "font-size: 15px; font-weight: bold; color: #a0aaff; letter-spacing: 0.05em;"
  title.textContent   = "⚠ 선택하라!"
  popup.appendChild(title)

  const desc = document.createElement("div")
  desc.style.cssText  = "font-size: 11px; color: #aaa; line-height: 1.6;"
  desc.textContent    = "막아선다: 자신이 70% 흡수, 동료는 각 15%\n물러난다: 전원에게 동등하게 분배"
  desc.style.whiteSpace = "pre-line"
  popup.appendChild(desc)

  const btnWrap = document.createElement("div")
  btnWrap.style.cssText = "display: flex; gap: 10px;"

  const standBtn = document.createElement("button")
  standBtn.textContent = "🛡 막아선다"
  standBtn.style.cssText = `
    flex: 1; padding: 10px; border-radius: 10px;
    border: none; background: #535ca8; color: #fff;
    font-size: 13px; font-weight: bold; cursor: pointer;
    font-family: inherit;
  `
  standBtn.onclick = async () => {
    popup.remove()
    try { await _standChoice({ roomId: ROOM_ID, mySlot, choice: "stand" }) }
    catch (e) { console.error("standChoice 오류:", e.message) }
  }

  const backBtn = document.createElement("button")
  backBtn.textContent = "💨 물러난다"
  backBtn.style.cssText = `
    flex: 1; padding: 10px; border-radius: 10px;
    border: none; background: #4c4948; color: #fff;
    font-size: 13px; font-weight: bold; cursor: pointer;
    font-family: inherit;
  `
  backBtn.onclick = async () => {
    popup.remove()
    try { await _standChoice({ roomId: ROOM_ID, mySlot, choice: "step_back" }) }
    catch (e) { console.error("standChoice 오류:", e.message) }
  }

  btnWrap.appendChild(standBtn)
  btnWrap.appendChild(backBtn)
  popup.appendChild(btnWrap)
  document.body.appendChild(popup)

  setTimeout(() => {
    if (document.getElementById("stand-choice-popup")) {
      popup.remove()
      _standChoice({ roomId: ROOM_ID, mySlot, choice: "step_back" }).catch(() => {})
    }
  }, 30000)
}

function showResonanceModal(data) {
  const existing = document.getElementById("resonance-modal")
  if (existing) existing.remove()

  const modal = document.createElement("div")
  modal.id = "resonance-modal"
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 9900;
    background: rgba(0,0,0,0.82);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 20px;
  `

  const title = document.createElement("div")
  title.style.cssText = `
    font-size: clamp(20px, 5vw, 36px); font-weight: 900;
    color: #fff; letter-spacing: 0.12em; text-align: center;
    text-shadow: 0 0 20px #535ca8, 0 0 40px #535ca8;
    animation: resonancePulse 1.2s ease-in-out infinite;
  `
  title.textContent = "RESONANCE"

  if (!document.getElementById("resonance-style")) {
    const style = document.createElement("style")
    style.id = "resonance-style"
    style.textContent = `
      @keyframes resonancePulse {
        0%,100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.7; transform: scale(1.04); }
      }
    `
    document.head.appendChild(style)
  }

  const sub = document.createElement("div")
  sub.style.cssText = "font-size: 13px; color: #aaa; text-align: center; max-width: 300px; line-height: 1.7;"
  sub.textContent   = "누클라바스가 최후의 일격을 준비하고 있다.\n동료와 함께 힘을 모아 막아내라!"
  sub.style.whiteSpace = "pre-line"

  const agreedEl = document.createElement("div")
  agreedEl.id = "resonance-agreed-count"
  agreedEl.style.cssText = "font-size: 12px; color: #7a8aff;"
  const agreedCount = (data.resonance_agreed ?? []).length
  agreedEl.textContent = `동의: ${agreedCount} / 3`

  const btnWrap = document.createElement("div")
  btnWrap.style.cssText = "display: flex; flex-direction: column; gap: 10px; align-items: center;"

  // [40인] 출전 중인 플레이어만 동의 가능
  if (!isSpectator && mySlot && myRosterStatus === "active" && myUid) {
    const alreadyAgreed = (data.resonance_agreed ?? []).includes(myUid)
    const agreeBtn = document.createElement("button")
    agreeBtn.id = "resonance-agree-btn"
    agreeBtn.textContent = alreadyAgreed ? "✅ 동의함" : "💠 동의한다"
    agreeBtn.disabled    = alreadyAgreed
    agreeBtn.style.cssText = `
      padding: 12px 32px; border-radius: 12px; border: none;
      background: ${alreadyAgreed ? "#444" : "#535ca8"}; color: #fff;
      font-size: 14px; font-weight: bold; cursor: ${alreadyAgreed ? "not-allowed" : "pointer"};
      font-family: inherit; letter-spacing: 0.05em;
      transition: background 0.2s;
    `
    agreeBtn.onclick = async () => {
      agreeBtn.disabled = true
      agreeBtn.textContent = "✅ 동의함"
      agreeBtn.style.background = "#444"
      try { await _resonanceAgree({ roomId: ROOM_ID, myUid }) }
      catch (e) { console.error("resonanceAgree 오류:", e.message) }
    }
    btnWrap.appendChild(agreeBtn)
  }

  const isAdmin = data.roster?.[myUid]?.role === "admin"
if (isAdmin) {
  const adminFireBtn = document.createElement("button")
  adminFireBtn.id = "resonance-fire-btn"
  adminFireBtn.textContent = "⚡ 레조넌스 발동"
  adminFireBtn.disabled    = !(data.resonance_ready ?? false)
  adminFireBtn.style.cssText = `
    padding: 10px 24px; border-radius: 10px; border: none;
    background: ${data.resonance_ready ? "#e74c3c" : "#555"}; color: #fff;
    font-size: 13px; font-weight: bold;
    cursor: ${data.resonance_ready ? "pointer" : "not-allowed"};
    font-family: inherit;
    transition: background 0.2s;
  `
  adminFireBtn.onclick = async () => {
  if (!data.resonance_ready) return
  adminFireBtn.disabled = true
  adminFireBtn.textContent = "발동 중..."
  try {
    await _resonanceFire({ roomId: ROOM_ID, myUid })
    await showResonanceWhiteFade()  // 화이트 페이드
  } catch (e) {
    console.error("resonanceFire 오류:", e.message)
    adminFireBtn.disabled = false
    adminFireBtn.textContent = "⚡ 레조넌스 발동"
  }
}

  btnWrap.appendChild(adminFireBtn)
}

  modal.appendChild(title)
  modal.appendChild(sub)
  modal.appendChild(agreedEl)
  modal.appendChild(btnWrap)
  document.body.appendChild(modal)
}

function updateResonanceModal(data) {
  const modal = document.getElementById("resonance-modal")
  if (!modal) return

  const agreedEl = document.getElementById("resonance-agreed-count")
  if (agreedEl) agreedEl.textContent = `동의: ${(data.resonance_agreed ?? []).length} / 3`

  const agreeBtn = document.getElementById("resonance-agree-btn")
  if (agreeBtn && myUid && (data.resonance_agreed ?? []).includes(myUid)) {
    agreeBtn.disabled = true
    agreeBtn.textContent = "✅ 동의함"
    agreeBtn.style.background = "#444"
  }

  const fireBtn = document.getElementById("resonance-fire-btn")
  if (fireBtn) {
    fireBtn.disabled = !(data.resonance_ready ?? false)
    fireBtn.style.background    = data.resonance_ready ? "#e74c3c" : "#555"
    fireBtn.style.cursor        = data.resonance_ready ? "pointer"  : "not-allowed"
    if (data.resonance_ready) fireBtn.textContent = "⚡ 레조넌스 발동"
  }

  if (data.game_over) modal.remove()
}

function activateIllusionUI(meta) {
  const { illusionHp, illusionMaxHp, illusionName, illusionPortrait } = meta
  const bossHpBar  = $("boss-hp-bar")
  const bossHpText = $("boss-hp-text")
  if (bossHpBar && illusionMaxHp > 0) {
    const pct = Math.max(0, Math.min(100, illusionHp / illusionMaxHp * 100))
    bossHpBar.style.transition      = "width 0.4s ease"
    bossHpBar.style.width           = pct + "%"
    bossHpBar.style.backgroundColor = pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"
    if (bossHpText) bossHpText.innerText = `HP: ${illusionHp} / ${illusionMaxHp}`
    setTimeout(() => { if (bossHpBar) bossHpBar.style.transition = "" }, 420)
  }

  const bossNameEl = $("boss-name")
  if (bossNameEl && illusionName) bossNameEl.innerText = illusionName

  const bossImg = $("boss-portrait")
  const bossPh  = document.querySelector(".boss-portrait-placeholder")
  if (bossImg && illusionPortrait) {
    if (bossPh) bossPh.style.display = "none"
    bossImg.classList.remove("visible")
    bossImg.style.display = "block"
    bossImg.src           = illusionPortrait
    bossImg.alt           = illusionName ?? "???"
    setTimeout(() => bossImg.classList.add("visible"), 60)
  }

  let badge = $("illusion-badge")
  if (!badge) {
    badge = document.createElement("div")
    badge.id = "illusion-badge"
    badge.style.cssText = `
      position: absolute; top: 4px; right: 6px;
      background: rgba(104,72,112,0.85);
      color: #fff; font-size: 10px; padding: 2px 7px;
      border-radius: 8px; pointer-events: none; z-index: 10;
      font-weight: bold; letter-spacing: 0.5px;
    `
    badge.innerText = "🎭 일루전"
    const bossArea = $("boss-pokemon-area") ?? document.querySelector(".boss-area")
    if (bossArea) { bossArea.style.position = "relative"; bossArea.appendChild(badge) }
  }
  badge.style.display = "block"
}

function deactivateIllusionUI(data) {
  const bossHp    = data.boss_current_hp ?? 0
  const bossMaxHp = data.boss_max_hp     ?? 1
  const bossName  = data.boss_name       ?? "조로아크"
  const portrait  = data.boss_portrait_url ?? null

  const bossHpBar  = $("boss-hp-bar")
  const bossHpText = $("boss-hp-text")
  if (bossHpBar) {
    const pct = bossMaxHp > 0 ? Math.max(0, Math.min(100, bossHp / bossMaxHp * 100)) : 0
    bossHpBar.style.width           = pct + "%"
    bossHpBar.style.backgroundColor = pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"
    if (bossHpText) bossHpText.innerText = `HP: ${bossHp} / ${bossMaxHp}`
  }

  const bossNameEl = $("boss-name")
  if (bossNameEl) bossNameEl.innerText = bossName

  const bossImg = $("boss-portrait")
  if (bossImg && portrait) { bossImg.src = portrait; bossImg.alt = bossName }

  const badge = $("illusion-badge")
  if (badge) badge.style.display = "none"
}

// ── 기술 버튼 ────────────────────────────────────────────────────────
function updateMoveButtons(data) {
  // [40인] bench 플레이어는 버튼 전체 비활성화
  const isBenchPlayer = myRosterStatus === "bench"

  const myActiveIdx = data[`${mySlot}_active_idx`] ?? 0
  const myPokemon   = data[`${mySlot}_entry`]?.[myActiveIdx]
  const fainted     = !myPokemon || myPokemon.hp <= 0
  const movesArr    = myPokemon?.moves ?? []
  const chainBound  = myPokemon?.chainBound ?? null

  const isAutoTurn = !!(
    myPokemon?.flyState?.flying       ||
    myPokemon?.digState?.digging      ||
    myPokemon?.ghostDiveState?.diving ||
    myPokemon?.bideState              ||
    myPokemon?.rollState?.active      ||
    myPokemon?.hyperBeamState
  )

  for (let i = 0; i < 4; i++) {
    const btn = $(`move-btn-${i}`)
    if (!btn) continue

    // bench 플레이어는 모든 버튼 비활성화
    if (isBenchPlayer) {
      btn.innerHTML = '<span style="font-size:11px;color:#aaa">대기 중</span>'
      btn.disabled = true; btn.onclick = null; continue
    }

    if (i >= movesArr.length) {
      btn.innerHTML = '<span style="font-size:13px">-</span>'
      btn.disabled = true; btn.onclick = null; continue
    }
    const mv       = movesArr[i]
    const moveInfo = moves[mv.name] ?? {}
    const acc      = moveInfo.alwaysHit ? "필중" : `${moveInfo.accuracy ?? 100}%`

    const isChainBlocked = !!(chainBound && chainBound.moveName === mv.name)
    const lockedBySeal   = !!(myPokemon?.sealedMove && (myPokemon?.sealedMoveTurns ?? 0) > 0 && mv.name === myPokemon.sealedMove)

    if (lockedBySeal) {
      btn.innerHTML = `<span style="display:block;font-size:13px;font-weight:bold">${mv.name} 🔒</span><span style="display:block;font-size:10px;opacity:.85">봉인됨! (${myPokemon.sealedMoveTurns}턴)</span>`
      btn.style.background = "#7a6a8a"
      btn.style.boxShadow  = "none"
      btn.disabled = true; btn.onclick = null; continue
    }

    if (isChainBlocked) {
      btn.innerHTML = `<span style="display:block;font-size:13px;font-weight:bold">${mv.name} 🔗</span><span style="display:block;font-size:10px;opacity:.85">사슬묶기 중!</span>`
      btn.style.background = "#555"; btn.disabled = true; btn.onclick = null; continue
    }

    if (isAutoTurn) {
      btn.innerHTML = `<span style="display:block;font-size:13px;font-weight:bold">${mv.name}</span><span style="display:block;font-size:10px;opacity:.85">자동처리 중...</span>`
      const color = TYPE_COLORS[moveInfo.type] ?? "#a0a0a0"
      btn.style.background = color; btn.disabled = true; btn.onclick = null; continue
    }

    btn.innerHTML = `<span style="display:block;font-size:13px;font-weight:bold">${mv.name}</span><span style="display:block;font-size:10px;opacity:.85">PP: ${mv.pp} | ${acc}</span>`
    const color = TYPE_COLORS[moveInfo.type] ?? "#a0a0a0"
    btn.style.background = color
    btn.style.boxShadow  = `inset 0 0 0 2px white, 0 0 0 2px ${color}`

    const lockedByTorment    = !!(myPokemon?.tormented && mv.name === myPokemon?.lastUsedMove)
    const lockedByNoRepeat   = !!(moveInfo?.noRepeat && mv.name === myPokemon?.lastUsedMove)
    const soundMoves         = ["금속음","돌림노래","바크아웃","소란피기","싫은소리","울부짖기","울음소리","차밍보이스","비밀이야기","하이퍼보이스","매혹의보이스"]
    const lockedByThroatChop = !!((myPokemon?.throatChopped ?? 0) > 0 && soundMoves.includes(mv.name))
    const lockedByOutrage    = !!(myPokemon?.outrageState?.active)
    const lockedByTaunt      = !!((myPokemon?.taunted ?? 0) > 0 && !(moveInfo?.power > 0))

    const canUse = !isSpectator && !fainted && mv.pp > 0 && myTurn && !actionDone
      && !isChainBlocked && !lockedByTorment && !lockedByNoRepeat && !lockedByThroatChop && !lockedByOutrage && !lockedByTaunt
      && !lockedBySeal
    btn.disabled = !canUse
    btn.onclick  = canUse ? () => { playSound(SFX_BTN); onMoveClick(i, moveInfo, data) } : null
  }
}

function onMoveClick(idx, moveInfo, data) {
  if (actionDone) return

  if (moveInfo?.healPulse) {
    const aliveAllies = otherPlayerSlots().filter(s => {
      if (!(data.active_slots ?? {})[s]) return false  // [40인] 빈 슬롯 제외
      const aIdx = data[`${s}_active_idx`] ?? 0
      const p    = data[`${s}_entry`]?.[aIdx]
      return p && p.hp > 0
    })
    if (aliveAllies.length === 0) { doUseMove(idx, [], data); return }
    const popup     = $("ally-target-popup")
    const btnWrap   = $("ally-target-buttons")
    const cancelBtn = $("ally-target-cancel")
    if (!popup || !btnWrap) { doUseMove(idx, [], data); return }
    btnWrap.innerHTML = ""
    aliveAllies.forEach(s => {
      const aIdx = data[`${s}_active_idx`] ?? 0
      const p    = data[`${s}_entry`]?.[aIdx]
      const btn  = document.createElement("button")
      btn.textContent = p?.name ?? s
      btn.style.cssText = "padding:3px 10px;border-radius:6px;border:1px solid #27ae60;background:#27ae60;color:#fff;cursor:pointer;font-size:11px;"
      btn.onclick = () => { popup.style.display = "none"; doUseMove(idx, [s], data) }
      btnWrap.appendChild(btn)
    })
    cancelBtn.onclick = () => { popup.style.display = "none" }
    popup.style.display = "block"
    return
  }

  if (moveInfo?.eggHeal) {
    const aliveAllies = otherPlayerSlots().filter(s => {
      if (!(data.active_slots ?? {})[s]) return false
      const aIdx = data[`${s}_active_idx`] ?? 0
      const p    = data[`${s}_entry`]?.[aIdx]
      return p && p.hp > 0
    })
    if (aliveAllies.length === 0) { doUseMove(idx, [], data); return }
    const popup     = $("ally-target-popup")
    const btnWrap   = $("ally-target-buttons")
    const cancelBtn = $("ally-target-cancel")
    if (!popup || !btnWrap) { doUseMove(idx, [], data); return }
    btnWrap.innerHTML = ""
    const selfBtn = document.createElement("button")
    selfBtn.textContent = "나 자신"
    selfBtn.style.cssText = "padding:3px 10px;border-radius:6px;border:1px solid #27ae60;background:#27ae60;color:#fff;cursor:pointer;font-size:11px;"
    selfBtn.onclick = () => { popup.style.display = "none"; doUseMove(idx, [], data) }
    btnWrap.appendChild(selfBtn)
    aliveAllies.forEach(s => {
      const aIdx = data[`${s}_active_idx`] ?? 0
      const p    = data[`${s}_entry`]?.[aIdx]
      const btn  = document.createElement("button")
      btn.textContent = p?.name ?? s
      btn.style.cssText = "padding:3px 10px;border-radius:6px;border:1px solid #27ae60;background:#27ae60;color:#fff;cursor:pointer;font-size:11px;"
      btn.onclick = () => { popup.style.display = "none"; doUseMove(idx, [s], data) }
      btnWrap.appendChild(btn)
    })
    cancelBtn.onclick = () => { popup.style.display = "none" }
    popup.style.display = "block"
    return
  }

  if (moveInfo?.pollenPuff) {
    const aliveAllies = otherPlayerSlots().filter(s => {
      if (!(data.active_slots ?? {})[s]) return false
      const aIdx = data[`${s}_active_idx`] ?? 0
      const p    = data[`${s}_entry`]?.[aIdx]
      return p && p.hp > 0
    })
    if (aliveAllies.length > 0) {
      const popup     = $("ally-target-popup")
      const btnWrap   = $("ally-target-buttons")
      const cancelBtn = $("ally-target-cancel")
      if (!popup || !btnWrap) { doUseMove(idx, ["boss"], data); return }
      btnWrap.innerHTML = ""
      aliveAllies.forEach(s => {
        const aIdx = data[`${s}_active_idx`] ?? 0
        const p    = data[`${s}_entry`]?.[aIdx]
        const btn  = document.createElement("button")
        btn.textContent = p?.name ?? s
        btn.style.cssText = "padding:3px 10px;border-radius:6px;border:1px solid #27ae60;background:#27ae60;color:#fff;cursor:pointer;font-size:11px;"
        btn.onclick = () => { popup.style.display = "none"; doUseMove(idx, [s], data) }
        btnWrap.appendChild(btn)
      })
      const enemyBtn = document.createElement("button")
      enemyBtn.textContent = anyBeedrillAlive(data) ? "독침붕" : "보스"
      enemyBtn.style.cssText = "padding:3px 10px;border-radius:6px;border:1px solid #e74c3c;background:#e74c3c;color:#fff;cursor:pointer;font-size:11px;"
      enemyBtn.onclick = () => {
        popup.style.display = "none"
        if (anyBeedrillAlive(data)) {
          const aliveBees = (data.Beedrill ?? []).map((b,i) => ({b,i})).filter(({b}) => b.hp > 0)
          if (aliveBees.length === 1) {
            doUseMove(idx, [`beedrill_${aliveBees[0].i}`], data)
          } else {
            pendingMoveIdx  = idx
            pendingMoveInfo = moveInfo
            enterBeedrillTargetMode(data)
          }
        } else {
          doUseMove(idx, ["boss"], data)
        }
      }
      btnWrap.appendChild(enemyBtn)
      cancelBtn.onclick = () => { popup.style.display = "none" }
      popup.style.display = "block"
      return
    }
  }

  if (moveInfo?.helper) {
    const aliveAllies = otherPlayerSlots().filter(s => {
      if (!(data.active_slots ?? {})[s]) return false
      const aIdx = data[`${s}_active_idx`] ?? 0
      const p    = data[`${s}_entry`]?.[aIdx]
      return p && p.hp > 0
    })
    if (aliveAllies.length === 0) { doUseMove(idx, [], data); return }
    const popup     = $("ally-target-popup")
    const btnWrap   = $("ally-target-buttons")
    const cancelBtn = $("ally-target-cancel")
    if (!popup || !btnWrap) { doUseMove(idx, [], data); return }
    btnWrap.innerHTML = ""
    aliveAllies.forEach(s => {
      const aIdx = data[`${s}_active_idx`] ?? 0
      const p    = data[`${s}_entry`]?.[aIdx]
      const btn  = document.createElement("button")
      btn.textContent = p?.name ?? s
      btn.style.cssText = "padding:3px 10px;border-radius:6px;border:1px solid #27ae60;background:#27ae60;color:#fff;cursor:pointer;font-size:11px;"
      btn.onclick = () => { popup.style.display = "none"; doUseMove(idx, [s], data) }
      btnWrap.appendChild(btn)
    })
    cancelBtn.onclick = () => { popup.style.display = "none" }
    popup.style.display = "block"
    return
  }

  const hasBeedrills = anyBeedrillAlive(data)

  if (moveInfo?.uTurn) {
    if (hasBeedrills) {
      const aliveBees = (data.Beedrill ?? []).map((b,i) => ({b,i})).filter(({b}) => b.hp > 0)
      if (aliveBees.length === 1) {
        const bIdx = (data.Beedrill ?? []).findIndex(b => b.hp > 0)
        doUseMove(idx, [`beedrill_${bIdx}`], data)
      } else {
        pendingMoveIdx = idx; pendingMoveInfo = moveInfo
        enterBeedrillTargetMode(data)
      }
    } else {
      const hasBaby   = !!(data.boss_baby && (data.boss_baby.hp ?? 0) > 0)
      const bossPhase = data.boss_state?.phase ?? 1
      if (hasBaby && bossPhase === 1) {
        showBossTargetPopup(idx, moveInfo, data)
      } else {
        doUseMove(idx, ["boss"], data)
      }
    }
    return
  }

  if (moveInfo?.aoe || moveInfo?.aoeEnemy) {
    doUseMove(idx, hasBeedrills ? [] : ["boss"], data)
    return
  }

  if (moveInfo?.outrage) {
    if (hasBeedrills) {
      const aliveBees = (data.Beedrill ?? []).map((b,i) => ({b,i})).filter(({b}) => b.hp > 0)
      const { i: bIdx } = aliveBees[Math.floor(Math.random() * aliveBees.length)]
      doUseMove(idx, [`beedrill_${bIdx}`], data)
    } else {
      doUseMove(idx, ["boss"], data)
    }
    return
  }

  const r = moveInfo?.rank
  const targetsEnemy =
    !moveInfo?.teamBoost &&
    !moveInfo?.healPulse &&
    !moveInfo?.eggHeal &&
    !moveInfo?.waterHeal &&
    !moveInfo?.helper &&
    !moveInfo?.pollenPuff &&
    (moveInfo?.power || moveInfo?.ghostDive || moveInfo?.futureSight
    || moveInfo?.taunt || moveInfo?.memento
    || (r && (r.targetAtk !== undefined || r.targetDef !== undefined || r.targetSpd !== undefined))
    || moveInfo?.roar || moveInfo?.leechSeed || moveInfo?.chainBind
    || moveInfo?.dragonTail || moveInfo?.poisonPowder
    || moveInfo?.curse
    || moveInfo?.telekinesis
    || (moveInfo?.effect?.volatile && !moveInfo?.targetSelf)
    || (moveInfo?.effect?.status && moveInfo?.targetSelf === false))

  if (!targetsEnemy) {
    doUseMove(idx, [], data)
    return
  }

  const hasBaby     = !!(data.boss_baby && (data.boss_baby.hp ?? 0) > 0)
  const bossPhase   = data.boss_state?.phase ?? 1

  if (hasBeedrills) {
    const aliveBees = (data.Beedrill ?? []).filter(b => b.hp > 0)
    if (aliveBees.length === 1) {
      const bIdx = (data.Beedrill ?? []).findIndex(b => b.hp > 0)
      doUseMove(idx, [`beedrill_${bIdx}`], data)
    } else {
      pendingMoveIdx  = idx
      pendingMoveInfo = moveInfo
      enterBeedrillTargetMode(data)
    }
    return
  }

  if (!hasBeedrills && hasBaby && bossPhase === 1) {
    showBossTargetPopup(idx, moveInfo, data)
    return
  }

  doUseMove(idx, ["boss"], data)
}

function showBossTargetPopup(idx, moveInfo, data) {
  const existing = document.getElementById('boss-target-popup')
  if (existing) existing.remove()

  const popup = document.createElement('div')
  popup.id = 'boss-target-popup'
  popup.style.cssText = `
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    z-index: 9000;
    background: #fff; border: 2px solid #e74c3c;
    border-radius: 10px; padding: 14px 16px;
    font-size: 12px; color: #333;
    display: flex; flex-direction: column; gap: 10px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    min-width: 200px;
  `
  const label = document.createElement('div')
  label.textContent = '⚔ 공격 대상을 선택하세요'
  label.style.cssText = 'font-weight:bold; color:#e74c3c;'
  popup.appendChild(label)

  const btnWrap = document.createElement('div')
  btnWrap.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap;'

  const momBtn = document.createElement('button')
  momBtn.textContent = data.boss_name ?? '엄마 캥카'
  momBtn.style.cssText = 'flex:1; padding:7px 12px; border-radius:8px; border:none; background:#e74c3c; color:#fff; cursor:pointer; font-size:12px; font-weight:bold;'
  momBtn.onclick = () => { popup.remove(); doUseMove(idx, ['boss'], data) }

  const babyBtn = document.createElement('button')
  babyBtn.textContent = data.boss_baby?.name ?? '아기 캥카'
  babyBtn.style.cssText = 'flex:1; padding:7px 12px; border-radius:8px; border:none; background:#e67e22; color:#fff; cursor:pointer; font-size:12px; font-weight:bold;'
  babyBtn.onclick = () => { popup.remove(); doUseMove(idx, ['boss_baby'], data) }

  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = '취소'
  cancelBtn.style.cssText = 'width:100%; padding:5px; border-radius:8px; border:1px solid #ccc; background:transparent; color:#888; cursor:pointer; font-size:11px;'
  cancelBtn.onclick = () => popup.remove()

  btnWrap.appendChild(momBtn)
  btnWrap.appendChild(babyBtn)
  popup.appendChild(btnWrap)
  popup.appendChild(cancelBtn)
  document.body.appendChild(popup)
}

async function doUseMove(moveIdx, targetSlots, data) {
  if (actionDone) return
  actionDone = true
  updateMoveButtons(data)
  try {
    await _useMove({ roomId: ROOM_ID, mySlot, moveIdx: Number(moveIdx), targetSlots })
  } catch (e) {
    console.error("useMove 오류:", e.message)
    actionDone = false; updateMoveButtons(data)
  }
}

async function doUseItem(itemName, targetIdx, data) {
  if (actionDone) return
  actionDone = true
  updateMoveButtons(data)
  updateBagButton(data)
  try {
    await _useItem({ roomId: ROOM_ID, mySlot, itemName, targetIdx })
  } catch (e) {
    console.error("useItem 오류:", e.message)
    actionDone = false
    updateMoveButtons(data)
    updateBagButton(data)
  }
}

function updateBagButton(data) {
  const btn = $("bag-btn")
  if (!btn) return
  updateBagBadge("bag-btn", data.inventory ?? {})
  // [40인] bench 플레이어는 가방 사용 불가
  if (isSpectator || gameOver || myRosterStatus === "bench") { btn.disabled = true; return }
  const myActiveIdx  = data[`${mySlot}_active_idx`] ?? 0
  const myActivePkmn = data[`${mySlot}_entry`]?.[myActiveIdx]
  const hasAliveInParty = (data[`${mySlot}_entry`] ?? []).some(p => p.hp > 0)
  const canOpen = myTurn && !actionDone && hasAliveInParty
  btn.disabled = !canOpen
  btn.onclick  = canOpen
    ? () => {
        playSound(SFX_BTN)
        openItemModal(
          currentRoomData, mySlot, myTurn, actionDone,
          (itemName, targetIdx) => doUseItem(itemName, targetIdx, currentRoomData)
        )
      }
    : () => closeItemModal()
}

function updateBenchButtons(data) {
  const bench = $("bench-container")
  if (!bench) return
  bench.innerHTML = ""
  // [40인] bench 플레이어는 교체 불가
  if (myRosterStatus === "bench") return
  const myEntry      = data[`${mySlot}_entry`] ?? []
  const activeIdx    = data[`${mySlot}_active_idx`] ?? 0
  const myActivePkmn = myEntry[activeIdx]
  const isFainted    = !myActivePkmn || myActivePkmn.hp <= 0
  const forceSwitch  = !!data[`force_switch_${mySlot}`]
  const isDiving     = !!(myActivePkmn?.ghostDiveState?.diving)
  const isFlying     = !!(myActivePkmn?.flyState?.flying)
  const isDigging    = !!(myActivePkmn?.digState?.digging)

  myEntry.forEach((pkmn, idx) => {
    if (idx === activeIdx) return
    const btn = document.createElement("button")
    if (pkmn.hp <= 0) {
      btn.innerHTML = `<span class="bench-name">${pkmn.name}</span><span class="bench-hp">기절</span>`
      btn.disabled  = true
    } else {
      btn.innerHTML = `<span class="bench-name">${pkmn.name}</span><span class="bench-hp">HP: ${pkmn.hp}/${pkmn.maxHp}</span>`
      if (isSpectator) {
        btn.disabled = true
      } else {
        const canSwitch = (isFainted || forceSwitch || (myTurn && !actionDone))
          && !isDiving && !isFlying && !isDigging
        btn.disabled = !canSwitch
        if (canSwitch) btn.onclick = () => { playSound(SFX_BTN); doSwitchPokemon(idx, data, forceSwitch) }
      }
    }
    bench.appendChild(btn)
  })
}

async function doSwitchPokemon(newIdx, data, forceSwitch = false) {
  const myEntry      = data[`${mySlot}_entry`] ?? []
  const activeIdx    = data[`${mySlot}_active_idx`] ?? 0
  const myActivePkmn = myEntry[activeIdx]
  const isFainted    = !myActivePkmn || myActivePkmn.hp <= 0
  if (!isFainted && !forceSwitch && actionDone) return
  if (!isFainted) actionDone = true
  const bench = $("bench-container")
  if (bench) bench.querySelectorAll("button").forEach(b => { b.disabled = true; b.onclick = null })
  try {
    await _switchPkmn({ roomId: ROOM_ID, mySlot, newIdx })
  } catch (e) {
    console.error("switchPokemon 오류:", e.message)
    if (!isFainted) actionDone = false
    updateBenchButtons(data)
  }
}

function updateOrderDisplay(data) {
  const el = $("order-display")
  if (!el) return
  const order = data.current_order ?? []
  if (order.length === 0) { el.innerHTML = ""; return }
  el.innerHTML = order.map((slot, i) => {
    const label   = slot === "boss" ? (data.boss_name ?? "보스") :
                    (data[`${slot.replace("p","player")}_name`] ?? slot).split("]").pop().trim()
    const isActive = i === 0
    const isMine   = slot === mySlot
    let cls = "order-item"
    if (isActive) cls += " active"
    else if (isMine) cls += " mine"
    return `<div class="${cls}">${i+1}. ${label}</div>`
  }).join("")
}

function updateTurnUI(data) {
  const el = $("turn-display")
  if (!el) return
  const order = data.current_order ?? []

  // [40인] bench 플레이어 → "대기 중" 표시
  if (myRosterStatus === "bench") {
    el.innerText = "📋 대기 중 (교체 대기)"
    el.style.color = "#888"
    return
  }

  if (isSpectator) {
    if (order.length > 0) {
      const s     = order[0]
      const label = s === "boss" ? (data.boss_name ?? "보스") :
                    (data[`${s.replace("p","player")}_name`] ?? s).split("]").pop().trim()
      el.innerText = `${label}의 턴`; el.style.color = "#333"
    } else {
      el.innerText = "라운드 대기 중..."; el.style.color = "#aaa"
    }
    return
  }
  const myActiveIdx  = data[`${mySlot}_active_idx`] ?? 0
  const myActivePkmn = data[`${mySlot}_entry`]?.[myActiveIdx]
  const isFainted    = !myActivePkmn || myActivePkmn.hp <= 0
  if (isFainted) {
    el.innerText = "교체할 포켓몬을 선택!"; el.style.color = "#e67e22"
  } else if (order.length === 0) {
    el.innerText = "라운드 대기 중..."; el.style.color = "#aaa"
  } else if (order[0] === mySlot) {
    el.innerText = "내 턴!"; el.style.color = "green"
  } else if (order[0] === "boss") {
    el.innerText = "보스 턴..."; el.style.color = "#e74c3c"
  } else {
    const idx    = order.indexOf(mySlot)
    el.innerText = idx > 0 ? `${idx}번째 대기중...` : "다른 플레이어 턴..."
    el.style.color = "gray"
  }
  const tc = $("turn-count")
  if (tc) tc.innerText = `${data.round_count ?? 0}라운드 / ${data.turn_count ?? 0}턴`
}

function updateAssistUI(data) {
  const assist  = data.assist_active  ?? null
  const used    = data.assist_used    ?? false
  const req     = data.assist_request ?? null
  const blocked = cannotRequestSupport(data)
  const allDead = isAllPlayersDead(data)

  const reqBtn = $("assist-request-btn")
  if (reqBtn) {
    const isMyReq = req?.from === mySlot
    // [40인] bench 플레이어는 어시스트 불가
    if (isSpectator || used || assist || allDead || blocked || myRosterStatus === "bench") {
      reqBtn.disabled  = true
      reqBtn.innerText = allDead ? "사용 불가" : assist ? "🤝 어시스트 중" : used ? "지원 완료" : "요청 불가"
    } else if (isMyReq) {
      reqBtn.disabled  = true
      const agreeCnt   = req.agrees?.length ?? 0
      reqBtn.innerText = `요청 중... (${agreeCnt}/2 동의)`
    } else {
      reqBtn.disabled  = false
      reqBtn.innerText = "지원 요청"
      reqBtn.onclick   = () => { playSound(SFX_BTN); doRequestAssist() }
    }
  }

  const popup = $("assist-popup")
  if (popup) {
    const myActiveIdx  = data[`${mySlot}_active_idx`] ?? 0
    const myActivePkmn = data[`${mySlot}_entry`]?.[myActiveIdx]
    const myFainted    = !myActivePkmn || myActivePkmn.hp <= 0
    const canAgree     = req && req.from !== mySlot
                      && !(req.agrees ?? []).includes(mySlot)
                      && !isSpectator && !myFainted
                      && myRosterStatus === "active"   // [40인] 출전 중만
    if (canAgree) {
      popup.style.display = "block"
      const nameEl = $("assist-popup-name")
      if (nameEl) nameEl.innerText = req.fromName ?? req.from
      const agreeCnt = req.agrees?.length ?? 0
      const cntEl = $("assist-agree-count")
      if (cntEl) cntEl.innerText = `(${agreeCnt}/2 동의)`
    } else {
      popup.style.display = "none"
    }
  }
}

function updateSyncUI(data) {
  const sync    = data.sync_active  ?? null
  const used    = data.sync_used    ?? false
  const req     = data.sync_request ?? null
  const blocked = cannotRequestSupport(data)
  const allDead = isAllPlayersDead(data)

  const reqBtn = $("sync-request-btn")
  if (reqBtn) {
    const isMyReq = req?.from === mySlot
    // [40인] bench 플레이어는 싱크로 불가
    if (isSpectator || used || sync || allDead || blocked || myRosterStatus === "bench") {
      reqBtn.disabled  = true
      reqBtn.innerText = allDead ? "사용 불가" : sync ? "💠 싱크로 중" : used ? "동기화 완료" : "요청 불가"
    } else if (isMyReq) {
      reqBtn.disabled  = true
      const agreeCnt   = req.agrees?.length ?? 0
      reqBtn.innerText = `요청 중... (${agreeCnt}/2 동의)`
    } else {
      reqBtn.disabled  = false
      reqBtn.innerText = "동기화 요청"
      reqBtn.onclick   = () => { playSound(SFX_BTN); doRequestSync() }
    }
  }

  const statusEl = $("sync-status")
  if (statusEl) {
    if (sync) {
      const readyCnt = sync.ready?.length ?? 0
      statusEl.innerText = `💠 싱크로 진행 중 (${readyCnt}/3 준비)`
      statusEl.style.color = "#9b59b6"
    } else {
      statusEl.innerText = ""
    }
  }

  const popup = $("sync-popup")
  if (popup) {
    const myActiveIdx  = data[`${mySlot}_active_idx`] ?? 0
    const myActivePkmn = data[`${mySlot}_entry`]?.[myActiveIdx]
    const myFainted    = !myActivePkmn || myActivePkmn.hp <= 0
    const canAgree     = req && req.from !== mySlot
                      && !(req.agrees ?? []).includes(mySlot)
                      && !isSpectator && !myFainted
                      && myRosterStatus === "active"   // [40인] 출전 중만
    if (canAgree) {
      popup.style.display = "block"
      const nameEl = $("sync-popup-name")
      if (nameEl) nameEl.innerText = req.fromName ?? req.from
    } else {
      popup.style.display = "none"
    }
  }
}

function showGameOver(data) {
  if (gameOver) return
  gameOver = true
  closeItemModal()
  const win = data.raid_result === "victory"
  const td  = $("turn-display")
  if (isSpectator || myRosterStatus === "bench") {
    if (td) { td.innerText = win ? "🏆 레이드 성공!" : "💀 레이드 실패..."; td.style.color = win ? "gold" : "red" }
  } else {
    if (td) { td.innerText = win ? "🏆 승리!" : "💀 패배..."; td.style.color = win ? "gold" : "red" }
  }
  for (let i = 0; i < 4; i++) { const b = $(`move-btn-${i}`); if (b) { b.disabled = true; b.onclick = null } }
  const bench = $("bench-container"); if (bench) bench.innerHTML = ""
  const bagBtn = $("bag-btn"); if (bagBtn) { bagBtn.disabled = true; bagBtn.onclick = null }
  const lb = $("leaveBtn")
  if (lb) { lb.style.display = "inline-block"; lb.disabled = false; lb.onclick = leaveGame }
}

// ── 눈여아 / 누클라바스 UI (변경 없음) ──────────────────────────────
function updateFroslassUI(data) {
  if (data.boss_name !== "눈여아") return

  PLAYER_SLOTS.forEach(s => {
    // [40인] 빈 슬롯 스킵
    if ((data.active_slots ?? {})[s] === undefined) return
    if (Object.keys(data.active_slots ?? {}).length > 0 && !data.active_slots[s]) return

    const prefix  = slotToPrefix(s)
    if (!prefix) return

    const hasBall = data[`${s}_fireball`]    ?? false
    const temp    = data[`${s}_temperature`] ?? 3

    let ballEl = document.getElementById(`${prefix}-fireball-badge`)
    if (!ballEl) {
      ballEl = document.createElement("div")
      ballEl.id = `${prefix}-fireball-badge`
      ballEl.style.cssText = `
        display:none; font-size:11px; font-weight:bold;
        background:#e67e22; color:#fff;
        padding:2px 7px; border-radius:8px;
        margin-top:3px; text-align:center;
      `
      const hpCard = document.getElementById(`${prefix}-active-hp`)?.parentElement
                   ?? document.querySelector(`#${prefix}-pokemon-area .hp-card`)
      if (hpCard) hpCard.appendChild(ballEl)
    }
    ballEl.style.display = hasBall ? "block" : "none"
    ballEl.textContent   = "🔥 화염구슬"

    let tempEl = document.getElementById(`${prefix}-temperature`)
    if (!tempEl) {
      tempEl = document.createElement("div")
      tempEl.id = `${prefix}-temperature`
      tempEl.style.cssText = `
        font-size:11px; font-weight:bold;
        padding:2px 7px; border-radius:8px;
        margin-top:3px; text-align:center;
        transition: background 0.3s;
      `
      const hpCard = document.getElementById(`${prefix}-active-hp`)?.parentElement
                   ?? document.querySelector(`#${prefix}-pokemon-area .hp-card`)
      if (hpCard) hpCard.appendChild(tempEl)
    }
    if (!hasBall) {
      tempEl.style.display = "block"
      tempEl.textContent   = `🌡️ 온도: ${temp}`
      tempEl.style.background = temp >= 3 ? "#27ae60"
                               : temp === 2 ? "#f39c12"
                               : temp === 1 ? "#e67e22"
                               : "#e74c3c"
      tempEl.style.color = "#fff"
    } else {
      tempEl.style.display = "none"
    }
  })

  updateFireballPassButton(data)
  updateMirageUI(data)
}

function updateCatastroUI(data) {
  if (data.boss_name !== "누클라바스") return
  const state = data.boss_state ?? {}
  const phase = state.phase ?? 1

  const partPanel = $("catastro-part-panel")
  if (partPanel) {
    partPanel.style.display = phase === 2 ? "block" : "none"
    if (phase === 2) {
      const partHp      = state.partHp      ?? { eye:500, wing:500, tail:500, claw:500 }
      const partDestroy = state.partDestroyed ?? { eye:false, wing:false, tail:false, claw:false }
      const PARTS = [
        { id: "eye",  label: "눈"   },
        { id: "wing", label: "날개" },
        { id: "tail", label: "꼬리" },
        { id: "claw", label: "발톱" },
      ]
      PARTS.forEach(({ id, label }) => {
        const card = $(`part-card-${id}`)
        const bar  = $(`part-hp-bar-${id}`)
        const num  = $(`part-hp-num-${id}`)
        if (!card) return
        const hp    = partHp[id] ?? 500
        const pct   = Math.max(0, hp / 500 * 100)
        const dead  = partDestroy[id] ?? false
        const shown = state.exposedPart === id

        card.classList.toggle("part-exposed",   shown && !dead)
        card.classList.toggle("part-destroyed", dead)

        if (bar) {
          bar.style.width           = `${dead ? 0 : pct}%`
          bar.style.backgroundColor = pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"
        }
        if (num) num.textContent = dead ? "파괴됨" : `${hp} / 500`
      })
    }
  }

  const corePanel = $("catastro-core-panel")
  if (corePanel) {
    corePanel.style.display = phase === 3 ? "block" : "none"
    if (phase === 3) {
      const coreOrder = state.coreOrder ?? []
      const coreIdx   = state.coreIndex  ?? 0
      const currentId = coreOrder[coreIdx] ?? null
      const coreData  = state.coreData?.[currentId]
      const coreHpMap = state.coreHp ?? {}

      const nameEl = $("core-name")
      const bar    = $("core-hp-bar")
      const num    = $("core-hp-num")
      const cntEl  = $("core-destroyed-count")

      if (nameEl) nameEl.textContent = coreData?.name ?? (currentId ? `${currentId} 코어` : "없음")
      if (cntEl)  cntEl.textContent  = `${state.coresDestroyed ?? 0} / 6 파괴`

      const curHp  = currentId ? (coreHpMap[currentId] ?? coreData?.hp ?? 300) : 0
      const maxHp  = coreData?.hp ?? 300
      const pct    = maxHp > 0 ? Math.max(0, curHp / maxHp * 100) : 0

      if (bar) {
        bar.style.width           = `${pct}%`
        bar.style.backgroundColor = pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"
      }
      if (num) num.textContent = currentId ? `${curHp} / ${maxHp}` : "-"
    }
  }
}

function updateFireballPassButton(data) {
  if (data.boss_name !== "눈여아") return
  if (!mySlot) return

  let btn = document.getElementById("fireball-pass-btn")
  if (!btn) {
    btn = document.createElement("button")
    btn.id = "fireball-pass-btn"
    btn.style.cssText = `
      display:none; margin-top:6px;
      padding:5px 12px; border-radius:8px;
      border:none; background:#e67e22; color:#fff;
      font-size:12px; font-weight:bold; cursor:pointer;
      width:100%; box-sizing:border-box;
    `
    const myArea = document.getElementById("my-pokemon-area")
              ?? document.getElementById("my-controls")
    if (myArea) myArea.appendChild(btn)
  }

  const iHaveBall = data[`${mySlot}_fireball`] ?? false
  const canPass   = iHaveBall && !gameOver && !isSpectator && myRosterStatus === "active"

  btn.style.display = iHaveBall ? "block" : "none"
  btn.textContent   = "🔥 화염구슬 전달"
  btn.disabled      = !canPass

  btn.onclick = canPass ? () => {
    playSound(SFX_BTN)
    showFireballPassPopup(data)
  } : null
}

function showFireballPassPopup(data) {
  const existing = document.getElementById("fireball-pass-popup")
  if (existing) existing.remove()

  const popup = document.createElement("div")
  popup.id = "fireball-pass-popup"
  popup.style.cssText = `
    position:fixed; top:50%; left:50%;
    transform:translate(-50%,-50%);
    z-index:9500;
    background:#fff; border:2px solid #e67e22;
    border-radius:12px; padding:16px 18px;
    font-size:12px; color:#333;
    display:flex; flex-direction:column; gap:10px;
    box-shadow:0 4px 24px rgba(0,0,0,0.3);
    min-width:200px;
  `
  const label = document.createElement("div")
  label.textContent = "🔥 화염구슬 전달 대상"
  label.style.cssText = "font-weight:bold; color:#e67e22; text-align:center;"
  popup.appendChild(label)

  const btnWrap = document.createElement("div")
  btnWrap.style.cssText = "display:flex; flex-direction:column; gap:6px;"

  // [40인] active_slots에서 출전 중인 아군만 표시
  const activeSlots = data.active_slots ?? {}
  const targets = ["p1","p2","p3"].filter(s => s !== mySlot && activeSlots[s])
  targets.forEach(s => {
    const idx  = data[`${s}_active_idx`] ?? 0
    const pkmn = data[`${s}_entry`]?.[idx]
    if (!pkmn) return

    const name   = pkmn.name ?? s
    const isFroz = pkmn.status === "얼음"
    const btn    = document.createElement("button")
    btn.style.cssText = `
      padding:7px 12px; border-radius:8px; border:none;
      background:${isFroz ? "#3498db" : "#e67e22"}; color:#fff;
      cursor:pointer; font-size:12px; font-weight:bold;
    `
    btn.textContent = isFroz ? `❄️ ${name} (얼음 해제!)` : `🔥 ${name}`
    btn.disabled    = pkmn.hp <= 0
    btn.onclick     = () => {
      popup.remove()
      doPassFireball(mySlot, s)
    }
    btnWrap.appendChild(btn)
  })

  const cancelBtn = document.createElement("button")
  cancelBtn.textContent = "취소"
  cancelBtn.style.cssText = "padding:5px; border-radius:8px; border:1px solid #ccc; background:transparent; color:#888; cursor:pointer; font-size:11px;"
  cancelBtn.onclick = () => popup.remove()

  popup.appendChild(btnWrap)
  popup.appendChild(cancelBtn)
  document.body.appendChild(popup)
}

async function doPassFireball(fromSlot, toSlot) {
  try {
    await _passFireball({ roomId: ROOM_ID, fromSlot, toSlot })
  } catch (e) {
    alert(`화염구슬 전달 실패: ${e.message}`)
  }
}

function updateMirageUI(data) {
  if (data.boss_name !== "눈여아") return

  const mirageActive = data.boss_state?.mirageActive ?? false
  let overlay = document.getElementById("mirage-overlay")

  if (!mirageActive) {
    if (overlay) overlay.style.display = "none"
    mirageSelectMode = false
    return
  }

  // [40인] bench / spectator는 눈속임 선택 불가
  if (!myTurn || actionDone || isSpectator || myRosterStatus === "bench") {
    if (overlay) overlay.style.display = "none"
    return
  }

  if (!overlay) {
    overlay = document.createElement("div")
    overlay.id = "mirage-overlay"
    overlay.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      background:rgba(10,20,60,0.55); z-index:8000;
      display:flex; flex-direction:column;
      align-items:center; justify-content:center; gap:16px;
    `
    document.body.appendChild(overlay)
  }
  overlay.innerHTML = ""
  overlay.style.display = "flex"
  mirageSelectMode = true

  const title = document.createElement("div")
  title.style.cssText = `
    color:#e0efff; font-size:15px; font-weight:bold;
    text-shadow:0 0 12px #6dc8eb; letter-spacing:1px;
    text-align:center;
  `
  title.textContent = "❄️ 눈보라 속에서 눈여아의 형상이 흩어진다…\n어느 것이 진짜인가?"
  title.style.whiteSpace = "pre-line"
  overlay.appendChild(title)

  const btnRow = document.createElement("div")
  btnRow.style.cssText = "display:flex; gap:16px;"

  for (let i = 0; i < 3; i++) {
    const btn = document.createElement("button")
    btn.style.cssText = `
      width:80px; height:80px; border-radius:50%;
      border:3px solid #6dc8eb;
      background:rgba(109,200,235,0.18);
      color:#e0efff; font-size:22px;
      cursor:pointer; font-weight:bold;
      transition:background 0.2s, transform 0.15s;
      box-shadow:0 0 16px rgba(109,200,235,0.4);
    `
    btn.textContent = "❄️"
    btn.onmouseover = () => { btn.style.background = "rgba(109,200,235,0.45)"; btn.style.transform = "scale(1.08)" }
    btn.onmouseout  = () => { btn.style.background = "rgba(109,200,235,0.18)"; btn.style.transform = "scale(1)" }
    btn.onclick     = () => {
      overlay.style.display = "none"
      mirageSelectMode = false
      doAttackMirage(i)
    }
    btnRow.appendChild(btn)
  }
  overlay.appendChild(btnRow)

  const hint = document.createElement("div")
  hint.style.cssText = "color:#9ecfef; font-size:11px; text-align:center;"
  hint.textContent = "형상을 선택해 공격하세요. 가짜를 고르면 온도가 내려갑니다!"
  overlay.appendChild(hint)
}

async function doAttackMirage(mirageIdx) {
  if (actionDone) return
  actionDone = true
  try {
    const result = await _attackMirage({ roomId: ROOM_ID, mySlot, mirageIdx })
    if (result.isReal) {
      actionDone = false
    }
    if (!result.isReal) actionDone = false
  } catch (e) {
    console.error("mirage attack 오류:", e.message)
    actionDone = false
  }
}

async function doSkipTurn(timerExpired = false) {
  try { await _skipTurn({ roomId: ROOM_ID, mySlot, timerExpired }) }
  catch (e) { console.warn("skipTurn 오류:", e.message); actionDone = false }
}

// ════════════════════════════════════════════════════════════════════
//  [40인] Admin 슬롯 교체 패널
//  role: admin인 경우 배틀 화면에 교체 패널 표시
// ════════════════════════════════════════════════════════════════════
// 변경 후
function renderAdminSwapPanel(data, isAdmin) {
  const panelId = "admin-swap-panel"
  const panel = document.getElementById(panelId)
  if (!panel) return   // HTML에 없으면 종료

  if (!isAdmin) {
    panel.classList.remove("visible")
    return
  }

  panel.classList.add("visible")
  panel.innerHTML = ""

  const title = document.createElement("div")
  title.style.cssText = "font-weight:bold; color:#9b59b6; margin-bottom:8px; font-size:12px; letter-spacing:0.05em;"
  title.textContent = "🔧 ADMIN — 슬롯 교체"
  panel.appendChild(title)

  const roster   = data.roster ?? {}
  const slots    = data.active_slots ?? {}

  // 현재 출전 슬롯 3개
  const slotGrid = document.createElement("div")
  slotGrid.style.cssText = "display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-bottom:8px;"

  PLAYER_SLOTS.forEach(slot => {
    const uid  = slots[slot] ?? null
    const nick = uid ? (roster[uid]?.nick ?? uid.slice(0,6)) : "비어있음"
    const card = document.createElement("div")
    card.style.cssText = `
      padding:5px 8px; border-radius:8px;
      border:1px solid ${uid ? "#4caf50" : "#aaa"};
      background:${uid ? "rgba(76,175,80,0.08)" : "#f5f5f5"};
      text-align:center; font-size:10px; color:#333;
    `
    card.innerHTML = `<b>${slot.toUpperCase()}</b><br>${nick}`
    slotGrid.appendChild(card)
  })
  panel.appendChild(slotGrid)

  // 대기열 목록
  const spectatorUids  = data.spectators      ?? []
const spectatorNames = data.spectator_names ?? []

const rosterList = Object.entries(roster)
  .filter(([, m]) => m.status === "bench" || m.status === "spectator")

const spectatorList = spectatorUids
  .filter(uid => !roster[uid])
  .map((uid, i) => [uid, { status: "spectator", nick: spectatorNames[i] ?? uid.slice(0, 6) }])

const benchList = [...rosterList, ...spectatorList]
  .sort((a, b) => (a[1].joinedAt ?? 0) - (b[1].joinedAt ?? 0))

  if (benchList.length === 0) {
    const empty = document.createElement("div")
    empty.style.cssText = "color:#aaa; font-size:10px;"
    empty.textContent = "대기 중인 플레이어 없음"
    panel.appendChild(empty)
    return
  }

  const benchTitle = document.createElement("div")
  benchTitle.style.cssText = "color:#888; font-size:10px; margin-bottom:4px;"
  benchTitle.textContent = "대기열"
  panel.appendChild(benchTitle)

  benchList.forEach(([uid, member]) => {
    const row = document.createElement("div")
    row.style.cssText = "display:flex; align-items:center; gap:6px; margin-bottom:4px;"

    const nick = document.createElement("span")
    nick.style.cssText = "flex:1; font-size:11px; color:#333;"
    nick.textContent = `[${member.status === "bench" ? "대기" : "관전"}] ${member.nick ?? uid.slice(0,6)}`

    const sel = document.createElement("select")
    sel.style.cssText = "font-size:10px; padding:2px 4px; border-radius:4px; border:1px solid #ccc;"
    sel.innerHTML = `<option value="">슬롯 선택</option>`
    PLAYER_SLOTS.forEach(s => {
      const opt = document.createElement("option")
      opt.value = s
      opt.textContent = `${s.toUpperCase()} (${slots[s] ? roster[slots[s]]?.nick ?? "누군가" : "비어있음"})`
      sel.appendChild(opt)
    })

    const btn = document.createElement("button")
    btn.textContent = "교체"
    btn.style.cssText = `
      padding:2px 8px; border-radius:4px; border:none;
      background:#e67e22; color:#fff; font-size:10px; cursor:pointer;
    `
    btn.onclick = async () => {
      const targetSlot = sel.value
      if (!targetSlot) { alert("슬롯을 선택해줘!"); return }
      const outUid = slots[targetSlot] ?? null
      btn.disabled = true; btn.textContent = "처리 중..."
      try {
        await _adminSwapSlot({ roomId: ROOM_ID, outUid, inUid: uid, targetSlot })
      } catch (e) {
        alert(`교체 실패: ${e.message}`)
        btn.disabled = false; btn.textContent = "교체"
      }
    }

    row.appendChild(nick)
    row.appendChild(sel)
    row.appendChild(btn)
    panel.appendChild(row)
  })
}

// ── applyRoomData ────────────────────────────────────────────────────
function applyRoomData(data) {
  currentRoomData = data
  

  // [40인] mySlot / myRosterStatus 갱신 (교체 후 변경될 수 있음)
  if (myUid) {
    const resolved = resolveMySlotAndStatus(data, myUid)
    mySlot = resolved.slot
    myRosterStatus = resolved.status
    // spectator URL 파라미터 없어도 roster status가 spectator면 관전자 취급
    if (resolved.status === "spectator" && !mySlot) isSpectator = true
    // bench 플레이어는 spectator처럼 로그만 봄 (isSpectator는 false 유지)
  }

  PLAYER_SLOTS.forEach(s => updateSlotUI(s, data))
  updateBossUI(data)
  const bossPhase = data.boss_state?.phase ?? 1
playBgm(bossPhase)
  updateFroslassUI(data)
  updateCatastroUI(data)
  updateBeedrillUI(data)
  updateResonanceModal(data)
  updateOrderDisplay(data)
  updateTurnUI(data)

  // [40인] bench가 아닌 출전 플레이어만 컨트롤 UI 업데이트
  if (!isSpectator && mySlot && myRosterStatus === "active") {
    updateMoveButtons(data)
    updateBenchButtons(data)
    updateAssistUI(data)
    updateSyncUI(data)
    updateBagButton(data)
  } else if (myRosterStatus === "bench") {
    // bench: 버튼만 비활성화 표시
    updateMoveButtons(data)
    updateBagButton(data)
  }

  // [40인] Admin 패널
  const isAdmin = !!(data.roster?.[myUid]?.role === "admin" ||
                     data[`player_role_${myUid}`] === "admin")
  renderAdminSwapPanel(data, isAdmin)

  const spectEl = $("spectator-list")
  if (spectEl) {
    // [40인] 관전자 + 대기열 표시
    const roster     = data.roster ?? {}
    const spectators = Object.values(roster).filter(m => m.status === "spectator").map(m => m.nick ?? "?")
    const bench      = Object.values(roster).filter(m => m.status === "bench").map(m => `${m.nick ?? "?"}(대기)`)
    const all        = [...spectators, ...bench]
    spectEl.innerText = all.length > 0 ? "관전/대기: " + all.join(", ") : ""
  }

  if (data.game_over) { showGameOver(data); return }
}

// ── 로그 리스너 ──────────────────────────────────────────────────────
function listenLogs(gameStartedAt) {
  let firstSnapshot = true
  const q = query(logsRef, orderBy("ts"))
  onSnapshot(q, snap => {
    const newEntries = []
    snap.docs.forEach(d => {
      if (renderedLogIds.has(d.id)) return
      const logData = d.data()
      if (gameStartedAt && logData.ts < gameStartedAt) return
      renderedLogIds.add(d.id)
      if (firstSnapshot) return
      newEntries.push(logData)
    })
    firstSnapshot = false
    if (newEntries.length > 0) enqueueLogs(newEntries)
  })
}

let lastDiceEventTs   = 0
let lastAssistEventTs = 0
let lastSyncEventTs   = 0

// ── 룸 리스너 ────────────────────────────────────────────────────────
function listenRoom() {
  onSnapshot(roomRef, async snap => {
    const data = snap.data()
    if (!data) return

    // ── [40인] 최소 데이터 체크 ─────────────────────────────────
    // roster 기반이면 roster 존재 여부, 레거시면 p1_entry
    const hasRoster = !!(data.roster && Object.keys(data.roster).length > 0)
    const hasLegacy = !!(data.p1_entry)
    if (!hasRoster && !hasLegacy) return

    // [40인] mySlot / myRosterStatus 갱신
    if (myUid) {
      const resolved = resolveMySlotAndStatus(data, myUid)
      mySlot = resolved.slot
      myRosterStatus = resolved.status
    }

    const order           = data.current_order ?? []
    const currentTurnSlot = order[0] ?? null
    lastTurnSlot = currentTurnSlot

    // [40인] active 상태인 경우만 턴 처리
    if (!isSpectator && myRosterStatus === "active" && mySlot && !data.game_over) {
      const wasMyTurn   = myTurn
      const isMyTurnNow = order[0] === mySlot
      myTurn = isMyTurnNow

      if (!wasMyTurn && isMyTurnNow) {
        actionDone = false
        closeItemModal()
        if (beedrillTargetMode) exitBeedrillTargetMode(data)
      }

      if (myTurn && !actionDone) {
        const myEntry = data[`${mySlot}_entry`] ?? []
        if (myEntry.every(p => p.hp <= 0)) {
          actionDone = true; doSkipTurn(false)
        } else {
          const myActiveIdx  = data[`${mySlot}_active_idx`] ?? 0
          const myActivePkmn = data[`${mySlot}_entry`]?.[myActiveIdx]

          if (data[`force_switch_${mySlot}`] && myActivePkmn && myActivePkmn.hp > 0) {
            actionDone = false; applyRoomData(data); return
          }

          if (myActivePkmn?.outrageState?.active) {
            const outrageMoveIdx = (myActivePkmn.moves ?? [])
              .findIndex(m => m.name === myActivePkmn.outrageState.moveName)
            if (outrageMoveIdx !== -1) {
              actionDone = true
              const hasBees = anyBeedrillAlive(data)
              let tSlots = ["boss"]
              if (hasBees) {
                const aliveBees = (data.Beedrill ?? []).map((b,i) => ({b,i})).filter(({b}) => b.hp > 0)
                const { i: bIdx } = aliveBees[Math.floor(Math.random() * aliveBees.length)]
                tSlots = [`beedrill_${bIdx}`]
              }
              _useMove({ roomId: ROOM_ID, mySlot, moveIdx: outrageMoveIdx, targetSlots: tSlots })
                .catch(e => { console.warn("역린 자동처리 오류:", e.message); actionDone = false })
              return
            }
          }

          const needsAutoMove = myActivePkmn?.bideState || myActivePkmn?.rollState?.active
          const needsAutoFly  = myActivePkmn?.flyState?.flying
          const needsAutoDig  = myActivePkmn?.digState?.digging
          const needsAutoDive = myActivePkmn?.ghostDiveState?.diving
          if (!actionDone && (needsAutoMove || needsAutoFly || needsAutoDig || needsAutoDive || myActivePkmn?.hyperBeamState)) {
            actionDone = true
            const hasBees = anyBeedrillAlive(data)
            let tSlots = ["boss"]
            if (hasBees) {
              const aliveBees = (data.Beedrill ?? []).map((b,i) => ({b,i})).filter(({b}) => b.hp > 0)
              const { i: bIdx } = aliveBees[Math.floor(Math.random() * aliveBees.length)]
              tSlots = [`beedrill_${bIdx}`]
            }
            _useMove({ roomId: ROOM_ID, mySlot, moveIdx: 0, targetSlots: tSlots })
              .catch(e => { console.warn("자동처리 오류:", e.message); actionDone = false })
          }
        }
      }

      if (order.length === 0 && data.game_started && data.intro_done) {
        tryStartRound()
      }
    } else if (!isSpectator && myRosterStatus === "bench") {
      // bench 플레이어는 턴 관여 X, myTurn = false
      myTurn = false
    }

    if (!isSpectator && myRosterStatus === "active" && !data.game_over && mySlot) {
      const myActiveIdx  = data[`${mySlot}_active_idx`] ?? 0
      const myActivePkmn = data[`${mySlot}_entry`]?.[myActiveIdx]
      const isFainted    = !myActivePkmn || myActivePkmn.hp <= 0
      const hasAlive     = (data[`${mySlot}_entry`] ?? []).some(p => p.hp > 0)
      const forceSwitch  = !!data[`force_switch_${mySlot}`]
      if (isFainted && hasAlive && (forceSwitch || myTurn)) {
        updateBenchButtons(data)
        updateTurnUI(data)
      }
    }

    if (data.dice_event && data.dice_event.ts > lastDiceEventTs) {
      if (!isProcessing && logQueue.length === 0) {
        lastDiceEventTs = data.dice_event.ts
        await animateRoundDice(data.dice_event.rolls, data.dice_event.slots)
        applyRoomData(data)
      } else {
        pendingRoomData = data
      }
      return
    }

    if (!isProcessing && logQueue.length === 0) {
      applyRoomData(data)
    } else {
      pendingRoomData = data
    }
  })
}

let startRoundLock = false
async function tryStartRound() {
  if (startRoundLock) return
  startRoundLock = true
  try { await _startRound({ roomId: ROOM_ID, mySlot }) }
  catch (e) { console.warn("startRound:", e.message) }
  finally { setTimeout(() => startRoundLock = false, 3000) }
}

async function doRequestAssist() {
  if (!myTurn) { alert("자신의 턴에만 지원 요청할 수 있어!"); return }
  try { await _requestAssist({ roomId: ROOM_ID, mySlot }) }
  catch (e) { alert(`어시스트 요청 실패: ${e.message}`) }
}
async function doAgreeAssist() {
  playSound(SFX_BTN)
  try { await _agreeAssist({ roomId: ROOM_ID, mySlot }) }
  catch (e) { alert(`동의 실패: ${e.message}`) }
}
async function doRejectAssist() {
  playSound(SFX_BTN)
  try { await _rejectAssist({ roomId: ROOM_ID, mySlot }) }
  catch (e) { console.warn("거절 실패:", e.message) }
}
async function doRequestSync() {
  if (!myTurn) { alert("자신의 턴에만 동기화 요청할 수 있어!"); return }
  try { await _requestSync({ roomId: ROOM_ID, mySlot }) }
  catch (e) { alert(`동기화 요청 실패: ${e.message}`) }
}
async function doAgreeSync() {
  playSound(SFX_BTN)
  try { await _agreeSync({ roomId: ROOM_ID, mySlot }) }
  catch (e) { alert(`동의 실패: ${e.message}`) }
}
async function doRejectSync() {
  playSound(SFX_BTN)
  try { await _rejectSync({ roomId: ROOM_ID, mySlot }) }
  catch (e) { console.warn("거절 실패:", e.message) }
}

async function leaveGame() {
  try { await _leaveGame({ roomId: ROOM_ID, myUid }) }
  catch (e) { console.error("leaveGame 오류:", e) }
  location.href = "../main.html"
}

// ── 초기화 ───────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) return
  myUid = user.uid
  const roomSnap = await getDoc(roomRef)
  const data     = roomSnap.data()

  // ── [40인] mySlot / myRosterStatus 결정 ─────────────────────
  if (data) {
    const resolved = resolveMySlotAndStatus(data, myUid)
    mySlot         = resolved.slot
    myRosterStatus = resolved.status
  }

  // URL spectator 파라미터 또는 roster status가 spectator/bench면 관전 모드
  if (isSpectator || myRosterStatus === "spectator") {
    mySlot = null
    isSpectator = true
    const td = $("turn-display")
    if (td) { td.innerText = "관전 중"; td.style.color = "gray" }
  } else if (myRosterStatus === "bench") {
    // bench: mySlot null, 채팅만 가능
    mySlot = null
    const td = $("turn-display")
    if (td) { td.innerText = "📋 대기 중"; td.style.color = "#888" }
  }

  if (window.initRaidChat) {
    const userSnap = await getDoc(doc(db, "users", myUid))
    window.__myDisplayName = userSnap.data()?.nickname ?? myUid.slice(0, 6)
    window.initRaidChat({ db, ROOM_ID, myUid, mySlot, isSpectator, gameStartedAt: data?.game_started_at ?? 0 })
  }

  // [40인] 초기 데이터 표시
  if (data) applyRoomData(data)
  listenLogs(data?.game_started_at ?? 0)
  listenRoom()
})

// ── 소넷 무전 대화 ───────────────────────────────────────────────
const SONNET_RADIO_LINES = [
  { text: "... ...",                              pause: 900  },
  { text: "얘들아.",                              pause: 700  },
  { text: "들려?",                                pause: 700  },
  { text: "나야, 소넷.",                          pause: 900  },
  { text: "내가 뭘 만들었는지 알아?",             pause: 800  },
  { text: "바로...",                              pause: 1000 },
  { text: "너희를 전부 연결하는 장치!",           pause: 1000 },
  { text: "방금 봤지? 따로따로 흩어지면 못 막아.", pause: 1100 },
  { text: "...지금 그거, 전부 날리는 기술이니까.", pause: 1100 },
  { text: "회피 불가, 방어 불가.",                pause: 1000 },
  { text: "근데, 이 레조넌스는...",               pause: 1000 },
  { text: "응, 어렵게 설명하면 안 들을 거잖아.",  pause: 1100 },
  { text: "아무튼, 조건을 맞추면, 되돌릴 수 있어.", pause: 1100 },
  { text: "조건? 간단해. 전원 동의. 출력 동기화.", pause: 1100 },
  { text: "귀찮은 방식이지, 알아.",               pause: 900  },
  { text: "한 명이라도 빠지면... 실패.",           pause: 1000 },
  { text: "그래도...",                            pause: 800  },
  { text: "이게 제일 확률 높아.",                 pause: 1200 },
  { text: null,                                   pause: 900  },
  { text: "있지, 나 너희를 믿으니까.",             pause: 1000 },
  { text: "너희도 나를 믿어줄 거지?",             pause: 1000 },
  { text: "그리고 서로를.",                       pause: 900  },
  { text: "...",                                  pause: 1200 },
  { text: "시작할게.",                            pause: 800  },
]

function showSonnetRadio() {
  return new Promise(resolve => {
    const existing = document.getElementById("sonnet-radio-overlay")
    if (existing) existing.remove()

    const overlay = document.createElement("div")
    overlay.id = "sonnet-radio-overlay"
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 9500;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding-top: 14vh;
    `

    const bubble = document.createElement("div")
    bubble.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    `

    const tag = document.createElement("div")
    tag.style.cssText = `
      font-size: 11px;
      color: rgba(180, 160, 255, 0.7);
      letter-spacing: 0.15em;
      font-weight: bold;
    `
    tag.textContent = "◈ SONNET"

    const msg = document.createElement("div")
    msg.style.cssText = `
      font-size: clamp(14px, 3.5vw, 18px);
      color: #e8e0ff;
      text-align: center;
      line-height: 1.6;
      letter-spacing: 0.03em;
      padding: 12px 24px;
      background: rgba(10, 8, 28, 0.85);
      border: 1px solid rgba(160, 140, 255, 0.35);
      border-radius: 12px;
      max-width: min(460px, 86vw);
      opacity: 0;
      transition: opacity 0.35s ease;
      text-shadow: 0 0 12px rgba(180, 160, 255, 0.4);
    `

    bubble.appendChild(tag)
    bubble.appendChild(msg)
    overlay.appendChild(bubble)
    document.body.appendChild(overlay)

    async function playLines() {
      for (const line of SONNET_RADIO_LINES) {
        if (line.text === null) {
          // 텀: 현재 말풍선 페이드아웃 후 대기
          msg.style.opacity = "0"
          await wait(line.pause)
          continue
        }

        // 이전 대사 페이드아웃
        if (msg.style.opacity === "1") {
          msg.style.opacity = "0"
          await wait(320)
        }

        // 새 대사 세팅 후 페이드인
        msg.textContent = line.text
        await wait(40) // 리플로우
        msg.style.opacity = "1"

        // 대사 길이에 비례한 대기
        await wait(line.pause + line.text.length * 22)
      }

      // 마지막 대사 페이드아웃
      msg.style.opacity = "0"
      await wait(400)
      overlay.remove()
      resolve()
    }

    playLines()
  })
}

async function showResonanceWhiteFade() {
  const modal = document.getElementById("resonance-modal")
  if (modal) {
    modal.style.transition = "opacity 0.5s ease"
    modal.style.opacity = "0"
    await wait(500)
    modal.remove()
  }

  const logEl = $("battle-log")
  await typeText(logEl, "이제 온다.")
  await wait(700)
  await typeText(logEl, "프로토콜, 실행!")
  await wait(900)

  const fade = document.createElement("div")
  fade.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: #fff;
    opacity: 0;
    pointer-events: all;
    transition: opacity 2.4s ease;
  `
  document.body.appendChild(fade)

  await wait(50)
  fade.style.opacity = "1"
  // 이후 게임 종료는 roomRef onSnapshot이 처리
}

window.__doRequestAssist = doRequestAssist
window.__doAgreeAssist   = doAgreeAssist
window.__doRejectAssist  = doRejectAssist
window.__doRequestSync   = doRequestSync
window.__doAgreeSync     = doAgreeSync
window.__doRejectSync    = doRejectSync