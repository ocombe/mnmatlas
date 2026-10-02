// Writes one small page per map (<map-id>/index.html) whose link preview shows that map's card.
// Visitors are forwarded to the atlas with the same view; run again after adding a map.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),site='https://www.mnmatlas.com/';
const html=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const registry=JSON.parse(await readFile(resolve(root,'data/maps.json'),'utf8'));
for(const m of registry.maps){
 if(!/^[a-z0-9-]{1,80}$/.test(m.id))throw new Error('Unexpected map id '+m.id);
 const card='assets/cards/'+m.id+'.jpg';
 try{await access(resolve(root,card));}catch{throw new Error('Missing '+card+'; run make_cards.py first.');}
 const title=html(m.title+' · MnM Atlas'),description=html(m.description),image=site+card+'?v=1',target='../?map='+m.id;
 const page=`<!doctype html>
<html lang="en">
<head>
 <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#16120e">
 <title>${title}</title><meta name="description" content="${description}">
 <meta property="og:site_name" content="MnM Atlas"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${site}${m.id}/"><meta property="og:type" content="website">
 <meta property="og:image" content="${image}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${html(m.title)}, an illustrated map from Monsters & Memories, in MnM Atlas.">
 <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${image}">
 <link rel="canonical" href="${site}?map=${m.id}"><link rel="icon" href="../favicon.ico" sizes="48x48">
 <script>(()=>{const to=new URL('../',location.href),q=new URLSearchParams(location.search);q.set('map','${m.id}');to.search=q.toString();to.hash=location.hash;location.replace(to.href);})();</script>
 <noscript><meta http-equiv="refresh" content="0; url=${target}"></noscript>
</head>
<body style="background:#16120e;color:#e8dcc4;font:16px system-ui,sans-serif;padding:24px"><p><a style="color:#d0852f" href="${target}">Open ${html(m.title)} in MnM Atlas</a></p></body>
</html>
`;
 await mkdir(resolve(root,m.id),{recursive:true});await writeFile(resolve(root,m.id,'index.html'),page,'utf8');console.log('Wrote '+m.id+'/index.html');
}
