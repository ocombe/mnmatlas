import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),fixture=await mkdtemp(resolve(root,'scripts/.publish-test-'));
let approved=[],patches=[];
const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;if(req.method==='PATCH'){patches.push(JSON.parse(body));res.end('[]');}else res.end(JSON.stringify(approved));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
async function run(dry=false){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fixture+'/scripts/apply-approved.mjs',...(dry?['--dry-run']:[])],{env:{...process.env,SUPABASE_URL:'http://127.0.0.1:'+server.address().port,SUPABASE_SERVICE_KEY:'test-secret'}});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('exit',code=>resolve({code,output}));});}
try{
 await mkdir(fixture+'/scripts');await mkdir(fixture+'/data');
 for(const name of ['app.js','icons.js','scripts/apply-approved.mjs'])await copyFile(root+'/'+name,fixture+'/'+name);
 const maps={maps:[{id:'other-map',width:100,height:100,markersFile:'data/other.json',extraCategories:{Dock:['D','#385f60']}},{id:'test-map',width:100,height:100,markersFile:'data/markers.json',labelsFile:'data/labels.json',levels:[{id:'lower'},{id:'upper',labelsFile:'data/upper-labels.json'}]}]};
 await writeFile(fixture+'/data/maps.json',JSON.stringify(maps));
 const markers=[{id:'published',name:'Bank',category:'Bank',x:10,y:20,level:'lower',note:''}],labels={labels:[],trainers:[{id:'published',x:10,y:20}]},upper={labels:[{id:'place',name:'Hall',kind:'building',x:20,y:30,level:'upper'}],trainers:[]};
 const format=data=>JSON.stringify(data,null,2).replace(/\n/g,'\r\n')+'\r\n';
 await writeFile(fixture+'/data/markers.json',format(markers));await writeFile(fixture+'/data/labels.json',format(labels));await writeFile(fixture+'/data/upper-labels.json',format(upper));
 approved=[
  {id:1,map:'test-map',level:'lower',kind:'move-marker',target_id:'published',payload:{from:[10,20],to:[30.6,40.2],name:'Bank'}},
  {id:2,map:'test-map',level:'upper',kind:'move-label',target_id:'place',payload:{from:[20,30],to:[40,50],name:'Hall'}},
  {id:3,map:'test-map',level:'lower',kind:'new-marker',payload:{x:12.6,y:17.1,name:'Ore',category:'Tradeskill',note:'A note',trade:'Mining',color:'#a04438',extra:'discard'}},
  {id:4,map:'test-map',level:'upper',kind:'new-marker',payload:{x:15,y:16,name:'Way out',category:'Personal',note:'Exit',noteType:'exit',arrow:'north'}},
  {id:10,map:'test-map',level:'upper',kind:'edit-label',target_id:'place',payload:{name:'Great Hall',note:'Big room',from:{name:'Hall',note:''}}},
  {id:11,map:'test-map',level:'lower',kind:'edit-marker',target_id:'published',payload:{name:'Bank of the Bay',note:'Open late',from:{name:'Bank',note:''}}}
 ];
 const before=await readFile(fixture+'/data/markers.json','utf8'),dry=await run(true);assert.equal(dry.code,0,dry.output);assert.equal(await readFile(fixture+'/data/markers.json','utf8'),before);assert.equal(patches.length,0);assert(!dry.output.includes('test-secret'));
 const result=await run();assert.equal(result.code,0,result.output);assert.equal(patches.length,1);assert.equal(patches[0].status,'published');
 const written=await readFile(fixture+'/data/markers.json','utf8'),rows=JSON.parse(written);assert.deepEqual([rows[0].x,rows[0].y],[31,40]);assert.equal(rows[1].id,'community-3');assert.equal(rows[1].trade,'Mining');assert.equal(rows[1].color,'#a04438');assert(!Object.hasOwn(rows[1],'extra'));assert(!Object.hasOwn(rows[1],'noteType'));assert(written.endsWith('\r\n'));assert(!/(?<!\r)\n/.test(written));
 const names=JSON.parse(await readFile(fixture+'/data/upper-labels.json','utf8'));assert.equal(names.labels[0].name,'Great Hall');assert.equal(names.labels[0].note,'Big room');assert.equal(rows[0].name,'Bank of the Bay');assert.equal(rows[0].note,'Open late');assert.equal(names.labels[0].x,40);assert.equal(names.labels[1].kind,'exit');assert.equal(names.labels[1].arrow,'north');assert.equal(names.labels[1].level,'upper');assert.equal(JSON.parse(await readFile(fixture+'/data/labels.json','utf8')).trainers[0].x,31);
 const again=await run();assert.equal(again.code,0,again.output);assert.equal(await readFile(fixture+'/data/markers.json','utf8'),written);
 approved=[{id:5,map:'test-map',level:'lower',kind:'new-marker',payload:{x:10,y:20,name:'New bank',category:'Bank'}},{id:6,map:'test-map',level:'lower',kind:'move-marker',target_id:'published',payload:{from:[1,2],to:[50,60],name:'Bank'}}];
 const patchCount=patches.length,invalid=await run();assert.equal(invalid.code,1);assert.equal(await readFile(fixture+'/data/markers.json','utf8'),written);assert.equal(patches.length,patchCount);
 // Text is cleaned of invisible and markup characters; a category from another map is refused.
 const ch=String.fromCharCode,sneaky='Ore'+ch(0x202E)+ch(0x200B)+' <script>x</script>  ',note='Line one'+ch(0x7)+'\r\n\n\n\nLine <b>two</b>  ';
 approved=[{id:7,map:'test-map',level:'lower',kind:'new-marker',payload:{x:5,y:5,name:sneaky,category:'Ore',note}}];const cleaned=await run();assert.equal(cleaned.code,0,cleaned.output);
 const added=JSON.parse(await readFile(fixture+'/data/markers.json','utf8')).find(m=>m.id==='community-7');assert.equal(added.name,'Ore scriptx/script');assert.equal(added.note,'Line one\n\nLine btwo/b');
 approved=[{id:8,map:'test-map',level:'lower',kind:'new-marker',payload:{x:5,y:5,name:'Pier',category:'Dock'}}];const foreign=await run();assert.equal(foreign.code,1);assert(foreign.output.includes('Unsupported marker fields'));
 approved=[{id:9,map:'test-map',level:'lower',kind:'new-marker',payload:{x:5,y:5,name:ch(0x200B)+' ',category:'Ore'}}];assert.equal((await run()).code,1,'A name made only of invisible characters is refused');
 console.log('Publisher checks passed: text cleanup, per-map categories, dry run, moves, level overrides, new markers/labels, formatting, retries and conflict protection.');
}finally{
 await new Promise(resolve=>server.close(resolve));const local=relative(root,fixture);if(local.startsWith('scripts'+sep+'.publish-test-'))await rm(fixture,{recursive:true,force:true});
}
