// lib/bossMoves.js

export const bossMoves = {
  // ── 앱솔 기술 ──────────────────────────────────────────────────
  "악의파동": {
    power: 45, type: "악", accuracy: 100, alwaysHit: true,
    effect: { chance: 0.2, volatile: "풀죽음" },
    aoe: true
  },
  "할퀴기": {
    power: 35, type: "노말", accuracy: 100, alwaysHit: true,
    effect: null,
    aoe: true
  },
  "물기": {
    power: 50, type: "악", accuracy: 100, alwaysHit: true,
    effect: { chance: 0.3, volatile: "풀죽음" }
  },

  // ── 앱솔 ult ───────────────────────────────────────────────────
  "기습": {
    power: 50, type: "악", accuracy: 100, alwaysHit: true,
    effect: null,
    ult: true
  },

  // ── 비퀸 직접 공격 ──────────────────────────────────────────────
  "독침":      { power: 50, type: "독",   accuracy: 100, alwaysHit: true },
  "시저크로스": { power: 45, type: "벌레", accuracy: 100, alwaysHit: true, aoe: true },
  "달려들기":  { power: 50, type: "벌레", accuracy: 100, alwaysHit: true },
  "벌레의저항": { power: 60, type: "벌레", accuracy: 100, alwaysHit: true, aoe: true },

  // ── 비퀸 독침붕 기술 ────────────────────────────────────────────
  "마구찌르기": {
    power: 1, type: "노말", accuracy: 85, alwaysHit: false,
    multiHit: { min: 2, max: 5, fixedDamage: 20 },
  },

  // ── 대여르 기술 ──────────────────────────────────────────────────
  "인파이트": {
    power: 70, type: "격투", accuracy: 100, alwaysHit: true,
    selfDefDown: { amount: -1, turns: 2 },
  },
  "스톤샤워": {
    power: 50, type: "바위", accuracy: 100, alwaysHit: true,
    aoe: true,
  },
  "사념의박치기": {
    power: 70, type: "에스퍼", accuracy: 100, alwaysHit: true,
    effect: { chance: 0.2, volatile: "풀죽음" },
    ult: true,
  },
  "배수의진": {
    power: 0, type: "격투", accuracy: 100, alwaysHit: true,
    unitSwap: true,
  },

  // ── 캥카 기술 ──────────────────────────────────────────────────────
  "누르기":       { power: 85,  type: "노말", accuracy: 100, alwaysHit: true },
  "깨트리기":     { power: 75,  type: "격투", accuracy: 100, alwaysHit: true, breakBarrier: true },
  "깨물어부수기": { power: 80,  type: "악",   accuracy: 100, alwaysHit: true },
  "아이언테일":   { power: 100, type: "강철", accuracy: 100, alwaysHit: true },
  "번개펀치":     { power: 75,  type: "전기", accuracy: 100, alwaysHit: true },
  "냉동펀치":     { power: 75,  type: "얼음", accuracy: 100, alwaysHit: true },
  "불꽃펀치":     { power: 75,  type: "불",   accuracy: 100, alwaysHit: true },

  // ── 누리레느 기술 ────────────────────────────────────────────────
  "파도타기": {
    power: 60, type: "물", alwaysHit: true,
    aoe: true,
  },
  "차밍보이스": {
    power: 45, type: "페어리", alwaysHit: true,
    effect: { seduce: true, chance: 1.0 },
  },
  "하이드로펌프": {
    power: 60, type: "물", alwaysHit: true,
  },
  "생명의물방울": {
    power: 0, type: "물", alwaysHit: true,
    effect: { heal: 0.20 },
    targetSelf: true,
  },
  "헤롱헤롱": {
    power: 0, type: "노말", alwaysHit: true,
    effect: { charm: true },
  },
  "문포스": {
    power: 70, type: "페어리", alwaysHit: true,
    aoe: true,
  },
  // ── 더스트나 기술 ────────────────────────────────────────────────
  "독가스": {
    power: 0, type: "독", accuracy: 100, alwaysHit: true,
    effect: { corrosion: true },
  },
  "오물웨이브": {
    power: 85, type: "독", accuracy: 100, alwaysHit: true,
    aoe: true,
  },
  "HP회복": {
    power: 0, type: "노말", accuracy: 100, alwaysHit: true,
    effect: { heal: 0.23 },
    targetSelf: true,
  },
  "베놈쇼크": {
    power: 65, type: "독", accuracy: 100, alwaysHit: true,
    aoe: true,
    venomShock: true,
  },
  "부패폭발": {
    power: 0, type: "독", accuracy: 100, alwaysHit: true,
    ult: true,
    corrosionBlast: true,
  },

  // ── 마폭시 기술 ────────────────────────────────────────────────────
  "도깨비불": {
    power: 0, type: "불", alwaysHit: true,
    effect: { status: "낙인" },
  },
  "리플렉터": {
    power: 0, type: "에스퍼", alwaysHit: true,
    targetSelf: true,
    reflector: true,
  },
  "환상빔": {
    power: 90, type: "에스퍼", alwaysHit: true,
  },
  "매지컬플레임": {
    power: 90, type: "불", alwaysHit: true,
  },
 
  // ── 마폭시 ult ─────────────────────────────────────────────────────
  "속임수": {
    power: 0, type: "악", alwaysHit: true,
    ult: true,
    trickery: true,
  },
  "봉인": {
    power: 0, type: "에스퍼", alwaysHit: true,
    ult: true,
    seal: true,
  },
  "질투의불꽃": {
    power: 0, type: "불", alwaysHit: true,
    ult: true,
    brandBlast: true,
  },
  "트릭": {
    power: 0, type: "에스퍼", alwaysHit: true,
    ult: true,
    hpShuffle: true,
  },
  "미래예지": {
    power: 0, type: "에스퍼", alwaysHit: true,
    ult: true,
    prophecy: true,
  },

  // ── 칼라마네로 기술 ──────────────────────────────────────────────────────
"이상한빛": {
  power: 0, type: "고스트", accuracy: 100, alwaysHit: true,
  effect: { status: "현혹" },
},
"나쁜음모": {
  power: 0, type: "악", accuracy: 100, alwaysHit: true,
  effect: null,
},
"바꿔치기": {
  power: 0, type: "악", accuracy: 100, alwaysHit: true,
  effect: null,
  ult: true,
},
"사이코쇼크": {
  power: 20, type: "에스퍼", accuracy: 100, alwaysHit: true,
  effect: null,
},


"파괴충동": {
  power: 90, type: "노말", accuracy: 100, alwaysHit: true,
  aoe: true,
},
"돌진": {
  power: 90, type: "노말", accuracy: 100, alwaysHit: true,
  recoil: 0.25,
},
"이판사판태클": {
  power: 120, type: "노말", accuracy: 100, alwaysHit: true,
  recoil: 0.30,
},
"블러드문": {
  power: 140, type: "노말", accuracy: 100, alwaysHit: true,
},
"광폭화": {
  power: 0, type: "노말", accuracy: 100, alwaysHit: true,
},

}