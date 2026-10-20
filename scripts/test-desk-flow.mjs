import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {browser, Node, plain, suite, suggestion, settle,
  openDesk, selectRow, cardAction} from './regression-harness.mjs';
import {publisher} from './publisher-harness.mjs';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const checks = suite();
const job = await publisher();
const marker = {id: 'published', name: 'Bank', category: 'Bank', note: 'Original description',
  x: 10, y: 20, level: 'lower'};

async function desk(rows, live = marker) {
  const e = await browser(true);
  e.context.originals = [plain(live)];
  e.suggestions.push(...rows);
  await openDesk(e);
  return e;
}

const pending = (id, payload, extra = {}) => suggestion(id, 'edit-marker', payload,
  {status: 'pending', ...extra});
const siblings = () => [pending(1, {name: 'Bay Bank', from: marker}),
  pending(2, {name: marker.name, note: 'Second author text', from: marker}, {user_id: 'second'})];

try {
  await checks.test('B7', 'first card shows only its own change', async () => {
    const e = await desk(siblings());
    await selectRow(e, 1);
    assert.equal(e.context.$('review-note').value, marker.note,
      'The later pending description must not appear on the first card');
  });

  await checks.test('B7', 'editing first card description does not import second author text', async () => {
    const rows = siblings();
    const e = await desk(rows);
    await selectRow(e, 1);
    e.context.$('review-note').value += ' reviewed';
    await cardAction(e, 'Save edits');
    assert.equal(rows[0].payload.note, marker.note + ' reviewed',
      'Editing this card starts from its own description');
    assert.equal(rows[1].payload.note, 'Second author text');
  });

  await checks.test('B8', 'Change removes an own pending rename and description when reverted', async () => {
    const e = await browser();
    const c = e.context;
    c.originals = [plain(marker)];
    const row = pending(1, {name: 'Bay Bank', note: 'New text', from: marker}, {user_id: 'member'});
    e.suggestions.push(row);
    await c.window.testCommunity.editDialog(c.originals[0], 'edit-marker');
    c.$('edit-name').value = marker.name;
    c.$('edit-note').value = marker.note;
    const send = c.$('community-dialog').querySelectorAll('button')
      .find(b => b.textContent === 'Send for review');
    assert(send, 'The real Change form is open');
    await send.onclick();
    await settle();
    const saved = e.suggestions.find(r => r.id === row.id);
    assert(!saved || saved.status === 'withdrawn' ||
      (saved.payload.name === marker.name &&
        (!Object.hasOwn(saved.payload, 'note') || saved.payload.note === marker.note)),
    'A reverted pending change must no longer contain the old proposal');
  });

  await checks.test('B10', 'stale desk approval reloads published files and rebases before the job', async () => {
    const e = await desk([pending(2, {name: 'Harbor Bank', from: marker})]);
    const c = e.context;
    let served = [plain(marker)];
    c.config.markersFile = 'data/markers.json';
    c.config.labelsFile = 'data/labels.json';
    Object.assign(c.registry.maps[0], c.config);
    c.fetchData = async file => file.endsWith('labels.json') ? {labels: [], trainers: []} :
      plain(served);
    await job.reset({markers: [marker], rows: [suggestion(1, 'edit-marker',
      {name: 'Bay Bank', from: marker})]});
    assert.equal((await job.run()).code, 0);
    assert.equal((await job.run(true)).code, 0);
    served = await job.json('data/markers.json');
    assert.equal(served[0].name, 'Bay Bank', 'A real job publishes while the desk stays open');
    e.suggestions.push({...plain(job.state.rows[0]), updated_at: new Date().toISOString()});
    e.emit('atlas:published');
    await settle();
    await cardAction(e, 'Approve');
    const row = e.suggestions[0];
    assert.equal(row.status, 'approved');
    await job.reset({markers: served, rows: [row]});
    const result = await job.run();
    const held = await job.json('.publish/held.json');
    assert.equal(row.payload.from.name, 'Bay Bank', 'Approval must use the newly published baseline');
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(held, [], 'The rebased row must apply without another review loop');
    assert.equal((await job.json('data/markers.json'))[0].name, 'Harbor Bank');
  });

  const held = () => pending(1, {name: 'Bay Bank', from: marker},
    {review_note: 'Not published: conflicts with #812'});
  await checks.test('B17', 'job hold note is context and the author note input starts empty', async () => {
    const e = await desk([held()]);
    assert.equal(e.context.$('review-card').querySelector('.desk-note').value, '',
      'Internal job notes must not pre-fill a message to the author');
  });
  await checks.test('B17', 'rejecting a held row does not resend the job note as a reason', async () => {
    const row = held();
    const e = await desk([row]);
    await cardAction(e, 'Reject');
    assert.equal(row.status, 'rejected');
    assert.equal(row.review_note, null, 'The internal hold reason must not become a rejection message');
  });

  await checks.test('B18', 'Undo after Approve with edits restores the original payload', async () => {
    const row = pending(1, {name: 'Bay Bank', from: marker});
    const before = plain(row.payload);
    const e = await desk([row]);
    e.context.$('review-name').value = 'Reviewer version';
    await cardAction(e, 'Approve');
    assert.equal(row.payload.name, 'Reviewer version', 'Approve saved the reviewer edit');
    const undo = e.context.$('status').querySelectorAll('button').find(b => b.textContent === 'Undo');
    assert(undo, 'The review toast offers Undo');
    await undo.onclick();
    await settle();
    assert.equal(row.status, 'pending');
    assert.deepEqual(row.payload, before, 'Undo must restore the traveller original payload');
  });

  await checks.test('B20', 'bulk approval reports a network failure separately from a stale row', async () => {
    const rows = [pending(1, {name: 'Bay Bank', from: marker}),
      suggestion(2, 'new-marker', {name: 'A place', category: 'Quest NPC', x: 60, y: 70},
        {status: 'pending'})];
    const e = await desk(rows);
    for (const item of e.context.$('desk-list').querySelectorAll('.desk-item')) {
      const input = item.querySelector('input');
      assert(input?.onchange, 'Each queue row has a selection checkbox');
      input.checked = true;
      input.onchange();
    }
    let failures = 0;
    e.suggestionFault = request => {
      if (request.op === 'update' && request.filters.id === 2) {
        failures++;
        return {error: Error('network unavailable')};
      }
    };
    e.statuses.length = 0;
    await e.context.$('desk-bulk').querySelectorAll('button')
      .find(b => b.textContent === 'Approve').onclick();
    await settle();
    assert.equal(failures, 1, 'One row encounters a real simulated write error');
    assert.deepEqual(rows.map(r => r.status), ['approved', 'pending']);
    const message = e.statuses.at(-1);
    assert(/fail|could not|network/i.test(message) && !/changed since/i.test(message),
      'The summary must identify a failed request rather than a changed row');
  });

  async function noteForm(value) {
    const e = await browser();
    const c = e.context;
    const host = new Node('div');
    e.body.append(host);
    const form = c.window.atlasFields.build(host, {personal: true, value,
      ids: {name: 'name', category: 'category', note: 'note', wiki: 'wiki',
        vendor: 'vendor-kind', classes: 'trainer-class', trade: 'trade'}});
    c.noteFields = form;
    for (const control of Object.values(form.controls)) {
      if (control.id) e.elements.set(control.id, control);
    }
    form.boxes.wiki.id = 'wiki-field';
    e.elements.set('wiki-field', form.boxes.wiki);
    c.window.testCommunity.attachNoteFinder();
    return {e, c, form};
  }

  async function pickNpc(role, type) {
    const f = await noteForm({name: '', note: '', category: type});
    const npc = {id: 'npc-captain', name: 'Captain', type: 'npc', role, level: '8-10',
      url: 'https://monstersandmemories.wiki/npcs/captain'};
    f.c.fetch = async () => ({ok: true, json: async () => ({results: [npc]})});
    f.form.controls.name.value = 'captain';
    f.form.controls.name.fire('input');
    await f.e.tick(600);
    const result = f.form.root.querySelector('.wiki-result');
    assert(result, 'The real wiki picker returns the fixture NPC');
    result.onclick();
    return {...f, npc};
  }

  await checks.test('B12', 'wiki named NPC pick puts the level in Level and keeps a plain Name', async () => {
    const {form, npc} = await pickNpc('named', 'Named mob');
    const read = plain(form.read());
    assert.deepEqual(read.levels, [8, 8]);
    assert.equal(read.name, npc.name, 'Levels belong in Level rather than Name');
  });
  await checks.test('B12', 'wiki mob role pick fills Mobs and the Level range', async () => {
    const {form, npc} = await pickNpc('mob', 'Personal');
    const read = plain(form.read());
    assert.equal(read.category, 'Mob camp');
    assert.deepEqual(read.mobs, [{name: npc.name, wikiId: npc.id, wiki: npc.url}],
      'A mob name pick must enter the camp roster');
    assert.deepEqual(read.levels, [8, 10]);
    assert.equal(read.name, npc.name);
  });

  await checks.test('B20', 'Passage to Notable NPC clears direction, How and One way', async () => {
    const e = await browser();
    const c = e.context;
    const value = {...marker, category: 'Passage', way: 'Tunnel', oneWay: true, direction: 'east'};
    const form = c.window.atlasFields.build(new Node('div'), {value});
    form.controls.category.value = 'Notable NPC';
    form.controls.category.fire('change');
    const payload = c.window.atlasFields.delta(form.read(),
      c.window.atlasChanges.nextFrom({effective: value}, 'edit-marker'));
    await job.reset({markers: [value], rows: [suggestion(100, 'edit-marker', payload)]});
    assert.equal((await job.run()).code, 0);
    assert.deepEqual(await job.json('.publish/held.json'), []);
    const actual = (await job.json('data/markers.json'))[0];
    for (const key of ['direction', 'way', 'oneWay']) {
      assert(!Object.hasOwn(actual, key), `Changing to a plain NPC must remove ${key}`);
    }
  });

  await checks.test('B20', 'new zone exit to place name drops all travel fields', async () => {
    const row = suggestion(100, 'new-marker', {name: 'Gate', category: 'Personal',
      x: 30, y: 40, noteType: 'exit', arrow: 'north', travel: 'Exit', toMap: 'other-map',
      toPlace: 'gate'}, {status: 'pending'});
    const e = await desk([row]);
    e.context.registry.maps.push({id: 'other-map', title: 'Other map'});
    e.context.$('review-kind').value = 'building';
    e.context.$('review-kind').fire('change');
    await cardAction(e, 'Approve');
    assert.equal(row.payload.noteType, 'label');
    await job.reset({rows: [row]});
    assert.equal((await job.run()).code, 0);
    assert.deepEqual(await job.json('.publish/held.json'), []);
    const actual = (await job.json('data/labels.json')).labels[0];
    for (const key of ['arrow', 'direction', 'travel', 'toMap', 'toPlace', 'toLevel',
      'toMarker', 'switchOnClick']) {
      assert(!Object.hasOwn(actual, key), `A place name must omit ${key}`);
    }
  });

  const classes = ['Elementalist', 'Wizard', 'Enchanter'];
  for (const action of ['shows', 'keeps']) {
    await checks.test('B20', `multi-class trainer form ${action} every class`, async () => {
      const e = await browser();
      const value = {...marker, category: 'Class trainer', classes};
      const form = e.context.window.atlasFields.build(new Node('div'), {value});
      if (action === 'keeps') {
        form.controls.note.value = 'At the door';
        assert.deepEqual(plain(form.read().classes), classes);
      } else {
        const visibleText = node => node.tagName === 'select' ? node.value :
          String(node.textContent || '') + node.children.map(visibleText).join(' ');
        const shown = visibleText(form.boxes.classes);
        for (const name of classes) assert(shown.includes(name), `${name} must be visible as selected`);
      }
    });
  }

  await checks.test('B20', 'bounty claim omits vendor Kind guessed into the hidden control', async () => {
    const m = {id: 'personal-bounty', name: 'A bag merchant', category: 'Vendor', note: '',
      wiki: 'https://monstersandmemories.wiki/npcs/bag-merchant',
      wikiId: 'npc-bag-merchant', x: 30, y: 40, level: 'lower'};
    const {e, c, form} = await noteForm(m);
    e.recordInserts = true;
    const main = new Node('form');
    main.append(new Node('div', '', 'form-head'));
    e.elements.set('marker-form', main);
    e.elements.set('editor-title', new Node('h2'));
    const share = new Node('label');
    share.append(c.$('suggest-check'));
    e.saved.set('mnmaps-bounty-notes', JSON.stringify({[m.id]: {
      bounty: m.wikiId, map: 'test-map', priority: true
    }}));
    c.window.testCommunity.setBountyForm(m);
    assert(main.classList.contains('bounty-mode'), 'The real bounty form hides its fixed fields');
    vm.runInContext(app.slice(app.indexOf('function guessVendor('),
      app.indexOf('function guessTrade(')), c);
    c.guessVendor();
    const values = form.read();
    assert.equal(values.vendor, 'Bag merchant', 'The production guess reaches the hidden Kind');
    const result = await c.window.testCommunity.claimBounty({...m, ...values}, false);
    assert.equal(result, 'claimed');
    const sent = e.calls.filter(r => r.table === 'suggestions' && r.op === 'insert').at(-1);
    assert(sent, 'The bounty claim was sent');
    assert(!Object.hasOwn(sent.payload.payload, 'vendor'), 'A hidden guessed Kind must not be claimed');
  });
} finally {
  await job.close();
}
checks.finish();
