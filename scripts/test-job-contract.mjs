import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {publisher} from './publisher-harness.mjs';
import {browser, Node, plain, suite, suggestion} from './regression-harness.mjs';

const checks = suite();
const job = await publisher();
const marker = {id: 'published', name: 'Bank', category: 'Bank', note: '',
  x: 10, y: 20, level: 'lower'};
const addition = {name: 'A place', category: 'Quest NPC', note: '', x: 30, y: 40};
const apply = async () => {
  const result = await job.run();
  assert.equal(result.code, 0, result.output);
  return result;
};
const assertHeld = async (id, field) => {
  await apply();
  const held = await job.json('.publish/held.json');
  assert.equal(job.state.rows.find(r => r.id === id).status, 'approved',
    'Apply stages holds until the successful-push mark step');
  const marked = await job.run(true);
  assert.equal(marked.code, 0, marked.output);
  const row = job.state.rows.find(r => r.id === id);
  assert(held.some(h => h.id === id), 'The row must be held');
  assert.equal(row.status, 'pending');
  assert(row.review_note.startsWith('Not published:'), 'A held row needs an explanatory note');
  if (field) assert(row.review_note.includes(field), `The note must name ${field}`);
  assert(!(await job.json('.publish/applied.json')).some(r => r.id === id));
};

try {
  await checks.test('B6', 'shared apply returns a refusal reason for an unknown field', async () => {
    const e = await browser();
    const result = e.context.atlasMarkerSchema.apply(null, suggestion(100, 'new-marker',
      {...addition, futureField: 'Keep this'}));
    assert.equal(result.refusal, 'unknown field futureField');
  });

  for (const kind of ['new-marker', 'edit-marker']) {
    await checks.test('B6', `${kind} refuses unknown futureField`, async () => {
      const payload = kind === 'new-marker' ? {...addition, futureField: 'Keep this'} :
        {name: marker.name, futureField: 'Keep this', from: marker};
      await job.reset({markers: [marker], rows: [suggestion(100, kind, payload)]});
      await assertHeld(100, 'futureField');
      assert.deepEqual(await job.json('data/markers.json'), [marker], 'Unknown fields apply nothing');
    });
  }

  for (const category of ['Personal', 'Ore', 'Wood', 'Herbs', 'Camping spot']) {
    for (const kind of ['new-marker', 'edit-marker']) {
      await checks.test('B9', `${kind} holds private type ${category}`, async () => {
        const payload = kind === 'new-marker' ? {...addition, category} :
          {name: marker.name, category, from: marker};
        await job.reset({markers: [marker], rows: [suggestion(100, kind, payload)]});
        await assertHeld(100);
        assert.deepEqual(await job.json('data/markers.json'), [marker]);
      });
    }
  }

  await checks.test('B9', 'review type choices exclude every private category', async () => {
    const e = await browser(true);
    e.suggestions.push(suggestion(100, 'new-marker', addition, {status: 'pending'}));
    const {openDesk} = await import('./regression-harness.mjs');
    await openDesk(e);
    const choices = e.context.$('review-category').querySelectorAll('option').map(o => o.value);
    assert(choices.includes('Quest NPC'));
    for (const category of ['Personal', 'Ore', 'Wood', 'Herbs', 'Camping spot']) {
      assert(!choices.includes(category), `${category} must stay private`);
    }
  });

  await checks.test('B10', 'Old Rankle #940 and #1006 both publish the same Quest NPC wish', async () => {
    const rankle = {...marker, id: 'community-123', name: 'Old Rankle', category: 'Personal'};
    const rows = [suggestion(940, 'edit-marker', {name: rankle.name, category: 'Quest NPC',
      from: {...rankle, category: 'Personal'}}, {target_id: rankle.id}),
    suggestion(1006, 'edit-marker', {name: rankle.name, category: 'Quest NPC',
      from: {...rankle, category: 'Notable NPC'}}, {target_id: rankle.id})];
    await job.reset({markers: [rankle], rows});
    await apply();
    const marked = await job.run(true);
    assert.equal(marked.code, 0, marked.output);
    assert.deepEqual(job.state.rows.map(r => r.status), ['published', 'published'],
      'Identical wishes must not conflict');
    assert.deepEqual(await job.json('.publish/held.json'), []);
  });

  for (const key of ['classes', 'sells']) {
    await checks.test('B10', `new-marker ${key}:null means absent`, async () => {
      const category = key === 'classes' ? 'Class trainer' : 'Vendor';
      await job.reset({rows: [suggestion(100, 'new-marker', {...addition, category, [key]: null})]});
      await apply();
      assert.deepEqual(await job.json('.publish/held.json'), [], 'Null optional arrays must publish');
      const added = (await job.json('data/markers.json'))[0];
      assert(added && !Object.hasOwn(added, key), `${key}:null must not be stored`);
    });
  }

  await checks.test('B10', 'new exit Arrow None from the desk publishes with no arrow', async () => {
    const e = await browser(true);
    const row = suggestion(100, 'new-marker', {...addition, category: 'Personal',
      noteType: 'exit', arrow: 'north'}, {status: 'pending'});
    e.suggestions.push(row);
    const {openDesk, cardAction} = await import('./regression-harness.mjs');
    await openDesk(e);
    e.context.$('review-arrow').value = '';
    e.context.$('review-arrow').fire('change');
    await cardAction(e, 'Approve');
    assert.equal(row.status, 'approved', 'The desk must approve the cleared arrow');
    await job.reset({rows: [row]});
    await apply();
    assert.deepEqual(await job.json('.publish/held.json'), [], 'Arrow None must not loop back to review');
    const added = (await job.json('data/labels.json')).labels[0];
    assert(added && !Object.hasOwn(added, 'arrow'));
  });

  await checks.test('B15', 'label removal leaves a trainer chip with the same id', async () => {
    const label = {...marker, kind: 'building'};
    delete label.category;
    const trainer = {id: label.id, name: 'Tutor', building: 'Hall', classes: ['Monk'],
      abbreviations: ['MNK'], x: 10, y: 20, level: 'lower'};
    await job.reset({labels: [label], trainers: [trainer], rows: [suggestion(100,
      'edit-label', {name: label.name, remove: true, from: label})]});
    await apply();
    const data = await job.json('data/labels.json');
    assert.deepEqual(data.labels, []);
    assert.deepEqual(data.trainers, [trainer], 'The chip belongs to a separate namespace');
  });

  await checks.test('B14', 'new Blacktide Bay place moved to caves lands in caves labels', async () => {
    const registry = JSON.parse(await readFile(new URL('../data/maps.json', import.meta.url)));
    const map = registry.maps.find(m => m.id === 'blacktide-bay');
    assert(map, 'The Blacktide Bay registry entry exists');
    const caves = {...map, ...map.levels.find(l => l.id === 'caves')};
    const e = await browser(true);
    e.context.registry = {maps: [map]};
    e.context.config = {...map, ...map.levels.find(l => l.id === 'floor-1'),
      id: map.id, levelId: 'floor-1'};
    const row = suggestion(100, 'new-marker', {...addition, category: 'Personal',
      noteType: 'label'}, {status: 'pending', map: map.id, level: 'floor-1'});
    e.suggestions.push(row);
    const {openDesk, cardAction} = await import('./regression-harness.mjs');
    await openDesk(e);
    e.context.$('review-level').value = 'caves';
    await cardAction(e, 'Approve');
    assert.equal(row.payload.level, 'caves', 'The real desk supplies the changed floor');
    await job.reset({maps: {maps: [map]}, rows: [row]});
    for (const floor of [map, ...map.levels.map(l => ({...map, ...l}))]) {
      if (floor.markersFile) await job.write(floor.markersFile, []);
      if (floor.labelsFile) await job.write(floor.labelsFile, {labels: [], trainers: []});
    }
    await apply();
    assert.deepEqual(await job.json('.publish/held.json'), []);
    assert((await job.json(caves.labelsFile)).labels.some(m => m.id === 'community-100'),
      'The label must be written in the caves file');
    assert(!(await job.json(map.labelsFile)).labels.some(m => m.id === 'community-100'));
  });

  await checks.test('B21', 'empty run changes no data or publish-log entry', async () => {
    await job.reset();
    const before = await job.json('data/publish-log.json');
    const result = await apply();
    assert.deepEqual(await job.json('.publish/applied.json'), []);
    assert.deepEqual(await job.json('data/publish-log.json'), before,
      'An empty run must preserve the recovery log');
    assert(result.output.includes('0 data files changed.'), 'No data change may trigger a publish');
  });

  for (const operation of ['hold', 'acknowledgement']) {
    await checks.test('B16', `failed ${operation} write fails or emits an error annotation`, async () => {
      const row = suggestion(100, 'edit-marker', {name: 'Bay Bank', from: marker});
      if (operation === 'hold') row.payload.from.name = 'Old Bank';
      await job.reset({markers: [marker], rows: [row]});
      await apply();
      job.state.failPatch = () => true;
      const result = await job.run(true);
      assert(job.state.requests.some(r => r.method === 'PATCH'), 'The failing write was attempted');
      assert(result.code !== 0 || result.output.includes('::error::'),
        'Write failures must be errors, not warning-only success');
    });
  }

  const shape = {kind: 'path', points: [[10, 20], [30, 40]], loop: false};
  const changedShape = {kind: 'path', points: [[10, 20], [40, 50]], loop: false};
  const link = {...marker, category: 'Passage', shape, toLevel: 'upper',
    toMarker: 'stairs', direction: 'up', travel: 'Stairs', switchOnClick: true};
  const arrival = {...marker, id: 'stairs', level: 'upper', x: 80, y: 80};
  for (const [field, late, required] of [
    ['position', {x: 30, y: 40}, ['x', 'y']],
    ['shape', {shape: changedShape}, ['shape']],
    ['travel', {direction: 'down', switchOnClick: false},
      ['toLevel', 'toMarker', 'direction', 'travel', 'switchOnClick']]
  ]) {
    await checks.test('B13', `late ${field} correction has complete from and publishes next run`, async () => {
      const live = field === 'position' ? marker : link;
      const row = suggestion(100, 'edit-marker', {name: 'Renamed place', from: live});
      await job.reset({markers: [live, arrival], rows: [row]});
      await apply();
      assert.equal((await job.json('.publish/applied.json')).length, 1,
        'The original rename must apply before the acknowledgement race');
      Object.assign(job.state.rows[0].payload, plain(late));
      job.state.rows[0].updated_at = '2026-10-20T11:00:00Z';
      const marked = await job.run(true);
      assert.equal(marked.code, 0, marked.output);
      const correction = job.state.rows.find(r => r.id !== 100);
      assert(correction, 'Acknowledgement creates a correction');
      const applied = (await job.json('data/markers.json')).find(m => m.id === live.id);
      const missing = required.filter(k => !Object.hasOwn(correction.payload.from, k) ||
        JSON.stringify(correction.payload.from[k]) !== JSON.stringify(applied[k]));
      // Always run the follow-up publication, even if the baseline is incomplete.
      const next = await job.run();
      const held = await job.json('.publish/held.json');
      const output = (await job.json('data/markers.json')).find(m => m.id === live.id);
      assert.equal(missing.length, 0, `Correction from is missing ${missing.join(', ')}`);
      assert.equal(next.code, 0, next.output);
      assert(!held.some(h => h.id === correction.id), 'The correction must publish on the next run');
      for (const [k, v] of Object.entries(late)) assert.deepEqual(output[k], v);
    });
  }

  await checks.test('B13', 'lost runner preserves the exact applied shape and travel version', async () => {
    const row = suggestion(100, 'edit-marker', {name: 'Renamed passage', from: link});
    await job.reset({markers: [link, arrival], rows: [row]});
    await apply();
    const log = await job.json('data/publish-log.json');
    assert.deepEqual(log[0].rows[0].version.payload, row.payload);
    assert(!Object.hasOwn(log[0].rows[0].version, 'author_name'));
    await job.write('.publish/applied.json', []);
    Object.assign(job.state.rows[0].payload, {shape: changedShape, direction: 'down',
      switchOnClick: false});
    job.state.rows[0].updated_at = '2026-10-20T11:00:00Z';
    await apply();
    const published = job.state.rows.find(r => r.id === 100);
    assert.equal(published.status, 'published');
    assert.deepEqual(published.payload, row.payload, 'Recovery records only what actually landed');
    const correction = job.state.rows.find(r => r.id !== 100);
    assert(correction);
    for (const key of ['x', 'y', 'shape', 'toLevel', 'toMarker', 'direction', 'travel',
      'switchOnClick']) assert.deepEqual(correction.payload.from[key], link[key]);
    assert.deepEqual(await job.json('.publish/held.json'), []);
    const actual = (await job.json('data/markers.json'))[0];
    assert.deepEqual(actual.shape, changedShape);
    assert.equal(actual.direction, 'down');
    assert.equal(actual.switchOnClick, false);
  });

  for (const operation of ['hold', 'acknowledgement']) {
    await checks.test('B16', `failed ${operation} continues through the other rows`, async () => {
      const other = {...marker, id: 'other'};
      const rows = [marker, other].map((m, i) => suggestion(100 + i, 'edit-marker', {
        name: 'Renamed ' + m.id, from: {...m,
          ...(operation === 'hold' ? {name: 'Stale'} : {})}
      }, {target_id: m.id}));
      await job.reset({markers: [marker, other], rows});
      await apply();
      assert(!job.state.requests.some(r => r.method === 'PATCH'),
        'Apply cannot send holds or acknowledgements before a successful push');
      job.state.failPatch = q => q.get('id') === 'eq.100';
      const result = await job.run(true);
      assert.equal(result.code, 1, result.output);
      assert(result.output.includes('::error::'));
      assert.equal(job.state.rows[0].status, 'approved');
      assert.equal(job.state.rows[1].status,
        operation === 'hold' ? 'pending' : 'published');
    });
  }

  await checks.test('B16', 'a version check miss is logged and leaves a newer held row alone', async () => {
    const row = suggestion(100, 'edit-marker', {name: 'New bank',
      from: {...marker, name: 'Stale bank'}});
    await job.reset({markers: [marker], rows: [row]});
    await apply();
    job.state.rows[0].updated_at = '2026-10-20T13:00:00Z';
    const result = await job.run(true);
    assert.equal(result.code, 0, result.output);
    assert(result.output.includes('version check missed'));
    assert.equal(job.state.rows[0].status, 'approved');
  });

  await checks.test('B13', 'late new-marker shape correction moves its anchor in one valid edit', async () => {
    const row = suggestion(100, 'new-marker', {...addition, category: 'Passage',
      x: 10, y: 20, shape, direction: 'up'});
    await job.reset({rows: [row]});
    await apply();
    const movedShape = {...shape, points: [[30, 40], [50, 60]]};
    Object.assign(job.state.rows[0].payload, {shape: movedShape, x: 30, y: 40});
    job.state.rows[0].updated_at = '2026-10-20T13:00:00Z';
    const marked = await job.run(true);
    assert.equal(marked.code, 0, marked.output);
    const correction = job.state.rows.find(r => r.id !== 100);
    assert.deepEqual(correction.payload.from.shape, shape);
    assert.deepEqual([correction.payload.from.x, correction.payload.from.y], [10, 20]);
    await apply();
    assert.deepEqual(await job.json('.publish/held.json'), []);
    const actual = (await job.json('data/markers.json'))[0];
    assert.deepEqual(actual.shape, movedShape);
    assert.deepEqual([actual.x, actual.y], [30, 40]);
  });

  await checks.test('B20', 'building uses the same text cleanup as marker names', async () => {
    const row = suggestion(100, 'edit-marker', {name: marker.name,
      building: '\u202e <Guild>\t  Hall ', from: marker});
    await job.reset({markers: [marker], rows: [row]});
    await apply();
    const actual = (await job.json('data/markers.json'))[0];
    assert.equal(actual.building, 'Guild Hall');
    const e = await browser();
    assert.deepEqual(plain(e.context.window.atlasChanges.applyTo(marker, row)), actual);
  });

  await checks.test('B21', 'an all-held run changes no data or recovery log', async () => {
    await job.reset({markers: [marker], rows: [suggestion(100, 'new-marker',
      {...addition, futureField: 'Keep this'})]});
    const result = await apply();
    assert.equal((await job.json('.publish/held.json')).length, 1);
    assert.deepEqual(await job.json('data/publish-log.json'), []);
    assert(result.output.includes('0 data files changed.'));
  });

  await checks.test('B11', 'client new exit updown payload is accepted by the job', async () => {
    const e = await browser();
    const c = e.context;
    const form = c.window.atlasFields.build(new Node('div'), {newMarker: true,
      value: {...addition, category: 'Personal', noteType: 'exit'}, mode: () => 'exit'});
    form.controls.arrow.value = 'updown';
    const note = {...addition, ...form.read(), id: 'personal-exit', noteType: 'exit'};
    const payload = c.window.atlasFields.stored('new-marker', c.window.testCommunity.notePayload(note));
    assert.equal(payload.arrow, 'updown');
    await job.reset({rows: [suggestion(100, 'new-marker', payload)]});
    await apply();
    assert.deepEqual(await job.json('.publish/held.json'), []);
    assert.equal((await job.json('data/labels.json')).labels[0].arrow, 'updown');
    form.dispose();
  });
} finally {
  await job.close();
}
checks.finish();
