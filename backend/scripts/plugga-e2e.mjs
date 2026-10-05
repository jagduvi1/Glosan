// End-to-end-test av Plugga fas 1 mot en KÖRANDE Glosan (via nginx):
// AI:n skapar ett område via MCP → rättar en papperslösning → eleven övar i
// appen (rättas på servern) → XP och streak → felrapport → AI:n rättar och
// stänger → en annan användare ser ingenting. Engångsanvändare raderas efteråt.
//
// Plugga är på för alla sedan v0.1.39. Är det inte det (en dold modul igen)
// slås flaggan på för testanvändarna direkt i den lokala databasen.
//
//   FRONTEND_URL=http://localhost:8080 docker compose up --build -d
//   cd backend && node scripts/plugga-e2e.mjs http://localhost:8080
import assert from 'node:assert/strict';
import { e2e, grantFeatureInLocalDb, inDays } from './lib/e2e.mjs';

const { BASE, ok, api, register, connectMcp, call } = e2e(process.argv[2]);

async function main() {
  console.log(`Plugga e2e against ${BASE}`);
  const users = [];
  const signUp = async (prefix) => { const u = await register(prefix); users.push(u); return u; };
  try {
    const A = await signUp('plugga');
    const B = await signUp('pluggb');
    // Är Plugga inte på för alla slås det på för testanvändaren direkt i den lokala databasen.
    if ((await api('/api/study/overview', A.token)).status !== 200) grantFeatureInLocalDb(A.name, 'study');
    assert.equal((await api('/api/study/overview', A.token)).status, 200, 'Plugga must be enabled for the test user');
    ok('Plugga enabled for the test user');

    const claude = await connectMcp(A.token);
    const tools = (await claude.listTools()).tools.map((t) => t.name);
    assert.ok(tools.includes('create_study_unit') && tools.includes('record_paper_attempt'));
    assert.match(claude.getInstructions() || '', /årskurs/);
    const prompts = (await claude.listPrompts()).prompts.map((p) => p.name);
    assert.ok(prompts.includes('study_from_photos') && prompts.includes('check_my_solution'));
    ok(`MCP: ${tools.filter((t) => t.includes('study') || t.includes('flashcard') || t.includes('exercise') || t.includes('paper')).length} study tools, study prompts and instructions (asks årskurs)`);

    const noGrade = await call(claude, 'create_study_unit', { subject: 'matematik', title: 'x' });
    assert.equal(noGrade.isError, true);
    const created = await call(claude, 'create_study_unit', {
      subject: 'matematik',
      grade_year: 8,
      title: 'Kapitel 3 — Ekvationer',
      source: { book: 'Matte Direkt 8', chapter: '3 Ekvationer', pages: '98–124' },
      exam_date: inDays(10),
      pages: [{
        title: 'Så löser du en ekvation',
        body: '## Det här ska du kunna\n- Lösa ekvationer som $2x + 3 = 11$\n\n## Så gör du\n1. Subtrahera 3 i båda led: $2x = 8$\n2. Dividera med 2: $x = 4$\n\n$$\\frac{2x}{2} = \\frac{8}{2}$$'
      }]
    });
    assert.equal(created.isError, false, JSON.stringify(created));
    assert.equal(created.data.code, 'MA1');
    assert.equal(created.data.grade_year, 8);
    const unitId = created.data.unit_id;
    ok(`create_study_unit refuses without årskurs; creates MA1 (åk 8, test in 10 days) with a genomgång`);

    const cards = await call(claude, 'add_flashcards', {
      unit_id: unitId,
      cards: [
        { front: 'Vad är en **variabel**?', back: 'En bokstav som står för ett okänt tal, t.ex. $x$.' },
        { front: 'Vad betyder "i båda led"?', back: 'Att man gör samma sak på båda sidor om likhetstecknet.' },
        { front: 'Vad är en **koefficient**?', back: 'Talet framför variabeln, t.ex. 2 i $2x$.', level: 'E' }
      ]
    });
    assert.deepEqual(cards.data.codes, ['MA1-1', 'MA1-2', 'MA1-3']);
    const noSolution = await call(claude, 'add_exercises', {
      unit_id: unitId,
      exercises: [{ prompt: 'Lös $x+1=2$', answer: { type: 'number', value: 1 }, level: 'E' }]
    });
    assert.equal(noSolution.isError, true);
    const ex = await call(claude, 'add_exercises', {
      unit_id: unitId,
      exercises: [
        { prompt: 'Lös ekvationen $2x + 3 = 11$', answer: { type: 'number', value: 4 }, solution: '$2x = 8$\n\n$x = 4$', hints: ['Börja med att ta bort 3 i båda led.'], level: 'E', skill: 'tvåstegsekvationer', source_ref: 'uppg 3.14' },
        { prompt: 'Lös $4x = 10$', answer: { type: 'number', value: 2.5, tolerance: 0.01 }, solution: '$x = 10/4 = 2{,}5$', level: 'E' },
        { prompt: 'Lös $6x = 3$', answer: { type: 'number', value: 0.5 }, solution: '$x = 3/6 = 0{,}5$', level: 'C' },
        { prompt: 'Vilket värde på $x$ löser $3x - 4 = 2x + 1$?', answer: { type: 'choice', choices: ['$x = 1$', '$x = 3$', '$x = 5$'], correct_index: 2 }, solution: 'Subtrahera $2x$: $x - 4 = 1$, så $x = 5$.', level: 'C' },
        { prompt: 'Vad kallas talet framför variabeln?', answer: { type: 'text', accepted: ['koefficient', 'koefficienten'] }, solution: 'Det kallas koefficient.', level: 'C' },
        { prompt: 'Förklara varför man får dividera med samma tal i båda led.', answer: { type: 'self', model_answer: 'E: Likheten gäller fortfarande. C: … A: …' }, level: 'A' }
      ]
    });
    assert.equal(ex.isError, false, JSON.stringify(ex));
    assert.deepEqual(ex.data.codes, ['MA1-4', 'MA1-5', 'MA1-6', 'MA1-7', 'MA1-8', 'MA1-9']);
    assert.equal(ex.warnings, undefined, 'no rounding warning for a short exact decimal (0.5)');
    const page2 = await call(claude, 'get_study_unit', { unit_id: unitId, codes: ['MA1-4', 'MA1-5'], include_pages: false });
    assert.deepEqual(page2.data.items.map((i) => i.code), ['MA1-4', 'MA1-5']);
    const paged = await call(claude, 'get_study_unit', { unit_id: unitId, items_limit: 4, include_pages: false });
    assert.deepEqual([paged.data.items.length, paged.data.items_total, paged.data.items_next_offset], [4, 9, 4]);
    const pageId = (await call(claude, 'get_study_unit', { unit_id: unitId, include_items: false })).data.pages[0].page_id;
    const fullPage = await call(claude, 'get_study_page', { page_id: pageId });
    const samePage = await call(claude, 'add_study_pages', { unit_id: unitId, pages: [{ title: fullPage.data.title, body: fullPage.data.body }] });
    assert.equal(samePage.data.length, 0, 'an identical page is skipped');
    const gone = await call(claude, 'delete_study_page', { page_id: pageId });
    assert.equal(gone.data.deleted_page.title, fullPage.data.title);
    await call(claude, 'add_study_pages', { unit_id: unitId, pages: [gone.data.deleted_page] });
    ok('get_study_unit pages through items (codes, items_limit); get_study_page; identical pages skipped; delete_study_page returns the page');
    ok('flashcards MA1-1…3; exercises MA1-4…9 on E/C/A (missing solution refused, no noise about 0.5)');

    const unit = await call(claude, 'get_study_unit', { unit_id: unitId });
    assert.equal(unit.data.pages.length, 1);
    assert.equal(unit.data.items.find((i) => i.code === 'MA1-4').answer.value, 4);
    const byCode = await call(claude, 'get_study_item', { code: 'ma1 4' });
    assert.equal(byCode.data.code, 'MA1-4');
    assert.equal(byCode.data.source_ref, 'uppg 3.14');
    assert.deepEqual(byCode.data.my_history, []);
    ok('get_study_unit (with answers) and get_study_item by a handwritten-style code ("ma1 4")');

    const paper = await call(claude, 'record_paper_attempt', {
      code: 'MA1-4', result: 'correct', given: 'x = 4', minutes: 5,
      feedback: 'Snyggt! Du tog bort 3 i båda led och delade med 2. Kontrollera gärna genom att sätta in x = 4.'
    });
    assert.equal(paper.data.xp_earned, 10);
    const resent = await call(claude, 'record_paper_attempt', {
      code: 'MA1-4', result: 'correct', given: 'x = 4', minutes: 5,
      feedback: 'Snyggt! Du tog bort 3 i båda led och delade med 2. Kontrollera gärna genom att sätta in x = 4.'
    });
    assert.equal(resent.data.duplicate, true);
    assert.equal(resent.data.xp_earned, 0);
    const again = await call(claude, 'get_study_item', { code: 'MA1-4' });
    assert.equal(again.data.my_history.length, 1);
    assert.equal(again.data.my_history[0].source, 'paper');
    ok('paper flow: record_paper_attempt (+10 XP), history with the AI feedback; the same call again is not counted twice');

    const units = await api('/api/study/units?subject=matematik&allTerms=1', A.token);
    assert.equal(units.body.units.length, 1);
    assert.equal(units.body.units[0].progress.total, 9);
    assert.equal(units.body.units[0].progress.seen, 1);
    const detail = await api(`/api/study/units/${unitId}`, A.token);
    const items = detail.body.items;
    assert.ok(items.every((i) => i.answer === undefined && i.solution === undefined), 'no answers or solutions in the app payload');
    assert.match(items.find((i) => i.code === 'MA1-4').lastPaper.feedback, /Snyggt/);
    assert.ok(items.find((i) => i.code === 'MA1-9').modelAnswer);
    ok('app: unit list with progress; unit page without answers/solutions, with the paper feedback');

    const start = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [unitId], mode: 'mixed', count: 20 } });
    assert.equal(start.status, 201);
    const sid = start.body.session.id;
    const code = (c) => start.body.items.find((i) => i.code === c);
    assert.equal(start.body.items.length, 9);
    const answer = (c, body) => api(`/api/study/sessions/${sid}/answer`, A.token, { method: 'POST', body: { itemId: code(c).id, ...body } });
    const bad = await answer('MA1-4', { answer: 'fyra' });
    assert.equal(bad.status, 422);
    const results = {
      'MA1-1': await answer('MA1-1', { self: 'correct' }),
      'MA1-2': await answer('MA1-2', { self: 'partial' }),
      'MA1-3': await answer('MA1-3', { self: 'correct' }),
      'MA1-4': await answer('MA1-4', { answer: '4' }),
      'MA1-5': await answer('MA1-5', { answer: '2,5' }),
      'MA1-6': await answer('MA1-6', { answer: '1/2' }),
      'MA1-7': await answer('MA1-7', { answer: 0 }),
      'MA1-8': await answer('MA1-8', { answer: 'koeficient' }),
      'MA1-9': await answer('MA1-9', { self: 'partial', answer: 'För att likheten fortfarande gäller.' })
    };
    assert.deepEqual(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.body.result])), {
      'MA1-1': 'correct', 'MA1-2': 'partial', 'MA1-3': 'correct', 'MA1-4': 'correct', 'MA1-5': 'correct',
      'MA1-6': 'correct', 'MA1-7': 'wrong', 'MA1-8': 'correct', 'MA1-9': 'partial'
    });
    assert.equal(results['MA1-7'].body.expected, '$x = 5$');
    assert.match(results['MA1-8'].body.note, /stavas/);
    assert.match(results['MA1-7'].body.solution, /x = 5/);
    assert.equal((await answer('MA1-4', { answer: '4' })).status, 409, 'the same item cannot be answered twice in a session');
    const other = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [unitId], mode: 'cards' } });
    const foreign = await api(`/api/study/sessions/${other.body.session.id}/answer`, A.token, { method: 'POST', body: { itemId: code('MA1-4').id, answer: '4' } });
    assert.equal(foreign.status, 404, 'an item the session did not serve is refused');
    ok('practice: "fyra" not counted (422); cards, 2,5 · 1/2 · typo "koeficient" right, wrong choice shows answer + solution; no second answer, no unserved item');

    const fin = await api(`/api/study/sessions/${sid}/finish`, A.token, { method: 'POST' });
    assert.equal(fin.body.answered, 9);
    assert.equal(fin.body.correct, 6);
    assert.equal(fin.body.xpEarned, 6 * 10 + 2 * 5);
    assert.equal((await api(`/api/study/sessions/${sid}/finish`, A.token, { method: 'POST' })).status, 404, 'a session finishes (and pays XP) once');
    assert.ok(fin.body.streak.current >= 1);
    const me = await api('/api/auth/me', A.token);
    assert.equal(me.body.user.subjectXp.matematik, 10 + 70);
    ok(`finish: 6/9 right → +${fin.body.xpEarned} XP, streak ${fin.body.streak.current}; subject XP matematik = ${me.body.user.subjectXp.matematik}`);

    const wrongMode = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [unitId], mode: 'wrong' } });
    assert.deepEqual(wrongMode.body.items.map((i) => i.code), ['MA1-7']);
    await api(`/api/study/sessions/${wrongMode.body.session.id}/finish`, A.token, { method: 'POST' });
    const hard = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [unitId], mode: 'exercises', levels: ['A'] } });
    assert.deepEqual(hard.body.items.map((i) => i.code), ['MA1-9']);
    await api(`/api/study/sessions/${hard.body.session.id}/finish`, A.token, { method: 'POST' });
    ok('"Bara fel" returns only the missed MA1-7; level filter A returns only MA1-9');

    const flag = await api(`/api/study/items/${code('MA1-5').id}/flag`, A.token, { method: 'POST', body: { note: 'Borde inte svaret vara 2,5?' } });
    assert.equal(flag.status, 201);
    const flags = await call(claude, 'list_study_flags');
    assert.equal(flags.data.length, 1);
    assert.equal(flags.data[0].code, 'MA1-5');
    assert.equal(flags.data[0].reporter_note_untrusted, 'Borde inte svaret vara 2,5?', 'the note is labelled as untrusted');
    assert.equal(flags.total_open, 1);
    const fixed = await call(claude, 'update_study_item', { code: 'MA1-5', solution: 'Dela båda led med 4: $x = \\frac{10}{4} = 2{,}5$' });
    assert.equal(fixed.isError, false);
    await call(claude, 'resolve_study_flag', { flag_id: flags.data[0].flag_id, note: 'Förtydligade lösningen.' });
    assert.equal((await call(claude, 'list_study_flags')).data.length, 0);
    const closedTwice = await call(claude, 'resolve_study_flag', { flag_id: flags.data[0].flag_id });
    assert.equal(closedTwice.data.already_closed, true, 'closing twice is fine (idempotent)');
    ok('"fel i facit" → list_study_flags → update_study_item → resolve_study_flag');

    const reading = await api('/api/study/sessions', A.token, { method: 'POST', body: { unitIds: [unitId], mode: 'reading' } });
    assert.equal(reading.status, 201);
    assert.equal((await api(`/api/study/sessions/${reading.body.session.id}/ping`, A.token, { method: 'POST' })).status, 200);
    assert.equal((await api(`/api/study/sessions/${reading.body.session.id}/finish`, A.token, { method: 'POST' })).status, 200);
    ok('reading session: start, ping, finish');

    const progress = await call(claude, 'get_study_progress', { unit_id: unitId });
    assert.deepEqual(progress.data.keeps_missing.map((w) => w.code), ['MA1-7']);
    ok('get_study_progress tells the AI what the student keeps missing (MA1-7)');

    // B ska ha modulen — det är åtkomstkontrollen som testas, inte flaggan.
    if ((await api('/api/study/overview', B.token)).status !== 200) grantFeatureInLocalDb(B.name, 'study');
    assert.equal((await api(`/api/study/units/${unitId}`, B.token)).status, 404);
    const claudeB = await connectMcp(B.token);
    assert.equal((await call(claudeB, 'get_study_item', { code: 'MA1-4' })).error.code, 'not_found');
    assert.equal((await call(claudeB, 'update_study_unit', { unit_id: unitId, title: 'hack' })).error.code, 'not_found');
    await claudeB.close();
    ok("another user can't see or change the unit (app 404, MCP not_found)");

    await call(claude, 'update_study_unit', { unit_id: unitId, archived: true });
    assert.equal((await api('/api/study/overview', A.token)).body.totalUnits, 0);
    const del = await call(claude, 'delete_study_unit', { unit_id: unitId });
    assert.equal(del.isError, false);
    assert.equal((await api(`/api/study/units/${unitId}`, A.token)).status, 404);
    await claude.close();
    ok('archive hides the unit; delete_study_unit removes it');
  } finally {
    let leftover = 0;
    for (const u of users) {
      const r = await api('/api/me', u.token, { method: 'DELETE' }).catch(() => ({ status: 0 }));
      if (r.status !== 200) { leftover += 1; console.log(`  ! could not delete ${u.name} (${r.status})`); }
    }
    if (!leftover) console.log('  · deleted throwaway users');
  }
  console.log('All good.');
}

main().catch((err) => {
  console.error('\nE2E FAILED:', err.message);
  process.exit(1);
});
