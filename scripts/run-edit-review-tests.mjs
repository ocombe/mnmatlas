import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {availableParallelism} from 'node:os';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = fileURLToPath(new URL('./', import.meta.url));
const files = (await readdir(directory)).filter(name => /^test-.*\.mjs$/.test(name)).sort();
const failures = new Set();
const results = [];

// The test files share nothing (each uses its own temporary folder and a free port), so several run at once.
// Each file's output is kept and printed in one piece, in file order, as soon as the files before it are done.
const run = file => new Promise(done => {
  const child = spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
    cwd: root, env: process.env
  });
  let output = '';
  child.stdout.on('data', data => {output += data;});
  child.stderr.on('data', data => {output += data;});
  child.on('error', error => done({code: 1, output: output + error.message}));
  child.on('exit', code => done({code, output}));
});
let free = Math.max(1, Math.min(8, availableParallelism() - 1));
const waiting = [];
const limited = file => new Promise(start => waiting.push(start)).then(() => run(file)).finally(() => {free++; release();});
const release = () => {while (free > 0 && waiting.length) {free--; waiting.shift()();}};
const runs = files.map(limited);
release();

for (let i = 0; i < files.length; i++) {
  const file = files[i], result = await runs[i];
  console.log(`\nRUN ${file}`);
  process.stdout.write(result.output);
  results.push({file, code: result.code});
  for (const match of result.output.matchAll(/^FAIL (B\d+|R[23]-\d+) /gm)) failures.add(match[1]);
  console.log(`${result.code === 0 ? 'PASS' : 'FAIL'} FILE ${file} (exit ${result.code})`);
}

console.log('\nTest files: ' + results.map(r => `${r.file}=${r.code}`).join(', '));
console.log('Failing ids: ' + ([...failures].sort((a, b) =>
  a.localeCompare(b, undefined, {numeric: true})).join(', ') || 'none'));
if (results.some(r => r.code !== 0)) process.exitCode = 1;
