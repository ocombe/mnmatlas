import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = fileURLToPath(new URL('./', import.meta.url));
const files = (await readdir(directory)).filter(name => /^test-.*\.mjs$/.test(name)).sort();
const failures = new Set();
const results = [];

for (const file of files) {
  console.log(`\nRUN ${file}`);
  const result = await new Promise(done => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
      cwd: root, env: process.env
    });
    let output = '';
    child.stdout.on('data', data => {output += data; process.stdout.write(data);});
    child.stderr.on('data', data => {output += data; process.stderr.write(data);});
    child.on('error', error => done({code: 1, output: error.message}));
    child.on('exit', code => done({code, output}));
  });
  results.push({file, code: result.code});
  for (const match of result.output.matchAll(/^FAIL (B\d+) /gm)) failures.add(match[1]);
  console.log(`${result.code === 0 ? 'PASS' : 'FAIL'} FILE ${file} (exit ${result.code})`);
}

console.log('\nTest files: ' + results.map(r => `${r.file}=${r.code}`).join(', '));
console.log('Failing ids: ' + ([...failures].sort((a, b) =>
  Number(a.slice(1)) - Number(b.slice(1))).join(', ') || 'none'));
if (results.some(r => r.code !== 0)) process.exitCode = 1;
