// 🍰 마무리 다이어리 — 화면. 사용자 입력은 전부 textContent로만 넣는다 (innerHTML 미사용).
import * as L from './logic.js';
import * as S from './store.js';

const $ = (id) => document.getElementById(id);
const STATUS_ICON = { 진행: '🔥', 대기: '⏳', 보류: '🧊', 완료: '🏁' };

let st = S.load(localStorage);
let view = 'today';
const ui = { recordsTab: 'tracker', wrapDay: null, wrapWeek: false, quoteSeed: null, openNew: false };

// ── DOM 헬퍼 ──────────────────────────────────────────────
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'open' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const svgNS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); el.append(...kids); return el; };
const card = (props, ...kids) => h('section', { class: 'card', ...props }, ...kids);
const select = (opts, value, props = {}) => h('select', props, opts.map((o) => {
  const [v, label] = Array.isArray(o) ? o : [o, o];
  return h('option', { value: v, selected: String(v) === String(value) }, label);
}));
const bar = (pct) => { const i = h('i'); i.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`; return h('div', { class: 'bar' }, i); };
const tagEl = (t) => (t ? h('span', { class: 'tag' }, t) : null);
const today = () => L.todayISO();

// ── 공통 동작 ──────────────────────────────────────────────
let toastTimer;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show${err ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, err ? 4200 : 2200);
}

/** 상태 변경 → 저장 → 다시 그리기. 규칙 위반·민감정보는 에러 토스트. */
function commit(fn, msg) {
  try { fn(st); } catch (e) { toast(e.message, true); return false; }
  try { S.save(localStorage, st); } catch { toast('저장 공간이 부족해요. 설정에서 백업 후 정리하세요.', true); }
  if (msg) toast(msg);
  render();
  return true;
}

function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 14; i++) {
    const c = h('span', { class: 'confetti' }, ['🎉', '🍰', '✨', '🔥'][i % 4]);
    c.style.left = `${Math.random() * 95}vw`;
    c.style.animationDelay = `${Math.random() * 0.4}s`;
    document.body.append(c);
    setTimeout(() => c.remove(), 2200);
  }
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { value: text });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('복사했어요 📋');
}
const shareBtn = (text, title) => (navigator.share
  ? h('button', { onclick: () => navigator.share({ title, text }).catch(() => {}) }, '↗ 공유') : null);

function openModal(title, body) {
  $('modal-title').textContent = title;
  $('modal-body').replaceChildren(body);
  $('modal').hidden = false;
}
const closeModal = () => { $('modal').hidden = true; $('modal-body').replaceChildren(); };

function download(name, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── 조각 / 일정 ───────────────────────────────────────────
const schedule = () => L.buildSchedule(st.settings, st.pieces);
const hue = (name) => [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

function checklist(piece, day) {
  const done = S.checked(st, day, piece.id);
  return piece.checklist.map((item) => h('label', { class: `check${done.has(item) ? ' done' : ''}` },
    h('input', { type: 'checkbox', checked: done.has(item), onchange: (e) => commit((x) => S.toggleCheck(x, day, piece.id, item, e.target.checked)) }),
    h('span', { class: 'txt' }, item)));
}

function dayTimeline(blocks, nowM, scale = 0.55) {
  const cur = L.currentBlock(blocks, nowM);
  return h('div', { class: 'day' }, blocks.map((b) => {
    const el = h('div', { class: `b ${b.kind}${cur && cur.block === b ? ' now' : ''}${b.end <= nowM ? ' past' : ''}` }, b.name);
    el.style.height = `${Math.max(22, (b.end - b.start) * scale)}px`;
    if (b.kind === 'piece') el.style.background = `hsl(${hue(b.base)} 70% 88%)`, el.style.color = '#2a2230';
    return [h('div', { class: 't' }, L.minToHm(b.start)), el];
  }));
}

// ── 🎯 오늘의 마무리 1개 ───────────────────────────────────
function focusPicker(onDone) {
  const d = today();
  const open = S.tasksDue(st, L.addDays(d, 7));
  const sel = select(open.map((t) => [t.id, t.title + (t.project ? ` · ${t.project}` : '')]), open[0]?.id);
  const quick = h('input', { placeholder: '또는 새로 적기 (예: 강의안 목차 확정)', maxlength: 200 });
  const tag = select(st.settings.tags, st.settings.tags[0]);
  return h('div', { class: 'stack' },
    open.length ? h('div', { class: 'row' }, h('div', { class: 'grow' }, sel),
      h('button', { class: 'primary', onclick: () => commit((x) => S.setFocus(x, d, sel.value), '오늘의 1개를 정했어요. 이것만 끝내도 오늘은 성공 ✨') && onDone?.() }, '이걸로')) : null,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, quick), tag,
      h('button', { onclick: () => commit((x) => { const t = S.addTask(x, { title: quick.value, due: d, tag: tag.value }); S.setFocus(x, d, t.id); }, '새로 적고 오늘의 1개로 정했어요 ✨') && onDone?.() }, '적고 정하기')));
}

function focusCard() {
  const d = today(), f = S.getFocus(st, d);
  if (f?.done) return card({ class: 'card ok' }, h('h2', {}, '🎯 오늘의 마무리 1개'), h('div', { class: 'focus-title' }, f.title), h('p', {}, '끝냈어요! 🎉 오늘은 이미 성공. 남은 건 보너스.'));
  if (f) return card({ class: 'card hero' }, h('h2', {}, '🎯 오늘의 마무리 1개'),
    h('div', { class: 'focus-title' }, f.title),
    h('p', { class: 'muted' }, [tagEl(f.tag), f.project, f.why && ` · ${f.why}`]),
    h('div', { class: 'grid2' },
      h('button', { class: 'primary big', onclick: () => { if (commit((x) => S.setTaskDone(x, f.id, true), `마무리 완료: ${f.title} — 🌙 정리에 자동으로 들어가요`)) celebrate(); } }, '✅ 끝냈다!'),
      h('button', { class: 'big ghost', onclick: () => commit((x) => S.setFocus(x, d, null)) }, '바꾸기')));
  return card({ class: 'card hero' }, h('h2', {}, '🎯 오늘 반드시 끝낼 1개'), h('p', { class: 'muted' }, '10개 계획보다 1개 완료. 딱 하나만 골라요.'), focusPicker());
}

// ── 🏠 오늘 ────────────────────────────────────────────────
function viewToday() {
  const d = today(), nowM = L.nowMin(), out = [];
  if (st.quotes.length) {
    const seed = ui.quoteSeed ?? Number(d.replaceAll('-', ''));
    out.push(h('div', { class: 'quote', title: '눌러서 다른 문장', onclick: () => { ui.quoteSeed = Math.floor(Math.random() * 1e9); render(); } }, `💬 ${st.quotes[seed % st.quotes.length]}`));
  }
  out.push(focusCard());

  const { blocks, overflow } = schedule();
  const cur = L.currentBlock(blocks, nowM);
  const nowCard = card({}, h('div', { class: 'spread' }, h('h2', {}, '⏱️ 지금 조각'), h('button', { class: 'mini ghost', onclick: () => go('pieces') }, '조각 편집')));
  if (cur) {
    const b = cur.block, piece = st.pieces.find((p) => p.id === b.pieceId);
    nowCard.append(h('h3', {}, `${b.name} `, h('span', { class: 'muted' }, L.blockLabel(b))),
      bar((cur.t - b.start) / (b.end - b.start)),
      h('p', { class: 'muted small' }, `남은 시간 약 ${b.end - cur.t}분`));
    if (piece?.checklist.length) nowCard.append(...checklist(piece, d));
    const next = blocks.find((x) => x.start >= b.end && x.kind === 'piece');
    nowCard.append(h('p', { class: 'muted small' }, next ? `다음 → ${next.name} (${L.minToHm(next.start)})` : '오늘 조각은 여기까지 🍰 — 🌙 정리에서 3분만 마무리하기.'));
  } else nowCard.append(h('p', {}, '지금은 수면 시간이에요 💤 내일의 나에게 맡기기.'));
  const all = h('details', {}, h('summary', { class: 'muted small' }, '오늘 전체 조각 보기'), dayTimeline(blocks, nowM, 0.35));
  nowCard.append(all);
  if (overflow) nowCard.append(h('p', { class: 'overdue small' }, `조각 합이 깨어 있는 시간보다 ${overflow}분 넘쳐요 — 조각 편집에서 줄여주세요.`));
  out.push(nowCard);

  const due = S.tasksDue(st, d);
  const qt = h('input', { placeholder: '오늘 할 일 추가', maxlength: 200 }), qtag = select(st.settings.tags, st.settings.tags[0]);
  out.push(card({}, h('h2', {}, '📋 오늘 할 일'),
    due.length ? due.map((t) => taskRow(t)) : h('p', { class: 'muted' }, '오늘 마감인 할 일이 없어요.'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, qt), qtag,
      h('button', { onclick: () => commit((x) => S.addTask(x, { title: qt.value, due: d, tag: qtag.value }), '추가했어요') }, '추가'))));

  const trs = st.trackers.filter((t) => !t.archived);
  if (trs.length) out.push(card({}, h('h2', {}, '📈 진행 중인 분량'), trs.map((tr) => {
    const e = L.eta(tr.total, S.trackerDone(tr), tr.start, d, tr.target);
    return h('div', { class: 'stack' }, h('div', { class: 'spread small' }, h('span', {}, tr.name), h('b', {}, `${(e.pct * 100).toFixed(1)}%`)), bar(e.pct),
      h('p', { class: 'muted small' }, e.eta ? `이 속도면 ${e.eta} 완료${e.slackDays == null ? '' : e.slackDays >= 0 ? ` · 목표보다 ${e.slackDays}일 여유` : ` · ⚠️ 목표보다 ${-e.slackDays}일 늦음`}` : '아직 기록이 없어요'));
  })));

  const cold = S.coldProjects(st, d);
  if (cold.length) out.push(card({ class: 'card warn' }, h('p', {}, `🧊 7일째 손 안 댄 진행 프로젝트: ${cold.map((p) => p.name).join(', ')}`), h('p', { class: 'small' }, '오늘 한 조각 하거나, 솔직하게 보류로 내려두기. 내려놓는 것도 마무리예요.')));

  const hasData = st.tasks.length + st.ideas.length > 5;
  const lastOut = [st.lastBackup, st.lastSync].filter(Boolean).sort().at(-1);
  const since = lastOut ? L.diffDays(d, lastOut) : null;
  if (hasData && (since == null || since >= 7)) out.push(card({ class: 'card warn' }, h('p', { class: 'small' }, `🔄 ${since == null ? '아직 다른 기기로 보낸 적이 없어요' : `동기화한 지 ${since}일`} — 기록은 이 기기에만 있어요. 폰↔PC 한 번 맞춰두기.`), h('button', { class: 'mini', onclick: () => go('settings') }, '동기화하러 가기')));
  return out;
}

function taskRow(t, { showProject = true, del = false } = {}) {
  const d = today(), over = t.due && t.due < d && !t.done;
  return h('label', { class: `check${t.done ? ' done' : ''}` },
    h('input', { type: 'checkbox', checked: t.done, onchange: (e) => commit((x) => S.setTaskDone(x, t.id, e.target.checked)) }),
    h('span', { class: 'txt' }, over ? '🔥 ' : '', tagEl(t.tag), t.title,
      showProject && t.project ? h('span', { class: 'muted small' }, ` · ${t.project}`) : null,
      t.due && (over || !showProject) ? h('span', { class: `small ${over ? 'overdue' : 'muted'}` }, ` · ${over ? L.dday(t.due, d) : t.due}`) : null,
      t.why && !showProject ? h('div', { class: 'muted small' }, t.why) : null),
    del ? h('button', { class: 'mini ghost', 'aria-label': '삭제', onclick: (e) => { e.preventDefault(); commit((x) => S.deleteTask(x, t.id)); } }, '✕') : null);
}

// ── 🍰 조각 편집 ──────────────────────────────────────────
function viewPieces() {
  const set = st.settings;
  const times = ['wake', 'breakfast', 'lunch', 'dinner', 'sleep'].map((k) => [k, h('input', { type: 'time', value: set[k] || '', step: 900 })]);
  const meal = h('input', { type: 'number', min: 15, max: 120, step: 15, value: set.mealMinutes });
  const names = { wake: '기상', breakfast: '아침', lunch: '점심', dinner: '저녁', sleep: '취침' };
  const pattern = card({}, h('h2', {}, '① 내 생활 패턴'), h('p', { class: 'muted small' }, '기상·식사·취침만 넣으면 남는 시간에 조각이 순서대로 자동 배치돼요.'),
    h('div', { class: 'grid2' }, times.map(([k, el]) => h('label', {}, names[k], el)), h('label', {}, '식사(분)', meal)),
    h('p'), h('button', { onclick: () => commit((x) => S.setSettings(x, Object.fromEntries([...times.map(([k, el]) => [k, el.value]), ['mealMinutes', +meal.value || 60]])), '패턴을 저장했어요') }, '패턴 저장'));

  // 편집용 사본
  const draft = st.pieces.map((p) => ({ ...p, checklist: [...p.checklist] }));
  const list = h('div', { class: 'stack' });
  const total = h('p', { class: 'muted small' });
  const drawList = () => {
    list.replaceChildren(...draft.map((p, i) => {
      const name = h('input', { value: p.name, maxlength: 40, oninput: (e) => { p.name = e.target.value; } });
      const min = h('input', { type: 'number', min: 5, max: 600, step: 5, value: p.minutes, oninput: (e) => { p.minutes = +e.target.value; sum(); } });
      const cl = h('textarea', { value: p.checklist.join('\n'), placeholder: '체크리스트 (한 줄에 하나)', oninput: (e) => { p.checklist = e.target.value.split('\n'); } });
      const move = (dir) => { const j = i + dir; if (j < 0 || j >= draft.length) return; [draft[i], draft[j]] = [draft[j], draft[i]]; drawList(); };
      return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, name), h('div', {}, min)), cl,
        h('div', { class: 'row' }, h('button', { class: 'mini', onclick: () => move(-1) }, '↑'), h('button', { class: 'mini', onclick: () => move(1) }, '↓'),
          h('button', { class: 'mini danger', onclick: () => { draft.splice(i, 1); drawList(); } }, '삭제')));
    }));
    sum();
  };
  const sum = () => { const m = draft.reduce((a, p) => a + (+p.minutes || 0), 0); total.textContent = `조각 합계 ${Math.floor(m / 60)}시간 ${m % 60}분`; };
  drawList();
  const pieces = card({}, h('h2', {}, '② 조각 구성'), h('p', { class: 'muted small' }, '위에서부터 순서대로 배치돼요. 체크리스트는 아침 팝업·지금 조각에 나와요.'),
    list, total,
    h('div', { class: 'row' }, h('button', { onclick: () => { draft.push({ id: null, name: '새 조각', minutes: 30, checklist: [] }); drawList(); } }, '＋ 조각 추가'),
      h('button', { class: 'primary', onclick: () => commit((x) => S.setPieces(x, draft), '조각을 저장했어요') }, '조각 저장')));

  const { blocks, overflow } = schedule();
  const result = card({}, h('h2', {}, '③ 오늘 배치 결과'),
    overflow ? h('p', { class: 'overdue' }, `⚠️ 계획 과다: ${overflow}분이 들어갈 자리가 없어요. 하고 싶은 건 많지만 하루는 24시간 😅`) : null,
    dayTimeline(blocks, L.nowMin()));
  return [h('button', { class: 'mini ghost', onclick: () => go('today') }, '← 오늘로'), h('p'), pattern, pieces, result];
}

// ── 📂 프로젝트 ───────────────────────────────────────────
function viewProjects() {
  const lim = st.settings.wipLimit, wip = S.wipCount(st), out = [];
  out.push(card({}, h('div', { class: 'spread' }, h('h2', {}, `🔥 진행 ${wip}/${lim}`), h('button', { class: 'mini', onclick: () => { ui.openNew = !ui.openNew; render(); } }, ui.openNew ? '닫기' : '＋ 새 프로젝트')),
    bar(wip / lim), h('p', { class: 'muted small' }, `동시에 진행은 최대 ${lim}개. '진행'은 완료 조건이 있어야 시작돼요.`),
    ui.openNew ? newProjectForm() : null));

  const all = S.projectsSorted(st);
  const active = all.filter((p) => p.status === '진행' || p.status === '대기');
  const rest = all.filter((p) => p.status === '보류' || p.status === '완료');
  out.push(...active.map(projectCard));
  if (rest.length) out.push(h('p', { class: 'muted small' }, `🧊 보류 · 🏁 완료 (${rest.length})`), ...rest.map(projectCard));
  if (!all.length) out.push(h('p', { class: 'muted' }, '아직 프로젝트가 없어요. 💡 인박스에서 숙성된 아이디어를 승격하거나 위에서 바로 만들어보세요.'));
  return out;
}

function newProjectForm() {
  const name = h('input', { placeholder: '이름', maxlength: 80 }), tag = select(st.settings.tags, st.settings.tags[0]);
  const status = select(['대기', '진행'], '대기'), due = h('input', { type: 'date' });
  const dod = h('textarea', { placeholder: '🏁 완료 조건 — 무엇이 되면 끝? (예: 강의안 PDF 팀 공유 + 신청 10명)' });
  return h('div', { class: 'stack' }, name, h('div', { class: 'grid3' }, tag, status, due), dod,
    h('button', { class: 'primary', onclick: () => { if (commit((x) => S.addProject(x, { name: name.value, tag: tag.value, status: status.value, due: due.value, dod: dod.value }), '프로젝트를 만들었어요')) { ui.openNew = false; render(); } } }, '만들기'));
}

function projectCard(p) {
  const d = today(), stt = S.projectStats(st, p.id);
  const head = h('summary', {}, `${STATUS_ICON[p.status]} `, tagEl(p.tag), h('b', {}, p.name),
    h('span', { class: 'muted small' }, [p.due ? ` · ${L.dday(p.due, d)}` : '', stt.n ? ` · ${stt.done}/${stt.n}` : '']));
  const title = h('input', { placeholder: '할 일', maxlength: 200 }), due = h('input', { type: 'date' }), why = h('input', { placeholder: '왜 (worklog에 들어감)', maxlength: 300 });
  const moves = { 진행: [['🏁 완료', '완료'], ['🧊 보류', '보류']], 대기: [['🔥 진행', '진행'], ['🏁 완료', '완료']], 보류: [['🔥 진행', '진행'], ['🏁 완료', '완료']], 완료: [['↩️ 다시 열기', '대기']] }[p.status];
  const msgs = { 완료: `🏁 ${p.name} 완료! 정리에 자동 기록돼요`, 보류: '보류했어요. 내려놓는 것도 마무리예요', 진행: `🔥 ${p.name} 시작!`, 대기: '다시 열었어요' };
  return h('details', { class: 'card', open: p.status === '진행' }, head,
    stt.n ? bar(stt.done / stt.n) : null,
    h('p', {}, h('b', {}, '🏁 완료 조건: '), p.dod || h('span', { class: 'muted' }, '(비어 있음 — 끝이 안 보이는 프로젝트는 안 끝나요)')),
    S.tasksOf(st, p.id).map((t) => taskRow(t, { showProject: false, del: true })),
    p.status === '진행' && stt.n && stt.done === stt.n ? h('p', { class: 'card ok small' }, '할 일이 전부 끝났어요! 완료 조건을 만족했다면 🏁 완료 처리하세요.') : null,
    p.status !== '완료' ? h('details', {}, h('summary', { class: 'small muted' }, '＋ 할 일 추가'),
      h('div', { class: 'stack' }, title, h('div', { class: 'grid2' }, due, why),
        h('button', { onclick: () => commit((x) => S.addTask(x, { title: title.value, projectId: p.id, due: due.value, why: why.value }), '추가했어요') }, '추가'))) : null,
    h('p'),
    h('div', { class: 'row' },
      moves.map(([label, to]) => h('button', { class: to === '완료' ? 'primary' : '', onclick: () => { if (commit((x) => S.setProjectStatus(x, p.id, to), msgs[to]) && to === '완료') celebrate(); } }, label)),
      p.status !== '완료' ? h('button', { onclick: () => claudeModal(p) }, '🤖 Claude에게 계획') : null,
      h('button', { class: 'danger ghost', onclick: () => { if (confirm(`'${p.name}'와 할 일을 모두 지울까요? 되돌릴 수 없어요.`)) commit((x) => S.deleteProject(x, p.id), '삭제했어요'); } }, '삭제')));
}

function claudeModal(p) {
  const d = today();
  const start = h('input', { type: 'date', value: d }), end = h('input', { type: 'date', value: p.due || L.addDays(d, 29) });
  const mins = h('input', { type: 'number', min: 15, max: 480, step: 15, value: 60 }), ctx = h('input', { placeholder: '참고 맥락 (선택, 민감정보 금지)', maxlength: 300 });
  const pre = h('pre', { class: 'out' });
  const upd = () => { pre.textContent = L.planPrompt({ project: p.name, goal: p.dod || '(완료 조건 미정)', start: start.value, deadline: end.value, minutesPerDay: mins.value, context: ctx.value }); };
  for (const el of [start, end, mins, ctx]) el.addEventListener('input', upd);
  upd();
  const raw = h('textarea', { placeholder: '② Claude 답변(JSON)을 여기에 붙여넣기' });
  openModal('🤖 Claude에게 계획 맡기기', h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, '① 프롬프트 복사 → Claude 앱에 붙여넣기 → ② 받은 JSON을 아래에 붙여넣기. API 키 없이 동작하고, 이 앱은 외부로 아무것도 보내지 않아요.'),
    h('div', { class: 'grid3' }, h('label', {}, '시작', start), h('label', {}, '마감', end), h('label', {}, '하루 분', mins)), ctx,
    pre, h('button', { onclick: () => copy(pre.textContent) }, '📋 프롬프트 복사'),
    raw, h('button', { class: 'primary', onclick: () => {
      if (commit((x) => { const items = L.parsePlanJson(raw.value); S.addTasksBulk(x, p.id, items); }, 'Claude 계획을 할 일로 가져왔어요')) closeModal();
    } }, '할 일로 가져오기')));
}

// ── 💡 인박스 ──────────────────────────────────────────────
function ideaForm(after) {
  const txt = h('textarea', { placeholder: '지금 하던 일은 멈추지 말고, 생각만 여기에 내려놓기', maxlength: 500 });
  const tag = select(st.settings.tags, st.settings.tags[0]);
  setTimeout(() => txt.focus(), 50);
  return h('div', { class: 'stack' }, txt, h('div', { class: 'row' }, h('div', { class: 'grow' }, tag),
    h('button', { class: 'primary', onclick: () => { if (commit((x) => S.addIdea(x, txt.value, tag.value), `인박스에 넣었어요. ${st.settings.coolingHours}시간 숙성 후에도 설레면 그때 프로젝트로 🌱`)) after?.(); } }, '인박스에 넣기')));
}

function viewInbox() {
  const cool = st.settings.coolingHours, inbox = st.ideas.filter((i) => i.status === '인박스'), kept = st.ideas.filter((i) => i.status === '보관');
  return [
    card({}, h('h2', {}, '💡 아이디어 인박스'), h('p', { class: 'muted small' }, `발산은 자유롭게, 결정은 천천히. ${cool}시간이 지나도 여전히 하고 싶으면 그때 프로젝트로.`), ideaForm()),
    inbox.length ? card({}, inbox.map((i) => {
      const age = S.ideaAgeH(i), ripe = age >= cool;
      return h('div', { class: 'check' }, h('div', { class: 'txt' }, tagEl(i.tag), i.text,
        h('div', { class: 'muted small' }, `${L.ago(i.created)} · ${ripe ? '🌱 숙성 완료' : `⏳ 숙성 중 (${Math.ceil(cool - age)}h 남음)`}`)),
      h('div', { class: 'row' },
        h('button', { class: 'mini', disabled: !ripe, title: '대기 프로젝트로', onclick: () => commit((x) => S.promoteIdea(x, i.id), '대기 프로젝트로 옮겼어요. 진행하려면 완료 조건부터!') }, '🌱'),
        h('button', { class: 'mini', title: '언젠가 보관', onclick: () => commit((x) => S.setIdeaStatus(x, i.id, '보관')) }, '🗄'),
        h('button', { class: 'mini ghost', title: '버리기', onclick: () => commit((x) => S.setIdeaStatus(x, i.id, '버림')) }, '✕')));
    })) : h('p', { class: 'muted' }, '인박스가 비어 있어요. 오른쪽 아래 💡 버튼은 어느 화면에서든 눌러져요.'),
    kept.length ? h('details', { class: 'card' }, h('summary', {}, `🗄 언젠가 보관함 (${kept.length})`), kept.map((i) => h('div', { class: 'check' },
      h('div', { class: 'txt' }, tagEl(i.tag), i.text, h('div', { class: 'muted small' }, L.ago(i.created))),
      h('button', { class: 'mini', onclick: () => commit((x) => S.setIdeaStatus(x, i.id, '인박스')) }, '인박스로')))) : null,
  ];
}

// ── 📈 기록 (트래커 / 몸 / 휴식) ───────────────────────────
function lineChart(series, { yMin = null } = {}) {
  const W = 320, H = 160, P = { l: 30, r: 8, t: 8, b: 20 };
  const pts = series.flatMap((x) => x.points);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1), y0 = yMin ?? Math.min(...ys), y1 = Math.max(...ys, y0 + 1);
  const X = (v) => P.l + ((v - x0) / (x1 - x0)) * (W - P.l - P.r), Y = (v) => H - P.b - ((v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': series.map((x) => x.name).join(', ') });
  for (const v of [y0, (y0 + y1) / 2, y1]) {
    svg.append(s('line', { x1: P.l, x2: W - P.r, y1: Y(v), y2: Y(v), stroke: 'currentColor', 'stroke-opacity': '.12' }),
      s('text', { x: P.l - 4, y: Y(v) + 3, 'text-anchor': 'end' }, String(Math.round(v * 10) / 10)));
  }
  for (const x of series) {
    if (!x.points.length) continue;
    const line = s('polyline', { points: x.points.map(([a, b]) => `${X(a)},${Y(b)}`).join(' '), fill: 'none', 'stroke-width': 2.5, 'stroke-dasharray': x.dash || '' });
    line.style.stroke = x.color;
    const [lx, ly] = x.points.at(-1);
    const dot = s('circle', { cx: X(lx), cy: Y(ly), r: 3.5 });
    dot.style.fill = x.color;
    svg.append(line, dot);
  }
  const leg = h('div', { class: 'row small muted' }, series.map((x) => { const dot = h('span', {}, '● '); dot.style.color = x.color; return h('span', {}, dot, x.name); }));
  return h('div', {}, svg, leg);
}

function viewRecords() {
  const seg = h('div', { class: 'seg' }, [['tracker', '📈 트래커'], ['body', '🏃 몸'], ['rest', '🛋️ 휴식']].map(([k, label]) =>
    h('button', { class: ui.recordsTab === k ? 'on' : '', onclick: () => { ui.recordsTab = k; render(); } }, label)));
  return [seg, ...({ tracker: trackers, body, rest })[ui.recordsTab]()];
}

function trackers() {
  const d = today();
  const name = h('input', { placeholder: '이름 (예: 강의 슬라이드)', maxlength: 60 }), unit = h('input', { value: '장', maxlength: 8 });
  const total = h('input', { type: 'number', min: 1, value: 30 }), start = h('input', { type: 'date', value: d }), target = h('input', { type: 'date', value: L.addDays(d, 29) });
  const out = [h('details', { class: 'card' }, h('summary', {}, '＋ 새 트래커'), h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, '큰 일을 숫자로: 강의 슬라이드 40장, 소재 30개, 책 300쪽…'),
    name, h('div', { class: 'grid2' }, h('label', {}, '단위', unit), h('label', {}, '총량', total), h('label', {}, '시작', start), h('label', {}, '목표일', target)),
    h('button', { class: 'primary', onclick: () => commit((x) => S.addTracker(x, { name: name.value, unit: unit.value, total: +total.value, start: start.value, target: target.value }), '트래커를 만들었어요') }, '만들기')))];

  for (const tr of st.trackers.filter((t) => !t.archived)) {
    const done = S.trackerDone(tr), e = L.eta(tr.total, done, tr.start, d, tr.target);
    const amt = h('input', { type: 'number', min: 0, step: 'any', value: 1 });
    const planDays = Math.max(L.diffDays(tr.target || L.addDays(tr.start, 29), tr.start) + 1, 1);
    const plan = L.splitPlan(tr.total, tr.start, planDays, false, L.defaultBuffer(planDays));
    const byDay = {}; for (const l of tr.logs) byDay[l.day] = (byDay[l.day] || 0) + l.amount;
    let cum = 0;
    const actual = Object.keys(byDay).sort().map((day) => [L.diffDays(day, tr.start), (cum += byDay[day])]);
    const chart = lineChart([
      { name: '계획(버퍼 포함)', color: '#9b8fa0', dash: '4 4', points: plan.map((p) => [L.diffDays(p.date, tr.start), p.cum]) },
      { name: '실제', color: 'var(--accent)', points: actual },
    ], { yMin: 0 });

    // 남은 분량 재분배 → 할 일
    const left = Math.max(L.diffDays(tr.target || L.addDays(d, 14), d) + 1, 1);
    const nd = h('input', { type: 'number', min: 1, max: 365, value: left }), sk = h('input', { type: 'checkbox' }), bf = h('input', { type: 'number', min: 0, max: 60, value: L.defaultBuffer(left) });
    const prev = h('pre', { class: 'out scroll' });
    const re = () => L.splitPlan(Math.round(e.remaining), d, +nd.value, sk.checked, +bf.value);
    const drawPrev = () => { prev.textContent = re().map((p) => `${p.date}  ${p.amount ? `+${p.amount}${tr.unit}` : '— 마무리 버퍼'}  (누적 ${Math.round(done) + p.cum})`).join('\n') || '남은 분량이 없어요 🎉'; };
    for (const el of [nd, sk, bf]) el.addEventListener('input', drawPrev);
    drawPrev();
    const projs = st.projects.filter((p) => p.status === '진행' || p.status === '대기');
    const psel = select(projs.map((p) => [p.id, p.name]), projs[0]?.id);

    out.push(card({},
      h('h2', {}, tr.name, h('span', { class: 'muted small' }, ` ${Math.round(done * 10) / 10} / ${tr.total} ${tr.unit}`)), bar(e.pct),
      h('div', { class: 'metrics' },
        h('div', { class: 'metric' }, h('span', { class: 'muted small' }, '진행률'), h('b', {}, `${(e.pct * 100).toFixed(1)}%`)),
        h('div', { class: 'metric' }, h('span', { class: 'muted small' }, '하루 평균'), h('b', {}, `${e.pace.toFixed(1)}${tr.unit}`)),
        h('div', { class: 'metric' }, h('span', { class: 'muted small' }, '예상 완료'), h('b', {}, e.eta || '기록 필요'),
          e.slackDays != null ? h('span', { class: `small ${e.slackDays < 0 ? 'overdue' : 'muted'}` }, e.slackDays < 0 ? `목표보다 ${-e.slackDays}일 늦음` : `${e.slackDays}일 여유`) : null),
        h('div', { class: 'metric' }, h('span', { class: 'muted small' }, '필요 속도'), h('b', {}, e.needPace ? `${e.needPace.toFixed(1)}${tr.unit}/일` : '—'))),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, amt), h('button', { class: 'primary', onclick: () => commit((x) => S.logTracker(x, tr.id, d, +amt.value), `+${amt.value}${tr.unit} 기록!`) }, '오늘 기록')),
      chart,
      h('details', {}, h('summary', { class: 'small' }, '✂️ 남은 분량을 오늘부터 다시 나눠서 할 일로 보내기'),
        h('div', { class: 'grid3' }, h('label', {}, '남은 일수', nd), h('label', {}, '마무리 버퍼(일)', bf), h('label', { class: 'row' }, sk, '주말 쉬기')),
        prev,
        projs.length ? h('div', { class: 'row' }, h('div', { class: 'grow' }, psel), h('button', { onclick: () => {
          const base = Math.round(done);
          const items = re().filter((p) => p.amount > 0).map((p) => ({ date: p.date, title: `${tr.name} ${base + p.cum - p.amount + 1}~${base + p.cum}${tr.unit}`, why: `${tr.name} 목표 ${tr.total}${tr.unit} 완주` }));
          commit((x) => S.addTasksBulk(x, psel.value, items), `${items.length}개 할 일을 만들었어요`);
        } }, '할 일로 보내기')) : h('p', { class: 'muted small' }, '보낼 프로젝트가 없어요 — 먼저 프로젝트를 만들어주세요.')),
      h('p'), h('button', { class: 'mini ghost', onclick: () => commit((x) => S.archiveTracker(x, tr.id), '보관했어요') }, '보관(숨기기)')));
  }
  return out;
}

function body() {
  const d = today(), prev = st.body[d] || {};
  const day = h('input', { type: 'date', value: d }), w = h('input', { type: 'number', step: 0.1, min: 0, max: 300, value: prev.weight ?? '', placeholder: 'kg' });
  const picked = new Set(prev.parts || []), note = h('input', { value: prev.note || '', placeholder: '메모 (영양제·컨디션 등)', maxlength: 200 });
  const pills = h('div', { class: 'pills' }, S.BODY_PARTS.map((p) => h('button', { class: `pill${picked.has(p) ? ' on' : ''}`, onclick: (e) => { picked.has(p) ? picked.delete(p) : picked.add(p); e.target.classList.toggle('on'); } }, p)));
  const days = Object.keys(st.body).sort();
  const last = Object.fromEntries(S.BODY_PARTS.map((p) => [p, days.filter((x) => st.body[x].parts?.includes(p)).at(-1)]));
  const wpts = days.filter((x) => st.body[x].weight).map((x) => [L.diffDays(x, days[0]), st.body[x].weight]);
  return [
    card({}, h('h2', {}, '🏃 몸 기록'), h('div', { class: 'grid2' }, h('label', {}, '날짜', day), h('label', {}, '몸무게', w)), h('p'), pills, h('p'), note, h('p'),
      h('button', { class: 'primary', onclick: () => commit((x) => S.saveBody(x, day.value, { weight: +w.value || null, parts: [...picked], note: note.value }), '기록했어요 💪') }, '저장')),
    card({}, h('h3', {}, '부위별 마지막 운동'), h('div', { class: 'pills' }, S.BODY_PARTS.map((p) => h('span', { class: 'chip' }, `${p} ${last[p] ? `${L.diffDays(d, last[p])}일 전` : '—'}`))),
      wpts.length > 1 ? h('div', {}, h('p'), h('h3', {}, '몸무게'), lineChart([{ name: `몸무게 (${days[0]}~)`, color: 'var(--accent)', points: wpts }])) : null),
  ];
}

function rest() {
  const name = h('input', { placeholder: '이름 (예: 전방경사 10분)', maxlength: 60 }), url = h('input', { type: 'url', placeholder: 'https://www.youtube.com/...' });
  return [card({}, h('h2', {}, '🛋️ 휴식 링크'), h('p', { class: 'muted small' }, '요가 영상·플레이리스트·보고 싶은 것. 휴식 조각에서 고민 없이 바로 누르기.'),
    st.links.map((l) => h('div', { class: 'check' }, S.isSafeUrl(l.url) ? h('a', { class: 'txt', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.name) : h('span', { class: 'txt muted' }, `${l.name} (안전하지 않은 링크라 막음)`),
      h('button', { class: 'mini ghost', onclick: () => commit((x) => S.deleteLink(x, l.id)) }, '✕'))),
    h('div', { class: 'stack' }, name, url, h('button', { onclick: () => commit((x) => S.addLink(x, name.value, url.value), '넣었어요') }, '넣기')))];
}

// ── 🌙 정리 ────────────────────────────────────────────────
function viewWrap() {
  const d = today(), day = ui.wrapDay || d;
  const dayIn = h('input', { type: 'date', value: day, onchange: (e) => { ui.wrapDay = e.target.value || null; render(); } });
  const week = h('input', { type: 'checkbox', checked: ui.wrapWeek, onchange: (e) => { ui.wrapWeek = e.target.checked; render(); } });
  const journal = h('textarea', { value: st.journal[day] || '', placeholder: '오늘 한 줄 (창작·강의 소재 저장소)', maxlength: 500 });

  const sec = select(L.WORKLOG_SECTIONS, '완성'), tag = select(st.settings.tags, st.settings.tags[0]);
  const what = h('input', { placeholder: '무엇을 했다', maxlength: 200 }), why = h('input', { placeholder: '왜/맥락', maxlength: 300 });
  const manual = st.worklog.filter((w) => w.day === day);

  const wd = L.weekday(day), days = ui.wrapWeek ? Array.from({ length: (wd + 6) % 7 + 1 }, (_, i) => L.addDays(day, -((wd + 6) % 7) + i)) : [day];
  const md = days.map((x) => L.renderWorklog(x, S.collectWorklog(st, x, d))).join('\n');

  const brainNotes = st.brain.filter((n) => n.day === day);
  const bt = h('input', { placeholder: '제목 (H1)', maxlength: 100 }), bs = h('input', { placeholder: '한 줄 요약', maxlength: 200 });
  const bb = h('textarea', { placeholder: '본문 (## 소제목 가능 · 오해 → 정정 · 추정: / 미확인: 표기)' });
  const bn = select(['재사용되는 원리', '특정 대상 정보', '외부자료 요약', '박제할 결론·Q&A'], '재사용되는 원리'), bc = select(['검증됨', '추정', '미확인'], '검증됨');
  const bsrc = h('input', { placeholder: "출처 (비우면 'claude.ai 대화')", maxlength: 200 }), ben = h('input', { placeholder: '영문 요약 (1문장)', maxlength: 200 });
  const bkw = h('input', { placeholder: '관련어 (쉼표)', maxlength: 200 }), bsens = h('input', { type: 'checkbox' });
  const aud = h('input', { value: '퍼포먼스 마케터·광고 실무자', maxlength: 60 }), cp = h('pre', { class: 'out' });
  const drawCp = () => { cp.textContent = L.contentPrompt(S.journalRecent(st, day, 7), aud.value); };
  aud.addEventListener('input', drawCp); drawCp();

  return [
    card({}, h('h2', {}, '🌙 오늘 정리 → worklog'),
      h('p', { class: 'muted small' }, '완료한 할 일·프로젝트는 자동으로 들어가요. 복사해서 내 worklog 파일에 붙여넣으면 끝.'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, dayIn), h('label', { class: 'row' }, week, '이번 주 한 번에')),
      h('pre', { class: 'out' }, md),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => copy(md) }, '📋 복사'), shareBtn(md, 'worklog'),
        h('button', { onclick: () => download(`worklog_${day}.md`, md, 'text/markdown') }, '⬇️ .md'))),
    card({}, h('h3', {}, '✍️ 한 줄 일기'), journal, h('p'), h('button', { onclick: () => commit((x) => S.saveJournal(x, day, journal.value), '저장했어요') }, '일기 저장')),
    h('details', { class: 'card', open: manual.length > 0 }, h('summary', {}, `➕ 직접 추가 (${manual.length})`),
      h('div', { class: 'stack' }, h('div', { class: 'grid2' }, sec, tag), what, why,
        h('button', { onclick: () => commit((x) => S.addWorklogItem(x, day, { section: sec.value, tag: tag.value, what: what.value, why: why.value })) }, '추가')),
      manual.map((w) => h('div', { class: 'check' }, h('span', { class: 'txt small' }, `${w.section} · `, tagEl(w.tag), w.what, w.why ? ` — ${w.why}` : ''),
        h('button', { class: 'mini ghost', onclick: () => commit((x) => S.deleteWorklogItem(x, w.id)) }, '✕')))),
    h('details', { class: 'card', open: brainNotes.length > 0 }, h('summary', {}, `🧠 brain 환원 재료 (${brainNotes.length})`),
      h('p', { class: 'muted small' }, '오늘 배운 지식을 한 토픽씩. 파일명·폴더·태그는 PC의 Claude Code가 정해요.'),
      h('div', { class: 'stack' }, bt, bs, bb, h('div', { class: 'grid2' }, bn, bc), bsrc, ben, bkw, h('label', { class: 'row' }, bsens, '⚠️ 특정 인물/조직 정보 포함'),
        h('button', { onclick: () => commit((x) => S.addBrainNote(x, day, { title: bt.value, summary: bs.value, body: bb.value, nature: bn.value, confidence: bc.value, source: bsrc.value, enSummary: ben.value, keywords: bkw.value, sensitive: bsens.checked }), 'brain 재료를 추가했어요') }, '추가')),
      brainNotes.length ? [
        brainNotes.map((n) => h('div', { class: 'check' }, h('span', { class: 'txt' }, `🧠 ${n.title}`), h('button', { class: 'mini ghost', onclick: () => commit((x) => S.deleteBrainNote(x, n.id)) }, '✕'))),
        h('pre', { class: 'out' }, L.renderBrain(brainNotes)),
        h('button', { class: 'primary', onclick: () => copy(L.renderBrain(brainNotes)) }, '📋 brain 재료 복사')] : null),
    h('details', { class: 'card' }, h('summary', {}, '🎨 일기로 콘텐츠 소재 뽑기 (Claude 프롬프트)'), h('label', {}, '대상', aud), cp,
      h('button', { onclick: () => copy(cp.textContent) }, '📋 프롬프트 복사')),
  ];
}

// ── ⚙️ 설정 ────────────────────────────────────────────────
function viewSettings() {
  const set = st.settings;
  const wip = h('input', { type: 'number', min: 1, max: 7, value: set.wipLimit }), cool = h('input', { type: 'number', min: 0, max: 336, value: set.coolingHours });
  const tags = h('input', { value: set.tags.join(', ') }), quotes = h('textarea', { value: st.quotes.join('\n') });
  const file = h('input', { type: 'file', accept: 'application/json,.json,text/plain', hidden: true });
  file.addEventListener('change', async () => { if (file.files[0]) receive(await file.files[0].text()); file.value = ''; });
  const pasted = h('textarea', { placeholder: '다른 기기에서 복사한 동기화 텍스트를 붙여넣기' });
  return [
    h('button', { class: 'mini ghost', onclick: () => go('today') }, '← 오늘로'), h('p'),
    card({}, h('h2', {}, '⚙️ 규칙'), h('div', { class: 'grid2' }, h('label', {}, '동시 진행 한도 (WIP)', wip), h('label', {}, '아이디어 숙성(시간)', cool)),
      h('p'), h('label', {}, '태그 (쉼표 — worklog의 [태그])', tags), h('p'),
      h('button', { class: 'primary', onclick: () => commit((x) => S.setSettings(x, { wipLimit: Math.max(1, +wip.value || 3), coolingHours: Math.max(0, +cool.value || 0), tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) }), '설정을 저장했어요') }, '저장')),
    card({}, h('h2', {}, '💬 홈 화면 문장'), quotes, h('p'), h('button', { onclick: () => commit((x) => S.setQuotes(x, quotes.value.split('\n')), '저장했어요') }, '문장 저장')),
    card({}, h('h2', {}, '🔄 폰 ↔ PC 동기화 · 백업'),
      h('p', { class: 'small' }, '① 보내는 기기에서 📤 보내기 → (폰) 카톡 나와의 채팅·드라이브로 / (PC) 파일 저장'),
      h('p', { class: 'small' }, '② 받는 기기에서 📥 받아서 합치기 → 양쪽 기록이 모두 살아남아요. 반대 방향도 한 번 하면 두 기기가 똑같아져요.'),
      h('div', { class: 'grid2' }, h('button', { class: 'primary', onclick: sendSync }, '📤 보내기'), h('label', { class: 'btn' }, '📥 받아서 합치기', file)),
      h('p', { class: 'muted small' }, `마지막 보내기: ${st.lastBackup || '없음'} · 마지막 합치기: ${st.lastSync || '없음'}. 파일엔 개인 기록이 들어 있으니 내 계정 공간에만 두세요.`),
      h('details', {}, h('summary', { class: 'small' }, '파일 대신 텍스트로'),
        h('div', { class: 'stack' }, h('button', { onclick: () => { copy(S.exportJSON(st)); commit((x) => { x.lastBackup = today(); }); } }, '📋 이 기기 기록을 텍스트로 복사'),
          pasted, h('button', { onclick: () => receive(pasted.value) }, '붙여넣은 텍스트 합치기')))),
    card({}, h('h2', {}, '🔒 보안'), h('ul', { class: 'small' },
      h('li', {}, '외부 서버·광고·분석 스크립트 없음. 네트워크로 데이터를 보내지 않아요.'),
      h('li', {}, '비밀번호·API Key·토큰·주민/카드/계좌번호처럼 보이는 내용은 저장 자체가 차단돼요.'),
      h('li', {}, '회사 기밀·고객 데이터·매출 수치는 적지 말고 회사 승인 채널에 두세요.'),
      h('li', {}, 'Claude 연동은 복사/붙여넣기라 API 키가 필요 없어요.')),
      h('button', { class: 'danger', onclick: () => { if (confirm('이 기기의 모든 기록을 지울까요? 다른 기기로 보내둔 게 없으면 되돌릴 수 없어요.') && confirm('정말요? 마지막 확인이에요.')) { st = S.freshState(); S.save(localStorage, st); toast('초기화했어요'); render(); } } }, '전체 초기화')),
  ];
}

async function sendSync() {
  const text = S.exportJSON(st), name = `maemuri_sync_${today()}.json`;
  const f = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: '마무리 다이어리 동기화' });
    else download(name, text);
  } catch (e) { if (e.name === 'AbortError') return; download(name, text); }
  commit((x) => { x.lastBackup = today(); }, '보냈어요. 받는 기기에서 📥 받아서 합치기!');
}

function receive(raw) {
  try {
    const { state, added, updated } = S.merge(st, S.parseExport(raw));
    st = state;
    S.save(localStorage, st);
    toast(`합쳤어요 ✨ 새 기록 ${added}개 · 갱신 ${updated}개`);
    render();
  } catch (e) { toast(e.message, true); }
}

// ── 라우팅 / 렌더 ──────────────────────────────────────────
const VIEWS = { today: viewToday, pieces: viewPieces, projects: viewProjects, inbox: viewInbox, records: viewRecords, wrap: viewWrap, settings: viewSettings };
function go(v) { view = v; render(); window.scrollTo(0, 0); }

function render() {
  const d = today();
  $('today-label').textContent = `${d} (${L.WEEKDAY_KO[L.weekday(d)]})`;
  $('streak-chip').textContent = `🔥 ${L.streak(S.focusDoneDays(st), d)}일`;
  $('wip-chip').textContent = `진행 ${S.wipCount(st)}/${st.settings.wipLimit}`;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.view === view);
  $('fab').hidden = view === 'inbox';
  $('view').replaceChildren(...[VIEWS[view]()].flat(Infinity).filter(Boolean));
}

function morningPopup() {
  const d = today(), morning = st.pieces[0];
  if (!morning || L.nowMin() >= 12 * 60 || sessionStorage.getItem('morning') === d) return;
  const doneAll = S.checked(st, d, morning.id).size >= morning.checklist.length;
  if (S.getFocus(st, d) && doneAll) return;
  sessionStorage.setItem('morning', d);
  const body = h('div', {});
  const draw = () => body.replaceChildren(
    morning.checklist.length ? h('div', {}, h('p', { class: 'muted small' }, morning.name), ...checklist(morning, d)) : null,
    h('p'), S.getFocus(st, d) ? h('p', {}, `🎯 오늘의 1개: ${S.getFocus(st, d).title}`) : focusPicker(draw),
    h('p'), h('button', { class: 'primary big', onclick: closeModal }, '시작! 🚀'));
  draw();
  openModal('☀️ 좋은 아침 — 순서대로 해볼까요?', body);
}

// ── 시작 ───────────────────────────────────────────────────
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => go(b.dataset.view));
$('settings-btn').addEventListener('click', () => go('settings'));
$('fab').addEventListener('click', () => openModal('💡 떠오른 거 던져두기', ideaForm(closeModal)));
$('modal-close').addEventListener('click', () => { closeModal(); render(); });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) { closeModal(); render(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').hidden) { closeModal(); render(); } });
// 다른 탭/창에서 바뀌면 동기화, 앱으로 돌아오면 시간 기준 화면 갱신
window.addEventListener('storage', (e) => { if (e.key === S.KEY) { st = S.load(localStorage); render(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('modal').hidden) render(); });
setInterval(() => { if (view === 'today' && $('modal').hidden && !document.activeElement?.matches('input,textarea,select')) render(); }, 60000);

render();
morningPopup();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
