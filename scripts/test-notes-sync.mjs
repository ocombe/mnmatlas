import assert from 'node:assert/strict';
import {browser, plain, suite, suggestion, settle} from './regression-harness.mjs';

const checks = suite();
const note = (id, name) => ({id: `personal-${id}`, name, category: 'Personal',
  note: '', x: 30, y: 40, level: 'lower'});

async function devices(initial) {
  const shared = plain(initial);
  const a = await browser(false, {notes: shared, personal: plain(initial)});
  const b = await browser(false, {notes: shared, personal: plain(initial)});
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
  {name: 'Named mob Ambush', value: {category: 'Named mob', levels: [8, 8], ambush: false},
    change: {ambush: true}},
  {name: 'Fishing spot floor', value: {category: 'Fishing spot', fish: [{name: 'Basa'}]},
    change: {level: 'upper'}},
  {name: 'Passage destination floor', value: {category: 'Passage', toLevel: 'lower',
    direction: 'up', switchOnClick: true}, change: {toLevel: 'upper'}}
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
  const changed = {...original, ...plain(spec.change)};
  c.personal = [changed];
  const rec = {id: row.id, sent: payload, credit: false};
  methods.writeFollowed({[methods.followId(original)]: rec});
  const live = {...original, id: 'community-100', community: true};
  c.originals = [live];
  c.publishedPositions = new Map([[live.id, [live.x, live.y]]]);
  e.statuses.length = 0;
  return {e, c, methods, changed, rec};
}

for (const spec of fields) {
  for (const status of ['approved', 'published']) {
    await checks.test('B2', `${status} shared ${spec.name} sends edit or visible refusal`, async () => {
      const f = await followed(spec, status);
      await f.methods.followNote(f.changed, f.rec);
      await settle();
      const sent = f.e.calls.filter(r => r.table === 'suggestions' && r.op === 'insert')
        .map(r => r.payload).filter(r => r.kind === 'edit-marker');
      const exact = sent.some(row => Object.entries(spec.change).every(([k, v]) =>
        JSON.stringify(row.payload[k]) === JSON.stringify(v)));
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
    assert.deepEqual(plain(f.c.personal), [f.changed],
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
  assert.deepEqual(plain(c.personal), [nearby], 'An explicit missing id disables fuzzy matching');
});

checks.finish();
