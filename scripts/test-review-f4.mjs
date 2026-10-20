import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {browser, Node, plain, settle, suite, suggestion} from './regression-harness.mjs';
import {publisher} from './publisher-harness.mjs';

const checks = suite(), job = await publisher();
const marker = {id: 'published', name: 'Bank', category: 'Bank', note: '', x: 10, y: 20, level: 'lower'};
const note = (id, extra = {}) => ({id: 'personal-' + id, name: id, category: 'Personal',
  note: '', x: 30, y: 40, level: 'lower', ...extra});
const apply = async () => {
  const result = await job.run();
  assert.equal(result.code, 0, result.output);
  return result;
};

try {
  for (const noteType of [undefined, 'label', 'exit']) {
    await checks.test('R2-1', `new ${noteType || 'marker'} publishes an empty note string`, async () => {
      const payload = {name: 'Place', category: 'Bank', note: '', x: 30, y: 40,
        ...(noteType ? {noteType} : {})};
      await job.reset({rows: [suggestion(100, 'new-marker', payload)]});
      await apply();
      assert.deepEqual(await job.json('.publish/held.json'), []);
      const data = await job.json(noteType ? 'data/labels.json' : 'data/markers.json');
      assert.equal((noteType ? data.labels : data)[0].note, '');
    });
  }
  for (const value of ['', null]) {
    await checks.test('R2-1', `note clear ${JSON.stringify(value)} is empty and an already-live edit is recognised`, async () => {
      const row = suggestion(100, 'edit-marker', {name: marker.name, note: value,
        from: {...marker, note: 'Old note'}}, {target_id: marker.id});
      await job.reset({markers: [{...marker, note: 'Old note'}], rows: [row]});
      await apply();
      assert.equal((await job.json('data/markers.json'))[0].note, '');
      await job.reset({markers: [marker], rows: [row]});
      const retry = await job.run(['--dry-run']);
      assert.equal(retry.code, 0, retry.output);
      assert(retry.output.includes('already edited'), retry.output);
      assert.deepEqual(await job.json('.publish/held.json'), []);
    });
  }
  await checks.test('R2-1', 'optional text clears never become the text null', async () => {
    const cleared = ['trade', 'vendor', 'wiki', 'wikiId', 'color', 'travel', 'arrow', 'toMap', 'toPlace', 'toLevel', 'toMarker', 'direction', 'building'];
    const live = {...marker, trade: 'Fishing', travel: 'Stairs', arrow: 'up', toMap: 'other-map', toPlace: 'gate', toLevel: 'upper', toMarker: 'arrival', direction: 'up', building: 'Hall', category: 'Vendor', vendor: 'Shady merchant', wiki: 'https://monstersandmemories.wiki/wiki/Bank', wikiId: 'npc-bank', color: '#a04438'};
    await job.reset({markers: [live], rows: [suggestion(100, 'edit-marker', {
      name: live.name, note: null, ...Object.fromEntries(cleared.map(k => [k, null])), from: live})]});
    await apply();
    const out = (await job.json('data/markers.json'))[0];
    assert.equal(out.note, '');
    for (const key of cleared) assert(!Object.hasOwn(out, key));
    assert(!JSON.stringify(out).includes('null'));
  });

  for (const scenario of ['map switch during debounce', 'failed push retried on another map', 'tileRevision change']) {
    await checks.test('R2-2', scenario + ' saves the merged list under its original storage key', async () => {
      const seed = note('seed'), other = note('other'), shared = [seed, other];
      const state = {exists: true, updated_at: '2026-10-20T08:00:00.000Z'};
      const a = await browser(false, {notes: shared, notesState: state, personal: plain(shared)});
      const b = await browser(false, {notes: shared, notesState: state, personal: plain(shared)});
      const c = a.context, oldKey = c.storageKey('notes');
      const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
      vm.runInContext(app.slice(app.indexOf('function valid('), app.indexOf('function normaliseNote(')), c);
      b.context.persist([...b.context.personal.map(m => m.id === seed.id ? {...m, note: 'B edit'} : m), note('remote')]);
      await b.tick(2000);
      c.persist(c.personal.map(m => m.id === other.id ? {...m, note: 'A edit'} : m));
      if (scenario.startsWith('failed')) {
        a.failNotes = true; await a.tick(2000); a.failNotes = false;
      }
      if (scenario.startsWith('tile')) c.config.tileRevision = 'edition-2';
      else c.config.id = 'other-map';
      c.config.width = 15; c.config.height = 15; c.config.levels = [{id: 'different-floor'}];
      c.personal = [note('other-map-only')];
      c.localStorage.setItem(c.storageKey('notes'), JSON.stringify(c.personal));
      const otherKey = c.storageKey('notes'), otherStorage = c.localStorage.getItem(otherKey);
      if (scenario.startsWith('failed')) await c.window.testCommunity.pushJobs();
      else await a.tick(2000);
      const saved = JSON.parse(c.localStorage.getItem(oldKey));
      assert.equal(saved.find(m => m.id === seed.id).note, 'B edit');
      assert.equal(saved.find(m => m.id === other.id).note, 'A edit');
      assert(saved.some(m => m.id === 'personal-remote'));
      assert.equal(c.localStorage.getItem(otherKey), otherStorage);
      assert.deepEqual(saved, plain(shared));
      const base = c.window.testCommunity.readBase('member', 'test-map-v1');
      assert.equal(base.size, saved.length);
      for (const m of saved) assert.equal(base.get(m.id), JSON.stringify(Object.keys(m).sort().map(k => [k, m[k]])));
      c.config.id = 'test-map'; c.config.tileRevision = 'v1'; c.config.width = 200; c.config.height = 200; c.config.levels = [{id: 'lower'}, {id: 'upper'}]; c.personal = saved;
      await c.window.testCommunity.sync();
      assert.equal(shared.find(m => m.id === seed.id).note, 'B edit');
      assert(shared.some(m => m.id === 'personal-remote'));
    });
  }
  await checks.test('R2-2', 'unreadable storage on the queued map prevents upload and base advancement', async () => {
    const e = await browser(false, {notes: [], personal: []}), c = e.context;
    c.persist([note('safe')]);
    const key = c.storageKey('notes'), before = plain([...c.window.testCommunity.readBase('member', 'test-map-v1')]);
    c.config.id = 'other-map'; c.localStorage.setItem(key, '{broken');
    await e.tick(2000);
    assert.equal(c.localStorage.getItem(key), '{broken');
    assert.deepEqual(e.remote, []);
    assert.deepEqual(plain([...c.window.testCommunity.readBase('member', 'test-map-v1')]), before);
  });

  await checks.test('R2-3', 'world zone rename keeps all untouched navigation fields in preview and publication', async () => {
    const zone = JSON.parse(await readFile(new URL('../data/world/labels.json', import.meta.url), 'utf8')).labels.find(m => m.id === 'zone-night-harbor');
    const e = await browser(), row = suggestion(100, 'edit-label', {name: 'Harbor', from: {name: zone.name}}, {target_id: zone.id});
    const preview = plain(e.context.atlasMarkerSchema.apply(zone, row));
    assert.equal(preview.toMap, zone.toMap);
    const full = plain(e.context.atlasMarkerSchema.apply(zone, {...row, payload: {name: 'Harbor', toMap: zone.toMap, from: {name: zone.name, toMap: zone.toMap}}}));
    assert.equal(full.toMap, zone.toMap, 'An unchanged field in a complete edit must also survive');
    await job.reset({labels: [zone], rows: [row]});
    // This fixture uses its own map registry, so keep the real destination available.
    const maps = await job.json('data/maps.json'); maps.maps.push({id: zone.toMap});
    await job.write('data/maps.json', maps);
    await apply();
    assert.deepEqual((await job.json('data/labels.json')).labels[0], preview);
  });

  await checks.test('R2-4', 'failed recovery acknowledgement annotates an error while other rows and holds proceed', async () => {
    const old = suggestion(90, 'edit-marker', {name: 'Renamed bank', from: {name: marker.name}});
    await job.reset({markers: [marker], rows: [old]});
    await apply();
    job.state.rows.push(suggestion(100, 'new-marker', {name: 'Other', note: '', category: 'Bank', x: 30, y: 40}),
      suggestion(101, 'new-marker', {name: 'Bad', note: '', category: 'Personal', x: 30, y: 40}));
    job.state.failPatch = q => q.get('id') === 'eq.90';
    const result = await apply();
    assert(result.output.includes('::error::Suggestion 90 could not be acknowledged'), result.output);
    assert((await job.json('data/markers.json')).some(m => m.id === 'community-100'));
    const marked = await job.run(true);
    assert.equal(marked.code, 0, marked.output);
    assert(!(await job.json('.publish/applied.json')).some(r => r.id === 90));
    assert.equal(job.state.rows.find(r => r.id === 100).status, 'published');
    assert.equal(job.state.rows.find(r => r.id === 101).status, 'pending');
    const log = await job.json('data/publish-log.json');
    const receipts = log.flatMap(run => run.rows).filter(r => r.id === 90);
    assert.equal(receipts.length, 1, 'A failed recovery must not create a fresh receipt');
  });
  await checks.test('R2-4', 'recovery receipts expire after seven days without another patch attempt', async () => {
    const old = suggestion(90, 'edit-marker', {name: 'Renamed bank', from: {name: marker.name}});
    await job.reset({markers: [marker], rows: [old]}); await apply();
    const log = await job.json('data/publish-log.json'); log[0].at = new Date(Date.now() - 8 * 86400000).toISOString();
    await job.write('data/publish-log.json', log);
    job.state.failPatch = () => true; job.state.requests.length = 0;
    await apply();
    assert(!job.state.requests.some(r => r.method === 'PATCH'));
  });
  await checks.test('R2-4', 'holds return independently of a failed push and dry runs have no hold step', async () => {
    await job.reset({rows: [suggestion(100, 'new-marker', {name: 'Bad', category: 'Personal', x: 30, y: 40})]});
    await apply();
    // No simulated successful push or acknowledgement: only the independent cleanup phase runs.
    const result = await job.run(['--return-holds', '.publish/held.json']);
    assert.equal(result.code, 0, result.output);
    assert.equal(job.state.rows[0].status, 'pending');
    assert(job.state.rows[0].review_note.startsWith('Not published:'));
    const workflow = await readFile(new URL('../.github/workflows/apply-suggestions.yml', import.meta.url), 'utf8');
    const step = workflow.split('- name: Return held suggestions to review')[1].split('# A push')[0];
    assert(step.includes('always() && inputs.dry_run != true'));
    assert(step.includes('--return-holds .publish/held.json'));
    assert(!step.includes('--mark-published'));
  });

  for (const chipOnly of [false, true]) {
    await checks.test('R2-5', `trainer move keeps chip fields on the chip (${chipOnly ? 'chip only' : 'paired marker'})`, async () => {
      const trainer = {...marker, category: 'Class trainer', classes: ['Cleric']};
      const chip = {id: marker.id, x: 10, y: 20, level: 'lower', building: 'Hospice', classes: ['Cleric'], abbreviations: ['CLR']};
      await job.reset({markers: chipOnly ? [] : [trainer], trainers: [chip], rows: [suggestion(100, 'move-marker', {
        name: marker.name, from: [10, 20], to: [35, 45]})]});
      await apply();
      const markers = await job.json('data/markers.json'), movedChip = (await job.json('data/labels.json')).trainers[0];
      assert.equal(movedChip.x, 35); assert.equal(movedChip.y, 45);
      assert.equal(movedChip.building, 'Hospice');
      if (chipOnly) {assert(!Object.hasOwn(movedChip, 'name')); assert(!Object.hasOwn(movedChip, 'category'));}
      else {assert(!Object.hasOwn(markers[0], 'building')); assert(!Object.hasOwn(markers[0], 'abbreviations')); assert.equal(markers[0].x, 35);}
    });
  }
  await checks.test('R2-6', 'prepare validates classes without a resolved category', async () => {
    const live = {...marker}; delete live.category;
    await job.reset({markers: [live], rows: [suggestion(100, 'edit-marker', {name: live.name, classes: ['Cleric'], from: {name: live.name}})]});
    await apply();
    const held = await job.json('.publish/held.json');
    assert(!JSON.stringify(held).includes('is not defined'));
    assert.deepEqual(held, [], 'Valid classes reach the unresolved-category path without a scope error');
  });
  await checks.test('R2-7', 'legacy exit tier publishes and Shadowknight publishes as Shadow Knight', async () => {
    await job.reset({rows: [suggestion(100, 'new-marker', {name: 'Exit', category: 'Bank', note: '', noteType: 'exit', tier: 'exit', x: 30, y: 40}, {user_id: 'reviewer'}),
      suggestion(101, 'new-marker', {name: 'Trainer', category: 'Class trainer', classes: ['Shadowknight'], x: 60, y: 70})]});
    await apply();
    assert.deepEqual(await job.json('.publish/held.json'), []);
    assert.equal((await job.json('data/labels.json')).labels[0].tier, 'exit');
    assert.deepEqual((await job.json('data/markers.json'))[0].classes, ['Shadow Knight']);
  });
  await checks.test('R2-7', 'legacy trainer classes stay selected in the form and normalise on a note edit', async () => {
    const e = await browser(), c = e.context;
    const trainer = {...marker, category: 'Class trainer', classes: ['Cleric', 'Shadowknight']};
    const form = c.window.atlasFields.build(new Node('div'), {value: trainer});
    assert.deepEqual(plain(form.readClasses()), ['Cleric', 'Shadow Knight']);
    form.setClasses([...form.readClasses(), 'Wizard']);
    assert.deepEqual(plain(form.read().classes), ['Cleric', 'Shadow Knight', 'Wizard']);
    await job.reset({markers: [trainer], rows: [suggestion(100, 'edit-marker', {name: trainer.name, note: 'Trainer note', from: trainer})]});
    await apply();
    assert.deepEqual((await job.json('data/markers.json'))[0].classes, ['Cleric', 'Shadow Knight']);
  });
  await checks.test('R2-7', 'every published marker label and chip validates except Personal markers', async () => {
    const root = new URL('../', import.meta.url), read = async path => readFile(new URL(path, root), 'utf8');
    const context = vm.createContext({URL}), app = await read('app.js');
    vm.runInContext(app.slice(app.indexOf('const baseCategories='), app.indexOf('const mobileLayout=')), context);
    for (const name of ['icons.js', 'marker-schema.js', 'changes.js', 'wiki-links.js']) vm.runInContext(await read(name), context);
    const schema = context.atlasMarkerSchema, failures = []; let count = 0, skipped = 0;
    const visit = async folder => {
      for (const entry of await readdir(new URL(folder, root), {withFileTypes: true})) {
        const path = folder + entry.name;
        if (entry.isDirectory()) {if (entry.name !== 'tiles') await visit(path + '/'); continue;}
        if (!/(?:markers|labels)\.json$/.test(entry.name)) continue;
        const data = JSON.parse((await read(path)).replace(/^\uFEFF/, ''));
        for (const [kind, rows] of Array.isArray(data) ? [['marker', data]] : [['label', data.labels || []], ['chip', data.trainers || []]]) {
          for (const m of rows) {
            if (kind === 'marker' && m.category === 'Personal') {skipped++; continue;}
            count++;
            const payload = Object.fromEntries(Object.entries(m).filter(([k]) => !['id', 'community', 'abbreviations', 'removed'].includes(k)));
            try {
              schema.validate(payload, {label: kind !== 'marker', category: kind === 'chip' ? 'Class trainer' : m.category});
              const live = kind === 'chip' ? {...m, name: m.name || m.building || '', category: 'Class trainer'} : m;
              const changed = schema.apply(live, {id: 1, kind: kind === 'label' ? 'edit-label' : 'edit-marker', payload: {name: live.name, note: 'Updated note', from: {name: live.name, note: live.note}}});
              assert(!changed.refusal, changed.refusal);
              for (const key of ['linkedArea', 'alignmentHelper', 'route', 'timesSource', 'passes']) if (Object.hasOwn(m, key)) assert.deepEqual(plain(changed[key]), m[key]);
            } catch (error) {failures.push(path + '#' + m.id + ': ' + error.message);}
          }
        }
      }
    };
    await visit('data/');
    console.log(`Published schema scan: ${count} validated, ${skipped} Personal markers excepted`);
    assert(count > 1500);
    assert.deepEqual(failures, []);
  });

  for (const legacy of ['missing floor', 'Shady merchant', 'shape anchor']) {
    await checks.test('R2-8', `first save preserves the timestamp of a normalised ${legacy} note`, async () => {
      const raw = note('legacy', {updated: 12});
      if (legacy === 'missing floor') delete raw.level;
      if (legacy === 'Shady merchant') raw.category = 'Shady merchant';
      if (legacy === 'shape anchor') raw.shape = {kind: 'area', form: 'circle', points: [[60, 60]], r: 5};
      const e = await browser(false, {notes: [], personal: []}), c = e.context;
      c.config.defaultLevel = 'lower';
      c.localStorage.setItem(c.storageKey('notes'), JSON.stringify([raw]));
      const normal = plain(c.normaliseNote(raw));
      assert(c.persist([normal]));
      assert.equal(c.personal[0].updated, 12);
      assert(c.persist([{...normal, note: 'Real edit'}]));
      assert(c.personal[0].updated > 12);
    });
  }
  await checks.test('R2-8', 'a deletion during legacy-note sync survives the normalised remote base', async () => {
    const e = await browser(false, {notes: [], personal: []}), c = e.context;
    c.config.defaultLevel = 'lower';
    const legacy = note('legacy'); delete legacy.level;
    e.remote.push(legacy);
    let deleted = false;
    e.notesFault = request => {
      if (request.op === 'select' && !request.filters.map.endsWith('#private') && !deleted) {
        deleted = true;
        c.persist([]);
      }
    };
    // Capture the legacy server copy, then simulate its removal before the conditional upload.
    c.localStorage.setItem('mnmaps-community-synced-member-test-map-v1', JSON.stringify({[legacy.id]: JSON.stringify(Object.keys(c.normaliseNote(legacy)).sort().map(k => [k, c.normaliseNote(legacy)[k]]))}));
    await c.window.testCommunity.sync();
    assert.equal(c.personal.length, 0);
    assert.equal(e.remote.length, 0);
  });

  for (const kind of ['changed type', 'exit', 'wiki id without wiki']) {
    await checks.test('R2-9', `note payload removes stale fields for ${kind}`, async () => {
      const e = await browser(), c = e.context, schema = c.atlasMarkerSchema;
      const m = note('share', {category: 'Bank', levels: [5, 9], mobs: [{name: 'Rat'}], fish: [{name: 'Basa'}], classes: ['Cleric'], building: 'Old trainer hall'});
      if (kind === 'exit') Object.assign(m, {noteType: 'exit', wiki: 'https://monstersandmemories.wiki/wiki/Bank', wikiId: 'npc-bank', color: '#a04438'});
      if (kind === 'wiki id without wiki') m.wikiId = 'npc-bank';
      const payload = plain(c.window.testCommunity.notePayload(m));
      for (const key of ['levels', 'mobs', 'fish', 'classes', 'building', 'wikiId']) assert(!Object.hasOwn(payload, key), key);
      if (kind === 'exit') for (const key of ['wiki', 'color']) assert(!Object.hasOwn(payload, key), key);
      assert.doesNotThrow(() => schema.validate(payload, {label: kind === 'exit'}));
      await job.reset({rows: [suggestion(100, 'new-marker', payload)]}); await apply();
      assert.deepEqual(await job.json('.publish/held.json'), []);
    });
  }
  for (const field of ['x', 'note']) await checks.test('R2-10', `successful follow ${field === 'x' ? 'move' : 'edit'} insert is remembered when its refresh throws`, async () => {
    const e = await browser(), c = e.context, methods = c.window.testCommunity;
    e.recordInserts = true;
    const original = note('follow', {category: 'Bank'}), sent = plain(methods.notePayload(original));
    e.suggestions.push(suggestion(100, 'new-marker', sent, {status: 'published', user_id: 'member'}));
    c.originals = [{...original, id: 'community-100'}];
    const rec = {id: 100, sent, credit: false}, changed = {...original, [field]: field === 'x' ? 70 : 'Edited note'};
    methods.writeFollowed({[methods.followId(original)]: rec});
    const refresh = c.window.atlasNotices.refresh;
    c.window.atlasNotices.refresh = () => {throw Error('Refresh failed after insert');};
    await methods.followNote(changed, rec);
    const saved = plain(methods.readFollowed()[methods.followId(original)]);
    assert.equal(saved.sent[field], changed[field]);
    c.window.atlasNotices.refresh = refresh;
    await methods.followNote(changed, saved); await settle();
    assert.equal(e.calls.filter(r => r.table === 'suggestions' && r.op === 'insert' && r.payload.kind === (field === 'x' ? 'move-marker' : 'edit-marker')).length, 1);
  });
} finally {
  await job.close();
}
checks.finish();
