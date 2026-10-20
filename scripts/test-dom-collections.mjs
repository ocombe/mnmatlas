// The test pages give querySelectorAll, children and options back as plain arrays; browsers give NodeLists and
// collections, which have no find, map or filter. Site code must spread them first ([...list].find).
import {readdir, readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pattern = /(querySelectorAll\([^)]*\)|\.children|\.options|\.selectedOptions|\.childNodes|getElementsBy\w+\([^)]*\))\.(find|findIndex|findLast|map|filter|some|every|flatMap|reduce|at|includes|indexOf|slice|sort|toSorted)\(/g;
const files = (await readdir(root)).filter(name => name.endsWith('.js'));
const hits = [];
for (const name of files) {
  const text = await readFile(new URL(name, root), 'utf8');
  for (const m of text.matchAll(pattern)) hits.push(`${name}: ${text.slice(Math.max(0, m.index - 40), m.index + m[0].length)}`);
}
if (hits.length) {
  for (const hit of hits) console.log('FAIL R2-11 DOM collection used as an array: ' + hit);
  process.exitCode = 1;
} else console.log(`PASS R2-11 no DOM collection is used as an array (${files.length} site scripts)`);
