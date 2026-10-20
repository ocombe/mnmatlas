import assert from 'node:assert/strict';
import {environment, Node, settle} from './community-harness.mjs';

export {Node, settle};
export const plain = value => JSON.parse(JSON.stringify(value));

export function suite() {
  const results = [];
  return {
    async test(id, name, run) {
      try {
        await run();
        results.push({id, name, pass: true});
        console.log(`PASS ${id} ${name}`);
      } catch (error) {
        const why = error.message.split('\n')[0];
        results.push({id, name, pass: false, why});
        console.log(`FAIL ${id} ${name}: ${why}`);
        if (process.env.ATLAS_TEST_STACKS) console.error(error.stack);
      }
    },
    finish() {
      const failures = results.filter(r => !r.pass);
      console.log(`${results.length} cases: ${results.length - failures.length} PASS, ` +
        `${failures.length} FAIL`);
      console.log('Failing ids: ' + ([...new Set(failures.map(r => r.id))].join(', ') || 'none'));
      if (failures.length) process.exitCode = 1;
      return results;
    }
  };
}

export async function browser(admin = false, fixtures = {}) {
  const e = environment({supabaseUrl: 'http://fixture', supabaseKey: 'test'},
    'atlas.example', {access_token: 'fixture-token', user: {id: 'member', admin}},
    {expose: true, ...fixtures});
  await settle();
  const c = e.context;
  c.categoryChoices = () => [
    'Personal', 'Mob camp', 'Named mob', 'Ambush', 'Fishing spot', 'Passage',
    'Trap', 'Secret', 'Quest NPC', 'Notable NPC', 'Vendor', 'Class trainer',
    'Tradeskill', 'Level connection', 'Bank', 'Ore', 'Wood', 'Herbs', 'Camping spot'
  ];
  for (const type of c.categoryChoices()) c.categories[type] = ['P', '#385f60'];
  c.enabled = new Set(c.categoryChoices());
  c.originals = [{id: 'published', name: 'Bank', note: '', category: 'Bank',
    x: 10, y: 20, level: 'lower'}];
  c.publishedPositions = new Map([['published', [10, 20]]]);
  return e;
}

export async function openDesk(e) {
  const button = [...e.bar.querySelectorAll('button')].find(n => n.textContent.startsWith('Review'));
  assert(button, 'Review button exists');
  await button.onclick();
  await settle();
  return e.context.$('review-desk');
}

export async function selectRow(e, id) {
  const row = e.context.$('desk-list').querySelectorAll('.desk-item')
    .find(n => n.dataset.row === String(id));
  assert(row, `Queue includes #${id}`);
  await row.querySelector('.desk-row-open').onclick();
  await settle();
}

export async function cardAction(e, label) {
  const button = e.context.$('review-card').querySelector('.desk-card-body')
    .querySelectorAll('button').find(n => n.textContent === label);
  assert(button, `Card action ${label} exists`);
  await button.onclick();
  await settle();
}

export const suggestion = (id, kind, payload, extra = {}) => ({
  id, kind, payload: plain(payload), target_id: kind === 'new-marker' ? null : 'published',
  map: 'test-map', level: 'lower', status: 'approved', reviewed_at: null,
  updated_at: '2026-10-20T10:00:00Z', created_at: '2026-10-20T09:00:00Z',
  user_id: 'traveller', author_name: 'Traveller', credit: false, ...extra
});
