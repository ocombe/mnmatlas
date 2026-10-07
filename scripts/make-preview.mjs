// Builds preview-dist/: a private test copy of this branch, for the Cloudflare Pages preview (behind Cloudflare Access).
// Map tiles are redirected to the live site, except tile folders this branch changes, which are copied in.
// The copy is marked as a test: no visit counting, no search engine indexing, a "Test copy" badge, and the owner's own
// suggestions are not approved on sending, so they wait in Review like anyone else's.
import {readFile,writeFile,mkdir,rm,cp,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(root,'preview-dist'),live='https://www.mnmatlas.com/';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
// Tile folders this branch changes compared with main; when that cannot be told, every tile comes from the live site.
let changed=[];
try{try{git('fetch','--quiet','--depth=1','origin','main');}catch{}changed=git('diff','--name-only','FETCH_HEAD','HEAD','--','assets/tiles').split('\n').filter(Boolean);}
catch{try{changed=git('diff','--name-only','origin/main','HEAD','--','assets/tiles').split('\n').filter(Boolean);}catch{changed=[];}}
execFileSync(process.execPath,[resolve(root,'scripts/make-share-pages.mjs')],{cwd:root,stdio:'inherit'});
await rm(out,{recursive:true,force:true});await mkdir(out);
const skip=new Set(['.git','.github','scripts','supabase','preview-dist','node_modules','CNAME','README.md']);
for(const name of await readdir(root)){
 if(skip.has(name)||name.startsWith('.'))continue;
 if(name==='assets'){for(const part of await readdir(resolve(root,'assets')))if(part!=='tiles')await cp(resolve(root,'assets',part),join(out,'assets',part),{recursive:true});continue;}
 await cp(resolve(root,name),join(out,name),{recursive:true});
}
// Tiles the branch did not change are redirected to the live site (Cloudflare _redirects); changed tile folders are copied in.
const registry=JSON.parse(await readFile(resolve(root,'data/maps.json'),'utf8')),folders=new Set();
(function collect(row){for(const value of Object.values(row)){if(typeof value==='string'&&value.startsWith('assets/tiles/')&&value.includes('/{z}'))folders.add(value.slice(0,value.indexOf('/{z}')));else if(value&&typeof value==='object')collect(value);}})(registry);
const copied=[],rules=[];
for(const folder of [...folders].sort()){
 if(changed.some(f=>f.startsWith(folder+'/'))){await cp(resolve(root,folder),join(out,folder),{recursive:true});copied.push(folder);}
 else rules.push('/'+folder+'/* '+live+folder+'/:splat 302');
}
await writeFile(join(out,'_redirects'),rules.join('\n')+'\n');
await writeFile(join(out,'config.js'),(await readFile(resolve(root,'config.js'),'utf8')).trimEnd()+'\natlasConfig.preview=true;atlasConfig.goatcounter=\'\';\n');
// Every page: not indexed, and a small badge so a test copy is never mistaken for the live atlas.
const badge='<div style="position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:9999;pointer-events:none;font:600 11px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;background:#a04438;color:#fff;padding:5px 9px;border-radius:999px;opacity:.9">Test copy · not the live atlas</div>';
const pages=['index.html','404.html',...registry.maps.map(m=>m.id+'/index.html')];
for(const page of pages){const path=join(out,page);let html;try{html=await readFile(path,'utf8');}catch{continue;}
 html=html.replace('<head>','<head><meta name="robots" content="noindex,nofollow">').replace(/<body([^>]*)>/,(m)=>m+badge);await writeFile(path,html);}
await writeFile(join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');
await writeFile(join(out,'_headers'),'/*\n  X-Robots-Tag: noindex, nofollow\n');
console.log('Preview built in preview-dist/'+(copied.length?' with this branch\'s tiles for '+copied.join(', '):'; all tiles from the live site')+'.');
