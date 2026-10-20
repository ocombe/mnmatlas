import assert from 'node:assert/strict';
import {browser, Node, plain, suite, suggestion} from './regression-harness.mjs';
import {publisher} from './publisher-harness.mjs';

const checks = suite();
const job = await publisher();
const mob = {name: 'A goblin', wikiId: 'npc-goblin',
  wiki: 'https://monstersandmemories.wiki/npcs/goblin'};
const fish = [{name: 'Thorn Sturgeon', wikiId: 'item-thorn-sturgeon',
  wiki: 'https://monstersandmemories.wiki/items/thorn-sturgeon'}, {name: 'Basa'}];
const area = {kind: 'area', form: 'rect', points: [[10, 10], [30, 10], [30, 30], [10, 30]]};
const path = {kind: 'path', points: [[10, 20], [30, 40], [50, 20]], loop: true};
const base = {id: 'published', name: 'A place', note: 'By the gate',
  category: 'Quest NPC', x: 10, y: 20, level: 'lower'};

const set = (form, key, value) => {
  const control = form.controls[key];
  assert(control, `Control ${key} exists`);
  if (control.type === 'checkbox') control.checked = value;
  else control.value = value;
  control.fire('change');
};
const sells = (form, values) => {
  for (const control of form.controls.sells.querySelectorAll('input')) {
    control.checked = values.includes(control.value);
  }
  form.controls.sells.fire('change');
};
const specs = [
  {name: 'Mob camp', value: {category: 'Mob camp', levels: [8, 12], mobs: [mob]},
    change: {levels: [9, 12]}, edit: f => {f.controls.levels.min.value = '9';}},
  {name: 'Named mob with Ambush tick', value: {category: 'Named mob', levels: [8, 8],
    ambush: false}, change: {ambush: true}, edit: f => set(f, 'ambush', true)},
  {name: 'Ambush', value: {category: 'Ambush', levels: [8, 12], mobs: [mob]},
    change: {levels: [8, 13]}, edit: f => {f.controls.levels.max.value = '13';}},
  {name: 'Fishing spot with wiki and typed fish', value: {category: 'Fishing spot', fish},
    change: {fish: [fish[0]]}, edit: f => f.controls.fish.tags.children[1].onclick()},
  {name: 'Passage How', value: {category: 'Passage', way: 'Tunnel', oneWay: true,
    direction: 'east'}, change: {way: 'Swim'}, edit: f => set(f, 'way', 'Swim')},
  {name: 'Passage One way', value: {category: 'Passage', way: 'Climb', oneWay: true,
    direction: 'up'}, change: {oneWay: false}, edit: f => set(f, 'oneWay', false)},
  {name: 'Passage Arrow', value: {category: 'Passage', way: 'Drop', oneWay: true,
    direction: 'east'}, change: {direction: 'west'}, edit: f => set(f, 'arrow', 'west')},
  ...['Trap', 'Secret', 'Quest NPC'].map(category => ({name: category, value: {category},
    change: {note: 'At the door'}, edit: f => set(f, 'note', 'At the door')})),
  {id: 'B4', name: 'Vendor Sells only keeps Kind', value: {category: 'Vendor',
    vendor: 'Mining vendor', sells: ['Materials']}, change: {sells: ['Recipes']},
    edit: f => sells(f, ['Recipes'])},
  {id: 'B4', name: 'Vendor Kind only keeps Sells', value: {category: 'Vendor',
    vendor: 'Mining vendor', sells: ['Materials']}, change: {vendor: 'Baker'},
    edit: f => set(f, 'vendor', 'Baker')},
  {name: 'Class trainer', value: {category: 'Class trainer', classes: ['Monk']},
    change: {classes: ['Cleric']}, edit: f => set(f, 'classes', 'Cleric')},
  {name: 'Multi-class trainer', value: {category: 'Class trainer',
    classes: ['Elementalist', 'Wizard', 'Enchanter']}, change: {note: 'At the door'},
    edit: f => set(f, 'note', 'At the door')},
  {name: 'Tradeskill', value: {category: 'Tradeskill', trade: 'Mining'},
    change: {trade: 'Cooking'}, edit: f => set(f, 'trade', 'Cooking')},
  {name: 'Floor link', value: {category: 'Passage', way: 'Climb',
    toLevel: 'upper', toMarker: 'stairs', direction: 'up', switchOnClick: true},
    change: {switchOnClick: false}, edit: f => set(f, 'switchOnClick', false)},
  {name: 'Zone exit', value: {category: 'Personal', kind: 'exit', noteType: 'exit',
    priority: 50, minZoom: 0, arrow: 'east', toMap: 'other-map', toPlace: 'gate',
    travel: 'Exit'}, label: true, change: {arrow: 'west'}, edit: f => set(f, 'arrow', 'west')},
  {name: 'Place name', value: {category: 'Personal', kind: 'building', noteType: 'label',
    priority: 50, minZoom: 0}, label: true, change: {note: 'At the door'},
    edit: f => set(f, 'note', 'At the door')},
  ...[['Pin', null], ['Area', area], ['Path', path]].map(([name, shape]) => ({
    name: `${name} shape`, value: {...(shape ? {shape} : {}),
      x: name === 'Area' ? 20 : 10, y: 20}, change: {note: 'At the door'},
    edit: f => set(f, 'note', 'At the door')
  }))
];

function memo(run) {
  let pending;
  return () => pending ||= run();
}

async function roundtrip(spec, adding) {
  const e = await browser();
  const c = e.context;
  const value = {...base, ...spec.value};
  if (spec.label) {delete value.category; delete value.noteType;}
  const published = plain(value);
  // A fresh personal label has no cartographer display settings.
  if (adding && spec.label) {delete value.minZoom; delete value.priority;}
  const arrival = {id: 'stairs', name: 'Stairs', category: 'Passage',
    x: 80, y: 80, level: 'upper'};
  c.originals = [value, arrival];
  c.registry.maps.push({id: 'other-map', title: 'Other map',
    markersFile: 'data/other.json', labelsFile: 'data/other-labels.json'});
  c.fetchData = async file => file.endsWith('labels.json') ? {labels: [{id: 'gate',
    name: 'Gate', kind: 'building', x: 10, y: 20}]} : [];
  const form = c.window.atlasFields.build(new Node('div'), {
    value, label: spec.label, newMarker: adding,
    mode: () => spec.label ? (spec.value.noteType || 'label') : null
  });
  // Exercise the actual read/delta/nextFrom chain used by editDialog.
  if (!adding) spec.edit(form);
  const read = plain(form.read());
  const kind = adding ? 'new-marker' : spec.label ? 'edit-label' : 'edit-marker';
  const note = {...value, ...read, id: 'personal-draft',
    ...(spec.label ? {category: 'Personal', noteType: spec.value.noteType} : {})};
  const payload = adding ? c.window.testCommunity.notePayload(note) :
    c.window.atlasFields.delta(read, c.window.atlasChanges.nextFrom({effective: value}, kind));
  const row = suggestion(100, kind, c.window.atlasFields.stored(kind, payload));
  const markers = spec.label ? [arrival] : [published, arrival];
  await job.reset({markers, labels: spec.label ? [published] : [], rows: [row]});
  const result = await job.run();
  const held = await job.json('.publish/held.json');
  const values = spec.label ? (await job.json('data/labels.json')).labels :
    await job.json('data/markers.json');
  const actual = values.find(v => v.id === (adding ? 'community-100' : value.id));
  const preview = plain(c.window.atlasChanges.applyTo(adding ? null : value,
    {...row, payload: plain(payload)}));
  let expected;
  if (adding) {
    expected = {...published, id: 'community-100', community: true};
  } else expected = {...published, ...spec.change, community: true};
  form.dispose();
  return {result, held, actual, preview, expected, payload};
}

try {
  for (const spec of specs) {
    for (const adding of [false, true]) {
      const mode = adding ? 'new' : 'edit';
      const get = memo(() => roundtrip(spec, adding));
      await checks.test(spec.id || 'B6', `${spec.name} ${mode} form to published JSON`, async () => {
        const r = await get();
        assert.equal(r.result.code, 0, r.result.output);
        assert.equal(r.held.length, 0, r.held.map(h => h.note).join('; '));
        assert.deepEqual(r.actual, r.expected, 'Published JSON must equal exactly the form intent');
      });
      await checks.test('B8', `${spec.name} ${mode} preview equals publication`, async () => {
        const r = await get();
        assert.equal(r.held.length, 0, 'The form payload must publish before preview comparison');
        assert.deepEqual(r.preview, r.actual, 'Desk preview must deep-equal the published marker');
      });
    }
  }

  const clears = [
    {name: 'Sells all unticked', value: {category: 'Vendor', vendor: 'Baker',
      sells: ['Materials']}, key: 'sells', edit: f => sells(f, [])},
    {name: 'Kind Not set', value: {category: 'Vendor', vendor: 'Baker', sells: ['Materials']},
      key: 'vendor', edit: f => set(f, 'vendor', '')},
    {name: 'Trade Any trade', value: {category: 'Tradeskill', trade: 'Mining'},
      key: 'trade', edit: f => set(f, 'trade', '')},
    {name: 'Class Not set', value: {category: 'Class trainer', classes: ['Monk']},
      key: 'classes', edit: f => set(f, 'classes', '')},
    {name: 'Level emptied', value: {category: 'Named mob', levels: [8, 8]},
      key: 'levels', edit: f => {f.controls.levels.fixed.value = '';}},
    {name: 'Fish emptied', value: {category: 'Fishing spot', fish: [fish[0]]},
      key: 'fish', edit: f => f.controls.fish.tags.children[0].onclick()},
    {name: 'How Not set', value: {category: 'Passage', way: 'Tunnel'},
      key: 'way', edit: f => set(f, 'way', '')}
  ];
  for (const spec of clears) {
    const get = memo(async () => {
      const e = await browser();
      const c = e.context;
      const value = {...base, ...spec.value};
      const form = c.window.atlasFields.build(new Node('div'), {value});
      spec.edit(form);
      let read;
      try {read = form.read();} catch (error) {
        assert(error.message.trim(), 'A refused clear must have a visible message');
        return {refused: true};
      }
      const payload = c.window.atlasFields.delta(read,
        c.window.atlasChanges.nextFrom({effective: value}, 'edit-marker'));
      const row = suggestion(100, 'edit-marker', payload);
      await job.reset({markers: [value], rows: [row]});
      const result = await job.run();
      const actual = (await job.json('data/markers.json'))[0];
      const preview = plain(c.window.atlasChanges.applyTo(value, row));
      form.dispose();
      return {result, actual, preview, held: await job.json('.publish/held.json')};
    });
    await checks.test('B5', `${spec.name} removes field on publish`, async () => {
      const r = await get();
      if (r.refused) return;
      assert.equal(r.result.code, 0, r.result.output);
      assert.equal(r.held.length, 0, 'Clearing must not be held');
      assert(!Object.hasOwn(r.actual, spec.key), `Cleared ${spec.key} must be absent`);
      const expected = {...base, ...spec.value, community: true};
      delete expected[spec.key];
      assert.deepEqual(r.actual, expected, 'A clear keeps every unrelated field');
    });
    await checks.test('B8', `${spec.name} preview equals publication`, async () => {
      const r = await get();
      if (!r.refused) assert.deepEqual(r.preview, r.actual, 'Clear preview must match publication');
    });
  }
} finally {
  await job.close();
}
checks.finish();
