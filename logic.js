// 순수 로직 (DOM·저장소 무관) — life/logic.py 와 같은 규칙. node --test 로 검증.

// ── 날짜 (KST 고정, 'YYYY-MM-DD' 문자열로 다룸) ─────────────
const KST_MS = 9 * 3600 * 1000;
export const nowKST = (ms = Date.now()) => new Date(ms + KST_MS);          // UTC getter = KST 값
export const todayISO = (ms = Date.now()) => nowKST(ms).toISOString().slice(0, 10);
export const nowMin = (ms = Date.now()) => { const d = nowKST(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const addDays = (iso, n) => new Date(toUTC(iso) + n * 86400000).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / 86400000);   // a − b
export const weekday = (iso) => new Date(toUTC(iso)).getUTCDay();                 // 0=일
export const WEEKDAY_KO = '일월화수목금토';
export const isValidISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;

export function dday(iso, today) {
  if (!iso) return '';
  const n = diffDays(iso, today);
  return n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `D+${-n} 지남`;
}

export function ago(isoTime, ms = Date.now()) {
  const h = (ms - Date.parse(isoTime)) / 3600000;
  return h < 1 ? `${Math.max(0, Math.floor(h * 60))}분 전` : h < 48 ? `${Math.floor(h)}시간 전` : `${Math.floor(h / 24)}일 전`;
}

// ── 1. 하루 조각 자동 배치 ─────────────────────────────────
export const hmToMin = (hm) => { const [h, m] = hm.trim().split(':').map(Number); return h * 60 + m; };
export const minToHm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export const blockLabel = (b) => `${minToHm(b.start)}–${minToHm(b.end)}`;

/** 기상·식사·취침 사이 빈 시간에 조각을 순서대로 채운다. 안 들어가면 다음 빈 창으로 이어 붙인다. */
export function buildSchedule(pattern, pieces) {
  const wake = hmToMin(pattern.wake);
  let sleep = hmToMin(pattern.sleep);
  if (sleep <= wake) sleep += 1440;
  const meal = Number(pattern.mealMinutes ?? 60);

  const fixed = [];
  for (const [key, name] of [['breakfast', '🍚 아침'], ['lunch', '🍱 점심'], ['dinner', '🍽️ 저녁']]) {
    if (!pattern[key]) continue;
    let s = hmToMin(pattern[key]);
    if (s < wake) s += 1440;
    const st = Math.max(s, wake), en = Math.min(s + meal, sleep);
    if (st < en) fixed.push({ start: st, end: en, name, kind: 'fixed' });
  }
  fixed.sort((a, b) => a.start - b.start);

  const windows = [];
  let cur = wake;
  for (const f of fixed) { if (f.start > cur) windows.push([cur, f.start]); cur = Math.max(cur, f.end); }
  if (cur < sleep) windows.push([cur, sleep]);

  const placed = [];
  let wi = 0, overflow = 0;
  for (const p of pieces) {
    let need = Number(p.minutes), first = true;
    while (need > 0) {
      while (wi < windows.length && windows[wi][0] >= windows[wi][1]) wi++;
      if (wi >= windows.length) { overflow += need; break; }
      const w = windows[wi], take = Math.min(need, w[1] - w[0]);
      placed.push({ start: w[0], end: w[0] + take, name: first ? p.name : `${p.name} (이어서)`, kind: 'piece', pieceId: p.id, base: p.name });
      w[0] += take; need -= take; first = false;
    }
  }
  const free = windows.filter(([s, e]) => e > s).map(([s, e]) => ({ start: s, end: e, name: '여백', kind: 'free' }));
  const blocks = [...fixed, ...placed, ...free].sort((a, b) => a.start - b.start || a.end - b.end);
  return { blocks, overflow };
}

export function currentBlock(blocks, min) {
  for (const t of [min, min + 1440]) for (const b of blocks) if (b.start <= t && t < b.end) return { block: b, t };
  return null;
}

// ── 2. 분량 나누기 ─────────────────────────────────────────
/** total을 작업일에 고르게. 마지막 buffer일은 0(마무리 버퍼). 나머지는 앞쪽에. */
export function splitPlan(total, start, days, skipWeekends = false, bufferDays = 0) {
  total = Math.floor(total); days = Math.floor(days);
  if (total <= 0 || days <= 0) return [];
  const work = [];
  for (let d = start; work.length < days; d = addDays(d, 1)) {
    const wd = weekday(d);
    if (!(skipWeekends && (wd === 0 || wd === 6))) work.push(d);
  }
  bufferDays = Math.max(0, Math.min(bufferDays, days - 1));
  const active = days - bufferDays, base = Math.floor(total / active), rem = total % active;
  let cum = 0;
  return work.map((date, i) => {
    const amount = i >= active ? 0 : base + (i < rem ? 1 : 0);
    cum += amount;
    return { date, amount, cum };
  });
}
export const defaultBuffer = (days) => (days >= 4 ? Math.max(1, Math.ceil(days * 0.15)) : 0);

// ── 3. 실제 속도 기반 완료 예상일 ──────────────────────────
export function eta(total, done, start, today, target) {
  const remaining = Math.max(total - done, 0);
  const elapsed = Math.max(diffDays(today, start) + 1, 1);
  const pace = done / elapsed;
  const r = { remaining, pace, pct: total ? done / total : 0, eta: null, slackDays: null, needPace: null };
  if (remaining === 0) r.eta = today;
  else if (pace > 0) r.eta = addDays(today, Math.ceil(remaining / pace));
  if (target) {
    const left = diffDays(target, today);
    r.needPace = left > 0 ? remaining / left : null;
    if (r.eta) r.slackDays = diffDays(target, r.eta);
  }
  return r;
}

// ── 4. 마무리 연속 일수 ────────────────────────────────────
export function streak(doneDays, today) {
  let d = doneDays.has(today) ? today : addDays(today, -1), n = 0;
  while (doneDays.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// ── 5. 민감정보 가드 (자격증명·고위험 개인정보 저장 차단) ──────
const luhnOk = (digits) => {
  let s = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = +digits[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    s += n; alt = !alt;
  }
  return s % 10 === 0;
};
const SECRET = [
  ['API Key (Anthropic/OpenAI)', /\bsk-(?:ant-)?[A-Za-z0-9_\-]{16,}/],
  ['AWS Access Key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub 토큰', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['Slack 토큰', /\bxox[abprs]-[A-Za-z0-9\-]{10,}/],
  ['Google API Key', /\bAIza[0-9A-Za-z_\-]{30,}/],
  ['개인키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT 토큰', /\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]+/],
  ['비밀번호/키 값', /(비밀번호|비번|패스워드|password|passwd|pwd|api[_\- ]?key|secret|token|토큰|시크릿)\s*[:=]\s*\S{4,}/i],
  ['인증번호', /(인증번호|OTP|otp)\s*[:=]?\s*\d{4,8}\b/],
  ['주민등록번호', /\b\d{6}\s?-\s?[1-4]\d{6}\b/],
];

export function detectSensitive(text) {
  if (!text) return [];
  text = String(text);
  const found = new Set(SECRET.filter(([, re]) => re.test(text)).map(([n]) => n));
  for (const m of text.matchAll(/\b(?:\d[ \-]?){13,19}\b/g)) {
    const d = m[0].replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhnOk(d)) { found.add('카드번호'); break; }
  }
  for (const m of text.matchAll(/\b\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,4})?\b/g)) {
    const s = m[0];
    if (/^01[016789]-\d{3,4}-\d{4}$/.test(s) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) continue;
    if (s.replace(/\D/g, '').length >= 10) { found.add('계좌번호'); break; }
  }
  return [...found].sort();
}

export class SensitiveError extends Error {}
export function guard(...texts) {
  const hits = [...new Set(texts.filter(Boolean).flatMap(detectSensitive))].sort();
  if (hits.length) throw new SensitiveError(`민감정보로 보이는 내용이 있어 저장하지 않았어요: ${hits.join(', ')} → 지우거나 마스킹(예: ****)한 뒤 다시 저장하세요.`);
}

// ── 6. Claude 위임 (프롬프트 ↔ JSON) ───────────────────────
export const PLAN_SCHEMA_HINT = '{"tasks": [{"date": "YYYY-MM-DD", "title": "할 일 (40자 이내)", "why": "왜 하는지 한 줄"}]}';

export function planPrompt({ project, goal, start, deadline, minutesPerDay, context = '' }) {
  return `너는 내 프로젝트 플래너야. 나는 ENFP라 아이디어는 많고 마무리가 약해.
아래 프로젝트를 마감까지 '매일 한 조각'으로 끝낼 수 있게 현실적으로 쪼개줘.

- 프로젝트: ${project}
- 완료 조건(이게 되면 끝): ${goal}
- 기간: ${start} ~ ${deadline}
- 하루 투입 가능 시간: ${minutesPerDay}분
${context ? `- 참고 맥락: ${context}\n` : ''}
규칙:
1. 하루 1~3개, 각 할 일은 ${minutesPerDay}분 안에 끝나는 크기로.
2. 마지막 15% 기간은 '마무리 버퍼'로 비우거나 검토·공유 작업만 넣어.
3. 중간에 '중간 산출물 공유' 체크포인트를 최소 1번 넣어.
4. 새 기능 아이디어는 넣지 말고 완료 조건 달성에만 집중.

출력은 아래 JSON 하나만, 설명 없이:
${PLAN_SCHEMA_HINT}`;
}

export function contentPrompt(entries, audience) {
  const body = entries.map(([d, t]) => `- ${d}: ${t}`).join('\n') || '- (기록 없음)';
  return `아래는 내 최근 한 줄 일기·작업 기록이야.
이걸 소재로 '${audience}' 대상 콘텐츠(강의 꼭지·인스타툰·짧은 글) 아이디어 5개를 뽑아줘.
각 아이디어: 제목 / 핵심 메시지 1줄 / 근거가 된 기록 날짜 / 30분 안에 만들 수 있는 첫 단계.
끝에 '이번 주에 하나만 고른다면' 추천 1개와 이유를 붙여줘.

${body}`;
}

export function parsePlanJson(raw, maxTasks = 120) {
  const m = /\{[\s\S]*\}/.exec(raw || '');
  if (!m) throw new Error('JSON 객체({ ... })를 찾지 못했어요.');
  let data;
  try { data = JSON.parse(m[0]); } catch (e) { throw new Error(`JSON 형식 오류: ${e.message}`); }
  const tasks = data && typeof data === 'object' ? data.tasks : null;
  if (!Array.isArray(tasks) || !tasks.length) throw new Error('"tasks" 배열이 비어 있거나 없어요.');
  if (tasks.length > maxTasks) throw new Error(`할 일이 ${tasks.length}개 — ${maxTasks}개 이하로 줄여달라고 다시 요청하세요.`);
  const out = tasks.map((t, i) => {
    if (!t || typeof t !== 'object') throw new Error(`${i + 1}번째 항목이 객체가 아니에요.`);
    const date = String(t.date ?? '').trim(), title = String(t.title ?? '').trim(), why = String(t.why ?? '').trim();
    if (!isValidISO(date)) throw new Error(`${i + 1}번째 날짜 형식 오류: "${date}" (YYYY-MM-DD)`);
    if (!title) throw new Error(`${i + 1}번째 title이 비어 있어요.`);
    return { date, title: title.slice(0, 200), why: why.slice(0, 300) };
  });
  guard(...out.map((x) => `${x.title} ${x.why}`));
  return out;
}

// ── 7. worklog / brain 렌더 (붙여넣기 형식) ─────────────────
export const WORKLOG_SECTIONS = [
  ['완성', '완성한 것 (적용까지 끝)'],
  ['보관', '만들었지만 보관 위치만 정하면 되는 것'],
  ['다음', '다음 세션에서 할 것'],
];
const line = ([tag, what, why]) => `- ${tag ? `[${tag}] ` : ''}${what}${why ? ` — ${why}` : ''}`;

/** items: {완성|보관|다음: [[tag, 무엇, 왜]]} → 날짜 아래 3단. 빈 단은 생략. */
export function renderWorklog(day, items) {
  const lines = [`## ${day}`];
  for (const [key, title] of WORKLOG_SECTIONS) {
    const rows = items[key] || [];
    if (!rows.length) continue;
    lines.push('', `### ${title}`, ...rows.map(line));
  }
  if (lines.length === 1) lines.push('', '(기록 없음)');
  return lines.join('\n') + '\n';
}

/** brain 환원 재료 — 파일명·경로·태그·frontmatter 없음 (PC의 Claude Code 담당). */
export function renderBrain(notes) {
  const blocks = notes.map((n) => {
    const b = [`# ${n.title}`, '', (n.summary || '').trim(), ''];
    if ((n.body || '').trim()) b.push(n.body.trim(), '');
    b.push('## 환원 메모 (Code용)',
      `- 성격: ${n.nature || ''}`,
      `- 출처: ${n.source || 'claude.ai 대화'}`,
      `- 신뢰도: ${n.confidence || ''}`,
      `- 영문 요약(1문장): ${n.enSummary || ''}`,
      `- 관련어: ${n.keywords || ''}`);
    if (n.sensitive) b.push('- ⚠️ 민감: 민감(인물/조직)');
    return b.join('\n');
  });
  return '```markdown\n' + blocks.join('\n\n---\n\n') + '\n```\n';
}
