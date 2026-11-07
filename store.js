// 상태 + 규칙 (WIP 한도·완료 조건·숙성·가드) + 기기 간 병합.
// 저장은 이 기기의 localStorage 한 키 — 외부 전송 없음. 폰↔PC는 동기화 파일을 '받아서 합치기'.
//
// 병합 규칙: 기록마다 고유 id + 수정시각 u. 같은 id면 더 최근 것이 이김.
// 삭제는 deleted[id]에 시각을 남겨 다른 기기에도 전파. 날짜별 값(일기·몸·오늘의 1개·체크)과
// 설정·조각·문장은 mu['종류:키'] 수정시각으로 비교.
import { guard, todayISO, addDays } from './logic.js';

export const KEY = 'maemuri.v2';
const VERSION = 2;

export const DEFAULT_PIECES = [
  ['☀️ 아침루틴', 60, ['공복 몸무게 기록', '스트레칭 10분', '어제 worklog 다시 보기', '오늘의 마무리 1개 고르기']],
  ['📊 딥워크·분석', 120, ['전날 데이터 정리', '리포트 이상치 체크', '결과물 팀 공유']],
  ['💬 커뮤니케이션', 120, ['Slack·메일 몰아서 확인', '회신 몰아서 처리']],
  ['🎤 강의·창작', 90, ['오늘 한 줄 일기에서 소재 1개', '강의자료 한 조각 완성']],
  ['🏃 몸·운동', 60, ['운동 기록', '영양제']],
  ['🧹 잡무', 45, ['결제·구독 정리', '파일 정리']],
  ['🛋️ 휴식', 60, []],
  ['🌙 오늘 정리', 15, ['완료 체크', 'worklog 복사해서 붙여넣기', '내일 마무리 1개 정하기']],
];

export const DEFAULT_QUOTES = [
  '완벽보다 완료.', '시작은 발산, 끝은 수렴.', '오늘 끝낼 1개만 고르면 된다.',
  '새 아이디어는 인박스로. 지금 일은 끝까지.', '작게 끝내고, 크게 반복하라.',
  '80%에서 공유하면 나머지 20%는 피드백이 채운다.', '열린 고리가 많을수록 머리는 무겁다. 하나 닫자.',
];

export const BODY_PARTS = ['하체', '상체', '어깨', '등', '코어', '유산소', '요가·스트레칭'];

const COLLECTIONS = ['projects', 'tasks', 'ideas', 'trackers', 'worklog', 'brain', 'links'];
const DAY_MAPS = ['journal', 'body', 'focus'];
const WHOLE = ['settings', 'pieces', 'quotes'];

export function freshState() {
  return {
    v: VERSION,
    settings: {
      wake: '07:00', breakfast: '07:30', lunch: '12:00', dinner: '18:30', sleep: '00:30', mealMinutes: 60,
      wipLimit: 3, coolingHours: 48, tags: ['업무', '강의', '사이드', '시스템', '개인'],
    },
    // 기본 조각 id는 고정 — 두 기기의 기본값이 같은 조각으로 인식되게
    pieces: DEFAULT_PIECES.map(([name, minutes, checklist], i) => ({ id: `p${i + 1}`, name, minutes, checklist })),
    checks: {}, projects: [], tasks: [], focus: {}, ideas: [], trackers: [], body: {},
    journal: {}, worklog: [], brain: [], quotes: [...DEFAULT_QUOTES], links: [],
    mu: {}, deleted: {}, lastBackup: null, lastSync: null,
  };
}

const nowIso = () => new Date().toISOString();
let lastStamp = 0;
/** 수정시각(ms). 같은 ms에 여러 번 바꿔도 순서가 보존되게 단조 증가. */
const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));
export const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const touch = (s, key) => { s.mu[key] = stamp(); };
const bump = (x) => { x.u = stamp(); return x; };
const tomb = (s, id) => { s.deleted[id] = stamp(); };
export class RuleError extends Error {}

// ── 영속화 ────────────────────────────────────────────────
export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d?.v === VERSION) return { ...freshState(), ...d };
    }
  } catch { /* 손상 시 새로 시작 — 동기화 파일로 복원 가능 */ }
  return freshState();
}
export function save(storage, s) { storage.setItem(KEY, JSON.stringify(s)); }

export function exportJSON(s) { return JSON.stringify({ ...s, app: 'maemuri', exportedAt: nowIso() }); }
// ── 가져오기 검문 (동기화 파일은 남이 보낸 파일일 수도 있다고 가정) ───────
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MU_RE = /^(?:settings|pieces|quotes|(?:journal|body|focus):\d{4}-\d{2}-\d{2}|checks:\d{4}-\d{2}-\d{2}:[A-Za-z0-9_-]{1,40})$/;
export const isSafeUrl = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (Number.isFinite(x) ? x : 0);
const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
const dict = (o, keyOk, valOk) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([k, v]) => keyOk(k) && valOk(v)));
const records = (a, extra = () => true) => (Array.isArray(a) ? a : []).filter((r) => isObj(r) && typeof r.id === 'string' && ID_RE.test(r.id) && extra(r))
  .map((r) => ({ ...r, ...('u' in r ? { u: num(r.u) } : {}), ...('created' in r ? { created: typeof r.created === 'string' ? r.created : nowIso() } : {}) }));

/** 형식이 맞는 것만 남긴다: 위험 키 제거, id·날짜·링크·숫자 검사. 버려진 건 조용히 무시. */
function sanitize(d) {
  const f = freshState();
  const set = isObj(d.settings) ? d.settings : {};
  return {
    ...f,
    settings: {
      ...f.settings,
      ...Object.fromEntries(['wake', 'breakfast', 'lunch', 'dinner', 'sleep'].filter((k) => typeof set[k] === 'string' && /^(\d{2}:\d{2})?$/.test(set[k])).map((k) => [k, set[k]])),
      ...Object.fromEntries(['mealMinutes', 'wipLimit', 'coolingHours'].filter((k) => Number.isFinite(set[k]) && set[k] >= 0 && set[k] <= 1440).map((k) => [k, set[k]])),
      ...(Array.isArray(set.tags) ? { tags: strs(set.tags).slice(0, 30) } : {}),
    },
    pieces: Array.isArray(d.pieces) ? records(d.pieces).map((p) => ({ id: p.id, name: String(p.name ?? ''), minutes: num(p.minutes), checklist: strs(p.checklist) })) : f.pieces,
    quotes: Array.isArray(d.quotes) ? strs(d.quotes) : f.quotes,
    projects: records(d.projects),
    tasks: records(d.tasks, (t) => t.projectId == null || (typeof t.projectId === 'string' && ID_RE.test(t.projectId))),
    ideas: records(d.ideas),
    trackers: records(d.trackers).map((t) => ({ ...t, logs: records(t.logs, (g) => DAY_RE.test(g.day) && Number.isFinite(g.amount)) })),
    worklog: records(d.worklog, (w) => DAY_RE.test(w.day) && ['완성', '보관', '다음'].includes(w.section)),
    brain: records(d.brain, (n) => DAY_RE.test(n.day)),
    links: records(d.links, (l) => isSafeUrl(l.url)),
    journal: dict(d.journal, (k) => DAY_RE.test(k), (v) => typeof v === 'string'),
    focus: dict(d.focus, (k) => DAY_RE.test(k), (v) => typeof v === 'string' && ID_RE.test(v)),
    body: dict(d.body, (k) => DAY_RE.test(k), isObj),
    checks: dict(d.checks, (k) => DAY_RE.test(k), isObj),
    mu: dict(d.mu, (k) => MU_RE.test(k), Number.isFinite),
    deleted: dict(d.deleted, (k) => ID_RE.test(k), Number.isFinite),
    lastBackup: typeof d.lastBackup === 'string' && DAY_RE.test(d.lastBackup) ? d.lastBackup : null,
    lastSync: typeof d.lastSync === 'string' && DAY_RE.test(d.lastSync) ? d.lastSync : null,
  };
}

export function parseExport(raw) {
  let d;
  // reviver로 __proto__·constructor·prototype 키를 파싱 단계에서 버린다 (프로토타입 오염 차단)
  try { d = JSON.parse(raw, (k, v) => (BAD_KEYS.has(k) ? undefined : v)); } catch { throw new RuleError('파일 내용을 읽지 못했어요. 마무리 다이어리에서 내보낸 파일인지 확인하세요.'); }
  if (!isObj(d) || d.app !== 'maemuri' || d.v !== VERSION || !Array.isArray(d.tasks)) throw new RuleError('마무리 다이어리 동기화 파일이 아니에요.');
  const clean = sanitize(d);
  for (const [day, byPiece] of Object.entries(clean.checks)) clean.checks[day] = dict(byPiece, (k) => ID_RE.test(k), Array.isArray);
  return clean;
}

// ── 기기 간 병합 ───────────────────────────────────────────
const newer = (x, y) => ((y.u || 0) > (x.u || 0) ? y : x);

/** local + remote → 합친 새 상태. local은 바꾸지 않는다. 반환 {state, added, updated}. */
export function merge(local, remote) {
  const out = structuredClone(local);
  let added = 0, updated = 0;
  for (const [id, t] of Object.entries(remote.deleted || {})) if (ID_RE.test(id)) out.deleted[id] = Math.max(out.deleted[id] || 0, t);
  const alive = (x) => !(out.deleted[x.id] >= (x.u || 0));

  for (const c of COLLECTIONS) {
    const map = new Map(out[c].map((x) => [x.id, x]));
    for (const r of remote[c] || []) {
      const l = map.get(r.id);
      if (!l) { map.set(r.id, r); if (alive(r)) added++; continue; }
      let win = newer(l, r);
      if (c === 'trackers') {   // 진행 기록은 양쪽 합집합
        const logs = new Map([...(l.logs || []), ...(r.logs || [])].map((g) => [g.id, g]));
        win = { ...win, logs: [...logs.values()].sort((a, b) => a.day.localeCompare(b.day)) };
      }
      if (JSON.stringify(win) !== JSON.stringify(l)) updated++;
      map.set(r.id, win);
    }
    out[c] = [...map.values()].filter(alive);
  }
  out.ideas.sort((a, b) => b.created.localeCompare(a.created));

  const pick = (key, lv, rv, has) => {
    const tl = local.mu[key] || 0, tr = remote.mu?.[key] || 0;
    out.mu[key] = Math.max(tl, tr);
    if (tr > tl) { if (JSON.stringify(lv) !== JSON.stringify(rv)) updated++; return [rv, has]; }
    return [lv, null];
  };
  for (const m of DAY_MAPS) {
    const keys = new Set([...Object.keys(local[m]), ...Object.keys(remote[m] || {}),
      ...Object.keys(remote.mu || {}).filter((k) => k.startsWith(`${m}:`)).map((k) => k.slice(m.length + 1))]);
    for (const k of keys) {
      if (!DAY_RE.test(k)) continue;
      const [v, fromRemote] = pick(`${m}:${k}`, local[m][k], remote[m]?.[k], true);
      if (fromRemote) { if (v === undefined) delete out[m][k]; else out[m][k] = v; }
    }
  }
  const checkKeys = new Set([...Object.keys(remote.mu || {}), ...Object.keys(local.mu)].filter((k) => k.startsWith('checks:')));
  for (const k of checkKeys) {
    const [, day, pid] = k.split(':');
    if (!DAY_RE.test(day) || !ID_RE.test(pid ?? '')) continue;
    const [v, fromRemote] = pick(k, local.checks[day]?.[pid], remote.checks?.[day]?.[pid], true);
    if (fromRemote) (out.checks[day] ||= {})[pid] = v || [];
  }
  for (const w of WHOLE) {
    const [v, fromRemote] = pick(w, local[w], remote[w], true);
    if (fromRemote && v !== undefined) out[w] = structuredClone(v);
  }
  out.lastBackup = [local.lastBackup, remote.lastBackup].filter(Boolean).sort().at(-1) || null;
  out.lastSync = todayISO();
  return { state: out, added, updated };
}

// ── 설정 / 조각 ───────────────────────────────────────────
export function setSettings(s, patch) {
  guard(...Object.values(patch).flat().map(String));
  Object.assign(s.settings, patch);
  touch(s, 'settings');
}
export function setPieces(s, items) {
  items = items.filter((p) => p.name.trim() && p.minutes > 0);
  guard(...items.flatMap((p) => [p.name, ...p.checklist]));
  s.pieces = items.map((p) => ({ id: p.id || nid(), name: p.name.trim(), minutes: Math.round(p.minutes), checklist: p.checklist.map((c) => c.trim()).filter(Boolean) }));
  touch(s, 'pieces');
}
export const checked = (s, day, pid) => new Set(s.checks[day]?.[pid] || []);
export function toggleCheck(s, day, pid, item, on) {
  const d = (s.checks[day] ||= {}), set = new Set(d[pid] || []);
  on ? set.add(item) : set.delete(item);
  d[pid] = [...set];
  touch(s, `checks:${day}:${pid}`);
}

// ── 프로젝트 / 할 일 ───────────────────────────────────────
export const wipCount = (s, exclude) => s.projects.filter((p) => p.status === '진행' && p.id !== exclude).length;
function checkWip(s, exclude) {
  const n = wipCount(s, exclude), lim = s.settings.wipLimit;
  if (n >= lim) throw new RuleError(`진행 중 프로젝트가 이미 ${n}/${lim}개예요. 하나를 끝내거나 보류한 뒤 시작하세요.`);
}
export function addProject(s, { name, tag, status = '대기', due = null, dod = '' }) {
  guard(name, dod);
  if (!name.trim()) throw new RuleError('이름을 적어주세요.');
  if (status === '진행') {
    checkWip(s);
    if (!dod.trim()) throw new RuleError("'진행'으로 시작하려면 완료 조건(여기까지 하면 끝)을 먼저 적어주세요.");
  }
  const p = bump({ id: nid(), name: name.trim(), tag, status, due: due || null, dod: dod.trim(), created: nowIso(), doneAt: null });
  s.projects.push(p);
  return p;
}
export const project = (s, id) => s.projects.find((p) => p.id === id);
export function setProjectStatus(s, id, status) {
  const p = project(s, id);
  if (status === '진행') {
    checkWip(s, id);
    if (!p.dod.trim()) throw new RuleError('완료 조건이 비어 있어요. 먼저 적어주세요.');
  }
  p.status = status;
  p.doneAt = status === '완료' ? nowIso() : null;
  bump(p);
}
export function deleteProject(s, id) {
  for (const t of s.tasks.filter((t) => t.projectId === id)) tomb(s, t.id);
  tomb(s, id);
  s.projects = s.projects.filter((p) => p.id !== id);
  s.tasks = s.tasks.filter((t) => t.projectId !== id);
}

const STATUS_ORDER = { 진행: 0, 대기: 1, 보류: 2, 완료: 3 };
export function projectsSorted(s) {
  return [...s.projects].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || (a.due ? 0 : 1) - (b.due ? 0 : 1) || String(a.due).localeCompare(String(b.due)) || a.created.localeCompare(b.created));
}
export function projectStats(s, id) {
  const ts = s.tasks.filter((t) => t.projectId === id);
  const doneAts = ts.map((t) => t.doneAt).filter(Boolean).sort();
  return { n: ts.length, done: ts.filter((t) => t.done).length, lastDone: doneAts.at(-1) || null };
}

export function addTask(s, { title, projectId = null, due = null, why = '', tag = '' }) {
  guard(title, why);
  if (!title.trim()) throw new RuleError('할 일을 적어주세요.');
  const t = bump({ id: nid(), projectId, title: title.trim(), why: why.trim(), tag, due: due || null, done: false, doneAt: null, created: nowIso() });
  s.tasks.push(t);
  return t;
}
export function addTasksBulk(s, projectId, items) {
  guard(...items.map((i) => `${i.title} ${i.why || ''}`));
  for (const i of items) addTask(s, { title: i.title, why: i.why || '', due: i.date, projectId });
  return items.length;
}
export function setTaskDone(s, id, done) {
  const t = s.tasks.find((x) => x.id === id);
  t.done = done;
  t.doneAt = done ? nowIso() : null;
  bump(t);
}
export function deleteTask(s, id) { tomb(s, id); s.tasks = s.tasks.filter((t) => t.id !== id); }

/** 할 일 + 프로젝트명·태그(프로젝트 태그 우선) */
export function taskView(s, t) {
  const p = t.projectId ? project(s, t.projectId) : null;
  return { ...t, project: p?.name || '', tag: p?.tag || t.tag || '', projectStatus: p?.status || null };
}
const byDue = (a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || String(a.due).localeCompare(String(b.due)) || a.created.localeCompare(b.created);

/** 오늘까지(지난 것 포함) 열린 할 일 + 날짜 없는 할 일 — 진행 프로젝트 것 또는 프로젝트 없는 것. */
export function tasksDue(s, upto) {
  return s.tasks.map((t) => taskView(s, t))
    .filter((t) => !t.done && (!t.projectStatus || t.projectStatus === '진행') && (!t.due || t.due <= upto))
    .sort(byDue);
}
export const tasksOf = (s, pid) => s.tasks.filter((t) => t.projectId === pid).map((t) => taskView(s, t)).sort((a, b) => a.done - b.done || byDue(a, b));
const localDay = (iso) => (iso ? new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10) : null);   // KST 날짜
export const tasksDoneOn = (s, day) => s.tasks.filter((t) => t.done && localDay(t.doneAt) === day).map((t) => taskView(s, t));
export const projectsDoneOn = (s, day) => s.projects.filter((p) => p.status === '완료' && localDay(p.doneAt) === day);

export function getFocus(s, day) {
  const id = s.focus[day];
  const t = id && s.tasks.find((x) => x.id === id);
  return t ? taskView(s, t) : null;
}
export function setFocus(s, day, id) {
  if (id) s.focus[day] = id; else delete s.focus[day];
  touch(s, `focus:${day}`);
}
export function focusDoneDays(s) {
  const out = new Set();
  for (const [day, id] of Object.entries(s.focus)) {
    const t = s.tasks.find((x) => x.id === id);
    if (t?.done && localDay(t.doneAt) === day) out.add(day);
  }
  return out;
}

/** 7일 넘게 손 안 댄 진행 프로젝트 */
export function coldProjects(s, today) {
  const cutoff = addDays(today, -7);
  return s.projects.filter((p) => p.status === '진행' && (localDay(projectStats(s, p.id).lastDone) || localDay(p.created)) <= cutoff);
}

// ── 아이디어 ──────────────────────────────────────────────
export function addIdea(s, text, tag) {
  guard(text);
  if (!text.trim()) throw new RuleError('내용을 적어주세요.');
  s.ideas.unshift(bump({ id: nid(), text: text.trim(), tag, status: '인박스', created: nowIso() }));
}
export const ideaAgeH = (i, ms = Date.now()) => (ms - Date.parse(i.created)) / 3600000;
export function promoteIdea(s, id, ms = Date.now()) {
  const i = s.ideas.find((x) => x.id === id);
  if (ideaAgeH(i, ms) < s.settings.coolingHours) throw new RuleError(`아직 숙성 중이에요. ${s.settings.coolingHours}시간 뒤에도 설레면 그때!`);
  const p = addProject(s, { name: i.text.slice(0, 60), tag: i.tag, status: '대기' });
  i.status = '승격';
  bump(i);
  return p;
}
export function setIdeaStatus(s, id, status) { bump(Object.assign(s.ideas.find((x) => x.id === id), { status })); }

// ── 트래커 ─────────────────────────────────────────────────
export function addTracker(s, { name, unit, total, start, target }) {
  guard(name, unit);
  if (!name.trim() || !(total > 0)) throw new RuleError('이름과 총량을 적어주세요.');
  s.trackers.push(bump({ id: nid(), name: name.trim(), unit: unit.trim() || '개', total: +total, start, target: target || null, archived: false, logs: [] }));
}
export const trackerDone = (tr) => tr.logs.reduce((a, l) => a + l.amount, 0);
export function logTracker(s, id, day, amount) {
  if (!(amount > 0)) throw new RuleError('0보다 큰 분량을 적어주세요.');
  const tr = s.trackers.find((t) => t.id === id);
  tr.logs.push({ id: nid(), day, amount: +amount });
  bump(tr);
}
export function archiveTracker(s, id) { bump(Object.assign(s.trackers.find((t) => t.id === id), { archived: true })); }

// ── 몸 / 일기 / worklog / brain / 링크 / 문장 ──────────────
export function saveBody(s, day, { weight, parts, note }) {
  guard(note);
  s.body[day] = { weight: weight || null, parts, note: (note || '').trim() };
  touch(s, `body:${day}`);
}
export function saveJournal(s, day, text) {
  guard(text);
  if (text.trim()) s.journal[day] = text.trim(); else delete s.journal[day];
  touch(s, `journal:${day}`);
}
export const journalRecent = (s, upto, n = 7) => Object.entries(s.journal).filter(([d]) => d <= upto).sort().slice(-n);

export function addWorklogItem(s, day, { section, tag, what, why }) {
  guard(what, why);
  if (!what.trim()) throw new RuleError('무엇을 했는지 적어주세요.');
  s.worklog.push(bump({ id: nid(), day, section, tag, what: what.trim(), why: (why || '').trim() }));
}
export function deleteWorklogItem(s, id) { tomb(s, id); s.worklog = s.worklog.filter((w) => w.id !== id); }

export function addBrainNote(s, day, note) {
  guard(...Object.values(note).map(String));
  if (!note.title.trim()) throw new RuleError('제목을 적어주세요.');
  s.brain.push(bump({ id: nid(), day, ...note }));
}
export function deleteBrainNote(s, id) { tomb(s, id); s.brain = s.brain.filter((n) => n.id !== id); }

export function addLink(s, name, url) {
  url = url.trim();
  if (!/^https:\/\/[^\s]+$/.test(url)) throw new RuleError('https:// 로 시작하는 링크만 저장해요.');
  guard(name, url);
  s.links.push(bump({ id: nid(), name: name.trim() || url, url }));
}
export function deleteLink(s, id) { tomb(s, id); s.links = s.links.filter((l) => l.id !== id); }

export function setQuotes(s, list) {
  list = list.map((q) => q.trim()).filter(Boolean);
  guard(...list);
  s.quotes = list;
  touch(s, 'quotes');
}

/** 오늘 정리용 자동 수집: 완료 할 일·프로젝트 + 직접 추가 + (오늘이면) 내일 할 일·못 끝낸 1개 */
export function collectWorklog(s, day, today = todayISO()) {
  const items = { 완성: [], 보관: [], 다음: [] };
  for (const t of tasksDoneOn(s, day)) items.완성.push([t.tag, t.project ? `${t.project}: ${t.title}` : t.title, t.why]);
  for (const p of projectsDoneOn(s, day)) items.완성.push([p.tag, `${p.name} 프로젝트 완료`, p.dod]);
  for (const w of s.worklog.filter((x) => x.day === day)) items[w.section].push([w.tag, w.what, w.why]);
  if (day === today) {
    const f = getFocus(s, day);
    if (f && !f.done) items.다음.push([f.tag, `${f.title} 마무리`, '오늘의 1개였는데 못 끝냄 → 내일 1순위']);
    const tmr = addDays(day, 1);
    for (const t of s.tasks.map((x) => taskView(s, x)).filter((t) => !t.done && t.due === tmr && t.id !== f?.id)) {
      items.다음.push([t.tag, t.project ? `${t.project}: ${t.title}` : t.title, t.why]);
    }
  }
  return items;
}
