// Writes the atlas page for each map (<map-id>/index.html) from index.html, with that map's title and link preview card,
// and 404.html, which sends mistyped map addresses to the right map. Run again after changing index.html or adding a map.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),site='https://www.mnmatlas.com/';
const html=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// Bump a map's card version after redrawing its card so link previews refresh.
const cardVersions={'sungreet-strand':2,'night-harbor':2};
const registry=JSON.parse(await readFile(resolve(root,'data/maps.json'),'utf8'));
const template=await readFile(resolve(root,'index.html'),'utf8');
const swap=(page,pattern,replacement)=>{
 const found=page.match(new RegExp(pattern.source,'g'))||[];
 if(found.length!==1)throw new Error('index.html should contain exactly one '+pattern+' (found '+found.length+')');
 return page.replace(pattern,()=>replacement);
};
const meta=(attr,name)=>new RegExp(`<meta ${attr}="${name.replace(/[.:]/g,'\\$&')}" content="[^"]*">`);
for(const m of registry.maps){
 if(!/^[a-z0-9-]{1,80}$/.test(m.id))throw new Error('Unexpected map id '+m.id);
 const card='assets/cards/'+m.id+'.jpg';
 try{await access(resolve(root,card));}catch{throw new Error('Missing '+card+'; run make_cards.py first.');}
 const title=html(m.title+' · MnM Atlas'),description=html(m.description),image=site+card+'?v='+(cardVersions[m.id]||1),address=site+m.id+'/';
 let page=template;
 for(const [pattern,replacement] of [
  [/<base href="\.\/">/,'<base href="../">'],
  [/<title>[^<]*<\/title>/,`<title>${title}</title><link rel="canonical" href="${address}">`],
  [meta('name','description'),`<meta name="description" content="${description}">`],
  [meta('property','og:title'),`<meta property="og:title" content="${title}">`],
  [meta('property','og:description'),`<meta property="og:description" content="${description}">`],
  [meta('property','og:url'),`<meta property="og:url" content="${address}">`],
  [meta('property','og:image'),`<meta property="og:image" content="${image}">`],
  [meta('property','og:image:alt'),`<meta property="og:image:alt" content="${html(m.title)}, an illustrated map from Monsters &amp; Memories, in MnM Atlas.">`],
  [meta('name','twitter:title'),`<meta name="twitter:title" content="${title}">`],
  [meta('name','twitter:description'),`<meta name="twitter:description" content="${description}">`],
  [meta('name','twitter:image'),`<meta name="twitter:image" content="${image}">`],
 ])page=swap(page,pattern,replacement);
 page=page.replace('<!doctype html>\n','<!doctype html>\n<!-- Generated from index.html by scripts/make-share-pages.mjs; edit index.html and run it again. -->\n');
 await mkdir(resolve(root,m.id),{recursive:true});await writeFile(resolve(root,m.id,'index.html'),page,'utf8');console.log('Wrote '+m.id+'/index.html');
}
// GitHub Pages serves 404.html for any unknown address; a map name in another case or spelling opens that map.
const ids=registry.maps.map(m=>m.id),links=registry.maps.map(m=>`<li><a href="/${m.id}/">${html(m.title)}</a></li>`).join('');
await writeFile(resolve(root,'404.html'),`<!doctype html>
<html lang="en">
<head>
 <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#16120e"><meta name="robots" content="noindex">
 <title>Page not found · MnM Atlas</title><link rel="icon" href="/favicon.ico" sizes="48x48">
 <script>(()=>{const maps=${JSON.stringify(ids)};let first='';try{first=decodeURIComponent(location.pathname.split('/')[1]||'').trim().toLowerCase().replace(/[\\s_']+/g,'-');}catch{}if(maps.includes(first))location.replace('/'+first+'/'+location.search+location.hash);})();</script>
</head>
<body style="background:#16120e;color:#e8dcc4;font:16px/1.5 system-ui,sans-serif;padding:24px;max-width:36em"><h1 style="font-size:1.4em">This page is not on the map</h1><p><a style="color:#d0852f" href="/">Open MnM Atlas</a> or choose a map:</p><ul>${links.replace(/<a /g,'<a style="color:#d0852f" ')}</ul></body>
</html>
`,'utf8');console.log('Wrote 404.html');
