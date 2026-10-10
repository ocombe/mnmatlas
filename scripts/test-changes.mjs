import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(await readFile(new URL('../changes.js',import.meta.url),'utf8'),context);
const {buildChanges,fieldsOf,diffWords,nextFrom}=context.atlasChanges,plain=v=>JSON.parse(JSON.stringify(v)),fields=r=>[...fieldsOf(r)].sort();
const marker={id:'bank',name:'Bank',note:'By the gate',category:'Bank',x:90,y:90,level:'lower'},label={id:'hall',name:'Hall',kind:'building',x:80,y:80,level:'lower'},chip={id:'trainer',building:'Tutor',classes:['Monk'],x:5,y:6};
const row=(id,kind,payload,extra={})=>({id,kind,payload,map:'bay',level:'lower',status:'approved',target_id:'bank',user_id:'u'+id,author_name:'Traveller '+id,credit:true,...extra});
const move=(id,from,to,extra={})=>row(id,'move-marker',{name:'Bank',from,to},extra),edit=(id,name,from='Bank',extra={})=>row(id,'edit-marker',{name,from:{name:from}},extra);
const fixture=rows=>({mapId:'bay',levelId:'lower',markers:[marker],labels:[label],trainers:[chip],publishedPositions:new Map([['bank',[10,20]]]),publishedLabelPositions:new Map([['hall',[3,4]]]),rows,now:'2026-10-10'});
{
 const input=fixture([edit(2,'Bay Bank'),move(1,[10,20],[30,40]),edit(3,'Waiting Bank','Bay Bank',{status:'pending'}),edit(4,'Set aside','Bank',{status:'rejected'}),edit(5,'Elsewhere','Bank',{map:'other'}),edit(6,'Upstairs','Bank',{level:'upper'})]);
 const before=JSON.stringify(input),set=buildChanges(input),t=set.get('marker:bank');
 assert.equal(JSON.stringify(input),before,'Inputs stay untouched');assert.equal(set.targets().length,1);assert.equal(set.forRow('2'),t);assert.equal(set.get('marker:none'),null);
 assert.deepEqual([t.published.x,t.published.y],[10,20]);assert.equal(t.effective.name,'Bay Bank');assert.deepEqual([t.effective.x,t.effective.y],[30,40]);assert.equal(t.proposed.name,'Waiting Bank');assert.equal(t.rows.length,4);assert.deepEqual(plain(t.rows.map(r=>r.id)),[1,2,3,4]);assert(t.rows.every(r=>!r.conflictsWith.length));
 assert.deepEqual([...t.changed].sort(),['name','position']);assert.equal(t.contributors.length,4);assert.equal(t.contributors[0].what,'moved');assert.equal(nextFrom(t,'edit-marker').name,'Bay Bank');assert.deepEqual(plain(nextFrom(t,'move-marker')),[30,40]);
 assert.deepEqual(plain(t.rows[0].base),{x:10,y:20});
 assert.equal(buildChanges({...input,includePending:true}).get(t.key).effective.name,'Waiting Bank');
 assert.deepEqual([set.get('label:hall').published.x,set.get('label:hall').published.y],[3,4]);
}
{
 const set=buildChanges(fixture([edit(1,'First'),edit(2,'Second'),move(3,[10,20],[30,40]),move(4,[10,20],[50,60]),edit(5,'Chained','Second')])),t=set.get('marker:bank');
 assert.deepEqual(plain(t.rows.map(r=>r.conflictsWith)),[[],[1],[],[3],[]]);assert.equal(t.effective.name,'Chained');
}
{
 const removed=row(2,'edit-marker',{name:'First',remove:true,from:{name:'First',note:'By the gate'}}),t=buildChanges(fixture([edit(1,'First'),removed,move(3,[10,20],[30,40]),edit(4,'Last','First')])).get('marker:bank');
 assert.equal(t.effective.removed,true);assert.deepEqual(plain(t.rows[2].conflictsWith),[2]);assert.deepEqual(plain(t.rows[3].conflictsWith),[2]);assert(t.changed.has('removed'));
 const stale=buildChanges(fixture([edit(1,'First'),{...removed,payload:{...removed.payload,from:{name:'Bank'}}}])).get('marker:bank');assert.deepEqual(plain(stale.rows[1].conflictsWith),[1]);
}
{
 const add=row(10,'new-marker',{name:'Camp',x:7,y:8,category:'Bank',note:''},{target_id:null}),target_id='community-10',t=buildChanges(fixture([add,move(11,[7,8],[9,10],{target_id}),edit(12,'Camp Bank','Camp',{target_id})])).get('marker:'+target_id);
 assert(t.isNew);assert.equal(t.published,null);assert(!t.missing);assert.equal(t.effective.name,'Camp Bank');assert.deepEqual([t.effective.x,t.effective.y],[9,10]);assert(t.changed.has('added'));assert.equal(t.contributors[0].what,'added');
 assert.equal(t.effective.level,'lower');
 const live={...fixture([add]),markers:[{id:target_id,name:'Camp',category:'Bank'}],publishedPositions:new Map([[target_id,[7,8]]])};assert(!buildChanges(live).get('marker:'+target_id).isNew);
}
{
 const rows=[row(1,'move-label',{name:'Hall',from:[3,4],to:[5,6]},{target_id:'hall'}),row(2,'edit-label',{name:'Great Hall',from:{name:'Hall'}},{target_id:'hall'}),row(3,'edit-marker',{name:'Tutor',classes:['Cleric'],from:{name:'Tutor',classes:['Monk']}},{target_id:'trainer'}),row(4,'new-marker',{name:'Way out',noteType:'exit',category:'Personal',x:8,y:9,arrow:'north'}),row(5,'edit-label',{name:'Way out',arrow:'east',level:'upper',from:{name:'Way out',arrow:'north',level:'lower'}},{target_id:'community-4'})];
 const set=buildChanges(fixture(rows));assert.equal(set.get('label:hall').effective.name,'Great Hall');assert.equal(set.get('label:hall').effective.x,5);assert.deepEqual(plain(set.get('chip:trainer').effective.classes),['Cleric']);assert.equal(set.get('label:community-4').effective.arrow,'east');assert.equal(set.get('label:community-4').effective.level,'upper');
 const missing=buildChanges(fixture([edit(6,'Lost','Lost',{target_id:'gone'})])).forRow(6);assert(missing.missing);assert(!missing.isNew);assert.equal(missing.published,null);
 const names=buildChanges(fixture([row(7,'new-marker',{name:'Grove',noteType:'label',category:'Personal',x:1,y:2}),row(8,'edit-label',{name:'Grove',remove:true,from:{name:'Grove'}},{target_id:'community-7'})]));assert.equal(names.forRow(7).kind,'label');assert.equal(names.forRow(7).effective.kind,'building');assert(names.forRow(7).effective.removed);
}
{
 assert.deepEqual(fields(row(1,'edit-marker',{name:'Bank',note:'By the gate',category:'Bank',from:{name:'Bank',note:'By the gate',category:'Bank'}})),[]);
 const retype=row(1,'edit-marker',{name:'Bank',category:'Tradeskill',trade:'Mining',from:{name:'Bank',category:'Bank'}}),rename=row(2,'edit-marker',{name:'Smithy',category:'Bank',from:{name:'Bank',category:'Bank'}}),t=buildChanges(fixture([retype,rename])).get('marker:bank');
 assert.deepEqual(fields(retype),['type']);assert.deepEqual(fields(rename),['name']);assert.equal(t.effective.category,'Tradeskill');assert.equal(t.effective.trade,'Mining');assert(t.rows.every(r=>!r.conflictsWith.length));
 assert.deepEqual(fields(row(3,'edit-marker',{name:'Bank',wiki:'page',wikiId:'id',from:{name:'Bank',wiki:''}})),['wiki']);
 const linked={...marker,wiki:'old-page',wikiId:'old-id'},input=fixture([row(4,'edit-marker',{name:'Bank',wiki:'new-page',from:{name:'Bank',wiki:'old-page'}})]);input.markers=[linked];assert.equal(buildChanges(input).get('marker:bank').effective.wikiId,undefined);
 const history=buildChanges(fixture([edit(9,'Old','Bank',{status:'published'}),edit(10,'Rejected','Bank',{status:'rejected'})]));assert.equal(history.targets().length,0);assert.equal(history.get('marker:bank').effective.name,'Bank');
}
for(const [a,b] of [['',''],['Old hall','New hall'],['Same  words','Same words!'],['','Hello'],['Gone','']]){
 const diff=diffWords(a,b);assert.equal(diff.filter(r=>r.op!=='ins').map(r=>r.text).join(''),a);assert.equal(diff.filter(r=>r.op!=='del').map(r=>r.text).join(''),b);assert(diff.every(r=>['same','del','ins'].includes(r.op)));
}
const browser=vm.createContext({window:{}});vm.runInContext(await readFile(new URL('../changes.js',import.meta.url),'utf8'),browser);assert(browser.window.atlasChanges);
assert((await readFile(new URL('../index.html',import.meta.url),'utf8')).includes('<script defer src="changes.js?v=atlas-1"></script><script defer src="community.js'));
console.log('Change ledger checks passed: published positions, composition, conflicts, removals, shared places, labels, chips, floors, history, credits, word diffs and pure inputs.');
