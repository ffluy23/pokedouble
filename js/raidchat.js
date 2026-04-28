import {
  collection, addDoc, onSnapshot, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

function formatMessage(text) {
  return text.replace(/\((.+?)\)/g, '<span class="chat-action">($1)</span>')
}

function appendMessage(container, nickname, text, type = "player") {
  const div = document.createElement("div")
  div.className = `chat-message chat-message--${type}`
  div.innerHTML = `<span class="chat-nick">${nickname}:</span> ${formatMessage(text)}`
  container.appendChild(div)
  container.scrollTop = container.scrollHeight
}

// 등록된 리스너 해제용
let _unsubPlayer    = null
let _unsubSpectator = null
let _currentMode    = null  // "player" | "spectator"

window.initRaidChat = function({ db, ROOM_ID, myUid, mySlot, isSpectator, gameStartedAt = 0 }) {
  const renderedPlayer    = new Set()
  const renderedSpectator = new Set()

  function setupPlayerMode() {
    if (_currentMode === "player") return
    _currentMode = "player"

    // 관전자 리스너 해제
    if (_unsubSpectator) { _unsubSpectator(); _unsubSpectator = null }
    if (_unsubPlayer)    { _unsubPlayer();    _unsubPlayer    = null }
    renderedPlayer.clear()

    const chatSection      = document.getElementById("chat-section")
    const spectatorSection = document.getElementById("spectator-chat-section")
    if (chatSection)      chatSection.style.display      = "flex"
    if (spectatorSection) spectatorSection.style.display = "none"

    const labelEl = document.getElementById("chat-channel-label")
    if (labelEl) labelEl.innerText = "🗡 레이드 채팅"

    const container = document.getElementById("chat-messages")
    if (container) {
      container.innerHTML = ""
      const ref = collection(db, "raid", ROOM_ID, "chat")
      const q   = gameStartedAt > 0
        ? query(ref, orderBy("ts"), where("ts", ">=", gameStartedAt))
        : query(ref, orderBy("ts"))
      _unsubPlayer = onSnapshot(q, snap => {
        snap.docs.forEach(d => {
          if (renderedPlayer.has(d.id)) return
          renderedPlayer.add(d.id)
          const { nickname, text } = d.data()
          appendMessage(container, nickname, text, "player")
        })
      })
    }

    async function sendChat() {
      if (window.__myRosterStatus === "bench" || window.__myRosterStatus === "spectator") return
      const input = document.getElementById("chat-input")
      if (!input) return
      const text = input.value.trim()
      if (!text) return
      const nickname = window.__myDisplayName ?? myUid.slice(0, 6)
      await addDoc(collection(db, "raid", ROOM_ID, "chat"), { uid: myUid, nickname, text, ts: Date.now() })
      input.value = ""
    }

    const sendBtn = document.getElementById("chat-send-btn")
    if (sendBtn) sendBtn.onclick = sendChat
    const inputEl = document.getElementById("chat-input")
    if (inputEl) {
      inputEl.onkeypress = e => { if (e.key === "Enter") sendChat() }
    }
  }

  function setupSpectatorMode() {
    if (_currentMode === "spectator") return
    _currentMode = "spectator"

    const chatSection      = document.getElementById("chat-section")
    const spectatorSection = document.getElementById("spectator-chat-section")
    if (chatSection)      chatSection.style.display      = "none"
    if (spectatorSection) spectatorSection.style.display = "flex"

    // 플레이어 채팅 읽기 전용 리스너 (해제 안 함 — 계속 보여야 함)
    const playerContainer = document.getElementById("spectator-player-messages")
    if (playerContainer && !_unsubPlayer) {
      const playerRef = collection(db, "raid", ROOM_ID, "chat")
      const playerQ   = gameStartedAt > 0
        ? query(playerRef, orderBy("ts"), where("ts", ">=", gameStartedAt))
        : query(playerRef, orderBy("ts"))
      _unsubPlayer = onSnapshot(playerQ, snap => {
        snap.docs.forEach(d => {
          if (renderedPlayer.has(d.id)) return
          renderedPlayer.add(d.id)
          const { nickname, text } = d.data()
          appendMessage(playerContainer, nickname, text, "player-readonly")
        })
      })
    }

    // 관전자 채팅 리스너
    const spectatorContainer = document.getElementById("spectator-chat-messages")
    if (spectatorContainer && !_unsubSpectator) {
      const spectRef = collection(db, "raid", ROOM_ID, "spectator_chat")
      const spectQ   = gameStartedAt > 0
        ? query(spectRef, orderBy("ts"), where("ts", ">=", gameStartedAt))
        : query(spectRef, orderBy("ts"))
      _unsubSpectator = onSnapshot(spectQ, snap => {
        snap.docs.forEach(d => {
          if (renderedSpectator.has(d.id)) return
          renderedSpectator.add(d.id)
          const { nickname, text } = d.data()
          appendMessage(spectatorContainer, nickname, text, "spectator")
        })
      })
    }

    async function sendSpectatorChat() {
      const input = document.getElementById("spectator-chat-input")
      if (!input) return
      const text = input.value.trim()
      if (!text) return
      const nickname = window.__myDisplayName ?? myUid.slice(0, 6)
      await addDoc(collection(db, "raid", ROOM_ID, "spectator_chat"), { uid: myUid, nickname, text, ts: Date.now() })
      input.value = ""
    }

    const sendBtn = document.getElementById("spectator-chat-send-btn")
    if (sendBtn) sendBtn.onclick = sendSpectatorChat
    const inputEl = document.getElementById("spectator-chat-input")
    if (inputEl) {
      inputEl.onkeypress = e => { if (e.key === "Enter") sendSpectatorChat() }
    }
  }

  // 초기 모드 설정
  if (isSpectator) {
    setupSpectatorMode()
  } else {
    setupPlayerMode()
  }

  // raid.js에서 호출 가능하게 전역 노출
  window.__switchChatMode = function(status) {
    if (status === "spectator" || status === "bench") {
      setupSpectatorMode()
    } else {
      setupPlayerMode()
    }
  }
}