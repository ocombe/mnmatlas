import assert from 'node:assert/strict';
import {browser, plain, suite, suggestion, settle} from './regression-harness.mjs';

const checks = suite();
const fieldValue = v => v == null || v === '' || Array.isArray(v) && !v.length ? null : v;
const note = (id, name) => ({id: `personal-${id}`, name, category: 'Personal',
  note: '', x: 30, y: 40, level: 'lower'});

async function devices(initial) {
  const shared = plain(initial);
  const notesState = {exists: true, updated_at: '2026-10-20T08:00:00.000Z'};
  const a = await browser(false, {notes: shared, notesState, personal: plain(initial)});
  const b = await browser(false, {notes: shared, notesState, personal: plain(initial)});
  const push = async (device, notes) => {
    assert(device.context.persist(plain(notes)), 'The local save succeeds');
    await device.tick(2000);
    await settle();
  };
  const sync = async device => {
    await device.context.window.testCommunity.sync();
    await settle();
  };
  const all = () => [a.context.personal, b.context.personal, shared].map(plain);
  return {a, b, shared, push, sync, all};
}

await checks.test('B1', 'two devices preserve interleaved additions locally and remotely', async () => {
  const seed = note('seed', 'Seed');
  const d = await devices([seed]);
  const addedB = note('b', 'Added on B');
  const addedA = note('a', 'Added on A');
  await d.push(d.b, [...d.b.context.personal, addedB]);
  assert(d.shared.some(n => n.id === addedB.id), 'B uploaded its addition');
  await d.push(d.a, [...d.a.context.personal, addedA]);
  await d.sync(d.b);
  for (const [index, notes] of d.all().entries()) {
    assert.deepEqual(notes.map(n => n.id).sort(), [seed.id, addedA.id, addedB.id].sort(),
      `Device/server ${index} must keep every addition`);
  }
});

await checks.test('B1', 'interleaved edits of different notes both survive', async () => {
  const first = note('first', 'First');
  const second = note('second', 'Second');
  const d = await devices([first, second]);
  await d.push(d.b, d.b.context.personal.map(n => n.id === first.id ? {...n, note: 'Edit B'} : n));
  await d.push(d.a, d.a.context.personal.map(n => n.id === second.id ? {...n, note: 'Edit A'} : n));
  await d.sync(d.b);
  await d.sync(d.a);
  for (const notes of d.all()) {
    assert.equal(notes.find(n => n.id === first.id)?.note, 'Edit B', 'The stale push keeps B edit');
    assert.equal(notes.find(n => n.id === second.id)?.note, 'Edit A', 'The merge keeps A edit');
  }
});

await checks.test('B1', 'a deletion wins over an unchanged copy on the other device', async () => {
  const seed = note('seed', 'Seed');
  const kept = note('keep', 'Keep');
  const d = await devices([seed, kept]);
  await d.push(d.a, d.a.context.personal.filter(n => n.id !== seed.id));
  assert(!d.shared.some(n => n.id === seed.id), 'A uploaded the deletion');
  const added = note('added', 'Added after deletion');
  await d.push(d.b, [...d.b.context.personal, added]);
  await d.sync(d.a);
  await d.sync(d.b);
  for (const notes of d.all()) {
    assert(!notes.some(n => n.id === seed.id), 'An unchanged stale copy cannot resurrect a deletion');
    assert(notes.some(n => n.id === kept.id) && notes.some(n => n.id === added.id));
  }
});


await checks.test('B1', 'both edit orders keep the newest timestamp and edited deletions survive', async () => {
  const original = {...note('seed', 'Seed'), updated: 10};
  const e = await browser();
  const merge = (a, b) => plain(e.context.window.testCommunity.mergeMapNotes(a, b,
    new Map([[original.id, JSON.stringify(Object.keys(original).sort().map(k => [k, original[k]]))]])));
  const older = {...original, note: 'Older edit', updated: 20};
  const newer = {...original, note: 'Newer edit', updated: 30};
  assert.deepEqual(merge([older], [newer]), [newer]);
  assert.deepEqual(merge([newer], [older]), [newer]);
  assert.deepEqual(merge([newer], []), [newer]);
  assert.deepEqual(merge([], [newer]), [newer]);
  assert.deepEqual(merge([original], []), []);
  assert.deepEqual(merge([], [original]), []);
});

await checks.test('B1', 'local edit after another device deletion stays on both devices', async () => {
  const original = note('seed', 'Seed');
  const d = await devices([original]);
  await d.push(d.a, []);
  await d.push(d.b, [{...original, note: 'Edited while the deletion was unseen'}]);
  await d.sync(d.a);
  for (const notes of d.all()) assert.equal(notes[0]?.note, 'Edited while the deletion was unseen');
});

await checks.test('B1', 'a conditional update miss rereads and preserves a concurrent addition', async () => {
  const e = await browser(false, {notes: [], personal: []});
  const c = e.context, local = note('local-race', 'Local'), other = note('remote-race', 'Remote');
  let misses = 0;
  e.notesFault = (request, rows, state) => {
    if (request.op === 'update' && !request.filters.map.endsWith('#private') && !misses++) {
      rows.push(other); state.updated_at = new Date(Date.parse(state.updated_at) + 1).toISOString();
    }
  };
  c.persist([local]); await e.tick(2000);
  assert(misses >= 2, 'A missed update was retried');
  assert.deepEqual(e.remote.map(n => n.id).sort(), [local.id, other.id].sort());
  assert.deepEqual(plain(c.personal), plain(e.remote));
  const updates = e.calls.filter(r => r.table === 'user_notes' && r.op === 'update' && !r.filters.map.endsWith('#private'));
  assert(updates.every(r => typeof r.filters.updated_at === 'string'), 'Every update checks the read version');
});

await checks.test('B1', 'a first insert collision rereads instead of overwriting the new server row', async () => {
  const state = {exists: false, updated_at: '2026-10-20T08:00:00.000Z'};
  const e = await browser(false, {notes: [], personal: [], notesState: state});
  state.exists = false;
  let collided = false;
  const other = note('new-server', 'Added concurrently');
  e.notesFault = (request, rows, version) => {
    if (request.op === 'insert' && !request.payload.map.endsWith('#private') && !collided) {
      collided = true; rows.push(other); version.exists = true;
    }
  };
  e.context.persist([note('new-local', 'Local')]); await e.tick(2000);
  assert(collided);
  assert.deepEqual(e.remote.map(n => n.id).sort(), ['personal-new-local', other.id].sort());
});

for (const failure of ['read error', 'invalid list', 'missing version', 'write error', 'repeated conflict', 'local storage']) {
  await checks.test('B1', `${failure} keeps local notes and does not advance the base`, async () => {
    const e = await browser(false, {notes: [], personal: []});
    const c = e.context, methods = c.window.testCommunity;
    c.persist([note('safe', 'Keep this')]);
    const before = plain(c.personal), base = plain([...methods.readBase('member', 'test-map-v1')]);
    let writes = 0;
    e.notesFault = (request, rows, state) => {
      if ((request.filters.map || request.payload?.map).endsWith('#private')) return;
      if (request.op === 'select') {
        if (failure === 'read error') return {error: Error('offline')};
        if (failure === 'invalid list') return {data: {notes: null, updated_at: state.updated_at}};
        if (failure === 'missing version') return {data: {notes: [], updated_at: null}};
      } else {
        writes++;
        if (failure === 'write error') return {error: Error('offline')};
        if (failure === 'repeated conflict') return {data: []};
      }
    };
    if (failure === 'local storage') {
      const set = c.localStorage.setItem;
      c.localStorage.setItem = (key, value) => {
        if (key === c.storageKey('notes')) throw Error('storage full');
        set(key, value);
      };
    }
    await e.tick(2000);
    assert.deepEqual(plain(c.personal), before);
    assert.deepEqual(plain([...methods.readBase('member', 'test-map-v1')]), base);
    assert.deepEqual(plain(e.remote), []);
    assert(e.statuses.includes('Notes could not sync. Your local notes are safe.'));
    assert.equal(writes, failure === 'repeated conflict' ? 4 : failure === 'write error' ? 1 : 0);
  });
}

await checks.test('B1', 'a local save during the server read joins the same upload', async () => {
  const e = await browser(false, {notes: [], personal: []});
  let saved = false;
  e.notesFault = request => {
    if (request.op === 'select' && !request.filters.map.endsWith('#private') && !saved) {
      saved = true; e.context.persist([...e.context.personal, note('during-read', 'Saved during read')]);
    }
  };
  e.context.persist([note('before-read', 'Saved before read')]); await e.tick(2000);
  assert.equal(e.remote.length, 2);
  assert.deepEqual(plain(e.context.personal), plain(e.remote));
});

await checks.test('B1', 'a local save during the server write stays queued for the next upload', async () => {
  const e = await browser(false, {notes: [], personal: []});
  let saved = false;
  e.notesFault = request => {
    if (request.op === 'update' && !request.filters.map.endsWith('#private') && !saved) {
      saved = true; e.context.persist([...e.context.personal, note('during-write', 'Saved during write')]);
    }
  };
  e.context.persist([note('before-write', 'Saved before write')]); await e.tick(2000);
  assert.equal(e.context.personal.length, 2, 'Completing an earlier upload cannot overwrite a newer save');
  await e.tick(2000);
  assert.equal(e.remote.length, 2);
  assert.deepEqual(plain(e.context.personal), plain(e.remote));
});


await checks.test('B1', 'two devices keep the newest edit even when the older edit uploads last', async () => {
  const d = await devices([{...note('newest', 'Seed'), updated: 1}]);
  d.a.context.Date = class extends Date { static now() { return 2000000000000; } };
  d.b.context.Date = class extends Date { static now() { return 2000000000100; } };
  await d.push(d.b, d.b.context.personal.map(n => ({...n, note: 'Newer B edit'})));
  await d.push(d.a, d.a.context.personal.map(n => ({...n, note: 'Older A edit'})));
  await d.sync(d.b);
  for (const notes of d.all()) assert.equal(notes[0].note, 'Newer B edit');
});

await checks.test('B1', 'saving in-place changes advances the edit time but sync preserves it', async () => {
  const e = await browser(false, {notes: [note('stamp', 'Seed')], personal: [note('stamp', 'Seed')]});
  e.context.personal[0].note = 'Changed in place';
  assert(e.context.persist(e.context.personal));
  const stamp = e.context.personal[0].updated;
  assert(Number.isFinite(stamp));
  await e.tick(2000);
  await e.context.window.testCommunity.sync();
  assert.equal(e.context.personal[0].updated, stamp);
  assert.equal(e.remote[0].updated, stamp);
});

await checks.test('R2-8', 'an unreadable sync base preserves notes and repairs itself', async () => {
  const e = await browser(false, {notes: [], personal: []});
  e.context.localStorage.setItem('mnmaps-community-synced-member-test-map-v1', '{broken');
  assert(e.context.persist([note('safe-base', 'Safe')]));
  await e.tick(2000);
  assert.equal(e.remote[0]?.id, 'personal-safe-base');
  assert(e.context.window.testCommunity.readBase('member', 'test-map-v1').has('personal-safe-base'));
});

await checks.test('B1', 'failure to store the new base leaves a safe retryable upload', async () => {
  const e = await browser(false, {notes: [], personal: []});
  const c = e.context, set = c.localStorage.setItem;
  c.persist([note('base-retry', 'Keep me')]);
  const local = plain(c.personal);
  c.localStorage.setItem = (key, value) => {
    if (key.startsWith('mnmaps-community-synced-')) throw Error('storage full');
    set(key, value);
  };
  await e.tick(2000);
  assert.deepEqual(plain(c.personal), local);
  assert.deepEqual(plain(e.remote), local);
  assert(e.statuses.includes('Notes could not sync. Your local notes are safe.'));
  c.localStorage.setItem = set;
  e.emit('online'); await settle();
  assert.deepEqual([...c.window.testCommunity.readBase('member', 'test-map-v1').keys()], [local[0].id]);
});

const goblin = {name: 'A goblin', wikiId: 'npc-goblin',
  wiki: 'https://monstersandmemories.wiki/npcs/goblin'};
const shaman = {name: 'Goblin shaman', wikiId: 'npc-shaman',
  wiki: 'https://monstersandmemories.wiki/npcs/shaman'};
const fields = [
  {name: 'Fishing spot fish', value: {category: 'Fishing spot', fish: [{name: 'Basa'}]},
    change: {fish: [{name: 'Grouper'}]}},
  {name: 'Mob camp mobs', value: {category: 'Mob camp', levels: [8, 12], mobs: [goblin]},
    change: {mobs: [goblin, shaman]}},
  {name: 'Mob camp levels', value: {category: 'Mob camp', levels: [8, 12], mobs: [goblin]},
    change: {levels: [9, 15]}},
  {name: 'Passage How', value: {category: 'Passage', way: 'Tunnel'},
    change: {way: 'Swim'}},
  {name: 'Passage One way', value: {category: 'Passage', way: 'Drop', oneWay: false},
    change: {oneWay: true}},
  {name: 'NPC Gives quests', value: {category: 'Notable NPC', quests: false}, change: {quests: true}},
  {name: 'Named mob Ambush', value: {category: 'Named mob', levels: [8, 8], ambush: false},
    change: {ambush: true}},
  {name: 'Fishing spot floor', value: {category: 'Fishing spot', fish: [{name: 'Basa'}]},
    change: {level: 'upper'}},
  {name: 'Passage destination floor', value: {category: 'Passage', toLevel: 'lower',
    direction: 'up', switchOnClick: true}, change: {toLevel: 'upper'}},
  {name: 'marker type', value: {category: 'Bank'}, change: {category: 'Quest NPC'}},
  {name: 'trade', value: {category: 'Tradeskill'}, change: {trade: 'Fishing'}},
  {name: 'classes', value: {category: 'Class trainer', classes: ['Elementalist']}, change: {classes: ['Wizard']}},
  {name: 'vendor kind', value: {category: 'Vendor', vendor: 'Leatherworking vendor', sells: ['Recipes']}, change: {vendor: 'Shady merchant'}},
  {name: 'Sells clear', value: {category: 'Vendor', vendor: 'Leatherworking vendor', sells: ['Recipes']}, change: {sells: undefined}},
  {name: 'wiki id only', value: {category: 'Quest NPC', ...goblin}, change: {wikiId: 'npc-other'}},
  {name: 'wiki clear', value: {category: 'Quest NPC', ...goblin}, change: {wiki: undefined, wikiId: undefined}},
  {name: 'name', value: {category: 'Bank'}, change: {name: 'Other name'}},
  {name: 'description', value: {category: 'Bank'}, change: {note: 'More detail'}},
  {name: 'colour', value: {category: 'Bank'}, change: {color: '#a04438'}},
  {name: 'minimum zoom', value: {category: 'Bank'}, change: {minZoom: 2}},
  {name: 'approximate', value: {category: 'Bank'}, change: {approximate: true}},
  {name: 'travel', value: {category: 'Passage', travel: 'Ladder'}, change: {travel: 'Stairs'}},
  {name: 'arrow', value: {category: 'Passage', arrow: 'up'}, change: {arrow: 'down'}},
  {name: 'destination map', value: {category: 'Passage'}, change: {toMap: 'elsewhere'}},
  {name: 'destination place', value: {category: 'Passage'}, change: {toPlace: 'Hall'}},
  {name: 'destination marker', value: {category: 'Passage'}, change: {toMarker: 'arrival'}},
  {name: 'direction', value: {category: 'Passage', direction: 'up'}, change: {direction: 'down'}},
  {name: 'switch on click', value: {category: 'Passage', switchOnClick: true}, change: {switchOnClick: false}},
  {name: 'shape', value: {category: 'Bank'}, change: {shape: {kind: 'area', form: 'circle', points: [[30,40]], r: 5}}},
  {name: 'label kind', value: {noteType: 'label', kind: 'district'}, change: {kind: 'building'}},
  {name: 'label tier', value: {noteType: 'label', kind: 'building'}, change: {tier: 'major'}},
  {name: 'label priority', value: {noteType: 'label', kind: 'building', priority: 50}, change: {priority: 60}},
  {name: 'building', value: {category: 'Class trainer'}, change: {building: 'Hall'}},
  {name: 'position with reshape', value: {category: 'Bank'}, change: {x: 50, y: 50, shape: {kind: 'area', form: 'circle', points: [[50,50]], r: 5}}}

];

async function followed(spec, status) {
  const e = await browser();
  const c = e.context;
  e.recordInserts = true;
  const methods = c.window.testCommunity;
  const original = {...note('shared', 'Shared place'), ...spec.value};
  const payload = plain(methods.notePayload(original));
  const row = suggestion(100, 'new-marker', payload, {user_id: 'member',
    status, note_id: original.id});
  e.suggestions.push(row);
  const changed = {...original, ...Object.fromEntries(Object.entries(spec.change).map(([k, v]) => [k, v === undefined ? undefined : plain(v)]))};
  c.personal = [changed];
  const rec = {id: row.id, sent: payload, credit: false};
  methods.writeFollowed({[methods.followId(original)]: rec});
  const live = {...original, id: 'community-100', community: true};
  if (['label', 'exit'].includes(original.noteType)) {
    delete live.category; c.labelData.labels = [live];
  } else c.originals = [live];
  c.publishedPositions = new Map([[live.id, [live.x, live.y]]]);
  e.statuses.length = 0;
  return {e, c, methods, changed, rec};
}

await checks.test('B2', 'follow cases cover every editable schema public field', async () => {
  const e = await browser();
  const covered = new Set(fields.flatMap(spec => Object.keys(spec.change)));
  assert.equal(e.context.atlasMarkerSchema.publicKeys.filter(k => !e.context.atlasMarkerSchema.knownLabelKeys.includes(k) && !covered.has(k)).length, 0);
});

for (const spec of fields) {
  for (const status of ['approved', 'published']) {
    await checks.test('B2', `${status} shared ${spec.name} sends edit or visible refusal`, async () => {
      const f = await followed(spec, status);
      await f.methods.followNote(f.changed, f.rec);
      await settle();
      const sent = f.e.calls.filter(r => r.table === 'suggestions' && r.op === 'insert')
        .map(r => plain(f.c.normaliseChange(r.payload))).filter(r => r.kind === (spec.value.noteType ? 'edit-label' : 'edit-marker'));
      const exact = sent.some(row => Object.entries(spec.change).every(([k, v]) =>
        JSON.stringify(fieldValue(row.payload[k])) === JSON.stringify(fieldValue(v))));
      const refused = f.e.statuses.some(message =>
        /not added|cannot follow|not sent|could not be updated/i.test(message));
      assert(exact || refused, 'Structured changes require a complete edit row or an explicit message');
      if (!exact) {
        assert.deepEqual(plain(f.methods.readFollowed()[f.methods.followId(f.changed)].sent),
          f.rec.sent, 'A refused change must not be recorded as sent');
      }
    });
  }
  await checks.test('B2', `retirement preserves unsent ${spec.name}`, async () => {
    const f = await followed(spec, 'published');
    await f.methods.retire();
    assert.deepEqual(plain(f.c.personal), plain([f.changed]),
      'Unsent structured changes must stay in personal notes');
  });
}

await checks.test('B19', 'missing explicit note_id never retires a nearby same-name note', async () => {
  const e = await browser();
  const c = e.context;
  const methods = c.window.testCommunity;
  const original = {...note('gone', 'Fishing pool'), category: 'Fishing spot', fish: [{name: 'Basa'}]};
  const nearby = {...original, id: 'personal-later', fish: [{name: 'Grouper'}], x: 31};
  c.personal = [nearby];
  c.originals = [{...original, id: 'community-100', community: true}];
  e.suggestions.push(suggestion(100, 'new-marker', methods.notePayload(original),
    {user_id: 'member', note_id: original.id, status: 'published'}));
  await methods.retire();
  assert.deepEqual(plain(c.personal), plain([nearby]), 'An explicit missing id disables fuzzy matching');
});


await checks.test('B2', 'failed inserts leave every unsent field in the follow baseline', async () => {
  const f = await followed(fields[0], 'published');
  f.e.failSuggestions = true;
  await f.methods.followNote(f.changed, f.rec);
  assert.deepEqual(plain(f.methods.readFollowed()[f.methods.followId(f.changed)].sent), f.rec.sent);
  await f.methods.retire();
  assert.deepEqual(plain(f.c.personal), plain([f.changed]));
});

await checks.test('B2', 'a successful move is remembered when the later edit insert fails', async () => {
  const f = await followed({value: {category: 'Bank'}, change: {x: 35, note: 'New text'}}, 'published');
  f.e.suggestionFault = request => request.op === 'insert' && request.payload.kind === 'edit-marker' ? {error: Error('offline')} : undefined;
  await f.methods.followNote(f.changed, f.rec);
  const rec = plain(f.methods.readFollowed()[f.methods.followId(f.changed)]);
  assert.equal(rec.sent.x, 35);
  assert.equal(rec.sent.note, '', 'The failed text edit is still unsent');
  f.e.suggestionFault = null;
  await f.methods.followNote(f.changed, rec);
  assert.equal(f.e.calls.filter(r => r.table === 'suggestions' && r.op === 'insert' && r.payload.kind === 'move-marker').length, 1, 'Retry does not resend a successful move');
  assert.equal(f.methods.readFollowed()[f.methods.followId(f.changed)].sent.note, 'New text');
});

await checks.test('B2', 'sent changes stay personal until the published fields actually match', async () => {
  const f = await followed(fields[0], 'published');
  await f.methods.followNote(f.changed, f.rec);
  await f.methods.retire();
  assert.deepEqual(plain(f.c.personal), plain([f.changed]), 'Sent but unpublished fish must stay');
  f.c.originals = [{...f.changed, id: 'community-100', community: true}];
  await f.methods.retire();
  assert.deepEqual(plain(f.c.personal), [], 'An exact published copy can retire');
});

await checks.test('B2', 'a matching public copy with an unsent follow baseline still stays personal', async () => {
  const f = await followed(fields[0], 'published');
  f.c.originals = [{...f.changed, id: 'community-100', community: true}];
  await f.methods.retire();
  assert.deepEqual(plain(f.c.personal), plain([f.changed]));
});

await checks.test('B2', 'unsupported note kind changes show a refusal without advancing sent fields', async () => {
  const f = await followed({value: {category: 'Bank'}, change: {noteType: 'label'}}, 'published');
  await f.methods.followNote(f.changed, f.rec);
  assert(f.e.statuses.some(s => s.includes('could not be updated')));
  assert.deepEqual(plain(f.methods.readFollowed()[f.methods.followId(f.changed)].sent), f.rec.sent);
});

await checks.test('B19', 'a known missing followed id disables fuzzy retirement on old rows', async () => {
  const f = await followed({value: {category: 'Bank'}, change: {}}, 'published');
  delete f.e.suggestions[0].note_id;
  const other = {...f.changed, id: 'personal-replacement'};
  f.c.personal = [other];
  await f.methods.retire();
  assert.deepEqual(plain(f.c.personal), [other]);
});

await checks.test('B19', 'legacy rows without any known id can retire an exact copy', async () => {
  const f = await followed({value: {category: 'Bank'}, change: {}}, 'published');
  delete f.e.suggestions[0].note_id;
  f.methods.writeFollowed({});
  await f.methods.retire();
  assert.deepEqual(plain(f.c.personal), []);
});

checks.finish();
