import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),fixture=await mkdtemp(resolve(root,'scripts/.publish-test-'));
let approved=[],published=[],patches=[],creditRows=[],requests=[],race=null;
const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;
 const url=new URL(req.url,'http://fixture'),q=url.searchParams;requests.push({method:req.method,url:req.url,body:body?JSON.parse(body):null});
 if(url.pathname==='/rest/v1/credits'){if(req.method==='POST'){for(const c of JSON.parse(body))if(!creditRows.some(r=>r.suggestion_id===c.suggestion_id))creditRows.push(c);res.statusCode=201;res.end();}else res.end(JSON.stringify(creditRows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+1000)));return;}
 const id=q.get('id'),status=q.get('status')?.slice(3),source=status==='published'?published:approved;
 let rows=source.map(r=>({...r,status:r.status||status})).filter(r=>(!id||id.startsWith('gt.')?Number(r.id)>Number(id?.slice(3)||0):String(r.id)===id.slice(3))&&r.status===status);
 if(req.method==='PATCH'){
  if(race){race();race=null;rows=approved.filter(r=>String(r.id)===id?.slice(3)&&r.status==='approved');}
  patches.push(JSON.parse(body));const payload=q.get('payload')?.slice(3),version=q.get('updated_at')?.slice(3);
  rows=rows.filter(r=>(!payload||JSON.stringify(r.payload)===payload)&&(!version||r.updated_at===version));
  for(const r of rows){const original=approved.find(a=>a.id===r.id);Object.assign(original,JSON.parse(body));if(original.status==='published'){published.push({...original});approved=approved.filter(a=>a.id!==r.id);}}
  res.end(JSON.stringify(rows.map(r=>({id:r.id}))));
 }else res.end(JSON.stringify(rows.slice(0,Number(q.get('limit')||1000))));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
async function run(mode=false){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fixture+'/scripts/apply-approved.mjs',...(mode==='mark'?['--mark-published','.publish/applied.json']:mode?['--dry-run']:[])],{cwd:fixture,env:{...process.env,SUPABASE_URL:'http://127.0.0.1:'+server.address().port,SUPABASE_SERVICE_KEY:'test-secret'}});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('exit',code=>resolve({code,output}));});}
try{
 await mkdir(fixture+'/scripts');await mkdir(fixture+'/data');
 for(const name of ['app.js','icons.js','wiki-links.js','changes.js','scripts/apply-approved.mjs'])await copyFile(root+'/'+name,fixture+'/'+name);
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
 const result=await run();assert.equal(result.code,0,result.output);assert.equal(patches.length,0);assert.equal(JSON.parse(await readFile(fixture+'/.publish/applied.json','utf8')).length,6);
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
 const back=patches.slice(patchCount).find(p=>p.status==='pending');assert(back&&back.review_note.includes('position changed'));assert(!patches.slice(patchCount).some(p=>p.status==='published'));
 // Two moves from one base hold the later row for review.
 approved=[{id:20,map:'test-map',level:'lower',kind:'move-marker',target_id:'published',payload:{from:[31,40],to:[60,70],name:'Bank'}},{id:21,map:'test-map',level:'lower',kind:'move-marker',target_id:'published',payload:{from:[31,40],to:[62,71],name:'Bank'}}];
 const chained=await run();assert.equal(chained.code,0,chained.output);assert.deepEqual((({x,y})=>[x,y])(JSON.parse(await readFile(fixture+'/data/markers.json','utf8'))[0]),[60,70]);assert(chained.output.includes('conflicts with #20'));
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
 // A reviewer may change an edited marker's type: its old type's fields go, the new ones come, and a trainer chip follows.
 {const now=id=>JSON.parse(readFileSync(fixture+'/data/markers.json','utf8')).find(m=>m.id===id),text=m=>({name:m.name,note:m.note||'',from:{name:m.name,note:m.note||'',category:m.category}});
  const chips=()=>JSON.parse(readFileSync(fixture+'/data/labels.json','utf8')).trainers;
  approved=[{id:60,map:'test-map',level:'lower',kind:'edit-marker',target_id:'community-81',payload:{...text(now('community-81')),category:'Tradeskill',trade:'Fishing',vendor:'Shady merchant'}}];
  let r=await run();assert.equal(r.code,0,r.output);let m=now('community-81');assert.equal(m.category,'Tradeskill');assert.equal(m.trade,'Fishing');assert(!Object.hasOwn(m,'vendor')&&!Object.hasOwn(m,'sells'),'The old type\'s fields go');
  approved=[{id:61,map:'test-map',level:'lower',kind:'edit-marker',target_id:'published',payload:{...text(now('published')),category:'Class trainer',classes:['Monk']}}];
  r=await run();assert.equal(r.code,0,r.output);assert.deepEqual(now('published').classes,['Monk']);{const chip=chips().find(t=>t.id==='published');assert.deepEqual([chip.classes,chip.abbreviations],[['Monk'],['MNK']]);}
  approved=[{id:62,map:'test-map',level:'lower',kind:'edit-marker',target_id:'published',payload:{...text(now('published')),category:'Bank'}}];
  r=await run();assert.equal(r.code,0,r.output);assert.equal(now('published').category,'Bank');assert(!Object.hasOwn(now('published'),'classes'));assert(!chips().some(t=>t.id==='published'),'A marker that stops being a trainer loses its chip');
  const beforeTypes=readFileSync(fixture+'/data/markers.json','utf8');
  approved=[{id:63,map:'test-map',level:'lower',kind:'edit-marker',target_id:'published',payload:{...text(now('published')),from:{...text(now('published')).from,category:'Inn'},category:'Vendor'}},{id:64,map:'test-map',level:'lower',kind:'edit-marker',target_id:'published',payload:{...text(now('published')),category:'Personal'}}];
  r=await run();assert.equal(r.code,0,r.output);assert(r.output.includes('The published type changed'));assert(r.output.includes('Unsupported marker fields for suggestion 64'));assert.equal(readFileSync(fixture+'/data/markers.json','utf8'),beforeTypes);}
 // A name edit sent before the note was cleaned up still applies, and leaves the newer note alone.
 {const now=id=>JSON.parse(readFileSync(fixture+'/data/markers.json','utf8')).find(m=>m.id===id),m=now('community-81');
  approved=[{id:65,map:'test-map',level:'lower',kind:'edit-marker',target_id:'community-81',payload:{name:'Night fence',note:'Approximate location; to confirm in game.',from:{name:m.name,note:'Approximate location; to confirm in game.'}}}];
  const r=await run();assert.equal(r.code,0,r.output);assert(!r.output.includes('changed after'),r.output);assert.equal(now('community-81').name,'Night fence');assert.equal(now('community-81').note,m.note,'An untouched note is not written back');}
 // A failed row leaves neither the marker nor its chip changed, even when it also asked for a rename.
 {const original=await readFile(fixture+'/data/markers.json','utf8'),chips=await readFile(fixture+'/data/labels.json','utf8'),m=JSON.parse(original)[0];
  approved=[{id:100,map:'test-map',level:'lower',kind:'edit-marker',target_id:m.id,payload:{name:'Broken rename',wiki:'https://monstersandmemories.wiki/npcs/bank',wikiId:'<bad>',category:'Class trainer',classes:['Monk'],from:{name:m.name,wiki:m.wiki||'',category:m.category}}},{id:101,map:'test-map',level:'lower',kind:'edit-marker',target_id:m.id,payload:{name:'Broken trainer',category:'Class trainer',classes:['Warrior'],from:{name:m.name,category:m.category}}},{id:102,map:'test-map',level:'lower',kind:'move-marker',target_id:m.id,payload:{name:m.name,from:[m.x,m.y],to:[101,1]}}];
  const r=await run();assert.equal(r.code,0,r.output);assert.equal(await readFile(fixture+'/data/markers.json','utf8'),original);assert.equal(await readFile(fixture+'/data/labels.json','utf8'),chips);assert.equal(JSON.parse(await readFile(fixture+'/.publish/held.json','utf8')).length,3);assert.deepEqual(JSON.parse(await readFile(fixture+'/.publish/applied.json','utf8')),[]);
 }
 // Removals check the name and, when sent, the description; label and chip-only removals work too.
 {const path=fixture+'/data/labels.json',data=JSON.parse(await readFile(path,'utf8'));data.labels.push({id:'sign',name:'Sign',note:'By the door',x:1,y:2});data.trainers.push({id:'chip-only',building:'Tutor',note:'At the door',classes:['Monk'],x:3,y:4});await writeFile(path,format(data));
  approved=[{id:110,map:'test-map',level:'lower',kind:'edit-label',target_id:'sign',payload:{name:'Sign',remove:true,from:{name:'Old sign'}}},{id:111,map:'test-map',level:'lower',kind:'edit-label',target_id:'sign',payload:{name:'Sign',remove:true,from:{name:'Sign',note:'Elsewhere'}}},{id:112,map:'test-map',level:'lower',kind:'edit-marker',target_id:'chip-only',payload:{name:'Master tutor',classes:['Cleric'],from:{name:'Tutor',classes:['Monk']}}}];
  const r=await run();assert.equal(r.code,0,r.output);let current=JSON.parse(await readFile(path,'utf8'));assert(current.labels.some(r=>r.id==='sign'));assert.equal(current.trainers.find(r=>r.id==='chip-only').name,'Master tutor');assert.deepEqual(current.trainers.find(r=>r.id==='chip-only').abbreviations,['CLR']);
  approved=[{id:113,map:'test-map',level:'lower',kind:'edit-label',target_id:'sign',payload:{name:'Sign',remove:true,from:{name:'Sign',note:'By the door'}}},{id:114,map:'test-map',level:'lower',kind:'edit-marker',target_id:'chip-only',payload:{name:'Master tutor',remove:true,from:{name:'Master tutor'}}}];
  assert.equal((await run()).code,0);current=JSON.parse(await readFile(path,'utf8'));assert(!current.labels.some(r=>r.id==='sign'));assert(!current.trainers.some(r=>r.id==='chip-only'));
 }
 // Both authors keep their credit when a later edit follows the first; a retry sees the whole chain already live.
 {const m=JSON.parse(await readFile(fixture+'/data/markers.json','utf8'))[0],base={map:'test-map',level:'lower',target_id:m.id,kind:'edit-marker',credit:true};
  published=[{id:119,status:'published',map:'test-map',kind:'move-marker',target_id:m.id,user_id:null,credit:true,payload:{}}];creditRows.push({suggestion_id:119,user_id:null,name:'Former traveller'});
  approved=[{...base,id:120,user_id:'u-first',author_name:'First traveller',payload:{name:'First bank',from:{name:m.name}}},{...base,id:121,user_id:'u-second',author_name:'Second traveller',payload:{name:'Second bank',from:{name:'First bank'}}},{...base,id:122,user_id:'u-third',author_name:'Third traveller',credit:false,payload:{name:'Second bank',note:'Open early',from:{name:'Second bank',note:m.note||''}}}];
  const r=await run();assert.equal(r.code,0,r.output);assert(!r.output.includes('back to review'));assert.equal(JSON.parse(await readFile(fixture+'/data/markers.json','utf8'))[0].name,'Second bank');
  const ledger=()=>readFile(fixture+'/data/credits/test-map.json','utf8').then(JSON.parse);assert.deepEqual((await ledger())[m.id],[{name:null,what:'moved'},{name:'First traveller',what:'edited'},{name:'Second traveller',what:'edited'},{name:null,what:'edited'}]);assert(creditRows.some(r=>r.suggestion_id===120));assert(creditRows.some(r=>r.suggestion_id===121));
  const retry=await run();assert.equal(retry.code,0,retry.output);assert(retry.output.includes('already superseded'));assert.equal(JSON.parse(await readFile(fixture+'/.publish/applied.json','utf8')).length,3);assert(!retry.output.includes('back to review'));
  // Hashes ignore key order. An edited payload and a rejected row stay unacknowledged.
  approved[0].payload={from:{name:m.name},name:'First bank'};approved[1].payload.name='Changed during the run';approved[2].status='rejected';
  const count=patches.length,mark=await run('mark');assert.equal(mark.code,0,mark.output);assert.equal(patches.length,count+1);assert.equal(published.at(-1).id,120);assert.equal(approved.find(r=>r.id===121).status,undefined);assert.equal(approved.find(r=>r.id===122).status,'rejected');
 }
 // The conditional PATCH also catches a correction made after the acknowledgement read.
 {const m=JSON.parse(await readFile(fixture+'/data/markers.json','utf8'))[0];approved=[{id:130,status:'approved',updated_at:'2026-10-10T12:00:00Z',map:'test-map',level:'lower',kind:'edit-marker',target_id:m.id,payload:{name:'Race bank',from:{name:m.name}}}];
  assert.equal((await run()).code,0);race=()=>{approved[0].payload={name:'Newer bank',from:{name:m.name}};approved[0].updated_at='2026-10-10T12:01:00Z';};assert.equal((await run('mark')).code,0);assert.equal(approved[0].status,'approved');assert(!published.some(r=>r.id===130));
  const call=requests.filter(r=>r.method==='PATCH'&&r.body.status==='published').at(-1),q=new URL(call.url,'http://fixture').searchParams;assert(q.has('payload'));assert.equal(q.get('updated_at'),'eq.2026-10-10T12:00:00Z');
 }
 // Untouched entries keep their exact number spelling, even beside an added marker.
 {const raw='[\r\n  {"id":"decimal","name":"Gate","category":"Bank","x":18.0,"y":2.500}\r\n]\r\n';await writeFile(fixture+'/data/other.json',raw);
  approved=[{id:140,map:'other-map',kind:'new-marker',payload:{name:'New gate',category:'Bank',x:3,y:4}}];assert.equal((await run()).code,0);const text=await readFile(fixture+'/data/other.json','utf8');assert(text.includes(raw.slice(5,-5)));assert(text.includes('"x":18.0,"y":2.500'));assert(text.endsWith('\r\n'));
 }
 // A new marker and its follow-ups apply together; a copied, unchanged type never undoes a retype.
 {approved=[{id:150,map:'other-map',kind:'new-marker',payload:{name:'Forge',category:'Bank',x:1,y:2}},{id:151,map:'other-map',kind:'edit-marker',target_id:'community-150',payload:{name:'Forge',category:'Tradeskill',trade:'Mining',from:{name:'Forge',category:'Bank'}}},{id:152,map:'other-map',kind:'edit-marker',target_id:'community-150',payload:{name:'Old forge',category:'Bank',from:{name:'Forge',category:'Bank'}}},{id:153,map:'other-map',kind:'move-marker',target_id:'community-150',payload:{name:'Old forge',from:[1,2],to:[3,4]}}];
  const r=await run();assert.equal(r.code,0,r.output);assert(!r.output.includes('back to review'));const m=JSON.parse(await readFile(fixture+'/data/other.json','utf8')).find(m=>m.id==='community-150');assert.equal(m.name,'Old forge');assert.equal(m.category,'Tradeskill');assert.deepEqual([m.x,m.y],[3,4]);
  const before=await readFile(fixture+'/data/other.json','utf8'),retry=await run();assert.equal(retry.code,0,retry.output);assert(!retry.output.includes('back to review'));assert.equal(await readFile(fixture+'/data/other.json','utf8'),before);assert.equal(JSON.parse(await readFile(fixture+'/.publish/applied.json','utf8')).length,4);
 }
 // A correction to an unacknowledged new place is applied on the next run, with the original payload version kept intact.
 {approved=[{id:170,map:'other-map',status:'approved',kind:'new-marker',payload:{name:'  New   place ',category:'Bank',x:7,y:8}}];const original=structuredClone(approved[0].payload);assert.equal((await run()).code,0);assert.deepEqual(approved[0].payload,original);approved[0].payload.name='Corrected place';assert.equal((await run('mark')).code,0);assert.equal(approved[0].status,'approved');assert.equal((await run()).code,0);assert.equal(JSON.parse(await readFile(fixture+'/data/other.json','utf8')).find(m=>m.id==='community-170').name,'Corrected place');assert.equal((await run('mark')).code,0);assert(published.some(r=>r.id===170));}
 // Renames from the same base are held with the earlier row number, while a following removal blocks every later change.
 {approved=[{id:180,map:'other-map',kind:'edit-marker',target_id:'community-170',payload:{name:'First name',from:{name:'Corrected place'}}},{id:181,map:'other-map',kind:'edit-marker',target_id:'community-170',payload:{name:'Second name',from:{name:'Corrected place'}}},{id:182,map:'other-map',kind:'edit-marker',target_id:'community-170',payload:{name:'First name',remove:true,from:{name:'First name'}}},{id:183,map:'other-map',kind:'move-marker',target_id:'community-170',payload:{name:'First name',from:[7,8],to:[8,9]}}];const r=await run();assert.equal(r.code,0,r.output);const held=JSON.parse(await readFile(fixture+'/.publish/held.json','utf8'));assert.equal(held.find(r=>r.id===181).note,'Not published: conflicts with #180');assert.equal(held.find(r=>r.id===183).note,'Not published: conflicts with #182');}
 // With no new approvals, published history alone rebuilds the per-place credits.
 {approved=[];published.push({id:160,status:'published',map:'other-map',kind:'new-marker',credit:true,user_id:'old-user',payload:{}});creditRows.push({suggestion_id:160,user_id:'old-user',name:'Earlier traveller'});assert.equal((await run()).code,0);assert.deepEqual(JSON.parse(await readFile(fixture+'/data/credits/other-map.json','utf8'))['community-160'],[{name:'Earlier traveller',what:'added'}]);}
 const workflow=await readFile(root+'/.github/workflows/apply-suggestions.yml','utf8');assert(workflow.indexOf('git push origin HEAD:main')<workflow.indexOf('--mark-published'));assert(workflow.includes('git reset --hard origin/main\n            node scripts/apply-approved.mjs'));assert(!workflow.includes('git pull --rebase'));assert(workflow.includes('success() && inputs.dry_run != true'));
 // Run the publish endpoint with local replies; a running batch gets one more dispatch, a waiting one does not.
 const source=stripTypeScriptTypes(await readFile(root+'/supabase/functions/publish-now/index.ts','utf8'));
 async function endpoint(states){let handler;const calls=[],context=vm.createContext({URL,Request,Response,Deno:{env:{get:k=>({GITHUB_DISPATCH_TOKEN:'test-token',SUPABASE_ANON_KEY:'public-key',SUPABASE_URL:'http://fixture'})[k]},serve:fn=>handler=fn},fetch:async(url,options={})=>{
   calls.push({url,options});if(url.endsWith('/auth/v1/user'))return Response.json({id:'reviewer'});if(url.includes('/rest/v1/admins'))return Response.json([{user_id:'reviewer'}]);if(url.includes('/dispatches'))return new Response(null,{status:204});return Response.json({total_count:states.includes(new URL(url).searchParams.get('status'))?1:0});
  }});vm.runInContext(source,context);const response=await handler(new Request('http://fixture/publish-now',{method:'POST',headers:{authorization:'Bearer header.payload.signature'}}));return {body:await response.json(),calls};}
 for(const state of ['queued','pending','waiting']){const r=await endpoint([state]);assert(r.body.queued);assert(!r.calls.some(c=>c.url.includes('/dispatches')));}
 const running=await endpoint(['in_progress']);assert(running.body.queued);assert.equal(running.calls.filter(c=>c.url.includes('/dispatches')).length,1);const idle=await endpoint([]);assert(idle.body.started);assert(!idle.body.queued);
 const schema=await readFile(root+'/supabase/schema.sql','utf8'),migration=await readFile(root+'/supabase/edit-rewrite.sql','utf8');for(const sql of [schema,migration]){assert(sql.includes('add column if not exists updated_at timestamptz not null default now()'));assert(sql.includes('new.updated_at=clock_timestamp()'));assert(sql.includes("kind='new-marker' or (not payload ? 'bounty' and not payload ? 'priority')"));assert(sql.includes('not valid;'));assert(sql.includes('drop trigger if exists suggestions_updated_at'));}assert(schema.includes(migration.slice(migration.indexOf('-- Existing rows'),migration.indexOf('\ncommit;')).trim()));
 console.log('Publisher checks passed: atomic rows, field conflicts, stale removals, labels/chips, retries, payload versions, credits, number spelling, workflow ordering and queued publishing.');
}finally{
 await new Promise(resolve=>server.close(resolve));const local=relative(root,fixture);if(local.startsWith('scripts'+sep+'.publish-test-'))await rm(fixture,{recursive:true,force:true});
}
