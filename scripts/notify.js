const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ────────────────────────────────────────────────────────────
// 환경 변수
// ────────────────────────────────────────────────────────────
const WEBHOOK_URL       = process.env.DISCORD_WEBHOOK;
const COMMIT_MSG        = process.env.COMMIT_MESSAGE       || '';
const COMMITTER         = process.env.COMMITTER_NAME       || 'Unknown';
const USERNAME          = process.env.COMMITTER_USERNAME   || 'Unknown';
const REPO_NAME         = process.env.REPO_NAME            || '';
const REPO_URL          = process.env.REPO_URL             || '';
const COMMIT_URL        = process.env.COMMIT_URL           || '';
const COMMITS_JSON      = process.env.COMMITS_JSON         || '[]';
const GITHUB_TOKEN      = process.env.GITHUB_TOKEN         || '';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY   || '';
const STREAK_FILE       = path.join(process.env.STREAK_CACHE_DIR || '.', 'streak.json');

if (!WEBHOOK_URL) {
  console.log('ℹ️  DISCORD_WEBHOOK이 설정되지 않아 알림을 건너뜁니다.');
  process.exit(0);
}

// ────────────────────────────────────────────────────────────
// 커밋 메시지 파싱
// 백준허브 프로그래머스 형식:
//   [프로그래머스] 문제제목 / 난이도: Level X / 걸린시간: X분
//   [Programmers] 문제제목 / 난이도: Level X
// 수동 커밋 형식도 지원:
//   [Programmers] 문제제목 - Lv.1
//   programmers: 문제제목 lv2
// ────────────────────────────────────────────────────────────
const PATTERNS = [
  // 백준허브 자동 커밋: [프로그래머스] 두 수의 합 / 난이도: Level1 / 걸린시간: 10분
  {
    re: /\[프로그래머스\]\s*(.+?)\s*\/\s*난이도\s*:\s*Level\s*(\d+)/im,
    parse: m => ({ title: m[1].trim(), level: m[2] }),
  },
  // 백준허브 자동 커밋 (영문): [Programmers] 두 수의 합 / 난이도: Level1
  {
    re: /\[Programmers?\]\s*(.+?)\s*\/\s*난이도\s*:\s*Level\s*(\d+)/im,
    parse: m => ({ title: m[1].trim(), level: m[2] }),
  },
  // 수동: [Programmers] 문제 - Lv.1
  {
    re: /\[Programmers?\]\s*(.+?)(?:\s*[-–]\s*Lv\.?\s*(\d+))?$/im,
    parse: m => ({ title: m[1].trim(), level: m[2] || null }),
  },
  // 수동: programmers: 문제 lv2
  {
    re: /programmers?\s*:\s*(.+?)(?:\s+lv\.?\s*(\d+))?$/im,
    parse: m => ({ title: m[1].trim(), level: m[2] || null }),
  },
  // 수동: 프로그래머스 Lv1 문제
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

// ────────────────────────────────────────────────────────────
// 프로그래머스 문제 검색 링크
// ────────────────────────────────────────────────────────────
function getProgrammersSearchUrl(title) {
  if (!title) return 'https://programmers.co.kr/learn/challenges';
  return `https://programmers.co.kr/learn/challenges?q=${encodeURIComponent(title)}`;
}

// ────────────────────────────────────────────────────────────
// KST 날짜 유틸
// 하루 기준: KST 06:30 ~ 다음날 06:29
// 예) 06:29 → 전날로 집계 / 06:30 → 오늘로 집계
// ────────────────────────────────────────────────────────────
const KST_OFFSET    = 9 * 60 * 60 * 1000;
const DAY_START_MIN = 6 * 60 + 30; // 06:30 (분 단위)

/**
 * 주어진 시각이 속하는 "코딩테스트 날짜"를 YYYY-MM-DD로 반환합니다.
 * KST 06:30 이전이면 전날 날짜로 취급합니다.
 */
function toGameDateString(isoOrDate) {
  const kst = new Date(new Date(isoOrDate).getTime() + KST_OFFSET);
  const minutesOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  // 06:30 미만이면 하루 빼기
  if (minutesOfDay < DAY_START_MIN) {
    kst.setUTCDate(kst.getUTCDate() - 1);
  }
  return kst.toISOString().slice(0, 10);
}

// 하위 호환용 alias
const toKSTDateString = toGameDateString;

const todayKST = toGameDateString(new Date());

// ────────────────────────────────────────────────────────────
// 스트릭 관리
// ────────────────────────────────────────────────────────────
function loadStreak() {
  try {
    if (fs.existsSync(STREAK_FILE))
      return JSON.parse(fs.readFileSync(STREAK_FILE, 'utf8'));
  } catch {
    console.warn('⚠️  스트릭 파일 로드 실패, 초기화합니다.');
  }
  return { lastAchievedDate: null, currentStreak: 0, maxStreak: 0 };
}

function saveStreak(data) {
  try {
    const dir = path.dirname(STREAK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STREAK_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('⚠️  스트릭 저장 실패:', e.message);
  }
}

function dayDiff(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

function updateStreak() {
  const streak = loadStreak();
  if (streak.lastAchievedDate === todayKST) return streak;

  const diff = streak.lastAchievedDate ? dayDiff(streak.lastAchievedDate, todayKST) : null;
  streak.currentStreak = diff === 1 ? streak.currentStreak + 1 : 1;
  streak.lastAchievedDate = todayKST;
  streak.maxStreak = Math.max(streak.maxStreak, streak.currentStreak);
  saveStreak(streak);
  return streak;
}

function getStreakEmoji(n) {
  if (n >= 30) return '🏆';
  if (n >= 14) return '💎';
  if (n >= 7)  return '🔥';
  if (n >= 3)  return '⚡';
  return '✨';
}

// ────────────────────────────────────────────────────────────
// GitHub API: 오늘 KST 기준 전체 프로그래머스 커밋 수
// ────────────────────────────────────────────────────────────
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'programmers-discord-bot', ...headers },
      },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function fetchTodayProgrammersCount() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.warn('⚠️  GitHub API 사용 불가 → 이번 push 기준으로만 집계합니다.');
    return null;
  }
  const sinceUTC = new Date(new Date(todayKST).getTime() - KST_OFFSET).toISOString();
  let page = 1, count = 0;

  while (true) {
    const { status, body } = await httpsGet(
      `https://api.github.com/repos/${GITHUB_REPOSITORY}/commits?per_page=100&page=${page}&since=${sinceUTC}`,
      { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
    );
    if (status !== 200) { console.warn(`⚠️  GitHub API 오류 (${status})`); return null; }

    const commits = JSON.parse(body);
    if (!Array.isArray(commits) || commits.length === 0) break;

    for (const c of commits) {
      const msg  = c.commit?.message || '';
      const date = c.commit?.author?.date || c.commit?.committer?.date || '';
      if (date && toKSTDateString(date) === todayKST && parseProgrammersCommit(msg)) count++;
    }
    if (commits.length < 100) break;
    page++;
  }
  return count;
}

// ────────────────────────────────────────────────────────────
// Discord Webhook 전송
// ────────────────────────────────────────────────────────────
function sendWebhook(url, data) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () =>
          res.statusCode >= 200 && res.statusCode < 300
            ? resolve(body)
            : reject(new Error(`HTTP ${res.statusCode}: ${body}`))
        );
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ────────────────────────────────────────────────────────────
// 메인
// ────────────────────────────────────────────────────────────
(async () => {
  // 1) 이번 push 커밋 파싱
  let allCommits = [];
  try { allCommits = JSON.parse(COMMITS_JSON); }
  catch { allCommits = [{ message: COMMIT_MSG, author: { name: COMMITTER } }]; }

  const parsedProblems = allCommits
    .map(c => ({ raw: c.message, parsed: parseProgrammersCommit(c.message) }))
    .filter(c => c.parsed !== null && c.parsed.title); // 제목이 있는 것만

  if (parsedProblems.length === 0) {
    console.log('ℹ️  프로그래머스 관련 커밋이 없어 알림을 건너뜁니다.');
    process.exit(0);
  }

  // 2) 오늘 누적 카운트
  const DAILY_GOAL = 2;
  let todayCount = await fetchTodayProgrammersCount();
  if (todayCount === null) {
    todayCount = allCommits.filter(c => {
      const ts = c.timestamp || c.authored_date || new Date().toISOString();
      return toKSTDateString(ts) === todayKST && parseProgrammersCommit(c.message);
    }).length;
  }

  const goalAchieved = todayCount >= DAILY_GOAL;
  const justAchieved = goalAchieved && (todayCount - parsedProblems.length) < DAILY_GOAL;

  // 3) 스트릭 업데이트
  let streakData = loadStreak();
  if (goalAchieved) streakData = updateStreak();

  // 4) Embed 구성
  const LEVEL_COLORS = {
    '1': 0x57F287, '2': 0xFEE75C, '3': 0xE67E22, '4': 0xED4245, '5': 0x9B59B6,
  };
  const embedColor = goalAchieved
    ? (LEVEL_COLORS[parsedProblems[0].parsed.level] || 0x5865F2)
    : 0x95A5A6;

  const goalLine = !goalAchieved
    ? `⏳ 오늘 진행 중: **${todayCount}/${DAILY_GOAL}문제** — ${DAILY_GOAL - todayCount}문제 남았어요!`
    : todayCount === DAILY_GOAL
      ? `✅ **오늘 문제를 전부 풀었어요!** (${todayCount}/${DAILY_GOAL}문제)`
      : `🎯 **오늘 총 ${todayCount}문제를 풀었어요!** (목표 ${DAILY_GOAL}문제 초과 달성)`;

  // 문제 목록 (링크 포함)
  const problemListValue = parsedProblems.map(({ parsed }) => {
    const level = parsed.level ? ` (Lv.${parsed.level})` : '';
    const link  = getProgrammersSearchUrl(parsed.title);
    return `• [${parsed.title}](${link})${level}`;
  }).join('\n') || '(문제 없음)';

  // 스트릭
  const streakEmoji = getStreakEmoji(streakData.currentStreak);
  const streakValue = goalAchieved
    ? `${streakEmoji} **${streakData.currentStreak}일** 연속 달성 중! (최고: ${streakData.maxStreak}일)`
    : `현재 스트릭: ${streakData.currentStreak}일 (최고: ${streakData.maxStreak}일)`;

  const embed = {
    title: '📝 프로그래머스 문제 풀이',
    color: embedColor,
    url: COMMIT_URL || undefined,
    description: goalLine,
    fields: [
      { name: '🧩 이번 커밋 문제', value: problemListValue, inline: false },
      { name: '🔥 스트릭',         value: streakValue,       inline: false },
      {
        name:   '👤 커밋한 사람',
        value:  `[${COMMITTER} (@${USERNAME})](https://github.com/${USERNAME})`,
        inline: true,
      },
      {
        name:   '📁 저장소',
        value:  REPO_URL ? `[${REPO_NAME}](${REPO_URL})` : REPO_NAME,
        inline: true,
      },
    ],
    footer: { text: `KST ${todayKST} 기준 • 하루 목표: ${DAILY_GOAL}문제` },
    timestamp: new Date().toISOString(),
  };

  const content = justAchieved ? `🎉 **${COMMITTER}**님이 오늘 목표를 달성했습니다!` : undefined;
  const payload = JSON.stringify({ ...(content && { content }), embeds: [embed] });

  // 5) 전송
  try {
    await sendWebhook(WEBHOOK_URL, payload);
    console.log('✅ Discord 알림 전송 완료');
    console.log(`📊 오늘 현황: ${todayCount}/${DAILY_GOAL}${goalAchieved ? ' 🎉' : ''}`);
    console.log(`🔥 스트릭: ${streakData.currentStreak}일 (최고: ${streakData.maxStreak}일)`);
  } catch (err) {
    console.error('❌ Discord 전송 실패:', err.message);
    process.exit(1);
  }
})();
