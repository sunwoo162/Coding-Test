/**
 * 로컬 테스트용 스크립트
 * node scripts/test-local.js
 */

const PATTERNS = [
  {
    re: /\[프로그래머스\]\s*(.+?)\s*\/\s*난이도\s*:\s*Level\s*(\d+)/im,
    parse: m => ({ title: m[1].trim(), level: m[2] }),
  },
  {
    re: /\[Programmers?\]\s*(.+?)\s*\/\s*난이도\s*:\s*Level\s*(\d+)/im,
    parse: m => ({ title: m[1].trim(), level: m[2] }),
  },
  {
    re: /\[Programmers?\]\s*(.+?)(?:\s*[-–]\s*Lv\.?\s*(\d+))?$/im,
    parse: m => ({ title: m[1].trim(), level: m[2] || null }),
  },
  {
    re: /programmers?\s*:\s*(.+?)(?:\s+lv\.?\s*(\d+))?$/im,
    parse: m => ({ title: m[1].trim(), level: m[2] || null }),
  },
  {
    re: /프로그래머스\s+(?:Lv\.?\s*(\d+)\s+)?(.+)$/im,
    parse: m => ({ title: m[2].trim(), level: m[1] || null }),
  },
];

function parseProgrammersCommit(message) {
  for (const { re, parse } of PATTERNS) {
    const m = message.match(re);
    if (m) return parse(m);
  }
  return null;
}

// 하루 기준: KST 06:30 ~ 다음날 06:29
const KST_OFFSET    = 9 * 60 * 60 * 1000;
const DAY_START_MIN = 6 * 60 + 30;

function toGameDateString(isoOrDate) {
  const kst = new Date(new Date(isoOrDate).getTime() + KST_OFFSET);
  const minutesOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (minutesOfDay < DAY_START_MIN) kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
}

function getProgrammersSearchUrl(title) {
  if (!title) return 'https://programmers.co.kr/learn/challenges';
  return `https://programmers.co.kr/learn/challenges?q=${encodeURIComponent(title)}`;
}

function getStreakEmoji(n) {
  if (n >= 30) return '🏆';
  if (n >= 14) return '💎';
  if (n >= 7)  return '🔥';
  if (n >= 3)  return '⚡';
  return '✨';
}

// ── 테스트 케이스 ──────────────────────────────────────────
const testCases = [
  // 백준허브 자동 커밋 형식
  '[프로그래머스] 두 수의 합 / 난이도: Level1 / 걸린시간: 5분',
  '[프로그래머스] 소수 찾기 / 난이도: Level2 / 걸린시간: 20분',
  '[Programmers] 카펫 / 난이도: Level2',
  // 수동 커밋 형식
  '[Programmers] 체육복 - Lv.1',
  'programmers: 완전탐색 lv2',
  // 프로그래머스 아님
  'feat: 일반 기능 추가',
  'Add solution for BOJ 1234',
];

console.log('=== 커밋 메시지 파싱 테스트 ===\n');
let count = 0;

for (const msg of testCases) {
  const result = parseProgrammersCommit(msg);
  if (result) {
    count++;
    const level = result.level ? `Lv.${result.level}` : '레벨 없음';
    const link  = getProgrammersSearchUrl(result.title);
    console.log(`✅ "${msg}"`);
    console.log(`   → 제목: "${result.title}" | 난이도: ${level}`);
    console.log(`   → 링크: ${link}\n`);
  } else {
    console.log(`⏭️  "${msg}" → 건너뜀\n`);
  }
}

const DAILY_GOAL = 2;
console.log('=== 목표 체크 ===');
console.log(`오늘 프로그래머스 커밋: ${count}개`);
console.log(count >= DAILY_GOAL ? `🎉 목표 달성! (${count}/${DAILY_GOAL})` : `⏳ ${count}/${DAILY_GOAL} — ${DAILY_GOAL - count}개 남음`);

console.log('\n=== 스트릭 이모지 ===');
[1, 3, 7, 14, 30].forEach(n => console.log(`${n}일: ${getStreakEmoji(n)} ${n}일 연속`));

// ── 날짜 경계 테스트 (06:30 기준) ────────────────────────
console.log('\n=== 날짜 경계 테스트 (KST 06:30 기준) ===');
const boundaryTests = [
  { label: '오전 06:29 KST (전날로 집계)', utc: getUTCfromKST(6, 29) },
  { label: '오전 06:30 KST (오늘로 집계)', utc: getUTCfromKST(6, 30) },
  { label: '오전 00:00 KST (전날로 집계)', utc: getUTCfromKST(0, 0)  },
  { label: '오후 23:59 KST (오늘로 집계)', utc: getUTCfromKST(23, 59) },
];

function getUTCfromKST(h, m) {
  const now = new Date();
  now.setUTCHours(h - 9, m, 0, 0); // KST → UTC
  return now;
}

const todayGame = toGameDateString(new Date());
boundaryTests.forEach(({ label, utc }) => {
  const gameDate = toGameDateString(utc);
  const marker   = gameDate === todayGame ? '← 오늘' : '← 전날';
  console.log(`  ${label}: ${gameDate} ${marker}`);
});
