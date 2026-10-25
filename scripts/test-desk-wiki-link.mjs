import assert from 'node:assert/strict';
import {browser, plain, suite, suggestion, openDesk, settle} from './regression-harness.mjs';

// The review card's wiki link opens in a new tab, follows the field as it is edited, and offers the old page when it changed.
const checks = suite();
const oldPage = 'https://monstersandmemories.wiki/npcs/rell', newPage = 'https://monstersandmemories.wiki/npcs/rell-the-smith';
const live = {id: 'published', name: 'Rell', note: '', category: 'Notable NPC', level: 'lower', x: 10, y: 20, wiki: oldPage};
// The harness does not bubble events: hand the input to every ancestor, as a typed letter would.
const typed = input => { for (let n = input; n; n = n.parentElement) n.fire('input'); };
async function card(payload) {
  const e = await browser(true);
  e.context.originals = [plain(live)];
  e.suggestions.push(suggestion(100, 'edit-marker', payload, {status: 'pending'}));
  await openDesk(e);
  return {e, links: () => e.context.$('review-card').querySelectorAll('.desk-wiki-open')};
}
await checks.test('W1', 'wiki link opens in a new tab, old page offered when the link changed', async () => {
  const {links} = await card({wiki: newPage, from: {wiki: oldPage}});
  const [open, prior] = links();
  assert.equal(links().length, 2);
  assert.equal(open.href, newPage);
  assert.equal(open.target, '_blank');
  assert.equal(open.rel, 'noopener');
  assert.equal(prior.href, oldPage);
  assert.equal(prior.target, '_blank');
});
await checks.test('W2', 'unchanged link shows one link that follows the field', async () => {
  const {e, links} = await card({name: 'Rell the Smith', from: {name: 'Rell'}});
  assert.equal(links().length, 1);
  const [open] = links(), input = e.context.$('review-wiki');
  assert.equal(open.href, oldPage);
  input.value = newPage;
  typed(input);
  await settle();
  assert.equal(open.href, newPage);
  input.value = 'not a wiki';
  typed(input);
  await settle();
  assert.equal(open.hidden, true);
});
checks.finish();
