const https = require('https');

// ────────────────────────────────────────────────────────────
// 환경 변수
// ────────────────────────────────────────────────────────────
const WEBHOOK_URL       = process.env.DISCORD_WEBHOOK;
const GITHUB_TOKEN      = process.env.GITHUB_TOKEN      || '';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || '';

// 알림 받을 Discord User ID 목록 (스페이스 구분)
// 예: "123456789012345678 987654321098765432"
const USER_IDS = (process.env.DISCORD_USER_IDS || '').trim().split(/\s+/).filter(Boolean);

if (!WEBHOOK_URL) {
  console.log('ℹ️  DISCORD_WEBHOOK이 설정되지 않아 알림을 건너뜁니다.');
  process.exit(0);
}

// ────────────────────────────────────────────────────────────
// 하루 기준: KST 06:30 ~ 다음날 06:29
// ────────────────────────────────────────────────────────────
const KST_OFFSET    = 9 * 60 * 60 * 1000;
const DAY_START_MIN = 6 * 60 + 30;

function toGameDateString(isoOrDate) {
  const kst = new Date(new Date(isoOrDate).getTime() + KST_OFFSET);
  const minutesOfDay = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  if (minutesOfDay < DAY_START_MIN) kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10);
}

const todayKST = toGameDateString(new Date());

// ────────────────────────────────────────────────────────────
// 커밋 메시지 파싱
// ────────────────────────────────────────────────────────────
const PATTERNS = [
  // 백준허브 프로그래머스 실제 형식: [level 0] Title: 홀짝 구분하기, Time: ...
  { re: /^\[level\s*(\d+)\]\s*Title:\s*(.+?),\s*Time:/im, parse: m => ({ title: m[2].trim(), level: m[1] }) },
  { re: /\[프로그래머스\]\s*(.+?)\s*\/\s*난이도\s*:\s*Level\s*(\d+)/im, parse: m => ({ title: m[1].trim(), level: m[2] }) },
  { re: /\[Programmers?\]\s*(.+?)\s*\/\s*난이도\s*:\s*Level\s*(\d+)/im, parse: m => ({ title: m[1].trim(), level: m[2] }) },
  { re: /\[Programmers?\]\s*(.+?)(?:\s*[-–]\s*Lv\.?\s*(\d+))?$/im,      parse: m => ({ title: m[1].trim(), level: m[2] || null }) },
  { re: /programmers?\s*:\s*(.+?)(?:\s+lv\.?\s*(\d+))?$/im,              parse: m => ({ title: m[1].trim(), level: m[2] || null }) },
  { re: /프로그래머스\s+(?:Lv\.?\s*(\d+)\s+)?(.+)$/im,                   parse: m => ({ title: m[2].trim(), level: m[1] || null }) },
  // 범용: [무언가] 로 시작하는 커밋
  { re: /^\[([^\]]+)\]\s*(.+)/im,                                         parse: m => ({ title: m[2].trim(), level: null, tag: m[1].trim() }) },
];

function parseProgrammersCommit(message) {
  for (const { re, parse } of PATTERNS) {
    const m = message.match(re);
    if (m) return parse(m);
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// GitHub API: 오늘 프로그래머스 커밋 수 조회
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
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) return 0;

  const sinceUTC = new Date(new Date(todayKST).getTime() - KST_OFFSET +
    DAY_START_MIN * 60 * 1000).toISOString();

  let page = 1, count = 0;
  while (true) {
    const { status, body } = await httpsGet(
      `https://api.github.com/repos/${GITHUB_REPOSITORY}/commits?per_page=100&page=${page}&since=${sinceUTC}`,
      { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
    );
    if (status !== 200) { console.warn(`⚠️  GitHub API 오류 (${status})`); break; }

    const commits = JSON.parse(body);
    if (!Array.isArray(commits) || commits.length === 0) break;

    for (const c of commits) {
      const msg  = c.commit?.message || '';
      const date = c.commit?.author?.date || c.commit?.committer?.date || '';
      if (date && toGameDateString(date) === todayKST && parseProgrammersCommit(msg)) count++;
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
  const DAILY_GOAL = 2;
  const todayCount = await fetchTodayProgrammersCount();

  console.log(`📊 오늘(${todayKST}) 현황: ${todayCount}/${DAILY_GOAL}`);

  // 목표 달성했으면 알림 없이 종료
  if (todayCount >= DAILY_GOAL) {
    console.log('✅ 목표 달성 — 알림 없음');
    process.exit(0);
  }

  const remaining = DAILY_GOAL - todayCount;
  const mentions  = USER_IDS.map(id => `<@${id}>`).join(' ');

  const messages = [
    `😴 아직 ${remaining}문제 남았어요!`,
    `📚 오늘 코테 ${remaining}문제 더 풀어야 해요!`,
    `⏰ 자정 전에 ${remaining}문제 채워봐요!`,
  ];
  const randomMsg = messages[Math.floor(Math.random() * messages.length)];

  const embed = {
    title: '🚨 오늘 코딩테스트 목표 미달성!',
    color: 0xED4245, // 빨강
    description: `${mentions}\n\n${randomMsg}`,
    fields: [
      {
        name: '📊 오늘 현황',
        value: `${todayCount}/${DAILY_GOAL}문제 완료\n${'🟩'.repeat(todayCount)}${'⬜'.repeat(DAILY_GOAL - todayCount)}`,
        inline: false,
      },
      {
        name: '⏰ 마감',
        value: '내일 오전 06:30 KST',
        inline: true,
      },
      {
        name: '💪 남은 문제',
        value: `${remaining}문제`,
        inline: true,
      },
    ],
    footer: { text: `KST ${todayKST} 기준 • 하루 목표: ${DAILY_GOAL}문제` },
    timestamp: new Date().toISOString(),
  };

  const payload = JSON.stringify({
    content: mentions ? `${mentions} 👀` : undefined,
    embeds: [embed],
  });

  try {
    await sendWebhook(WEBHOOK_URL, payload);
    console.log(`🔔 미달성 알림 전송 완료 (${todayCount}/${DAILY_GOAL})`);
  } catch (err) {
    console.error('❌ Discord 전송 실패:', err.message);
    process.exit(1);
  }
})();
