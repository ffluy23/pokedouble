// api/raidSwap.js
// 40인 레이드 바톤터치 교대 처리
// 클라이언트에서 절대 직접 처리하지 말 것 → race condition 방지
import { db } from "../lib/firestore.js"
import { corsHeaders } from "../lib/gameUtils.js"

const PLAYER_SLOTS = ["p1", "p2", "p3"]

export default async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v))
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST")   return res.status(405).end()

  const { roomId, fromSlot, fromUid } = req.body
  if (!roomId || !fromSlot || !fromUid)
    return res.status(400).json({ error: "파라미터 부족" })
  if (!PLAYER_SLOTS.includes(fromSlot))
    return res.status(400).json({ error: "잘못된 슬롯" })

  const roomRef = db.collection("raid").doc(roomId)

  // ── Firestore 트랜잭션으로 원자적 처리 ──────────────────────────
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(roomRef)
      const data = snap.data()
      if (!data) throw new Error("방 없음")
      if (!data.game_started) throw new Error("게임 시작 전")
      if (data.game_over)     throw new Error("게임 종료됨")

      // 요청자가 실제로 해당 슬롯에 있는지 확인
      if (data[`${fromSlot}_uid`] !== fromUid)
        throw new Error("슬롯 불일치")

      // 교대 잠금 확인
      if (data.swap_lock)
        throw new Error("현재 교대 불가 (잠금 상태)")

      // 내 턴이면 교대 불가 (턴 끝나고 교대해야 함)
      const currentOrder = data.current_order ?? []
      if (currentOrder[0] === fromSlot)
        throw new Error("내 턴 중에는 교대 불가")

      // 벤치 확인
      const bench = data.bench ?? []
      if (bench.length === 0)
        throw new Error("대기 중인 플레이어 없음")

      // ── 교대 실행 ────────────────────────────────────────────────
      // bench[0]이 다음 교대자 (joinedAt 기준 정렬되어 있음)
      const next      = bench[0]
      const newBench  = bench.slice(1)

      // 나간 사람을 벤치 맨 뒤에 추가 (다음 번엔 뒤에서 다시 대기)
      const outgoing = {
        uid:      fromUid,
        name:     data[`${fromSlot}_name`] ?? fromUid.slice(0, 6),
        joinedAt: Date.now(),  // 맨 뒤로 밀림
        entry:    data[`${fromSlot}_entry`] ?? [],
        ready:    false,       // 교대 후 레디 초기화
      }

      // 들어오는 사람 엔트리 (벤치에 저장해뒀던 것 or 빈 배열)
      const incomingEntry = (next.entry ?? []).map(p => ({
        ...p,
        // HP 풀 회복 없음 — 벤치에 저장된 현재 HP 그대로
        maxHp: p.maxHp ?? p.hp,
      }))

      const update = {
        // 슬롯 교체
        [`${fromSlot}_uid`]:        next.uid,
        [`${fromSlot}_name`]:       next.name,
        [`${fromSlot}_entry`]:      incomingEntry,
        [`${fromSlot}_active_idx`]: 0,
        [`${fromSlot}_ready`]:      true,  // 벤치에서 레디한 상태
        [`${fromSlot}_last_move`]:  null,
        [`${fromSlot}_total_damage`]: data[`${fromSlot}_total_damage`] ?? 0,
        // 나간 사람의 딜은 유지됨 (outgoing에는 기록 안 하지만 필요시 확장 가능)

        // 벤치 업데이트: 나간 사람 맨 뒤에 추가
        bench: [...newBench, outgoing],

        // 교대 완료 처리
        swap_request: null,
        swap_lock:    false,
      }

      tx.update(roomRef, update)
    })

    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error("교대 오류:", e.message)
    return res.status(400).json({ error: e.message })
  }
}