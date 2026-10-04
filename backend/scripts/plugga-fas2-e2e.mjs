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
import { e2e, grantFeatureInLocalDb, fillStudyLinkInLocalDb, inDays } from './lib/e2e.mjs';

const { BASE, ok, api, register, connectMcp, call } = e2e(process.argv[2]);

async function hasPlugga(user) {
  return (await api('/api/study/overview', user.token)).status === 200;
}

async function main() {
  console.log(`Plugga fas 2 e2e against ${BASE}`);
  const users = [];
  const signUp = async (prefix) => { const u = await register(prefix); users.push(u); return u; };
  try {
    const A = await signUp('p2creator');
    const B = await signUp('p2friend');
    const C = await signUp('p2mate');
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

    // ── dela med en kompis: hen får en EGEN KOPIA ───────────────────────────
    const invite = await api('/api/me/invite-codes', A.token, { method: 'POST' });
    const befriended = await api('/api/me/friends/by-code', B.token, { method: 'POST', body: { code: invite.body.inviteCode.code } });
    assert.ok(befriended.status < 300, JSON.stringify(befriended.body));
    const shared = await api(`/api/study/units/${unitId}/share`, A.token, { method: 'POST', body: { friendIds: [B.id] } });
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    assert.deepEqual(shared.body.copies.map((r) => r.username), [B.name]);
    assert.deepEqual(shared.body.recipients, [], 'nobody new follows the original');
    assert.ok(await hasPlugga(B), 'the friend gets Plugga');
    const bUnits = await api('/api/study/units?allTerms=1', B.token);
    assert.equal(bUnits.body.units.length, 1);
    const bCopy = bUnits.body.units[0];
    const bCopyId = bCopy.id;
    assert.notEqual(bCopyId, unitId, 'a copy, not the original');
    assert.deepEqual([bCopy.code, bCopy.title, bCopy.isOwner, bCopy.isCopy, bCopy.copiedFrom, bCopy.sharedBy], ['MA1', 'Kapitel 4 — Procent', true, true, A.name, null]);
    const bDetail = await api(`/api/study/units/${bCopyId}`, B.token);
    assert.deepEqual(bDetail.body.items.map((i) => i.code), ['MA1-1', 'MA1-2', 'MA1-3', 'MA1-4'], 'the same items and codes');
    assert.equal(bDetail.body.pages.length, 1);
    assert.equal((await api(`/api/study/units/${unitId}`, B.token)).status, 404, 'the original stays the creator\'s');
    const notFriend = await api(`/api/study/units/${unitId}/share`, A.token, { method: 'POST', body: { friendIds: [C.id] } });
    assert.equal(notFriend.status, 400);
    // B övar på sin kopia — med sin egen statistik.
    const bSession = await api('/api/study/sessions', B.token, { method: 'POST', body: { unitIds: [bCopyId], mode: 'exercises' } });
    const firstEx = bSession.body.items.find((i) => i.code === 'MA1-2');
    const bAnswer = await api(`/api/study/sessions/${bSession.body.session.id}/answer`, B.token, { method: 'POST', body: { itemId: firstEx.id, answer: '20 kr' } });
    assert.equal(bAnswer.body.result, 'correct');
    await api(`/api/study/sessions/${bSession.body.session.id}/finish`, B.token, { method: 'POST' });
    const aDetail = await api(`/api/study/units/${unitId}`, A.token);
    assert.equal(aDetail.body.items.find((i) => i.code === 'MA1-2').state, null, "the friend's progress is the friend's own");
    assert.equal(aDetail.body.unit.sharedCount, 1);
    // Kopian är B:s: B tar bort en övning hen inte vill ha — A:s original är orört.
    const bDrop = bDetail.body.items.find((i) => i.code === 'MA1-4');
    assert.equal((await api(`/api/study/items/${bDrop.id}`, B.token, { method: 'DELETE' })).status, 200);
    assert.ok((await api(`/api/study/units/${unitId}`, A.token)).body.items.some((i) => i.code === 'MA1-4'), 'the original keeps it');
    // B:s AI ser kopian som B:s egen — men skriven av någon annan.
    const bClaude = await connectMcp(B.token);
    const bAiCopy = await call(bClaude, 'get_study_unit', { unit_id: bCopyId, include_pages: false });
    assert.deepEqual([bAiCopy.data.is_owner, bAiCopy.data.copied_from, bAiCopy.data.written_by_someone_else], [true, A.name, true]);
    const bOwn = await call(bClaude, 'create_study_unit', { subject: 'matematik', grade_year: 8, title: 'Mitt eget' });
    assert.equal(bOwn.data.code, 'MA2', 'the copy took MA1 — codes are per account and never reused');
    await call(bClaude, 'delete_study_unit', { unit_id: bOwn.data.unit_id });
    await bClaude.close();
    // Arkiverar skaparen sitt original påverkas inte kopian.
    await call(claude, 'update_study_unit', { unit_id: unitId, archived: true });
    assert.equal((await api(`/api/study/units/${bCopyId}`, B.token)).status, 200, 'the copy is not affected');
    const withArchived = await call(claude, 'list_study_units', { include_archived: true });
    assert.ok(withArchived.data.some((u) => u.unit_id === unitId && u.archived), 'include_archived finds it again');
    await call(claude, 'update_study_unit', { unit_id: unitId, archived: false });
    ok(`shared with a friend: ${forAll ? '' : 'Plugga switched on, '}they get their OWN copy (same codes, own progress, own bin; their AI sees whose text it is); non-friends refused; archiving the original leaves it alone`);

    // ── QR-länk: alla som går med får en egen kopia ─────────────────────────
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
    // En AI som C kopplade innan Plugga slogs på får inte Plugga av sig själv.
    const hasStudyTools = async (client) => (await client.listTools()).tools.some((t) => t.name === 'create_study_unit');
    const cEarly = forAll ? null : await connectMcp(C.token);
    if (cEarly) assert.equal(await hasStudyTools(cEarly), false);
    const joined = await api(`/api/study-invite/${code}/accept`, C.token, { method: 'POST' });
    assert.equal(joined.body.joined, true, JSON.stringify(joined.body));
    const cCopyId = joined.body.unitId;
    assert.notEqual(cCopyId, unitId);
    assert.deepEqual(joined.body.unitIds, [cCopyId]);
    assert.equal((await api(`/api/study/units/${cCopyId}`, C.token)).body.unit.copiedFrom, A.name);
    assert.ok(await hasPlugga(C), 'the classmate gets Plugga');
    if (cEarly) {
      assert.equal(await hasStudyTools(cEarly), false, 'an old connection does not widen by itself');
      const cConns = await api('/api/mcp/connections', C.token);
      assert.deepEqual(cConns.body.connections[0].missingModules, [{ key: 'study', label: 'Plugga' }]);
      const cLater = await connectMcp(C.token);
      assert.equal(await hasStudyTools(cLater), true, 'a new connection gets Plugga');
      await cEarly.close();
      await cLater.close();
    }
    const again = await api(`/api/study-invite/${code}/accept`, C.token, { method: 'POST' });
    assert.deepEqual([again.body.joined, again.body.unitId], [false, cCopyId], 'opening it again gives no second copy');
    const own = await api(`/api/study-invite/${code}/accept`, A.token, { method: 'POST' });
    assert.equal(own.body.own, true);
    const shares = await api(`/api/study/units/${unitId}/shares`, A.token);
    assert.deepEqual(shares.body.copies.map((r) => r.username).sort(), [B.name, C.name].sort());
    assert.equal(shares.body.links[0].usedCount, 1, 'opening it twice uses one place');
    const cFriends = await api('/api/me/friends', C.token);
    assert.ok(!cFriends.body.friends.some((f) => f.username === A.name), 'joining does not befriend the creator');
    await api(`/api/study/units/${unitId}/share-links/${code}`, A.token, { method: 'DELETE' });
    assert.equal((await api(`/api/study-invite/${code}`)).status, 404);
    assert.equal((await api(`/api/study/units/${cCopyId}`, C.token)).status, 200, 'closing the link takes no copy back');
    // C tar bort sin kopia i appen; originalet tas bort av skaparens AI, inte här.
    assert.equal((await api(`/api/study/units/${unitId}`, C.token, { method: 'DELETE' })).status, 404, 'nobody deletes someone else\'s unit');
    assert.equal((await api(`/api/study/units/${unitId}`, A.token, { method: 'DELETE' })).status, 400, 'an original is deleted by its AI');
    assert.equal((await api(`/api/study/units/${cCopyId}`, C.token, { method: 'DELETE' })).status, 200);
    assert.equal((await api(`/api/study/units/${cCopyId}`, C.token)).status, 404);
    assert.equal((await api(`/api/study/units/${unitId}`, A.token)).status, 200);
    ok(`QR link: public preview (no grade, book or description); each joiner gets their own copy (once, no friendship); closing the link takes nothing back; a copy is deleted in the app${forAll ? '' : '; an AI connected before Plugga stays without it until reconnected'}`);

    // ── Dela flera på en gång (Plugga-sidornas Dela: ett kapitel, en mapp) ──
    const histId = hist.data.unit_id;
    const multi = await api('/api/study/share-links', A.token, { method: 'POST', body: { unitIds: [unitId, histId], ttlDays: 7, maxUses: 30, title: 'Allt inför provet' } });
    assert.equal(multi.status, 201);
    assert.equal(multi.body.link.unitCount, 2);
    const multiPreview = await api(`/api/study-invite/${multi.body.link.code}`);
    assert.equal(multiPreview.body.title, 'Allt inför provet');
    assert.deepEqual(multiPreview.body.units.map((u) => u.title), ['Kapitel 4 — Procent', 'Industriella revolutionen']);
    const D = await signUp('p2class');
    const dJoin = await api(`/api/study-invite/${multi.body.link.code}/accept`, D.token, { method: 'POST' });
    assert.equal(dJoin.body.joined, true);
    assert.equal(dJoin.body.unitIds.length, 2);
    const dUnits = (await api('/api/study/units?allTerms=1', D.token)).body.units;
    assert.deepEqual(dUnits.map((u) => u.title).sort(), ['Industriella revolutionen', 'Kapitel 4 — Procent']);
    assert.ok(dUnits.every((u) => u.isCopy && u.copiedFrom === A.name));
    const mine = await api('/api/study/share-links', A.token);
    assert.ok(mine.body.links.some((l) => l.code === multi.body.link.code && l.units.length === 2));
    // Ett urval med en kompis på en gång: B har redan MA1, så bara HI1 är nytt.
    const both = await api('/api/study/share', A.token, { method: 'POST', body: { unitIds: [unitId, histId], friendIds: [B.id] } });
    assert.equal(both.status, 200);
    assert.deepEqual([both.body.units, both.body.created, both.body.updated], [2, 1, 0], 'one new copy (HI1); MA1 B already has, without what B deleted');
    const bHist = (await api('/api/study/units?allTerms=1', B.token)).body.units.find((u) => u.title === 'Industriella revolutionen');
    assert.ok(bHist && bHist.isCopy);
    assert.equal((await api('/api/study/share', B.token, { method: 'POST', body: { unitIds: ['64b000000000000000000009'], friendIds: [A.id] } })).status, 404);
    const toOwner = await api('/api/study/share', B.token, { method: 'POST', body: { unitIds: [bCopyId], friendIds: [A.id] } });
    assert.equal(toOwner.body.added, 0, 'a copy passed back to its creator changes nothing — they have the original');
    assert.equal((await api(`/api/study/share-links/${multi.body.link.code}`, A.token, { method: 'DELETE' })).status, 200);
    assert.equal((await api(`/api/study-invite/${multi.body.link.code}`)).status, 404);
    // Raderas länkens FÖRSTA område lever länken vidare för resten.
    const tmpUnit = await call(claude, 'create_study_unit', { subject: 'matematik', grade_year: 8, title: 'Tillfälligt område' });
    const chain = await api('/api/study/share-links', A.token, { method: 'POST', body: { unitIds: [tmpUnit.data.unit_id, histId], ttlDays: 1, maxUses: 10 } });
    assert.equal(chain.status, 201);
    assert.equal((await call(claude, 'delete_study_unit', { unit_id: tmpUnit.data.unit_id })).isError, false);
    const survived = await api(`/api/study-invite/${chain.body.link.code}`);
    assert.equal(survived.status, 200, 'the link still works for the unit that is left');
    assert.deepEqual(survived.body.units.map((u) => u.title), ['Industriella revolutionen']);
    await api(`/api/study/share-links/${chain.body.link.code}`, A.token, { method: 'DELETE' });
    ok('share several at once: one link for two units (each joiner gets copies of both); a selection with a friend gives only what they lack; only units you have; deleting the first unit keeps the link');

    // ── Dela igen: bara det nya ─────────────────────────────────────────────
    // B tar bort HI1-1 ur sin kopia. A lägger till en genomgång och ett kort i
    // HI1 och gör ett nytt kapitel. A delar igen → B får bara det nya.
    const bHistDetail = await api(`/api/study/units/${bHist.id}`, B.token);
    assert.equal((await api(`/api/study/items/${bHistDetail.body.items[0].id}`, B.token, { method: 'DELETE' })).status, 200);
    await call(claude, 'add_study_pages', { unit_id: histId, pages: [{ title: 'Fabrikerna', body: 'Fabrikerna växte i städerna.' }] });
    await call(claude, 'add_flashcards', { unit_id: histId, cards: [{ front: 'Spinning Jenny?', back: 'En spinnmaskin från 1764.' }] });
    const kap3 = await call(claude, 'create_study_unit', { subject: 'historia', grade_year: 8, title: 'Kapitel 3 — Imperialismen' });
    await call(claude, 'add_flashcards', { unit_id: kap3.data.unit_id, cards: [{ front: 'Kolonialism?', back: 'När ett land styr ett annat.' }] });
    const reShare = await api('/api/study/share', A.token, { method: 'POST', body: { unitIds: [unitId, histId, kap3.data.unit_id], friendIds: [B.id] } });
    assert.deepEqual([reShare.body.created, reShare.body.updated], [1, 1], 'a copy of the new chapter; new material in HI1; nothing in MA1');
    const bHistAfter = await api(`/api/study/units/${bHist.id}`, B.token);
    assert.deepEqual(bHistAfter.body.items.map((i) => i.prompt), ['Spinning Jenny?'], 'the new card came — the one B deleted did not');
    assert.deepEqual(bHistAfter.body.pages.map((p) => p.title), ['Fabrikerna']);
    assert.ok(!(await api(`/api/study/units/${bCopyId}`, B.token)).body.items.some((i) => i.code === 'MA1-4'), 'MA1-4, which B deleted, stays away');
    assert.equal((await api('/api/study/units?allTerms=1', B.token)).body.units.length, 3, 'MA1, HI1 and the new chapter');
    const nothingNew = await api('/api/study/share', A.token, { method: 'POST', body: { unitIds: [unitId, histId, kap3.data.unit_id], friendIds: [B.id] } });
    assert.equal(nothingNew.body.added, 0, 'sharing again with nothing new changes nothing');
    ok('share again: only what is new arrives — the new chapter as a new copy, a new page and card in the copy B has — never what B deleted');

    // ── Dela vidare: en kopia delas som allt annat man har ──────────────────
    const befriend = async (x, y) => {
      const c = (await api('/api/me/invite-codes', x.token, { method: 'POST' })).body.inviteCode.code;
      assert.ok((await api('/api/me/friends/by-code', y.token, { method: 'POST', body: { code: c } })).status < 300);
    };
    const unitsOf = async (u) => (await api('/api/study/units?allTerms=1', u.token)).body?.units || [];
    await befriend(B, C);
    const onward = await api(`/api/study/units/${bCopyId}/share`, B.token, { method: 'POST', body: { friendIds: [C.id] } });
    assert.equal(onward.status, 200, JSON.stringify(onward.body));
    assert.deepEqual(onward.body.copies.map((r) => r.username), [C.name]);
    const cFromB = (await unitsOf(C)).find((u) => u.title === 'Kapitel 4 — Procent');
    assert.equal(cFromB.copiedFrom, B.name, 'C sees who gave it — not the creator');
    const isMa14 = (i) => i.prompt.startsWith('En vara kostar');
    assert.ok(!(await api(`/api/study/units/${cFromB.id}`, C.token)).body.items.some(isMa14), 'B\'s copy as it is — without what B deleted');
    // En kopia per original, vilken väg det än kommer: C öppnar A:s länk och får
    // det C saknade i den kopia hen redan har.
    const aLink2 = await api(`/api/study/units/${unitId}/share-links`, A.token, { method: 'POST', body: { ttlDays: 1, maxUses: 10 } });
    const viaA = await api(`/api/study-invite/${aLink2.body.link.code}/accept`, C.token, { method: 'POST' });
    assert.deepEqual([viaA.body.joined, viaA.body.unitId, viaA.body.updated], [false, cFromB.id, 1], JSON.stringify(viaA.body));
    assert.equal((await unitsOf(C)).filter((u) => u.title === 'Kapitel 4 — Procent').length, 1, 'one copy per original');
    assert.ok((await api(`/api/study/units/${cFromB.id}`, C.token)).body.items.some(isMa14), 'what C lacked arrived');
    await api(`/api/study/units/${unitId}/share-links/${aLink2.body.link.code}`, A.token, { method: 'DELETE' });
    // Det man själv lagt till i sin kopia är sitt eget original: det kommer aldrig
    // tillbaka som dubblett när någon delar vidare och tillbaka — och inte heller
    // när man tagit bort det.
    const bAiHi = await connectMcp(B.token);
    assert.equal((await call(bAiHi, 'add_flashcards', { unit_id: bHist.id, cards: [{ front: 'B:s egen fråga?', back: 'B:s svar.' }] })).isError, false);
    await bAiHi.close();
    assert.equal((await api(`/api/study/units/${bHist.id}/share`, B.token, { method: 'POST', body: { friendIds: [C.id] } })).status, 200);
    const cHist = (await unitsOf(C)).find((u) => u.title === 'Industriella revolutionen');
    const promptsIn = async (u, id) => (await api(`/api/study/units/${id}`, u.token)).body.items.map((i) => i.prompt);
    assert.ok((await promptsIn(C, cHist.id)).includes('B:s egen fråga?'), 'C got B\'s own card');
    const back1 = await api(`/api/study/units/${cHist.id}/share`, C.token, { method: 'POST', body: { friendIds: [B.id] } });
    assert.equal(back1.body.added, 0, 'shared back, nothing is new to B — not even B\'s own card');
    const bCardItem = (await api(`/api/study/units/${bHist.id}`, B.token)).body.items.find((i) => i.prompt === 'B:s egen fråga?');
    assert.equal((await api(`/api/study/items/${bCardItem.id}`, B.token, { method: 'DELETE' })).status, 200);
    const back2 = await api(`/api/study/units/${cHist.id}/share`, C.token, { method: 'POST', body: { friendIds: [B.id] } });
    assert.equal(back2.body.added, 0);
    assert.ok(!(await promptsIn(B, bHist.id)).includes('B:s egen fråga?'), 'what B deleted stays away — B\'s own too');
    // Den man blockerat når en aldrig — inte heller det hen lagt till i något
    // en kompis delar: V blockerar B och får C:s kopia utan B:s kort.
    const V = await signUp('p2viewer');
    await befriend(C, V);
    assert.equal((await api('/api/me/blocks', V.token, { method: 'POST', body: { userId: B.id } })).status, 200);
    assert.equal((await api(`/api/study/units/${cHist.id}/share`, C.token, { method: 'POST', body: { friendIds: [V.id] } })).body.added, 1);
    const vHist = (await unitsOf(V)).find((u) => u.title === 'Industriella revolutionen');
    const vPrompts = await promptsIn(V, vHist.id);
    assert.ok(vPrompts.includes('Spinning Jenny?') && !vPrompts.includes('B:s egen fråga?'), 'nothing B wrote reaches someone who blocked B');
    assert.deepEqual([vHist.copiedFrom, vHist.alsoFrom], [C.name, []]);
    // En full länk fungerar fortfarande för dem som redan använt den — de hämtar det nya.
    const fullLink = await api(`/api/study/units/${histId}/share-links`, A.token, { method: 'POST', body: { ttlDays: 1, maxUses: 10 } });
    const G = await signUp('p2late');
    assert.equal((await api(`/api/study-invite/${fullLink.body.link.code}/accept`, G.token, { method: 'POST' })).body.joined, true);
    fillStudyLinkInLocalDb(fullLink.body.link.code);
    await call(claude, 'add_flashcards', { unit_id: histId, cards: [{ front: 'Ångloket?', back: 'Stephenson, 1829.' }] });
    const gAgain = await api(`/api/study-invite/${fullLink.body.link.code}/accept`, G.token, { method: 'POST' });
    assert.deepEqual([gAgain.status, gAgain.body.updated], [200, 1], 'the new card comes through the full link');
    const H = await signUp('p2toolate');
    assert.equal((await api(`/api/study-invite/${fullLink.body.link.code}/accept`, H.token, { method: 'POST' })).status, 404, 'a full link takes no one new');
    assert.equal((await api(`/api/study-invite/${fullLink.body.link.code}`)).status, 404);
    assert.equal((await api(`/api/study-invite/${fullLink.body.link.code}`, G.token)).status, 200);
    await api(`/api/study/units/${histId}/share-links/${fullLink.body.link.code}`, A.token, { method: 'DELETE' });
    // B:s egen länk till sin kopia: den som går med får en kopia "från B".
    const bLink = await api(`/api/study/units/${bCopyId}/share-links`, B.token, { method: 'POST', body: { ttlDays: 1, maxUses: 10 } });
    assert.equal(bLink.status, 201, JSON.stringify(bLink.body));
    assert.equal((await api(`/api/study-invite/${bLink.body.link.code}`)).body.creator.username, B.name);
    const E = await signUp('p2onward');
    const eJoin = await api(`/api/study-invite/${bLink.body.link.code}/accept`, E.token, { method: 'POST' });
    assert.equal(eJoin.body.joined, true);
    assert.equal((await api(`/api/study/units/${eJoin.body.unitId}`, E.token)).body.unit.copiedFrom, B.name);
    assert.deepEqual((await api(`/api/study/units/${bCopyId}/shares`, B.token)).body.copies.map((r) => r.username).sort(), [C.name, E.name].sort());
    const aGave = (await api(`/api/study/units/${unitId}/shares`, A.token)).body.copies.map((r) => r.username);
    assert.ok(!aGave.includes(E.name), 'the creator sees whom THEY gave a copy, not the whole chain');
    // Har skaparen blockerat någon kommer det aldrig fram — vem som än delar.
    const F = await signUp('p2blocked');
    await befriend(B, F);
    assert.equal((await api('/api/me/blocks', A.token, { method: 'POST', body: { userId: F.id } })).status, 200);
    const toBlocked = await api(`/api/study/units/${bCopyId}/share`, B.token, { method: 'POST', body: { friendIds: [F.id] } });
    assert.equal(toBlocked.status, 200);
    assert.equal(toBlocked.body.added, 0);
    assert.equal((await api(`/api/study-invite/${bLink.body.link.code}`)).status, 200, 'the public preview works');
    assert.equal((await api(`/api/study-invite/${bLink.body.link.code}`, F.token)).status, 404, 'logged in, F\'s preview shows what F would get: nothing');
    assert.equal((await api(`/api/study-invite/${bLink.body.link.code}/accept`, F.token, { method: 'POST' })).status, 404);
    assert.equal((await unitsOf(F)).length, 0);
    await api(`/api/study/units/${bCopyId}/share-links/${bLink.body.link.code}`, B.token, { method: 'DELETE' });
    assert.equal((await api(`/api/me/blocks/${F.id}`, A.token, { method: 'DELETE' })).status, 200);
    // En kopia är mottagarens: att sluta vara kompisar tar inget tillbaka.
    assert.equal((await api(`/api/me/friends/${B.id}`, C.token, { method: 'DELETE' })).status, 200);
    assert.equal((await api(`/api/study/units/${cFromB.id}`, C.token)).status, 200, 'unfriending takes no copy back');
    // Via AI:n: samma sak — och en kopia kan inte tas tillbaka.
    const bAi = await connectMcp(B.token);
    const bSharing = (await call(bAi, 'get_study_sharing', { unit: bCopyId })).data;
    assert.deepEqual(bSharing.copies_given_to.map((p) => p.username).sort(), [C.name, E.name].sort());
    const takeBack = await call(bAi, 'stop_sharing_study', { unit: bCopyId, friend: E.name });
    assert.equal(takeBack.error?.code, 'not_found');
    assert.match(takeBack.error.message, /can't be taken back/);
    await bAi.close();
    ok('pass it on: a copy is shared like anything else ("från B"); one copy per original whichever way it comes, with only what was missing; your own additions never come back as duplicates; nothing by someone you blocked reaches you; a full link still brings the new material to those who used it; blocks hold along the chain; unfriending takes nothing back');

    // Glos-listor: samma regler. A delar med B (får ändra); B delar vidare med
    // C, som bara får läsa och öva — ägaren valde aldrig C.
    await befriend(B, C);
    const rList = await api('/api/lists', A.token, { method: 'POST', body: { title: 'Vidare-test', sourceLang: 'sv', targetLang: 'en' } });
    const rListId = rList.body.list._id;
    assert.equal((await api(`/api/lists/${rListId}/glosor`, A.token, { method: 'POST', body: { source: 'hus', target: 'house' } })).status, 201);
    assert.equal((await api(`/api/lists/${rListId}/share`, A.token, { method: 'POST', body: { friendIds: [B.id], mode: 'edit' } })).status, 200);
    assert.equal((await api(`/api/lists/${rListId}/share`, B.token, { method: 'POST', body: { friendIds: [C.id], mode: 'edit' } })).status, 403, 'only the owner sets the mode');
    const bListShare = await api(`/api/lists/${rListId}/share`, B.token, { method: 'POST', body: { friendIds: [C.id] } });
    assert.equal(bListShare.status, 200, JSON.stringify(bListShare.body));
    assert.equal(bListShare.body.list.sharedWith, undefined, 'B never sees who else has the list');
    const cList = await api(`/api/lists/${rListId}`, C.token);
    assert.equal(cList.body.sharedBy.username, B.name);
    assert.equal(cList.body.list.shareMode, 'read', 'passed on = read-only');
    assert.equal(cList.body.list.sharedWith, undefined);
    assert.equal(cList.body.list.user, undefined, 'not even the owner\'s id');
    assert.equal((await api(`/api/lists/${rListId}/glosor`, C.token, { method: 'POST', body: { source: 'katt', target: 'cat' } })).status, 403);
    const bWord = await api(`/api/lists/${rListId}/glosor`, B.token, { method: 'POST', body: { source: 'katt', target: 'cat' } });
    assert.equal(bWord.status, 201, 'the owner chose B');
    const bEdit = await api(`/api/glosor/${bWord.body.glos._id}`, B.token, { method: 'PUT', body: { notes: 'mjau' } });
    assert.equal(bEdit.status, 200);
    assert.equal(typeof bEdit.body.glos.list, 'string', 'editing a word never sends the list (and who has it) along');
    assert.equal((await api('/api/lists', C.token)).body.sharedLists.find((l) => l._id === rListId)?.sharedBy.username, B.name);
    const aListShares = await api(`/api/lists/${rListId}/shares`, A.token);
    assert.deepEqual(aListShares.body.shares.map((s) => `${s.username}<${s.via}`).sort(), [`${B.name}<null`, `${C.name}<${B.name}`].sort());
    assert.deepEqual((await api(`/api/lists/${rListId}/shares`, B.token)).body.shares.map((s) => s.username), [C.name]);
    assert.equal((await api(`/api/lists/${rListId}/share/${B.id}`, C.token, { method: 'DELETE' })).status, 404);
    // B:s länk ger en kopia; ägaren ser den. Tas B bort slutar B:s länk gälla.
    const bListLink = await api(`/api/lists/${rListId}/share-link`, B.token, { method: 'POST', body: { ttlDays: 1, maxUses: 10 } });
    assert.equal(bListLink.status, 201, JSON.stringify(bListLink.body));
    assert.equal((await api(`/api/list-invite/${bListLink.body.invite.code}`)).body.creator.username, B.name);
    const aInvites = (await api(`/api/lists/${rListId}/share-links`, A.token)).body.invites;
    const bInviteSeen = aInvites.find((i) => i._id === bListLink.body.invite._id);
    assert.equal(bInviteSeen?.via, B.name);
    assert.equal(bInviteSeen.code, undefined, 'the owner sees B\'s link without its code');
    assert.equal((await api(`/api/list-invite/${bListLink.body.invite.code}/accept`, A.token, { method: 'POST' })).status, 400, 'the owner needs no copy');
    assert.equal((await api(`/api/lists/${rListId}/share/${B.id}`, A.token, { method: 'DELETE' })).status, 200);
    assert.equal((await api(`/api/list-invite/${bListLink.body.invite.code}`)).status, 404, 'B no longer has the list, so B\'s link is closed');
    assert.equal((await api(`/api/lists/${rListId}`, C.token)).status, 200, 'C keeps it until the owner removes C too');
    assert.equal((await api(`/api/lists/${rListId}/share/${C.id}`, A.token, { method: 'DELETE' })).status, 200);
    assert.equal((await api(`/api/lists/${rListId}`, C.token)).status, 404);
    assert.equal((await api(`/api/me/friends/${B.id}`, C.token, { method: 'DELETE' })).status, 200);
    ok('lists pass on too: read-only for those the owner never chose, "delad av" the sharer, the owner sees everyone via whom and removes anyone; a removed sharer\'s link stops');

    // ── Dela via AI:n ───────────────────────────────────────────────────────
    const aiShare = await call(claude, 'share_study_units', { units: [unitId, histId], friends: [B.name] });
    assert.equal(aiShare.isError, false, JSON.stringify(aiShare));
    const aiNotFriend = await call(claude, 'share_study_units', { units: [unitId], friends: [C.name] });
    assert.deepEqual(aiNotFriend.error.not_friends, [C.name], 'a classmate who joined by link is not a friend');
    const aiLink = await call(claude, 'create_study_link', { units: [unitId, histId], title: 'Från AI:n', days: 1, max_uses: 10 });
    assert.match(aiLink.data.url, /\/p\/[A-Z0-9]+$/);
    const aiPreview = await api(`/api/study-invite/${aiLink.data.code}`);
    assert.equal(aiPreview.body.title, 'Från AI:n');
    assert.equal(aiPreview.body.units.length, 2);
    assert.ok((await call(claude, 'get_study_sharing', {})).data.links.some((l) => l.code === aiLink.data.code && l.unit_count === 2));
    assert.ok((await call(claude, 'get_study_sharing', { unit: unitId })).data.copies_given_to.some((p) => p.username === B.name));
    assert.equal((await call(claude, 'share_study_units', { units: ['64b000000000000000000009'], friends: [B.name] })).error.code, 'not_found');
    assert.equal((await call(claude, 'stop_sharing_study', { link_code: aiLink.data.code })).isError, false);
    assert.equal((await api(`/api/study-invite/${aiLink.data.code}`)).status, 404);
    ok('the AI shares units: share_study_units (friends only), create_study_link (one link, title, preview), get_study_sharing, stop_sharing_study');

    // ── Mappar ──────────────────────────────────────────────────────────────
    const folder = await api('/api/study/folders', A.token, { method: 'POST', body: { name: 'Inför provet v. 42', color: 'sky', unitIds: [unitId, hist.data.unit_id, '64b000000000000000000009'] } });
    assert.equal(folder.status, 201);
    assert.equal(folder.body.folder.unitCount, 2, 'unknown ids are ignored');
    const fid = folder.body.folder.id;
    const fDetail = await api(`/api/study/folders/${fid}`, A.token);
    assert.deepEqual(fDetail.body.units.map((u) => u.code), ['MA1', 'HI1']);
    const fSession = await api('/api/study/sessions', A.token, { method: 'POST', body: { folderId: fid, mode: 'cards', count: 10 } });
    assert.deepEqual(fSession.body.items.map((i) => i.code).sort(), ['HI1-1', 'HI1-2', 'HI1-3', 'MA1-1']);
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

    // B får provet i sin kopia när A delar igen (det är nytt), och gör det i appen.
    const withTest = await api('/api/study/share', A.token, { method: 'POST', body: { unitIds: [unitId], friendIds: [B.id] } });
    assert.equal(withTest.body.updated, 1);
    const bWithTest = await api(`/api/study/units/${bCopyId}`, B.token);
    assert.equal(bWithTest.body.tests.length, 1);
    const bTestId = bWithTest.body.tests[0].id;
    assert.notEqual(bTestId, testId, 'the test is in B\'s copy too — B\'s own');
    const started = await api(`/api/study/tests/${bTestId}/start`, B.token, { method: 'POST' });
    assert.equal(started.status, 201);
    const qs = started.body.questions;
    assert.equal(qs.length, 4);
    assert.ok(qs.every((q) => q.solution === undefined && q.modelAnswer === undefined && q.hints === undefined), 'no answers before handing in');
    const resumed = await api(`/api/study/tests/${bTestId}/start`, B.token, { method: 'POST' });
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
    const fresh = await api(`/api/study/tests/${bTestId}/start`, B.token, { method: 'POST' });
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
    // B skapades i dag, så vecka, månad och termin rymmer samma pass och svar —
    // men månad och termin räknas i databasen (aggregering), veckan svar för
    // svar. Siffrorna ska bli exakt desamma oavsett väg.
    const month = await api('/api/study/activity?period=month', B.token);
    const todayRow = (r) => r.body.days.find((d) => d.date === r.body.today);
    const bySubject = (r) => Object.fromEntries(r.body.bySubject.map((s) => [s.subject, s]));
    assert.ok(todayRow(week).answered >= 5);
    for (const view of [month, term]) {
      assert.deepEqual(view.body.totals, week.body.totals);
      assert.deepEqual(bySubject(view), bySubject(week));
      assert.deepEqual(todayRow(view), todayRow(week));
    }
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
    // B har papperskorgen i sin kopia, men når aldrig A:s original.
    const sCopy = await api('/api/study/sessions', B.token, { method: 'POST', body: { unitIds: [bCopyId], mode: 'cards' } });
    assert.ok(sCopy.body.items.length > 0 && sCopy.body.items.every((i) => i.own === true), 'a copy is its owner\'s — with the bin');
    await api(`/api/study/sessions/${sCopy.body.session.id}/finish`, B.token, { method: 'POST' });
    assert.equal((await api(`/api/study/items/${cardId}`, B.token, { method: 'DELETE' })).status, 404);
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
    assert.equal((await api(`/api/study/units/${unitId}/deletions`, B.token)).status, 404);
    const undo = await api(`/api/study/units/${unitId}/deletions/${log.body.deletions[1].id}/restore`, A.token, { method: 'POST' });
    assert.equal(undo.body.restored, 'MA1-1');
    const back = await api(`/api/study/units/${unitId}`, A.token);
    assert.equal(back.body.items.find((i) => i.code === 'MA1-1').id, cardId, 'restored with its old code and id');
    assert.equal((await api(`/api/study/units/${unitId}/deletions/${log.body.deletions[1].id}/restore`, A.token, { method: 'POST' })).status, 409);
    ok('bin: only the owner deletes (B in B\'s copy, never in the original); app and AI deletions are logged with who/where; undo brings MA1-1 back with its code and id');

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

    // Övningsbladet (utskrift): facit, ordna i pappersordningen, mallens variant
    // — och AI:n får exakt samma tal med get_study_item + variant.
    const exSheet = await api(`/api/study/sheet?units=${drillId}&mode=exercises&count=40`, A.token);
    assert.equal(exSheet.status, 200, JSON.stringify(exSheet.body));
    const onPaper = (re) => exSheet.body.items.find((i) => re.test(i.prompt));
    assert.equal(onPaper(/primtal\?/).facit.answer, 'B. 23  ·  D. 29');
    const paperOrder = onPaper(/storleksordning/);
    const orderLetters = paperOrder.facit.answer.split(' (')[0].split(' → ');
    assert.deepEqual(orderLetters.map((l) => paperOrder.items[l.charCodeAt(0) - 65]), ['0,05', '0,5', '5'], 'facit in the letters of the printed order');
    const paperTpl = exSheet.body.items.find((i) => i.variant);
    assert.ok(paperTpl.variant >= 1 && paperTpl.variant <= 999 && !paperTpl.prompt.includes('{{'), 'a template prints with a short variant');
    const [, px, py] = /Beräkna (\d+) · (\d+)/.exec(paperTpl.prompt);
    assert.equal(paperTpl.facit.answer, String(px * py));
    const printedForAi = await call(claude, 'get_study_item', { code: paperTpl.code, variant: paperTpl.variant });
    assert.equal(printedForAi.data.printed.prompt, paperTpl.prompt, 'the AI gets exactly the printed numbers');
    assert.equal(printedForAi.data.printed.answer, px * py);
    assert.equal(exSheet.body.items.some((i) => i.kind === 'card'), false, 'mode exercises prints no cards');
    assert.equal((await api(`/api/study/sheet?units=${drillId}&mode=ladder`, A.token)).status, 400, 'the ladder cannot be printed');
    assert.equal((await api(`/api/study/sheet?units=${drillId}&levels=X`, A.token)).status, 400);
    assert.equal((await api('/api/study/sheet?units=,', A.token)).status, 400, 'an empty unit list is not "everything"');
    assert.equal((await api(`/api/study/sheet?units=${drillId}`, B.token)).status, 404, 'no sheet from someone else\'s unit');

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
    // Provfrågor hamnar aldrig på ett övningsblad (där står facit).
    const afterTest = await api(`/api/study/sheet?units=${drillId}&mode=mixed&count=50`, A.token);
    assert.equal(afterTest.status, 200);
    assert.ok(afterTest.body.items.length > 0 && afterTest.body.items.every((i) => !parts.data.question_codes.includes(i.code)), 'no test question on a sheet');
    // "Nya uppgifter": det redan utskrivna väljs sist — bara om inget annat finns.
    const firstIds = afterTest.body.items.slice(0, 3).map((i) => i.id);
    const next = await api(`/api/study/sheet?units=${drillId}&mode=exercises&count=3&exclude=${firstIds.join(',')}`, A.token);
    assert.ok(next.body.items.every((i) => !firstIds.includes(i.id)), 'exclude picks other exercises first');
    const paperDiag = await call(claude, 'record_paper_test', {
      test_id: parts.data.test_id,
      results: [{ code: parts.data.question_codes[0], points: { C: 1 } }, { code: parts.data.question_codes[2], points: { E: 1 } }],
      overall_feedback: 'Öva mer på primtal.'
    });
    assert.deepEqual(paperDiag.data.by_skill.map((r) => [r.skill, r.points]), [['primtal', '1/2'], ['multiplikation', '1/1']]);
    ok('feedback: duplicate unit refused; one tolerance warning (exact decimals pass); retries skip; svg checked; multi/order/factors graded; templates with seeds; skill practice; test parts and per-skill result');

    // ── städning ────────────────────────────────────────────────────────────
    // A raderar sitt prov: B:s kopia har kvar sitt eget.
    assert.equal((await call(claude, 'delete_practice_test', { test_id: testId })).isError, false);
    assert.equal((await api(`/api/study/tests/attempts/${attemptId}`, B.token)).body.testExists, true, 'the copy keeps its test');
    // B:s AI raderar provet i kopian: resultatet finns kvar. Och det kommer
    // inte tillbaka när A delar igen — B tog bort det.
    const bAi2 = await connectMcp(B.token);
    assert.equal((await call(bAi2, 'delete_practice_test', { test_id: bTestId })).isError, false);
    await bAi2.close();
    const afterDel = await api(`/api/study/tests/attempts/${attemptId}`, B.token);
    assert.equal(afterDel.body.testExists, false, 'results survive the test');
    assert.equal(afterDel.body.score.total, 4);
    // Kopian är B:s — den finns kvar när B och A slutar vara kompisar.
    assert.equal((await api(`/api/me/friends/${A.id}`, B.token, { method: 'DELETE' })).status, 200);
    assert.equal((await api(`/api/study/units/${bCopyId}`, B.token)).status, 200);
    await claude.close();
    ok('delete_practice_test keeps the results (the copy keeps its own test until its owner deletes it); a copy stays after unfriending');

    // ── Blockera ────────────────────────────────────────────────────────────
    const codeFor = async (u) => (await api('/api/me/invite-codes', u.token, { method: 'POST' })).body.inviteCode.code;
    assert.ok((await api('/api/me/friends/by-code', C.token, { method: 'POST', body: { code: await codeFor(A) } })).status < 300);
    assert.equal((await api(`/api/study/units/${unitId}/share`, A.token, { method: 'POST', body: { friendIds: [C.id] } })).status, 200);
    const aList = await api('/api/lists', A.token, { method: 'POST', body: { title: 'Blockera-test', sourceLang: 'sv', targetLang: 'en' } });
    const listId = aList.body.list?._id || aList.body._id;
    assert.equal((await api(`/api/lists/${listId}/share`, A.token, { method: 'POST', body: { friendIds: [C.id] } })).status, 200);
    const blockRes = await api('/api/me/blocks', A.token, { method: 'POST', body: { userId: C.id } });
    assert.equal(blockRes.status, 200);
    assert.deepEqual(blockRes.body.blocked.map((b) => b.username), [C.name]);
    // Allt mellan dem är borta — utom kopior C redan fått: de är C:s.
    assert.ok(!(await api('/api/me/friends', A.token)).body.friends.some((f) => f.username === C.name), 'no longer friends');
    assert.equal((await api(`/api/study/units/${cFromB.id}`, C.token)).status, 200, 'a copy is C\'s — a block takes nothing back');
    assert.equal((await api(`/api/lists/${listId}`, C.token)).status, 404);
    // Den blockerade kommer inte tillbaka: ingen kod, ingen länk — och får inte veta varför.
    const cTry = await api('/api/me/friends/by-code', C.token, { method: 'POST', body: { code: await codeFor(A) } });
    assert.equal(cTry.status, 404);
    assert.doesNotMatch(cTry.body.error, /block/i);
    assert.equal((await api('/api/me/friends/by-code', A.token, { method: 'POST', body: { code: await codeFor(C) } })).status, 409);
    const aLink = await api(`/api/study/units/${unitId}/share-links`, A.token, { method: 'POST', body: { ttlDays: 1, maxUses: 10 } });
    assert.equal((await api(`/api/study-invite/${aLink.body.link.code}/accept`, C.token, { method: 'POST' })).status, 404);
    const listLink = await api(`/api/lists/${listId}/share-link`, A.token, { method: 'POST', body: { ttlDays: 1, maxUses: 10 } });
    assert.equal((await api(`/api/list-invite/${listLink.body.invite.code}/accept`, C.token, { method: 'POST' })).status, 404);
    // Häv blockeringen: länken fungerar igen.
    assert.deepEqual((await api(`/api/me/blocks/${C.id}`, A.token, { method: 'DELETE' })).body.blocked, []);
    assert.equal((await api(`/api/study-invite/${aLink.body.link.code}/accept`, C.token, { method: 'POST' })).status, 200);
    ok('block: friendship and list shares go both ways (copies stay with their owners); no way back by code or link (and no hint why); unblock restores links');

    // Skaparen raderar sitt konto: kopiorna är vännernas och finns kvar — utan skaparens namn.
    assert.equal((await api('/api/me', A.token, { method: 'DELETE' })).status, 200);
    const kept = await api(`/api/study/units/${bCopyId}`, B.token);
    assert.equal(kept.status, 200);
    assert.deepEqual([kept.body.unit.isCopy, kept.body.unit.copiedFrom], [true, null], 'no trace of the deleted account');
    const orphan = await api(`/api/study/tests/attempts/${attemptId}`, B.token);
    assert.equal(orphan.status, 200);
    assert.equal(orphan.body.score.total, 4);
    ok('the creator deletes the account: the friends\' copies and results stay theirs, without the creator\'s name');
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
