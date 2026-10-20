import {mkdtemp, mkdir, copyFile, writeFile, readFile, rm} from 'node:fs/promises';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = resolve(root, 'scripts');
const clone = value => JSON.parse(JSON.stringify(value));

// Same REST shape as test-apply-approved; every request stays on this local listener.
export async function publisher() {
  const folder = await mkdtemp(resolve(scripts, '.review-test-'));
  const state = {rows: [], credits: [], requests: [], failPatch: null, nextId: 10000};
  const server = createServer(async (req, res) => {
    try {
      let text = '';
      for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : null;
      const url = new URL(req.url, 'http://fixture');
      const q = url.searchParams;
      state.requests.push({method: req.method, path: url.pathname, query: q, body});
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/rest/v1/admins') {
        res.end(JSON.stringify([{user_id: 'reviewer'}]));
        return;
      }
      if (url.pathname === '/rest/v1/credits') {
        if (req.method === 'POST') {
          for (const row of body) {
            if (!state.credits.some(c => c.suggestion_id === row.suggestion_id)) {
              state.credits.push(row);
            }
          }
          res.statusCode = 201;
          res.end();
        } else {
          const offset = Number(q.get('offset') || 0);
          res.end(JSON.stringify(state.credits.slice(offset, offset + 1000)));
        }
        return;
      }
      if (url.pathname !== '/rest/v1/suggestions') {
        res.statusCode = 404;
        res.end('{}');
        return;
      }
      if (req.method === 'POST') {
        const row = {...body, id: state.nextId++, updated_at: '2026-10-20T12:00:00Z'};
        state.rows.push(row);
        res.statusCode = 201;
        res.end(JSON.stringify([row]));
        return;
      }
      const matches = row => [...q].every(([key, value]) => {
        if (['select', 'order', 'limit', 'offset'].includes(key)) return true;
        if (value.startsWith('eq.')) {
          const actual = typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key]);
          return actual === value.slice(3);
        }
        if (value.startsWith('gt.')) return Number(row[key]) > Number(value.slice(3));
        if (value === 'is.null') return row[key] == null;
        return true;
      });
      const rows = state.rows.filter(matches).sort((a, b) => Number(a.id) - Number(b.id));
      if (req.method === 'PATCH') {
        if (state.failPatch?.(q, body)) {
          res.statusCode = 400;
          res.end('{}');
          return;
        }
        for (const row of rows) Object.assign(row, clone(body));
        res.end(JSON.stringify(rows.map(row => ({id: row.id}))));
      } else res.end(JSON.stringify(rows.slice(0, Number(q.get('limit') || 1000))));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({message: error.message}));
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await mkdir(resolve(folder, 'scripts'));
  await mkdir(resolve(folder, 'data'));
  for (const name of ['app.js', 'icons.js', 'wiki-links.js', 'changes.js',
    'scripts/apply-approved.mjs']) {
    await copyFile(resolve(root, name), resolve(folder, name));
  }
  const write = async (name, value) => {
    await mkdir(resolve(folder, name, '..'), {recursive: true});
    await writeFile(resolve(folder, name), JSON.stringify(value, null, 2) + '\n');
  };
  const json = async name => JSON.parse(await readFile(resolve(folder, name), 'utf8'));
  async function reset({markers = [], labels = [], trainers = [], rows = [], maps} = {}) {
    Object.assign(state, {rows: clone(rows), credits: [], requests: [], failPatch: null,
      nextId: 10000});
    const registry = maps || {maps: [{
      id: 'test-map', title: 'Test map', width: 200, height: 200,
      markersFile: 'data/markers.json', labelsFile: 'data/labels.json',
      levels: [{id: 'lower'}, {id: 'upper', labelsFile: 'data/upper-labels.json'}]
    }, {id: 'other-map', title: 'Other map', width: 200, height: 200,
      markersFile: 'data/other.json', labelsFile: 'data/other-labels.json'}]};
    await write('data/maps.json', registry);
    await write('data/markers.json', markers);
    await write('data/labels.json', {labels, trainers});
    await write('data/upper-labels.json', {labels: [], trainers: []});
    await write('data/other.json', []);
    await write('data/other-labels.json', {labels: [{id: 'gate', name: 'Gate',
      kind: 'building', x: 10, y: 20}], trainers: []});
    await write('data/publish-log.json', []);
    await write('data/contributors.json', {contributors: []});
    await write('data/credits.json', {});
  }
  async function run(mark = false) {
    return new Promise((done, reject) => {
      const args = [resolve(folder, 'scripts/apply-approved.mjs')];
      if (mark) args.push('--mark-published', '.publish/applied.json');
      const child = spawn(process.execPath, args, {cwd: folder, env: {
        ...process.env, SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
        SUPABASE_SERVICE_KEY: 'fixture-only'
      }});
      let output = '';
      child.stdout.on('data', data => output += data);
      child.stderr.on('data', data => output += data);
      child.on('error', reject);
      child.on('exit', code => done({code, output}));
    });
  }
  return {state, reset, run, write, json, folder, async close() {
    await new Promise(done => server.close(done));
    const target = resolve(folder);
    const local = relative(scripts, target);
    if (!local.startsWith('.review-test-') || local.includes(sep) || resolve(scripts) === target) {
      throw Error('Fixture cleanup escaped scripts');
    }
    await rm(target, {recursive: true, force: true});
  }};
}
