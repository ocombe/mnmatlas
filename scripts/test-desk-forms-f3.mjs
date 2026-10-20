import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {browser, Node, plain, suite, suggestion, settle, openDesk, cardAction} from './regression-harness.mjs';
import {publisher} from './publisher-harness.mjs';

const checks = suite(), job = await publisher();
const live = {id: 'published', name: 'Rell', note: 'By the door', category: 'Notable NPC',
  level: 'lower', x: 10, y: 20};
const area = {kind: 'area', form: 'rect', points: [[10, 10], [30, 10], [30, 30], [10, 30]]};
const row = (payload, extra = {}) => suggestion(100, 'edit-marker', payload, {status: 'pending', ...extra});
async function desk(r, published = live) {
  const e = await browser(true);
  e.context.originals = [plain(published)];
  e.suggestions.push(r);
  await openDesk(e);
  if (r.status !== 'pending') await e.context.window.testReviewDesk.open(r);
  return e;
}
async function bulk(e) {
  const tick = e.context.$('desk-list').querySelector('.desk-item').querySelector('input');
  tick.checked = true;
  tick.onchange();
  await e.context.$('desk-bulk').querySelectorAll('button').find(b => b.textContent === 'Approve').onclick();
  await settle();
}
try {
  for (const action of ['Approve', 'Save edits', 'bulk', 'popup']) {
    await checks.test('B10', `${action} refuses the shared schema's invalid field before writing`, async () => {
      const r = row({name: live.name, futureField: 'Never discard this', from: live});
      const e = await desk(r);
      if (action === 'bulk') await bulk(e);
      else if (action === 'popup') await e.context.window.testReviewDesk.decideRow(r, 'approved');
      else await cardAction(e, action);
      assert.equal(r.status, 'pending');
      assert(!e.calls.some(c => c.table === 'suggestions' && c.op === 'update'));
      assert(e.statuses.some(s => s.includes('unknown field futureField')), 'Explain the refusal');
    });
  }
  for (const kind of ['edit-label', 'move-label']) for (const action of ['Approve', 'bulk', 'popup']) {
    await checks.test('B10', `${action} strips a stale shape from ${kind}`, async () => {
      const label = {...live, kind: 'building'};
      delete label.category;
      const r = suggestion(100, kind, kind === 'edit-label' ?
        {name: 'New place', shape: area, from: label} :
        {name: label.name, shape: area, fromShape: area, from: [10, 20], to: [50, 60]},
      {status: 'pending'});
      const e = await browser(true);
      e.context.labelData.labels = [label];
      e.context.publishedLabelPositions.set(label.id, [label.x, label.y]);
      e.suggestions.push(r);
      await openDesk(e);
      if (action === 'bulk') await bulk(e);
      else if (action === 'popup') await e.context.window.testReviewDesk.decideRow(r, 'approved');
      else await cardAction(e, action);
      assert.equal(r.status, 'approved', e.statuses.at(-1));
      assert(!Object.hasOwn(r.payload, 'shape'));
      assert(!Object.hasOwn(r.payload, 'fromShape'));
      await job.reset({labels: [label], rows: [r]});
      assert.equal((await job.run()).code, 0);
      assert.deepEqual(await job.json('.publish/held.json'), []);
    });
  }
  await checks.test('B10', 'published file failure leaves edits intact and prevents approval', async () => {
    const r = row({name: 'New name', from: live}), e = await desk(r);
    Object.assign(e.context.registry.maps[0], {markersFile: 'data/markers.json'});
    e.context.fetchData = async () => {throw Error('Published map unavailable');};
    e.context.$('review-name').value = 'Keep my typing';
    await cardAction(e, 'Approve');
    assert.equal(r.status, 'pending');
    assert.equal(e.context.$('review-name').value, 'Keep my typing');
    assert(e.statuses.at(-1).includes('Published map unavailable'));
  });
  for (const [name, payload, message] of [
    ['missing floor arrival', {toLevel: 'upper', toMarker: 'missing'}, 'Arrival marker missing'],
    ['display setting without an admin author', {minZoom: 2}, 'Only a cartographer'],
    ['unknown public type', {category: 'Unknown NPC'}, 'Unsupported category']
  ]) {
    await checks.test('B10', `${name} is refused before approval`, async () => {
      const r = row({name: live.name, from: live, ...payload}, {user_id: null}), e = await desk(r);
      e.context.allCategories = e.context.categories;
      await cardAction(e, 'Approve');
      assert.equal(r.status, 'pending');
      assert(e.statuses.at(-1).includes(message), e.statuses.at(-1));
    });
  }
  await checks.test('B8', 'partial own-pending revert keeps only the remaining field change', async () => {
    const e = await browser(), c = e.context;
    c.originals = [plain(live)];
    const r = row({name: 'New name', note: 'New description', from: live}, {user_id: 'member'});
    e.suggestions.push(r);
    await c.window.testCommunity.editDialog(c.originals[0], 'edit-marker');
    c.$('edit-name').value = live.name;
    await c.$('community-dialog').querySelectorAll('button').find(b => b.textContent === 'Send for review').onclick();
    await settle();
    assert.equal(r.payload.name, live.name);
    assert.equal(r.payload.note, 'New description');
    assert.deepEqual([...c.window.atlasChanges.fieldsOf(r)], ['note']);
  });
  for (const form of ['editDialog', 'changeOwn']) {
    await checks.test('B8', `${form} withdraws a reverted pending quest tick`, async () => {
      const e = await browser(), c = e.context;
      c.originals = [plain(live)];
      const r = row({name: live.name, quests: true, from: live}, {user_id: 'member'});
      e.suggestions.push(r);
      if (form === 'editDialog') await c.window.testCommunity.editDialog(c.originals[0], 'edit-marker');
      else await c.window.testCommunity.changeOwn(r);
      c.$(form === 'editDialog' ? 'edit-quests' : 'own-quests').checked = false;
      const label = form === 'editDialog' ? 'Send for review' : 'Save suggestion';
      await c.$('community-dialog').querySelectorAll('button').find(b => b.textContent === label).onclick();
      await settle();
      assert(!e.suggestions.some(s => s.id === r.id));
      assert(e.statuses.at(-1).includes('withdrawn'));
    });
  }
  for (const context of ['Not published: invalid fields', 'Approved on sending (admin)',
    'Correction made after publishing (#12)']) {
    await checks.test('B17', `${context} is context rather than an author note`, async () => {
      const r = row({name: 'New name', from: live}, {review_note: context}), e = await desk(r);
      assert.equal(e.context.$('review-card').querySelector('.desk-note').value, '');
      assert.equal(e.context.$('review-card').querySelector('.desk-review-context').textContent, context);
      await cardAction(e, 'Reject');
      assert.equal(r.review_note, null);
    });
  }
  await checks.test('B18', 'Undo after rebased Save restores payload, status and previous review context', async () => {
    const r = row({name: 'New name', from: {...live, name: 'Old name'}},
      {status: 'approved', review_note: 'Earlier note', reviewed_at: '2026-10-19T12:00:00Z', comment: 'Why'});
    const before = plain(r), e = await desk(r);
    e.context.$('review-note').value = 'An edited description';
    await cardAction(e, 'Save edits');
    assert.equal(r.payload.from.name, live.name);
    await e.context.$('status').querySelectorAll('button').find(b => b.textContent === 'Undo').onclick();
    for (const k of ['payload', 'status', 'review_note', 'reviewed_at', 'comment', 'credit']) {
      assert.deepEqual(r[k], before[k], k);
    }
  });
  for (const accept of [false, true]) {
    await checks.test('B20', `background status change asks before losing a dirty card (${accept})`, async () => {
      const r = row({name: 'New name', from: live}), e = await desk(r), c = e.context;
      c.$('review-note').value = 'Unsaved description';
      let asks = 0;
      c.window.confirm = message => {assert(message.includes('Leave without saving')); asks++; return accept;};
      r.status = 'approved';
      await c.window.testReviewDesk.refresh();
      assert(asks >= 1);
      if (accept) assert(!c.$('review-card'));
      else assert.equal(c.$('review-note').value, 'Unsaved description');
    });
  }
  await checks.test('B20', 'review area remains visible with its category and all pins hidden', async () => {
    const r = suggestion(100, 'new-marker', {...live, id: undefined, shape: area, x: 20, y: 20},
      {status: 'pending'});
    delete r.payload.id;
    const e = await browser(true), seen = [];
    e.context.enabled.clear();
    e.context.showPins = false;
    e.context.window.atlasShapeUI = {render: (value, _layer, options) => seen.push({value, options})};
    e.suggestions.push(r);
    await openDesk(e);
    assert(seen.some(s => s.options.solid && s.value.shape), 'The desk draws its own area');
  });
  await checks.test('B20', 'Shady merchant hides Sells on fill and on Kind changes', async () => {
    const e = await browser(), f = e.context.window.atlasFields.build(new Node('div'),
      {value: {...live, category: 'Vendor', vendor: 'Shady merchant', sells: ['Materials']}});
    assert(f.boxes.sells.hidden);
    f.controls.vendor.value = 'Baker'; f.controls.vendor.fire('change');
    assert(!f.boxes.sells.hidden);
    f.controls.vendor.value = 'Shady merchant'; f.controls.vendor.fire('change');
    assert(f.boxes.sells.hidden);
    for (const [id, key] of [['name', 'name'], ['note', 'note'], ['category', 'category'], ['vendor-kind', 'vendor']]) e.elements.set(id, f.controls[key]);
    e.context.noteFields = f;
    const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
    vm.runInContext(app.slice(app.indexOf('function guessVendor('), app.indexOf('function guessTrade(')), e.context);
    f.controls.vendor.value = '';
    f.controls.name.value = 'A shady merchant';
    f.fit();
    e.context.guessVendor();
    assert.equal(f.controls.vendor.value, 'Shady merchant');
    assert(f.boxes.sells.hidden, 'A name-based Kind guess also hides Sells immediately');
  });
  await checks.test('B20', 'multi-class trainer can remove and add individual classes', async () => {
    const e = await browser(), f = e.context.window.atlasFields.build(new Node('div'),
      {value: {...live, category: 'Class trainer', classes: ['Wizard', 'Enchanter']}});
    assert.equal(f.controls.classes.value, 'multiple');
    f.boxes.classes.querySelector('.mob-chip').onclick();
    assert.deepEqual(plain(f.read().classes), ['Enchanter']);
    const add = f.boxes.classes.querySelectorAll('select').find(s => s !== f.controls.classes);
    add.value = 'Cleric'; add.fire('change');
    assert.deepEqual(plain(f.read().classes), ['Enchanter', 'Cleric']);
  });
  await checks.test('B12', 'typed mob names round trip, and duplicates show a message', async () => {
    const e = await browser(), f = e.context.window.atlasFields.build(new Node('div'),
      {value: {...live, category: 'Mob camp'}}), input = f.controls.mobs.search;
    for (let i = 0; i < 2; i++) {
      input.value = 'Fish';
      for (const fn of input.listeners.keydown) fn({key: 'Enter', preventDefault(){}});
    }
    assert.deepEqual(plain(f.read().mobs), [{name: 'Fish'}]);
    assert(e.statuses.some(s => s.includes('different mobs')));
  });
  for (const category of ['Tradeskill', 'Class trainer', 'Vendor', 'Named mob', 'Notable NPC']) {
    await checks.test('B23', `${category} has a checkbox before Gives quests in the shared forms`, async () => {
      const e = await browser(), f = e.context.window.atlasFields.build(new Node('div'),
        {value: {...live, category, quests: true}});
      assert(!f.boxes.quests.hidden);
      assert.equal(f.boxes.quests.firstChild, f.controls.quests);
      assert.equal(f.controls.quests.type, 'checkbox');
      assert.equal(f.read().quests, true);
    });
  }
  for (const category of ['Quest NPC', 'Trap', 'Fishing spot']) {
    await checks.test('B23', `switching to ${category} clears Gives quests in preview and publication`, async () => {
      const e = await browser(), c = e.context, value = {...live, quests: true};
      const f = c.window.atlasFields.build(new Node('div'), {value});
      f.controls.category.value = category; f.controls.category.fire('change');
      assert(f.boxes.quests.hidden);
      const p = c.window.atlasFields.delta(f.read(), c.window.atlasChanges.nextFrom({effective: value}, 'edit-marker'));
      const r = row(p, {status: 'approved'});
      const preview = plain(c.window.atlasChanges.applyTo(value, r));
      assert(!Object.hasOwn(preview, 'quests'));
      await job.reset({markers: [value], rows: [r]});
      assert.equal((await job.run()).code, 0);
      assert.deepEqual(await job.json('.publish/held.json'), []);
      assert.deepEqual((await job.json('data/markers.json'))[0], preview);
    });
  }
  await checks.test('B23', 'review card approves the checkbox and Undo restores the original quest wish', async () => {
    const r = row({name: live.name, quests: true, from: live}), e = await desk(r);
    assert.equal(e.context.$('review-quests').checked, true);
    e.context.$('review-quests').checked = false;
    await cardAction(e, 'Approve');
    assert.equal(r.payload.quests, false);
    await e.context.$('status').querySelectorAll('button').find(b => b.textContent === 'Undo').onclick();
    assert.equal(r.payload.quests, true);
  });
  await checks.test('B23', 'Gives quests rejects strings and values on Quest NPCs', async () => {
    const e = await browser(), schema = e.context.atlasMarkerSchema;
    for (const p of [{category: 'Vendor', quests: 'true'}, {category: 'Quest NPC', quests: true}]) {
      assert.throws(() => schema.validate(p), /quests/);
    }
  });
  await checks.test('B23', 'Change sends the quest tick as its own field', async () => {
    const e = await browser(), c = e.context;
    c.originals = [plain(live)];
    e.recordInserts = true;
    await c.window.testCommunity.editDialog(c.originals[0], 'edit-marker');
    c.$('edit-quests').checked = true;
    await c.$('community-dialog').querySelectorAll('button').find(b => b.textContent === 'Send for review').onclick();
    await settle();
    const sent = e.calls.filter(r => r.table === 'suggestions' && r.op === 'insert').at(-1);
    assert.equal(sent.payload.payload.quests, true);
    assert.deepEqual([...c.window.atlasChanges.fieldsOf(sent.payload)], ['quests']);
  });
} finally {
  await job.close();
}
checks.finish();
