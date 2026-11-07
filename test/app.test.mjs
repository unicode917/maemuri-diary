// node --test life/pwa/test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';
import * as S from '../store.js';

const PATTERN = { wake: '07:00', breakfast: '07:30', lunch: '12:00', dinner: '18:30', sleep: '00:30', mealMinutes: 60 };

test('조각: 식사 피해서 배치, 안 들어가면 다음 창으로 이어서', () => {
  const { blocks, overflow } = L.buildSchedule(PATTERN, [{ id: 1, name: '루틴', minutes: 30 }, { id: 2, name: '딥워크', minutes: 240 }]);
  const named = blocks.filter((b) => b.kind === 'piece').map((b) => [L.blockLabel(b), b.name]);
  assert.deepEqual(named, [['07:00–07:30', '루틴'], ['08:30–12:00', '딥워크'], ['13:00–13:30', '딥워크 (이어서)']]);
  assert.equal(overflow, 0);
});

test('조각: 넘침 계산 + 자정 넘은 현재 블록', () => {
  const { blocks, overflow } = L.buildSchedule(PATTERN, [{ id: 1, name: 'x', minutes: 1440 }]);
  assert.equal(overflow, 1440 - (1470 - 420 - 180));
  const cur = L.currentBlock(blocks, 15);
  assert.ok(cur.block.name.startsWith('x'));
  assert.equal(cur.block.end - cur.t, 15);
});

test('분량 나누기: 주말 제외 + 마무리 버퍼 + 앞쪽 배분', () => {
  const plan = L.splitPlan(100, '2026-10-26', 10, true, 2);
  assert.equal(plan.length, 10);
  assert.ok(plan.every((p) => ![0, 6].includes(L.weekday(p.date))));
  assert.deepEqual(plan.slice(-2).map((p) => p.amount), [0, 0]);
  assert.equal(plan.at(-1).cum, 100);
  assert.ok(plan[0].amount >= plan[7].amount);
});

test('ETA: 실제 속도로 재계산', () => {
  const e = L.eta(100, 20, '2026-10-01', '2026-10-10', '2026-10-30');
  assert.equal(e.pace, 2);
  assert.equal(e.eta, '2026-11-19');
  assert.equal(e.slackDays, -20);
  assert.equal(e.needPace, 4);
});

test('날짜 유틸', () => {
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.dday('2026-10-30', '2026-10-24'), 'D-6');
  assert.ok(!L.isValidISO('2026-02-30'));
  assert.equal(L.todayISO(Date.UTC(2026, 9, 24, 16, 0)), '2026-10-25');   // UTC 16시 = KST 다음날 01시
  assert.equal(L.streak(new Set(['2026-10-22', '2026-10-23']), '2026-10-24'), 2);
});

for (const [text, hit] of [
  ['키 sk-ant-api03-abcdefghijklmnopqrstuv', 'API Key (Anthropic/OpenAI)'], ['password: hunter22', '비밀번호/키 값'],
  ['비번=abcd1234', '비밀번호/키 값'], ['카드 4111 1111 1111 1111', '카드번호'], ['주민 900101-1234567', '주민등록번호'],
  ['국민 123456-01-123456', '계좌번호'], ['ghp_abcdefghijklmnopqrstuvwxyz0123', 'GitHub 토큰'], ['인증번호 482913', '인증번호'],
]) test(`가드 차단: ${hit}`, () => {
  assert.ok(L.detectSensitive(text).includes(hit));
  assert.throws(() => L.guard(text), L.SensitiveError);
});

for (const text of ['2026-10-24 강의안 v2 공유', '010-1234-5678 로 연락', '전환율 4.52 / 단가 ₩12,900', 'CMP_01_가입 소재 교체 v2', '비밀번호 바꾸기 (할 일)', '토큰 비용 절감 아이디어'])
  test(`가드 통과: ${text}`, () => assert.deepEqual(L.detectSensitive(text), []));

test('Claude JSON: 앞뒤 설명·코드펜스 허용 / 오류 거부', () => {
  const ok = '계획:\n```json\n{"tasks":[{"date":"2026-10-25","title":"목차 확정","why":"범위 고정"}]}\n```';
  assert.deepEqual(L.parsePlanJson(ok), [{ date: '2026-10-25', title: '목차 확정', why: '범위 고정' }]);
  for (const bad of ['no json', '{"tasks": []}', '{"tasks":[{"date":"10/25","title":"x"}]}', '{"tasks":[{"date":"2026-02-30","title":"x"}]}',
    '{"tasks":[{"date":"2026-10-25","title":""}]}', '{"tasks":[{"date":"2026-10-25","title":"api_key=abcdef123"}]}'])
    assert.throws(() => L.parsePlanJson(bad));
});

test('worklog 3단 형식 + 빈 단 생략, brain은 frontmatter 없이 markdown 펜스', () => {
  const md = L.renderWorklog('2026-10-24', { 완성: [['시스템', '앱 완성', 'ENFP 마무리 보조']], 다음: [['강의', '슬라이드 1~5장', '']] });
  assert.ok(md.startsWith('## 2026-10-24'));
  assert.ok(md.includes('- [시스템] 앱 완성 — ENFP 마무리 보조'));
  assert.ok(md.includes('- [강의] 슬라이드 1~5장\n'));
  assert.ok(!md.includes('보관 위치'));
  const b = L.renderBrain([{ title: 'WIP 제한', summary: '3개', body: '', nature: '재사용되는 원리', confidence: '검증됨', source: '', enSummary: 'Limit WIP.', keywords: '칸반', sensitive: true }]);
  assert.ok(b.startsWith('```markdown\n# WIP 제한'));
  assert.ok(b.includes('- 출처: claude.ai 대화') && b.includes('민감(인물/조직)'));
});

// ── store ────────────────────────────────────────────────
test('WIP 한도 + 완료 조건 필수', () => {
  const s = S.freshState();
  assert.throws(() => S.addProject(s, { name: 'x', tag: '개인', status: '진행', dod: '' }), S.RuleError);
  for (let i = 0; i < 3; i++) S.addProject(s, { name: `p${i}`, tag: '개인', status: '진행', dod: '끝' });
  assert.throws(() => S.addProject(s, { name: 'p4', tag: '개인', status: '진행', dod: '끝' }), /3\/3/);
  const p4 = S.addProject(s, { name: 'p4', tag: '개인', status: '대기', dod: '끝' });
  assert.throws(() => S.setProjectStatus(s, p4.id, '진행'));
  S.setProjectStatus(s, s.projects[0].id, '완료');
  S.setProjectStatus(s, p4.id, '진행');
  assert.equal(S.wipCount(s), 3);
});

test('가드는 저장 계층에서도 적용', () => {
  const s = S.freshState();
  assert.throws(() => S.addIdea(s, '슬랙 토큰 xoxb-1234567890-abcdef', '시스템'), L.SensitiveError);
  assert.equal(s.ideas.length, 0);
  assert.throws(() => S.addLink(s, 'x', 'javascript:alert(1)'), S.RuleError);
});

test('아이디어 숙성 전엔 승격 불가', () => {
  const s = S.freshState();
  S.addIdea(s, '주간 리포트 자동화', '업무');
  const id = s.ideas[0].id;
  assert.throws(() => S.promoteIdea(s, id), /숙성/);
  const p = S.promoteIdea(s, id, Date.now() + 49 * 3600000);
  assert.equal(p.status, '대기');
  assert.equal(s.ideas[0].status, '승격');
});

test('오늘의 1개 → 완료 → 연속 일수·worklog 자동 반영', () => {
  const s = S.freshState(), today = L.todayISO();
  const t = S.addTask(s, { title: '리포트 마감', due: today, tag: '업무', why: '주간 보고' });
  S.setFocus(s, today, t.id);
  assert.equal(L.streak(S.focusDoneDays(s), today), 0);
  S.setTaskDone(s, t.id, true);
  assert.equal(L.streak(S.focusDoneDays(s), today), 1);
  const md = L.renderWorklog(today, S.collectWorklog(s, today, today));
  assert.ok(md.includes('- [업무] 리포트 마감 — 주간 보고'));
});

test('저장/불러오기/내보내기 왕복 + 손상 대비', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = S.load(storage);
  S.addTask(s, { title: 'a' });
  S.save(storage, s);
  assert.equal(S.load(storage).tasks.length, 1);
  assert.equal(S.parseExport(S.exportJSON(s)).tasks[0].title, 'a');
  assert.throws(() => S.parseExport('{"hello":1}'), S.RuleError);
  assert.throws(() => S.parseExport('not json'), S.RuleError);
  mem.set(S.KEY, '{broken');
  assert.equal(S.load(storage).tasks.length, 0);
});

// ── 폰 ↔ PC 병합 ─────────────────────────────────────────
const clone = (x) => S.parseExport(S.exportJSON(x));
const tick = () => { const t = Date.now(); while (Date.now() === t); };

test('병합: 양쪽에서 각각 추가한 기록이 모두 남는다', () => {
  const phone = S.freshState(), pc = S.freshState();
  S.addIdea(phone, '폰에서 떠오른 아이디어', '개인');
  S.addTask(pc, { title: 'PC에서 만든 할 일' });
  S.saveJournal(phone, '2026-10-24', '폰 일기');
  const { state, added } = S.merge(pc, clone(phone));
  assert.equal(state.ideas.length, 1);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.journal['2026-10-24'], '폰 일기');
  assert.equal(added, 1);
});

test('병합: 같은 할 일은 더 최근 수정이 이김 + 반대 방향도 같은 결과', () => {
  const pc = S.freshState();
  const t = S.addTask(pc, { title: '리포트' });
  const phone = clone(pc);
  tick();
  S.setTaskDone(phone, t.id, true);                     // 폰에서 나중에 완료
  const onPc = S.merge(pc, clone(phone)).state;
  assert.equal(onPc.tasks[0].done, true);
  const onPhone = S.merge(phone, clone(pc)).state;      // 오래된 PC 버전이 덮어쓰지 않음
  assert.equal(onPhone.tasks[0].done, true);
});

test('병합: 삭제도 다른 기기에 전파, 진행 기록은 합집합', () => {
  const a = S.freshState();
  const t = S.addTask(a, { title: '지울 것' });
  S.addTracker(a, { name: '슬라이드', unit: '장', total: 40, start: '2026-10-20', target: '2026-11-10' });
  const b = clone(a), trId = a.trackers[0].id;
  tick();
  S.deleteTask(b, t.id);
  S.logTracker(a, trId, '2026-10-24', 3);
  S.logTracker(b, trId, '2026-10-24', 2);
  const m = S.merge(a, clone(b)).state;
  assert.equal(m.tasks.length, 0);
  assert.equal(S.trackerDone(m.trackers[0]), 5);
  assert.equal(S.merge(m, clone(m)).updated, 0);        // 같은 걸 또 합쳐도 변화 없음
});

test('병합: 날짜별 값·설정은 더 최근 쪽, 오늘의 1개 해제도 전파', () => {
  const a = S.freshState();
  const t = S.addTask(a, { title: '1개' });
  S.setFocus(a, '2026-10-24', t.id);
  const b = clone(a);
  tick();
  S.setFocus(b, '2026-10-24', null);
  S.setSettings(b, { wipLimit: 2 });
  S.toggleCheck(b, '2026-10-24', 'p1', '스트레칭 10분', true);
  const m = S.merge(a, clone(b)).state;
  assert.equal(m.focus['2026-10-24'], undefined);
  assert.equal(m.settings.wipLimit, 2);
  assert.ok(S.checked(m, '2026-10-24', 'p1').has('스트레칭 10분'));
  const back = S.merge(clone(b), a).state;              // b 입장에서 오래된 a를 합쳐도 유지
  assert.equal(back.settings.wipLimit, 2);
  assert.equal(back.focus['2026-10-24'], undefined);
});

// ── 가져오기 검문 (조작된 동기화 파일) ─────────────────────
const evil = (extra) => JSON.stringify({ app: 'maemuri', v: 2, tasks: [], ...extra });

test('검문: __proto__ 키로 프로토타입 오염 불가', () => {
  const raw = '{"app":"maemuri","v":2,"tasks":[],"checks":{"__proto__":{"polluted":"PWNED"}},"mu":{"checks:__proto__:polluted":9e15},"__proto__":{"x":1},"settings":{"constructor":{"prototype":{"y":2}}}}';
  const { state } = S.merge(S.freshState(), S.parseExport(raw));
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).x, undefined);
  assert.equal(({}).y, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(state.checks, '__proto__'), false);
});

test('검문: https 아닌 링크·잘못된 id·날짜는 버림', () => {
  const r = S.parseExport(evil({
    links: [{ id: 'a1', u: 1, name: 'x', url: 'javascript:alert(1)' }, { id: 'a2', u: 1, name: 'y', url: 'data:text/html,hi' }, { id: 'a3', u: 1, name: 'ok', url: 'https://example.com/v' }],
    ideas: [{ id: '<img src=x>', text: 'bad id', created: '2026-01-01' }, { id: 'ok1', text: 'fine', created: 5 }],
    journal: { '2026-10-24': 'ok', 'nope': 'x', '2026-10-25': { obj: 1 } },
    focus: { '2026-10-24': 'not valid id!' },
    mu: { 'settings': 1, 'evil:key': 2, 'journal:2026-10-24': 'NaN' },
    deleted: { 'ok2': 5, '../x': 6 },
    settings: { wipLimit: 'abc', tags: ['a', { b: 1 }], wake: '<b>' },
  }));
  assert.deepEqual(r.links.map((l) => l.id), ['a3']);
  assert.deepEqual(r.ideas.map((i) => i.id), ['ok1']);
  assert.equal(typeof r.ideas[0].created, 'string');
  assert.deepEqual(Object.keys(r.journal), ['2026-10-24']);
  assert.deepEqual(r.focus, {});
  assert.deepEqual(Object.keys(r.mu), ['settings']);
  assert.deepEqual(Object.keys(r.deleted), ['ok2']);
  assert.equal(r.settings.wipLimit, 3);
  assert.deepEqual(r.settings.tags, ['a']);
  assert.equal(r.settings.wake, '07:00');
  assert.ok(S.isSafeUrl('https://youtube.com/x') && !S.isSafeUrl('javascript:alert(1)') && !S.isSafeUrl(' https://x'));
});

test('검문: 정상 동기화 파일은 그대로 통과 (왕복 손실 없음)', () => {
  const a = S.freshState();
  S.addTask(a, { title: 't', due: '2026-10-24', tag: '업무' });
  S.addLink(a, '요가', 'https://www.youtube.com/watch?v=abc');
  S.addTracker(a, { name: 'n', unit: '장', total: 10, start: '2026-10-20', target: '2026-10-30' });
  S.logTracker(a, a.trackers[0].id, '2026-10-24', 2);
  S.toggleCheck(a, '2026-10-24', 'p1', '스트레칭 10분', true);
  S.saveJournal(a, '2026-10-24', '일기');
  const r = S.parseExport(S.exportJSON(a));
  for (const k of ['tasks', 'links', 'trackers', 'checks', 'journal', 'mu', 'pieces', 'settings', 'quotes']) assert.deepEqual(r[k], a[k], k);
});
