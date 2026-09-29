// End-to-end-test av Plugga fas 2 mot en KÖRANDE Glosan (via nginx):
// dela med en kompis och via QR-länk (mottagarna har ingen AI) → Mappar →
// övningsprov i appen (med självbedömning) och på papper (rättat av AI:n) →
// "Min plugg". Engångsanvändare raderas efteråt.
//
// Bäst UTAN FEATURES_FOR_ALL — då slår skriptet på Plugga för skaparen direkt
// i den lokala databasen (docker exec glosan-mongo) och kontrollerar att de
// som får något delat får Plugga påslaget (inbjudningsbeta):
//
//   FRONTEND_URL=http://localhost:8080 docker compose up --build -d
//   cd backend && node scripts/plugga-fas2-e2e.mjs http://localhost:8080
import assert from 'node:assert/strict';
import { e2e, grantFeatureInLocalDb, inDays } from './lib/e2e.mjs';

const { BASE, ok, api, register, connectMcp, call } = e2e(process.argv[2]);

async function hasPlugga(user) {
  return (await api('/api/study/overview', user.token)).status === 200;
}

async function main() {
  console.log(`Plugga fas 2 e2e against ${BASE}`);
  const A = await register('p2creator');
  const B = await register('p2friend');
  const C = await register('p2mate');
  try {
    // ── uppstart ────────────────────────────────────────────────────────────
    const forAll = await hasPlugga(B);
    if (!(await hasPlugga(A))) grantFeatureInLocalDb(A.name, 'study');
    assert.ok(await hasPlugga(A), 'the creator needs Plugga');
    ok(forAll ? 'Plugga on for everyone (FEATURES_FOR_ALL) — invite-grant checks skipped' : 'Plugga on for the creator only; friend and classmate have no Plugga yet');

    const claude = await connectMcp(A.token);
    const tools = (await claude.listTools()).tools.map((t) => t.name);
    for (const t of ['create_practice_test', 'get_practice_test', 'record_paper_test', 'delete_practice_test', 'list_study_folders', 'save_study_folder', 'get_study_activity']) {
      assert.ok(tools.includes(t), `tool ${t}`);
    }
    const prompts = (await claude.listPrompts()).prompts.map((p) => p.name);
    assert.ok(prompts.includes('prepare_for_test') && prompts.includes('check_my_test'));
    ok('MCP: test, folder and activity tools plus the prepare_for_test / check_my_test prompts');

    const unit = await call(claude, 'create_study_unit', {
      subject: 'matematik', grade_year: 8, title: 'Kapitel 4 — Procent', exam_date: inDays(7),
      pages: [{ title: 'Procent', body: '1 % = $\\frac{1}{100}$' }]
    });
    const unitId = unit.data.unit_id;
    await call(claude, 'add_flashcards', { unit_id: unitId, cards: [{ front: 'Vad är 1 %?', back: 'En hundradel' }] });
    await call(claude, 'add_exercises', {
      unit_id: unitId,
      exercises: [
        { prompt: 'Hur mycket är 10 % av 200 kr?', answer: { type: 'number', value: 20, unit: 'kr' }, solution: '$0{,}1 \\cdot 200 = 20$', level: 'E' },
        { prompt: 'Skriv 0,25 i procent', answer: { type: 'number', value: 25, unit: '%' }, solution: '$0{,}25 = 25\\,\\%$', level: 'E' },
        { prompt: 'En vara kostar 80 kr efter 20 % rabatt. Vad kostade den innan?', answer: { type: 'number', value: 100, unit: 'kr' }, solution: '$0{,}8x = 80 \\Rightarrow x = 100$', level: 'C' }
      ]
    });
    const hist = await call(claude, 'create_study_unit', { subject: 'historia', grade_year: 8, title: 'Industriella revolutionen' });
    await call(claude, 'add_flashcards', { unit_id: hist.data.unit_id, cards: [{ front: 'Ångmaskinen?', back: 'James Watt förbättrade den på 1760-talet.' }] });
    ok(`the creator's AI makes MA1 "${unit.data.title}" (4 items) and HI1 (1 card)`);

    // ── dela med en kompis ──────────────────────────────────────────────────
    const invite = await api('/api/me/invite-codes', A.token, { method: 'POST' });
    const befriended = await api('/api/me/friends/by-code', B.token, { method: 'POST', body: { code: invite.body.inviteCode.code } });
    assert.ok(befriended.status < 300, JSON.stringify(befriended.body));
    const shared = await api(`/api/study/units/${unitId}/share`, A.token, { method: 'POST', body: { friendIds: [B.id] } });
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.deepEqual(shared.body.recipients.map((r) => r.username), [B.name]);
    assert.ok(await hasPlugga(B), 'the friend gets Plugga');
    const bUnits = await api('/api/study/units?allTerms=1', B.token);
    assert.deepEqual(bUnits.body.units.map((u) => u.code), ['MA1']);
    assert.equal(bUnits.body.units[0].sharedBy, A.name);
    assert.equal(bUnits.body.units[0].sharedCount, null, 'recipients never see who else has it');
    const notFriend = await api(`/api/study/units/${unitId}/share`, A.token, { method: 'POST', body: { friendIds: [C.id] } });
    assert.equal(notFriend.status, 400);
    const bSession = await api('/api/study/sessions', B.token, { method: 'POST', body: { unitIds: [unitId], mode: 'exercises' } });
    const firstEx = bSession.body.items.find((i) => i.code === 'MA1-2');
    const bAnswer = await api(`/api/study/sessions/${bSession.body.session.id}/answer`, B.token, { method: 'POST', body: { itemId: firstEx.id, answer: '20 kr' } });
    assert.equal(bAnswer.body.result, 'correct');
    await api(`/api/study/sessions/${bSession.body.session.id}/finish`, B.token, { method: 'POST' });
    const aDetail = await api(`/api/study/units/${unitId}`, A.token);
    assert.equal(aDetail.body.items.find((i) => i.code === 'MA1-2').state, null, "the friend's progress is the friend's own");
    assert.equal(aDetail.body.unit.sharedCount, 1);
    // B får ett eget MA1 — samma kod som A:s delade. En papperskod får då aldrig
    // tyst hamna i B:s eget område: verktyget ger kandidaterna.
    const bClaude = await connectMcp(B.token);
    const bOwn = await call(bClaude, 'create_study_unit', { subject: 'matematik', grade_year: 8, title: 'Mitt eget' });
    assert.equal(bOwn.data.code, 'MA1');
    await call(bClaude, 'add_flashcards', { unit_id: bOwn.data.unit_id, cards: [{ front: 'Vad är en jon?', back: 'En laddad atom.' }] });
    const clash = await call(bClaude, 'get_study_item', { code: 'MA1-1' });
    assert.equal(clash.error?.code, 'conflict');
    assert.equal(clash.error.candidates.length, 2);
    assert.ok(clash.error.candidates.some((c) => c.is_owner === false && c.shared_by === A.name));
    assert.ok(!clash.error.message.includes('Procent'), 'no other user\'s text in the message');
    const theirs = clash.error.candidates.find((c) => !c.is_owner);
    const picked = await call(bClaude, 'get_study_item', { item_id: theirs.item_id });
    assert.deepEqual([picked.data.unit.is_owner, picked.data.unit.written_by_someone_else], [false, true]);
    await call(bClaude, 'delete_study_unit', { unit_id: bOwn.data.unit_id });
    await bClaude.close();
    await call(claude, 'update_study_unit', { unit_id: unitId, archived: true });
    assert.equal((await api(`/api/study/units/${unitId}`, B.token)).status, 404, 'an archived unit disappears for recipients');
    const withArchived = await call(claude, 'list_study_units', { include_archived: true });
    assert.ok(withArchived.data.some((u) => u.unit_id === unitId && u.archived), 'include_archived finds it again');
    assert.equal((await api(`/api/study/units/${unitId}`, A.token)).status, 200, '… but not for the creator');
    await call(claude, 'update_study_unit', { unit_id: unitId, archived: false });
    assert.equal((await api(`/api/study/units/${unitId}`, B.token)).status, 200);
    ok(`shared with a friend: ${forAll ? '' : 'Plugga switched on, '}unit visible, own progress; non-friends refused; the same code in two units → candidates; archived = hidden from recipients`);

    // ── QR-länk ─────────────────────────────────────────────────────────────
    const link = await api(`/api/study/units/${unitId}/share-links`, A.token, { method: 'POST', body: { ttlDays: 7, maxUses: 10 } });
    assert.equal(link.status, 201);
    const code = link.body.link.code;
    const preview = await api(`/api/study-invite/${code}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.unit.title, 'Kapitel 4 — Procent');
    assert.equal(preview.body.unit.exercises, 3);
    assert.equal(preview.body.creator.username, A.name);
    for (const k of ['gradeYear', 'description', 'book']) assert.equal(preview.body.unit[k], undefined, `the public preview has no ${k}`);
    assert.equal((await api(`/api/study-invite/${code}/accept`, null, { method: 'POST' })).status, 401);
    if (!forAll) assert.equal(await hasPlugga(C), false);
    const joined = await api(`/api/study-invite/${code}/accept`, C.token, { method: 'POST' });
    assert.deepEqual(joined.body, { unitId, joined: true });
    assert.ok(await hasPlugga(C), 'the classmate gets Plugga');
    const again = await api(`/api/study-invite/${code}/accept`, C.token, { method: 'POST' });
    assert.equal(again.body.joined, false);
    const own = await api(`/api/study-invite/${code}/accept`, A.token, { method: 'POST' });
    assert.equal(own.body.own, true);
    const shares = await api(`/api/study/units/${unitId}/shares`, A.token);
    assert.deepEqual(shares.body.recipients.map((r) => r.username).sort(), [B.name, C.name].sort());
    assert.equal(shares.body.links[0].usedCount, 1, 'joining twice uses one place');
    const cFriends = await api('/api/me/friends', C.token);
    assert.ok(!cFriends.body.friends.some((f) => f.username === A.name), 'joining does not befriend the creator');
    await api(`/api/study/units/${unitId}/share-links/${code}`, A.token, { method: 'DELETE' });
    assert.equal((await api(`/api/study-invite/${code}`)).status, 404);
    assert.equal((await api(`/api/study/units/${unitId}/leave`, C.token, { method: 'POST' })).status, 200);
    assert.equal((await api(`/api/study/units/${unitId}`, C.token)).status, 404);
    assert.equal((await api(`/api/study/units/${unitId}/share-links`, B.token, { method: 'POST', body: {} })).status, 403);
    ok('QR link: public preview (no grade, book or description), join (idempotent, no friendship), revoke, leave; only the creator shares');

    // ── Mappar ──────────────────────────────────────────────────────────────
    const folder = await api('/api/study/folders', A.token, { method: 'POST', body: { name: 'Inför provet v. 42', color: 'sky', unitIds: [unitId, hist.data.unit_id, '64b000000000000000000009'] } });
    assert.equal(folder.status, 201);
    assert.equal(folder.body.folder.unitCount, 2, 'unknown ids are ignored');
    const fid = folder.body.folder.id;
    const fDetail = await api(`/api/study/folders/${fid}`, A.token);
    assert.deepEqual(fDetail.body.units.map((u) => u.code), ['MA1', 'HI1']);
    const fSession = await api('/api/study/sessions', A.token, { method: 'POST', body: { folderId: fid, mode: 'cards', count: 10 } });
    assert.deepEqual(fSession.body.items.map((i) => i.code).sort(), ['HI1-1', 'MA1-1']);
    await api(`/api/study/sessions/${fSession.body.session.id}/finish`, A.token, { method: 'POST' });
    const viaAi = await call(claude, 'list_study_folders');
    assert.equal(viaAi.data[0].name, 'Inför provet v. 42');
    const removed = await call(claude, 'save_study_folder', { folder_id: fid, remove_unit_ids: [hist.data.unit_id] });
    assert.deepEqual(removed.data.units.map((u) => u.code), ['MA1']);
    assert.equal((await api(`/api/study/folders/${fid}`, B.token)).status, 404, "someone else's folder is invisible");
    ok('Mappar: a folder across subjects, practise the whole folder (cards from MA1 + HI1), the AI lists and edits it');

    // ── övningsprov ─────────────────────────────────────────────────────────
    const test = await call(claude, 'create_practice_test', {
      unit_id: unitId,
      title: 'Övningsprov — Procent',
      description: 'Miniräknare tillåten.',
      time_limit_min: 30,
      questions: [
        { prompt: 'Hur mycket är 25 % av 80?', answer: { type: 'number', value: 20 }, solution: '$0{,}25 \\cdot 80 = 20$', level: 'E' },
        { prompt: 'Vilket är störst?', answer: { type: 'choice', choices: ['30 %', '0,35', '1/3'], correct_index: 1 }, solution: '0,35 > 1/3 ≈ 0,333 > 0,30', level: 'C' },
        { prompt: 'Vad heter delen av 100?', answer: { type: 'text', accepted: ['procent'] }, solution: 'Procent betyder hundradel.', level: 'E', points: { E: 1, C: 1 } },
        { prompt: 'Förklara varför 50 % rabatt två gånger inte blir gratis.', answer: { type: 'self', model_answer: 'E: den andra rabatten räknas på det nya priset. C: 0,5·0,5 = 0,25 kvar. A: generellt $(1-p)^2$.' }, level: 'A', points: { C: 1, A: 1 } }
      ]
    });
    assert.equal(test.isError, false, JSON.stringify(test));
    assert.deepEqual(test.data.question_codes, ['MA1-5', 'MA1-6', 'MA1-7', 'MA1-8']);
    assert.deepEqual(test.data.max_points, { E: 2, C: 3, A: 1, total: 6 });
    const testId = test.data.test_id;
    const practice = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [unitId], mode: 'mixed', count: 50 } });
    assert.ok(practice.body.items.every((i) => !['MA1-5', 'MA1-6', 'MA1-7', 'MA1-8'].includes(i.code)), 'test questions stay out of practice');
    const peek = await api(`/api/study/sessions/${practice.body.session.id}/answer`, A.token, { method: 'POST', body: { itemId: (await call(claude, 'get_study_item', { code: 'MA1-5' })).data.item_id, answer: '20' } });
    assert.equal(peek.status, 404, 'a practice session never reveals a test answer');
    await api(`/api/study/sessions/${practice.body.session.id}/finish`, A.token, { method: 'POST' });
    ok(`create_practice_test: MA1-5…8, 2/3/1 points (E/C/A); hidden from practice`);

    const bUnit = await api(`/api/study/units/${unitId}`, B.token);
    assert.equal(bUnit.body.tests.length, 1);
    const started = await api(`/api/study/tests/${testId}/start`, B.token, { method: 'POST' });
    assert.equal(started.status, 201);
    const qs = started.body.questions;
    assert.equal(qs.length, 4);
    assert.ok(qs.every((q) => q.solution === undefined && q.modelAnswer === undefined && q.hints === undefined), 'no answers before handing in');
    const resumed = await api(`/api/study/tests/${testId}/start`, B.token, { method: 'POST' });
    assert.equal(resumed.body.attempt.id, started.body.attempt.id);
    assert.equal(resumed.body.attempt.resumed, true);
    const attemptId = started.body.attempt.id;
    const byCode = (c) => qs.find((q) => q.code === c).itemId;
    const bad = await api(`/api/study/tests/attempts/${attemptId}/submit`, B.token, { method: 'POST', body: { answers: [{ itemId: byCode('MA1-5'), answer: 'tjugo' }] } });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.invalid[0].n, 1);
    const sub = await api(`/api/study/tests/attempts/${attemptId}/submit`, B.token, {
      method: 'POST',
      body: { answers: [
        { itemId: byCode('MA1-5'), answer: '20' },
        { itemId: byCode('MA1-6'), answer: 0 },
        { itemId: byCode('MA1-7'), answer: 'Procent' },
        { itemId: byCode('MA1-8'), answer: 'För att andra rabatten tas på det nya priset.' }
      ] }
    });
    assert.equal(sub.body.status, 'awaiting_self');
    assert.match(sub.body.needsSelf[0].modelAnswer, /nya priset/);
    const partialAssess = await api(`/api/study/tests/attempts/${attemptId}/assess`, B.token, { method: 'POST', body: { assessments: [] } });
    assert.equal(partialAssess.status, 400);
    const done = await api(`/api/study/tests/attempts/${attemptId}/assess`, B.token, { method: 'POST', body: { assessments: [{ itemId: byCode('MA1-8'), level: 'C' }] } });
    assert.equal(done.body.status, 'done');
    assert.deepEqual(done.body.score, { E: 2, C: 2, A: 0, total: 4 });
    assert.equal(done.body.xpEarned, 2 * 10 + 1 * 5 + 20);
    const view = await api(`/api/study/tests/attempts/${attemptId}`, B.token);
    assert.equal(view.body.answers.find((a) => a.code === 'MA1-6').expected, '0,35');
    assert.equal(view.body.answers.find((a) => a.code === 'MA1-8').selfLevel, 'C');
    assert.equal((await api(`/api/study/tests/attempts/${attemptId}`, A.token)).status, 404, "results are the student's own");
    const fresh = await api(`/api/study/tests/${testId}/start`, B.token, { method: 'POST' });
    assert.equal(fresh.status, 201, 'a finished test starts a new attempt');
    ok(`the friend takes the test in the app: "tjugo" not counted (422), self-assessed C → ${done.body.score.total}/6, estimated ${done.body.grade}, +${done.body.xpEarned} XP`);

    const sheet = await api(`/api/study/tests/${testId}/sheet`, A.token);
    assert.equal(sheet.body.questions.length, 4);
    assert.ok(sheet.body.questions.every((q) => q.solution === undefined));
    const got = await call(claude, 'get_practice_test', { code: 'ma1 7' });
    assert.equal(got.data.test_id, testId);
    assert.equal(got.data.questions[2].answer.accepted[0], 'procent');
    const wrongCode = await call(claude, 'record_paper_test', { test_id: testId, results: [{ code: 'MA1-2', points: { E: 1 } }], overall_feedback: 'x' });
    assert.equal(wrongCode.isError, true);
    const paper = await call(claude, 'record_paper_test', {
      code: 'MA1-5',
      minutes: 25,
      results: [
        { code: 'MA1-5', points: { E: 1 }, feedback: 'Rätt!' },
        { code: 'MA1-6', points: { C: 1 } },
        { code: 'MA1-7', points: { E: 5, C: 1 }, feedback: 'Rätt ord.' },
        { code: 'MA1-8', points: { C: 1, A: 1 }, feedback: 'Välutvecklat resonemang!' }
      ],
      overall_feedback: 'Mycket bra! Du behärskar procent. Öva på förändringsfaktor inför provet.'
    });
    assert.equal(paper.isError, false, JSON.stringify(paper));
    assert.deepEqual(paper.data.score, { E: 2, C: 3, A: 1, total: 6 }, 'points are capped at each question\'s value');
    assert.equal(paper.data.estimated_grade, 'A');
    const resent = await call(claude, 'record_paper_test', {
      code: 'MA1-5',
      minutes: 25,
      results: [
        { code: 'MA1-5', points: { E: 1 }, feedback: 'Rätt!' },
        { code: 'MA1-6', points: { C: 1 } },
        { code: 'MA1-7', points: { E: 5, C: 1 }, feedback: 'Rätt ord.' },
        { code: 'MA1-8', points: { C: 1, A: 1 }, feedback: 'Välutvecklat resonemang!' }
      ],
      overall_feedback: 'Mycket bra! Du behärskar procent. Öva på förändringsfaktor inför provet.'
    });
    assert.equal(resent.data.duplicate, true, 'the same paper result sent again is not counted twice');
    assert.equal(resent.data.xp_earned, 0);
    ok(`on paper: printable sheet without answers; the AI finds the test by a question code and records 6/6 → estimated ${paper.data.estimated_grade}`);

    // ── nivåstegen ──────────────────────────────────────────────────────────
    const lad = await call(claude, 'create_study_unit', { subject: 'matematik', grade_year: 8, title: 'Multiplikation' });
    const ladId = lad.data.unit_id;
    const facts = [['E', 2, 3], ['E', 3, 3], ['E', 4, 3], ['E', 5, 3], ['C', 12, 12], ['C', 13, 13], ['A', 17, 19]];
    const made = await call(claude, 'add_exercises', {
      unit_id: ladId,
      exercises: facts.map(([level, x, y]) => ({ prompt: `Räkna $${x} \\cdot ${y}$`, answer: { type: 'number', value: x * y }, solution: `${x * y}`, level }))
    });
    const value = Object.fromEntries(made.data.codes.map((c, i) => [c, String(facts[i][1] * facts[i][2])]));
    const ls = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [ladId], mode: 'ladder', count: 10 } });
    assert.equal(ls.status, 201, JSON.stringify(ls.body));
    assert.deepEqual([ls.body.ladder.level, ls.body.ladder.levels], ['E', ['E', 'C', 'A']]);
    const lsid = ls.body.session.id;
    let cur = ls.body.items[0];
    const step = async (right) => {
      const r = await api(`/api/study/sessions/${lsid}/answer`, A.token, { method: 'POST', body: { itemId: cur.id, answer: right ? value[cur.code] : '999' } });
      cur = r.body.ladder.next;
      return r.body.ladder;
    };
    assert.equal(cur.level, 'E');
    await step(true);
    await step(true);
    const up = await step(true);
    assert.deepEqual([up.level, up.moved, cur.level], ['C', 'up', 'C']);
    await step(false);
    const down = await step(false);
    assert.deepEqual([down.level, down.moved, down.reached, cur.level], ['E', 'down', 'C', 'E']);
    const ladFin = await api(`/api/study/sessions/${lsid}/finish`, A.token, { method: 'POST' });
    assert.equal(ladFin.body.ladderReached, 'C');
    const ladDetail = await api(`/api/study/units/${ladId}`, A.token);
    assert.deepEqual(ladDetail.body.levelProgress.E, { total: 4, mastered: 0 });
    ok('nivåstege: starts at E, 3 right → up to C, 2 wrong → back to E; highest level C; per-level progress on the unit');

    // ── Min plugg ───────────────────────────────────────────────────────────
    const act = await api('/api/study/activity?period=day', A.token);
    assert.equal(act.status, 200);
    assert.equal(act.body.totals.tests, 1);
    const testSession = act.body.timeline.sessions.find((s) => s.kind === 'test');
    assert.equal(testSession.test.grade, 'A');
    assert.equal(testSession.activeSeconds, 25 * 60);
    assert.equal(testSession.items.length, 4);
    assert.ok(testSession.items.every((i) => i.source === 'paper'));
    const week = await api('/api/study/activity?period=week', B.token);
    assert.ok(week.body.totals.answered >= 5);
    assert.equal(week.body.days.length, 7);
    assert.equal(week.body.bySubject[0].subject, 'matematik');
    const term = await api('/api/study/activity?period=term', B.token);
    assert.equal(term.body.timeline.kind, 'days');
    const viaAiActivity = await call(claude, 'get_study_activity', { period: 'week' });
    assert.ok(viaAiActivity.data.totals.answered >= act.body.totals.answered, 'the week includes today');
    assert.ok(viaAiActivity.data.sessions.some((s) => s.kind === 'test'));
    const overview = await api('/api/study/overview', A.token);
    assert.ok(overview.body.today.activeSeconds >= 25 * 60);
    assert.ok(overview.body.streak.current >= 1);
    ok(`Min plugg: today ${Math.round(act.body.totals.activeSeconds / 60)} min, the paper test with its grade; week per subject; term per day; the AI reads the week`);

    // ── ta bort, historik och ångra ─────────────────────────────────────────
    await call(claude, 'add_flashcards', { unit_id: unitId, cards: [{ front: 'Vad är 50 %?', back: 'Hälften', level: 'E' }] });
    const listed = (await api('/api/study/units?subject=matematik&allTerms=1', A.token)).body.units.find((u) => u.id === unitId);
    assert.deepEqual(listed.progress.levels, { E: 2, C: 1, A: 0 }, 'the level breakdown counts exercises only, not cards');
    const cardId = (await call(claude, 'get_study_item', { code: 'MA1-1' })).data.item_id;
    const sOwn = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [unitId], mode: 'cards' } });
    assert.ok(sOwn.body.items.every((i) => i.own === true));
    const sShared = await api('/api/study/sessions', B.token, { method: 'POST', body: { unitIds: [unitId], mode: 'cards' } });
    assert.ok(sShared.body.items.every((i) => i.own === false), 'a recipient never gets the bin');
    assert.equal((await api(`/api/study/items/${cardId}`, B.token, { method: 'DELETE' })).status, 403);
    const binned = await api(`/api/study/items/${cardId}`, A.token, { method: 'DELETE' });
    assert.deepEqual(binned.body, { deleted: 'MA1-1' });
    await call(claude, 'delete_study_items', { unit_id: unitId, codes: ['MA1-3'] });
    const log = await api(`/api/study/units/${unitId}/deletions`, A.token);
    assert.deepEqual(log.body.deletions.map((d) => [d.code, d.via]), [['MA1-3', 'ai'], ['MA1-1', 'app']]);
    assert.equal(log.body.deletions[1].back, 'En hundradel');
    const afterBin = await api(`/api/study/units/${unitId}`, A.token);
    assert.equal(afterBin.body.deletedCount, 2);
    assert.ok(!afterBin.body.items.some((i) => ['MA1-1', 'MA1-3'].includes(i.code)));
    const aiView = await call(claude, 'get_study_unit', { unit_id: unitId, include_pages: false });
    assert.deepEqual(aiView.data.recently_deleted.map((d) => d.code), ['MA1-3', 'MA1-1']);
    assert.equal((await api(`/api/study/units/${unitId}/deletions`, B.token)).status, 403);
    const undo = await api(`/api/study/units/${unitId}/deletions/${log.body.deletions[1].id}/restore`, A.token, { method: 'POST' });
    assert.equal(undo.body.restored, 'MA1-1');
    const back = await api(`/api/study/units/${unitId}`, A.token);
    assert.equal(back.body.items.find((i) => i.code === 'MA1-1').id, cardId, 'restored with its old code and id');
    assert.equal((await api(`/api/study/units/${unitId}/deletions/${log.body.deletions[1].id}/restore`, A.token, { method: 'POST' })).status, 409);
    ok('bin: recipients can\'t delete; app and AI deletions are logged with who/where; undo brings MA1-1 back with its code and id');

    // ── feedback från en riktig MCP-session ─────────────────────────────────
    const dupUnit = await call(claude, 'create_study_unit', { subject: 'matematik', grade_year: 8, title: 'kapitel 4 — procent' });
    assert.equal(dupUnit.error?.code, 'conflict', 'same title + subject + term is refused');
    assert.match(dupUnit.error.message, new RegExp(unitId));
    const drill = await call(claude, 'create_study_unit', { subject: 'matematik', grade_year: 7, title: 'Drill — tal' });
    const drillId = drill.data.unit_id;
    const exs = [
      { prompt: 'Beräkna $10 / 3$ med alla decimaler', answer: { type: 'number', value: 3.3333333 }, solution: '3,333…', level: 'C' },
      { prompt: 'Beräkna $0{,}043 \\cdot 1$', answer: { type: 'number', value: 0.043 }, solution: '0,043', level: 'E' },
      { prompt: 'Vilka av talen är primtal?', answer: { type: 'multi', choices: ['21', '23', '27', '29'], correct_indices: [1, 3] }, solution: '23 och 29', level: 'C', skill: 'primtal' },
      { prompt: 'Skriv talen i storleksordning, minst först', answer: { type: 'order', items: ['0,05', '0,5', '5'] }, solution: '0,05 < 0,5 < 5', level: 'E' },
      { prompt: 'Primtalsfaktorisera 90', answer: { type: 'factors', factors: [2, 3, 3, 5] }, solution: '$90 = 2 \\cdot 3 \\cdot 3 \\cdot 5$', level: 'C', skill: 'primtal' },
      {
        prompt: 'Beräkna {{a}} · {{b}}\n\n```svg\n<svg viewBox="0 0 120 20" width="120"><line x1="0" y1="10" x2="120" y2="10" stroke="black"/></svg>\n```',
        answer: { type: 'number', expr: 'a * b' }, solution: '{{a}} · {{b}} = {{ a * b }}', level: 'E', skill: 'multiplikation',
        template: { vars: [{ name: 'a', int: [2, 9] }, { name: 'b', int: [2, 9] }], where: ['a != b'] }
      }
    ];
    const added = await call(claude, 'add_exercises', { unit_id: drillId, exercises: exs });
    assert.equal(added.isError, false, JSON.stringify(added));
    assert.equal(added.warnings.length, 1, 'one summary warning, only for 3.3333333');
    assert.match(added.warnings[0], /Exercise\(s\) 1:/);
    assert.equal(added.data.template_examples[0].examples.length, 2);
    const retry = await call(claude, 'add_exercises', { unit_id: drillId, exercises: exs });
    assert.deepEqual(retry.data.codes, []);
    assert.equal(retry.data.skipped_duplicates.length, 6, 'a retried call adds nothing');
    const badSvg = await call(claude, 'add_exercises', { unit_id: drillId, exercises: [{ prompt: '```svg\n<svg onload="alert(1)"></svg>\n```', answer: { type: 'number', value: 1 }, solution: '1', level: 'E' }] });
    assert.equal(badSvg.error?.code, 'invalid_input');
    const badTpl = await call(claude, 'add_exercises', { unit_id: drillId, exercises: [{ prompt: '{{a}}', answer: { type: 'number', expr: 'a +' }, solution: 'x', level: 'E', template: { vars: [{ name: 'a', int: [1, 2] }] } }] });
    assert.match(badTpl.error?.message || '', /template problem/);

    const ds = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [drillId], mode: 'exercises', count: 10 } });
    const byPrompt = (re) => ds.body.items.find((i) => re.test(i.prompt));
    const dsid = ds.body.session.id;
    const say = (item, answer, extra = {}) => api(`/api/study/sessions/${dsid}/answer`, A.token, { method: 'POST', body: { itemId: item.id, answer, ...extra } });
    const multiItem = byPrompt(/primtal\?/);
    assert.deepEqual((await say(multiItem, [3, 1])).body.result, 'correct');
    const orderItem = byPrompt(/storleksordning/);
    assert.deepEqual([...orderItem.items].sort(), ['0,05', '0,5', '5'].sort(), 'the items to order arrive shuffled (fully random)');
    assert.equal((await say(orderItem, ['0,05', '0,5', '5'])).body.result, 'correct');
    const factorItem = byPrompt(/faktorisera/);
    assert.equal((await say(factorItem, '3·2·5·3')).body.result, 'correct');
    const tpl = ds.body.items.find((i) => i.templated);
    assert.ok(tpl.seed && !tpl.prompt.includes('{{'), 'a template arrives as an instance with its seed');
    const [, x, y] = /Beräkna (\d+) · (\d+)/.exec(tpl.prompt);
    assert.equal((await say(tpl, String(x * y))).status, 422, 'no seed → not graded');
    const tplRes = await say(tpl, String(x * y), { seed: tpl.seed });
    assert.equal(tplRes.body.result, 'correct');
    assert.equal(tplRes.body.solution, `${x} · ${y} = ${x * y}`);
    await api(`/api/study/sessions/${dsid}/finish`, A.token, { method: 'POST' });
    const again2 = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [drillId], mode: 'exercises', count: 10 } });
    await api(`/api/study/sessions/${again2.body.session.id}/finish`, A.token, { method: 'POST' });
    const bySkill = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [drillId], mode: 'exercises', skills: ['primtal'] } });
    assert.equal(bySkill.body.items.length, 2, 'practise one skill');
    await api(`/api/study/sessions/${bySkill.body.session.id}/finish`, A.token, { method: 'POST' });

    const tplTest = await call(claude, 'create_practice_test', { unit_id: drillId, title: 'x', questions: [exs[5]] });
    assert.match(tplTest.error?.message || '', /templates are for practice/);
    const parts = await call(claude, 'create_practice_test', {
      unit_id: drillId,
      title: 'Diagnos — Tal',
      questions: [
        { ...exs[2], part: 'Del A — utan miniräknare' },
        { ...exs[4], part: 'Del A — utan miniräknare' },
        { prompt: 'Beräkna $12 \\cdot 12$', answer: { type: 'number', value: 144 }, solution: '144', level: 'E', skill: 'multiplikation', part: 'Del B' }
      ]
    });
    assert.equal(parts.isError, false, JSON.stringify(parts));
    assert.equal((await call(claude, 'create_practice_test', { unit_id: drillId, title: 'diagnos — tal', questions: [exs[2]] })).error?.code, 'conflict');
    const partSheet = await api(`/api/study/tests/${parts.data.test_id}/sheet`, A.token);
    assert.deepEqual(partSheet.body.questions.map((q) => q.part), ['Del A — utan miniräknare', 'Del A — utan miniräknare', 'Del B']);
    const paperDiag = await call(claude, 'record_paper_test', {
      test_id: parts.data.test_id,
      results: [{ code: parts.data.question_codes[0], points: { C: 1 } }, { code: parts.data.question_codes[2], points: { E: 1 } }],
      overall_feedback: 'Öva mer på primtal.'
    });
    assert.deepEqual(paperDiag.data.by_skill.map((r) => [r.skill, r.points]), [['primtal', '1/2'], ['multiplikation', '1/1']]);
    ok('feedback: duplicate unit refused; one tolerance warning (exact decimals pass); retries skip; svg checked; multi/order/factors graded; templates with seeds; skill practice; test parts and per-skill result');

    // ── städning ────────────────────────────────────────────────────────────
    const delTest = await call(claude, 'delete_practice_test', { test_id: testId });
    assert.equal(delTest.isError, false);
    const afterDel = await api(`/api/study/tests/attempts/${attemptId}`, B.token);
    assert.equal(afterDel.body.testExists, false, 'results survive the test');
    assert.equal(afterDel.body.score.total, 4);
    await api(`/api/study/units/${unitId}/share/${B.id}`, A.token, { method: 'DELETE' });
    assert.equal((await api(`/api/study/units/${unitId}`, B.token)).status, 404);
    await claude.close();
    ok('delete_practice_test keeps the results; removing the friend takes the unit away');

    // Skaparen raderar sitt konto: vännens resultat finns kvar, utan skaparens texter.
    assert.equal((await api('/api/me', A.token, { method: 'DELETE' })).status, 200);
    const orphan = await api(`/api/study/tests/attempts/${attemptId}`, B.token);
    assert.equal(orphan.status, 200);
    assert.equal(orphan.body.unitTitle, 'Raderat område');
    assert.equal(orphan.body.testTitle, 'Raderat prov');
    assert.ok(orphan.body.answers.every((a) => a.prompt === '' && a.solution === ''), 'no questions or solutions left from the creator');
    assert.equal(orphan.body.score.total, 4);
    ok('the creator deletes the account: the friend keeps the result, without the creator\'s titles and questions');
  } finally {
    for (const u of [A, B, C]) await api('/api/me', u.token, { method: 'DELETE' }).catch(() => {});
    console.log('  · deleted throwaway users');
  }
  console.log('All good.');
}

main().catch((err) => {
  console.error('\nE2E FAILED:', err.message);
  process.exit(1);
});
