import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),fixture=await mkdtemp(resolve(root,'scripts/.publish-test-'));
let approved=[],patches=[],creditRows=[];
const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;
 if(req.url.startsWith('/rest/v1/credits')){if(req.method==='POST'){for(const c of JSON.parse(body))if(!creditRows.some(r=>r.suggestion_id===c.suggestion_id))creditRows.push(c);res.statusCode=201;res.end();}else res.end(JSON.stringify(creditRows));return;}
 if(req.method==='PATCH'){patches.push(JSON.parse(body));res.end('[]');}else res.end(JSON.stringify(approved));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
async function run(dry=false){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fixture+'/scripts/apply-approved.mjs',...(dry?['--dry-run']:[])],{env:{...process.env,SUPABASE_URL:'http://127.0.0.1:'+server.address().port,SUPABASE_SERVICE_KEY:'test-secret'}});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('exit',code=>resolve({code,output}));});}
try{
 await mkdir(fixture+'/scripts');await mkdir(fixture+'/data');
 for(const name of ['app.js','icons.js','wiki-links.js','scripts/apply-approved.mjs'])await copyFile(root+'/'+name,fixture+'/'+name);
 const maps={maps:[{id:'other-map',width:100,height:100,markersFile:'data/other.json',extraCategories:{Dock:['D','#385f60']}},{id:'test-map',width:100,height:100,markersFile:'data/markers.json',labelsFile:'data/labels.json',levels:[{id:'lower'},{id:'upper',labelsFile:'data/upper-labels.json'}]}]};
 await writeFile(fixture+'/data/maps.json',JSON.stringify(maps));
 const markers=[{id:'published',name:'Bank',category:'Bank',x:10,y:20,level:'lower',note:''}],labels={labels:[],trainers:[{id:'published',x:10,y:20}]},upper={labels:[{id:'place',name:'Hall',kind:'building',x:20,y:30,level:'upper'}],trainers:[]};
 const format=data=>JSON.stringify(data,null,2).replace(/\n/g,'\r\n')+'\r\n';
 await writeFile(fixture+'/data/markers.json',format(markers));await writeFile(fixture+'/data/labels.json',format(labels));await writeFile(fixture+'/data/upper-labels.json',format(upper));
 approved=[
  {id:1,credit:true,author_name:'Ana',user_id:'u-ana',map:'test-map',level:'lower',kind:'move-marker',target_id:'published',payload:{from:[10,20],to:[30.6,40.2],name:'Bank'}},
  {id:2,map:'test-map',level:'upper',kind:'move-label',target_id:'place',payload:{from:[20,30],to:[40,50],name:'Hall'}},
  {id:3,credit:true,author_name:'Ana',user_id:'u-ana',map:'test-map',level:'lower',kind:'new-marker',payload:{x:12.6,y:17.1,name:'Ore',category:'Tradeskill',note:'A note',trade:'Mining',color:'#a04438',extra:'discard'}},
  {id:4,map:'test-map',level:'upper',kind:'new-marker',payload:{x:15,y:16,name:'Way out',category:'Personal',note:'Exit',noteType:'exit',arrow:'north'}},
  {id:10,map:'test-map',level:'upper',kind:'edit-label',target_id:'place',payload:{name:'Great Hall',note:'Big room',from:{name:'Hall',note:''}}},
  {id:11,credit:false,author_name:'Bo',user_id:'u-bo',map:'test-map',level:'lower',kind:'edit-marker',target_id:'published',payload:{name:'Bank of the Bay',note:'Open late',from:{name:'Bank',note:''}}}
 ];
 const before=await readFile(fixture+'/data/markers.json','utf8'),dry=await run(true);assert.equal(dry.code,0,dry.output);assert.equal(await readFile(fixture+'/data/markers.json','utf8'),before);assert.equal(patches.length,0);assert(!dry.output.includes('test-secret'));
 const result=await run();assert.equal(result.code,0,result.output);assert.equal(patches.length,1);assert.equal(patches[0].status,'published');
 const written=await readFile(fixture+'/data/markers.json','utf8'),rows=JSON.parse(written);assert.deepEqual([rows[0].x,rows[0].y],[31,40]);assert.equal(rows[1].id,'community-3');assert.equal(rows[1].trade,'Mining');assert.equal(rows[1].color,'#a04438');assert(!Object.hasOwn(rows[1],'extra'));assert(!Object.hasOwn(rows[1],'noteType'));assert(written.endsWith('\r\n'));assert(!/(?<!\r)\n/.test(written));
 const names=JSON.parse(await readFile(fixture+'/data/upper-labels.json','utf8'));assert.equal(names.labels[0].name,'Great Hall');assert.equal(names.labels[0].note,'Big room');assert.equal(rows[0].name,'Bank of the Bay');assert.equal(rows[0].note,'Open late');assert.equal(names.labels[0].x,40);assert.equal(names.labels[1].kind,'exit');assert.equal(names.labels[1].arrow,'north');assert.equal(names.labels[1].level,'upper');assert.equal(JSON.parse(await readFile(fixture+'/data/labels.json','utf8')).trainers[0].x,31);
 assert.equal(rows[0].community,true);assert.equal(rows[1].community,true);assert.equal(names.labels[0].community,true);
 // Only people who asked to be credited are listed, once per published change.
 const credits=()=>readFile(fixture+'/data/contributors.json','utf8').then(JSON.parse);assert.deepEqual((await credits()).contributors,[{name:'Ana',count:2}]);
 const again=await run();assert.equal(again.code,0,again.output);assert.equal(await readFile(fixture+'/data/markers.json','utf8'),written);assert.deepEqual((await credits()).contributors,[{name:'Ana',count:2}],'Re-running does not count twice');
 // A deleted account keeps its count under Anonymous.
 for(const r of creditRows)r.user_id=null;const later=await run();assert.equal(later.code,0,later.output);assert.deepEqual((await credits()).contributors,[{name:'Anonymous',count:2}]);
 approved=[{id:5,map:'test-map',level:'lower',kind:'new-marker',payload:{x:10,y:20,name:'New bank',category:'Bank'}},{id:6,map:'test-map',level:'lower',kind:'move-marker',target_id:'published',payload:{from:[1,2],to:[50,60],name:'Bank'}}];
 // A conflicting suggestion goes back to review with its reason; the valid one in the same run still publishes.
 const patchCount=patches.length,invalid=await run();assert.equal(invalid.code,0,invalid.output);assert(JSON.parse(await readFile(fixture+'/data/markers.json','utf8')).some(m=>m.id==='community-5'));
 const back=patches.slice(patchCount).find(p=>p.status==='pending');assert(back&&back.review_note.includes('position changed'));assert(patches.slice(patchCount).some(p=>p.status==='published'));
 // Two approved moves of one marker in the same run apply in order.
 approved=[{id:20,map:'test-map',level:'lower',kind:'move-marker',target_id:'published',payload:{from:[31,40],to:[60,70],name:'Bank'}},{id:21,map:'test-map',level:'lower',kind:'move-marker',target_id:'published',payload:{from:[31,40],to:[62,71],name:'Bank'}}];
 const chained=await run();assert.equal(chained.code,0,chained.output);assert.deepEqual((({x,y})=>[x,y])(JSON.parse(await readFile(fixture+'/data/markers.json','utf8'))[0]),[62,71]);
 // Text is cleaned of invisible and markup characters; a category from another map is refused.
 const ch=String.fromCharCode,sneaky='Ore'+ch(0x202E)+ch(0x200B)+' <script>x</script>  ',note='Line one'+ch(0x7)+'\r\n\n\n\nLine <b>two</b>  ';
 approved=[{id:7,map:'test-map',level:'lower',kind:'new-marker',payload:{x:5,y:5,name:sneaky,category:'Ore',note}}];const cleaned=await run();assert.equal(cleaned.code,0,cleaned.output);
 const added=JSON.parse(await readFile(fixture+'/data/markers.json','utf8')).find(m=>m.id==='community-7');assert.equal(added.name,'Ore scriptx/script');assert.equal(added.note,'Line one\n\nLine btwo/b');
 approved=[{id:8,map:'test-map',level:'lower',kind:'new-marker',payload:{x:5,y:5,name:'Pier',category:'Dragon lair'}}];const foreign=await run();assert.equal(foreign.code,0);assert(foreign.output.includes('Unsupported marker fields'),'A type no map has is refused');assert.equal(patches.at(-1).status,'pending');
 // Another map's type is fine: every page draws every map's types, and the note form offers them all.
 approved=[{id:9,map:'test-map',level:'lower',kind:'new-marker',payload:{x:5,y:5,name:'Pier',category:'Dock'}}];const borrowed=await run();assert.equal(borrowed.code,0);assert(!borrowed.output.includes('Unsupported marker fields'),'Another map’s type is accepted');
 approved=[{id:9,map:'test-map',level:'lower',kind:'new-marker',payload:{x:5,y:5,name:ch(0x200B)+' ',category:'Ore'}}];const blank=await run();assert(blank.output.includes('back to review'),'A name made only of invisible characters is refused');assert.equal(patches.at(-1).status,'pending');
 // Wiki links: a new marker and a marker edit carry one (with the wiki's id when picked); an edit can clear both; links to other sites and bad ids go back to review.
 approved=[{id:30,map:'test-map',level:'lower',kind:'new-marker',payload:{x:6,y:6,name:'Smithy',category:'Tradeskill',wiki:' monstersandmemories.wiki/npcs/smith ',wikiId:'npc:smith'}},{id:31,map:'test-map',level:'lower',kind:'edit-marker',target_id:'published',payload:{name:'Bank of the Bay',note:'Open late',wiki:'https://monme.no/npc/1-banker',wikiId:'1-banker',from:{name:'Bank of the Bay',note:'Open late',wiki:''}}}];
 const linked=await run();assert.equal(linked.code,0,linked.output);let all=JSON.parse(await readFile(fixture+'/data/markers.json','utf8'));
 assert.equal(all.find(m=>m.id==='community-30').wiki,'https://monstersandmemories.wiki/npcs/smith');assert.equal(all[0].wiki,'https://monme.no/npc/1-banker');assert.equal(all[0].name,'Bank of the Bay');
 assert.equal(all.find(m=>m.id==='community-30').wikiId,'npc:smith');assert.equal(all[0].wikiId,'1-banker');
 approved=[{id:32,map:'test-map',level:'lower',kind:'edit-marker',target_id:'published',payload:{name:'Bank of the Bay',note:'Open late',wiki:'',from:{name:'Bank of the Bay',note:'Open late',wiki:'https://monme.no/npc/1-banker'}}},{id:33,map:'test-map',level:'lower',kind:'edit-marker',target_id:'community-30',payload:{name:'Smithy',note:'',from:{name:'Smithy',note:''}}}];
 const cleared=await run();assert.equal(cleared.code,0,cleared.output);all=JSON.parse(await readFile(fixture+'/data/markers.json','utf8'));
 assert(!Object.hasOwn(all[0],'wiki')&&!Object.hasOwn(all[0],'wikiId'),'An edit can remove the link and its id');assert.equal(all.find(m=>m.id==='community-30').wikiId,'npc:smith','An older edit without a link keeps its id');assert.equal(all.find(m=>m.id==='community-30').wiki,'https://monstersandmemories.wiki/npcs/smith','An older edit without a link keeps it');
 approved=[{id:34,map:'test-map',level:'lower',kind:'new-marker',payload:{x:6,y:6,name:'Elsewhere',category:'Bank',wiki:'https://wiki.example/page'}},{id:35,map:'test-map',level:'lower',kind:'edit-marker',target_id:'community-30',payload:{name:'Smithy',note:'',wiki:'javascript:alert(1)',from:{name:'Smithy',note:'',wiki:'https://monstersandmemories.wiki/npcs/smith'}}},{id:36,map:'test-map',level:'lower',kind:'new-marker',payload:{x:6,y:6,name:'Bad id',category:'Bank',wiki:'https://monstersandmemories.wiki/npcs/x',wikiId:'<b>x</b>'}}];
 const foreignLinks=await run();assert.equal(foreignLinks.code,0,foreignLinks.output);assert.equal((foreignLinks.output.match(/Unsupported wiki link/g)||[]).length,2);assert(foreignLinks.output.includes('Invalid wiki id'));
 assert(!JSON.parse(await readFile(fixture+'/data/markers.json','utf8')).some(m=>m.id==='community-34'||m.id==='community-36'));
 // A shared trainer note keeps its classes from the atlas's list; anything else goes back to review.
 approved=[{id:40,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'A beastmaster instructor',category:'Class trainer',classes:['Beastmaster']}},{id:41,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'Odd trainer',category:'Class trainer',classes:['Warrior']}}];
 const trained=await run();assert.equal(trained.code,0,trained.output);assert(trained.output.includes('Unsupported classes'));
 {const all=JSON.parse(await readFile(fixture+'/data/markers.json','utf8'));assert.deepEqual(all.find(m=>m.id==='community-40').classes,['Beastmaster']);assert(!all.some(m=>m.id==='community-41'));}
 // Current and older vendor kinds publish with sorted item tags; invalid tags go back to review.
 approved=[
  {id:60,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'Leatherworker',category:'Vendor',vendor:'Leatherworking supplies',sells:['Recipes','Materials']}},
  {id:61,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'Alchemist',category:'Vendor',vendor:'Alchemy vendor'}},
  {id:62,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'Bank',category:'Bank',vendor:'Leatherworking supplies',sells:['Recipes']}},
  {id:63,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'Label',category:'Vendor',noteType:'label',vendor:'Leatherworking supplies',sells:['Recipes']}},
  ...[[],['Recipes','Recipes'],['Dragon eggs'],null,'Recipes',Array(13).fill('Recipes')].map((sells,i)=>({id:64+i,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'Bad tags '+i,category:'Vendor',sells}})),
  {id:70,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'Unknown merchant',category:'Vendor',vendor:'Dragon seller'}},
  {id:71,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'Recipes',category:'Vendor',sells:['Recipes']}},
  {id:72,map:'test-map',level:'lower',kind:'new-marker',payload:{x:7,y:7,name:'Herbalist',category:'Vendor',vendor:'Herbalism supplies'}}
 ];
 const vendors=await run();assert.equal(vendors.code,0,vendors.output);assert.equal((vendors.output.match(/Unsupported Sells tags/g)||[]).length,6);assert(vendors.output.includes('Unsupported vendor kind'));
 {const all=JSON.parse(await readFile(fixture+'/data/markers.json','utf8')),leather=all.find(m=>m.id==='community-60');assert.equal(leather.vendor,'Leatherworking vendor');assert.deepEqual(leather.sells,['Materials','Recipes']);
  const alchemist=all.find(m=>m.id==='community-61');assert.equal(alchemist.vendor,'Alchemy vendor');assert(!Object.hasOwn(alchemist,'sells'));
  const bank=all.find(m=>m.id==='community-62');assert(!Object.hasOwn(bank,'vendor')&&!Object.hasOwn(bank,'sells'));assert.deepEqual(all.find(m=>m.id==='community-71').sells,['Recipes']);assert.equal(all.find(m=>m.id==='community-72').vendor,'Herbalism vendor');
  for(let id=64;id<=70;id++)assert(!all.some(m=>m.id==='community-'+id));}
 {const label=JSON.parse(await readFile(fixture+'/data/labels.json','utf8')).labels.find(m=>m.id==='community-63');assert(!Object.hasOwn(label,'vendor')&&!Object.hasOwn(label,'sells'));}
 // Suggestions from older pages publish the old category as the Shady merchant vendor kind.
 approved=[
  {id:80,map:'test-map',level:'lower',kind:'new-marker',payload:{x:8,y:9,name:'Mira',category:'Shady merchant',note:'By the gate',wiki:'https://monstersandmemories.wiki/npcs/mira',wikiId:'npc-mira'}},
  {id:81,map:'test-map',level:'lower',kind:'new-marker',payload:{x:8,y:9,name:'Fence',category:'Shady merchant',vendor:'Baker',sells:['Recipes','Materials']}},
  {id:82,map:'test-map',level:'lower',kind:'new-marker',payload:{x:8,y:9,name:'Bad fence',category:'Shady merchant',sells:['Unknown']}},
  {id:83,map:'test-map',level:'lower',kind:'new-marker',payload:{x:8,y:9,name:'Market',category:'Shady merchant',noteType:'label',sells:['Recipes']}}
 ];
 const beforeShady=await readFile(fixture+'/data/markers.json','utf8'),shadyDry=await run(true);assert.equal(shadyDry.code,0,shadyDry.output);assert.equal(await readFile(fixture+'/data/markers.json','utf8'),beforeShady);
 const shady=await run();assert.equal(shady.code,0,shady.output);assert(shady.output.includes('Unsupported Sells tags'));assert(!shady.output.includes('Unsupported marker fields'));
 {const raw=await readFile(fixture+'/data/markers.json','utf8'),all=JSON.parse(raw),m=all.find(m=>m.id==='community-80');
  assert.deepEqual(m,{id:'community-80',community:true,name:'Mira',category:'Vendor',note:'By the gate',x:8,y:9,level:'lower',wiki:'https://monstersandmemories.wiki/npcs/mira',wikiId:'npc-mira',vendor:'Shady merchant'});
  const fence=all.find(m=>m.id==='community-81');assert.equal(fence.category,'Vendor');assert.equal(fence.vendor,'Shady merchant');assert.deepEqual(fence.sells,['Materials','Recipes']);assert(!all.some(m=>m.id==='community-82'));
  assert(raw.endsWith('\r\n')&&!/(?<!\r)\n/.test(raw),'Publishing keeps the file line endings');}
 {const label=JSON.parse(await readFile(fixture+'/data/labels.json','utf8')).labels.find(m=>m.id==='community-83');assert(!Object.hasOwn(label,'vendor')&&!Object.hasOwn(label,'sells'));}
 // A removal (an edit approved as one) takes the marker off the map; a second one finds it already gone.
 approved=[{id:50,map:'test-map',level:'lower',kind:'edit-marker',target_id:'community-40',payload:{name:'A beastmaster instructor',note:'',remove:true,reason:'duplicate',from:{name:'A beastmaster instructor',note:''}}},{id:51,map:'test-map',level:'lower',kind:'edit-marker',target_id:'community-40',payload:{name:'A beastmaster instructor',note:'',remove:true,from:{name:'A beastmaster instructor',note:''}}}];
 const removed=await run();assert.equal(removed.code,0,removed.output);assert(!JSON.parse(await readFile(fixture+'/data/markers.json','utf8')).some(m=>m.id==='community-40'),'A removal takes the marker off the map');
 console.log('Publisher checks passed: wiki links and ids, trainer classes, removals, text cleanup, per-map categories, dry run, moves, level overrides, new markers/labels, formatting, retries and conflict protection.');
}finally{
 await new Promise(resolve=>server.close(resolve));const local=relative(root,fixture);if(local.startsWith('scripts'+sep+'.publish-test-'))await rm(fixture,{recursive:true,force:true});
}
