import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context=vm.createContext({URL});vm.runInContext(await readFile(new URL('../marker-schema.js',import.meta.url),'utf8'),context);vm.runInContext(await readFile(new URL('../wiki-links.js',import.meta.url),'utf8'),context);vm.runInContext(await readFile(new URL('../changes.js',import.meta.url),'utf8'),context);
{
 const S=context.atlasShapes,C=context.atlasChanges,rect={kind:'area',form:'rect',points:[[10,10],[30,10],[30,30],[10,30]]},path={kind:'path',points:[[40,40],[50,50],[60,40]],loop:true},base={id:'shape',name:'Patrol',category:'Bank',x:20,y:20,shape:rect};
 const plain=v=>JSON.parse(JSON.stringify(v));assert.deepEqual(plain(S.anchor(rect)),[20,20]);assert.deepEqual(plain(S.anchor(path)),[40,40]);assert.equal(S.describe(rect),'Area (rectangle)');
 const edit={id:1,kind:'edit-marker',payload:{name:'Patrol',shape:path,from:base}},moved={id:2,kind:'move-marker',payload:{name:'Patrol',from:[20,20],fromShape:rect,to:[30,30],shape:S.translate(rect,10,10)}};
 assert.deepEqual([...C.fieldsOf(edit)],['shape']);assert.equal(C.whatOf(edit),'reshaped');const next=C.applyTo(base,edit);assert.deepEqual(plain([next.x,next.y]),[40,40]);assert.deepEqual(plain(next.shape),path);assert(C.matchesFrom(edit,base,'shape'));assert(!C.matchesFrom(edit,next,'shape'));
 assert.deepEqual(plain(C.conflicts(edit,C.applyTo(base,moved),[{id:2,fields:C.fieldsOf(moved)}])),[2]);assert.deepEqual(plain(C.conflicts(moved,next,[{id:1,fields:C.fieldsOf(edit)}])),[1]);
 assert.deepEqual(plain(C.applyTo(base,{kind:'move-marker',payload:{from:[20,20],to:[30,30]}}).shape),plain(S.translate(rect,10,10)),'Legacy move payloads also translate shapes');
 assert.deepEqual(plain(C.nextFrom({effective:next},'edit-marker').shape),path);assert(!C.applyTo(base,{kind:'edit-marker',payload:{name:'Patrol',shape:null,from:base}}).shape);
 const bad=[{...path,points:[[1.2,2],[3,4]]},{...path,loop:'yes'},{...path,points:[[1,2]]},{...path,points:Array.from({length:101},(_,i)=>[i,1])},{...rect,points:[[10,10],[30,11],[30,30],[10,30]]},{kind:'area',form:'circle',points:[[5,5]],r:10}];for(const s of bad)assert.throws(()=>S.validate(s,{width:100,height:100}),/Invalid shape/);assert.throws(()=>S.translate(rect,-20,0,{width:100,height:100}),/inside the map/);
 console.log('Shape ledger checks passed: whole-field changes, centroid/start anchors, moves, conflicts, clearing, bases and validation.');
}
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
 const set=buildChanges(fixture([edit(1,'First'),edit(2,'Second'),move(3,[10,20],[30,40]),move(4,[10,20],[50,60]),edit(5,'Chained','First')])),t=set.get('marker:bank');
 assert.deepEqual(plain(t.rows.map(r=>r.conflictsWith)),[[],[1],[],[3],[]]);assert.equal(t.effective.name,'Chained');assert.equal(t.effective.x,30);assert.equal(t.proposed.x,30);
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
 const linked={...marker,wiki:'https://monstersandmemories.wiki/npcs/old-page',wikiId:'old-id'},input=fixture([row(4,'edit-marker',{name:'Bank',wiki:'https://monstersandmemories.wiki/npcs/new-page',from:{name:'Bank',wiki:'https://monstersandmemories.wiki/npcs/old-page'}})]);input.markers=[linked];assert.equal(buildChanges(input).get('marker:bank').effective.wikiId,undefined);
 const history=buildChanges(fixture([edit(9,'Old','Bank',{status:'published'}),edit(10,'Rejected','Bank',{status:'rejected'})]));assert.equal(history.targets().length,0);assert.equal(history.get('marker:bank').effective.name,'Bank');
}
// Older type bases cannot chain after a type edit; a complete current base can.
{
 const trainer={...marker,category:'Class trainer',classes:['Monk']},change=(id,classes,from)=>row(id,'edit-marker',{name:'Bank',category:'Class trainer',classes,from:{name:'Bank',...from}});
 const input={...fixture([]),markers:[trainer]},first=change(1,['Cleric'],{category:'Class trainer'}),second=change(2,['Druid'],{category:'Class trainer'}),third=change(3,['Enchanter'],{category:'Class trainer',classes:['Cleric']});
 const t=buildChanges({...input,rows:[first,second,third]}).get('marker:bank');assert.deepEqual(plain(t.rows.map(r=>r.conflictsWith)),[[],[1],[]]);assert.deepEqual(plain(t.effective.classes),['Enchanter']);
 const vendor={...marker,category:'Vendor',vendor:'Baker',sells:['Food & drink']},v=(id,vendor,from)=>row(id,'edit-marker',{name:'Bank',category:'Vendor',vendor,sells:['Recipes'],from:{name:'Bank',...from}});
 const t2=buildChanges({...fixture([]),markers:[vendor],rows:[v(1,'Cook',{category:'Vendor'}),v(2,'Baker',{category:'Vendor'}),v(3,'Grocer',{category:'Vendor',vendor:'Cook',sells:['Recipes']})]}).get('marker:bank');assert.deepEqual(plain(t2.rows.map(r=>r.conflictsWith)),[[],[1],[]]);assert.equal(t2.effective.vendor,'Grocer');
 const trade={...marker,category:'Tradeskill',trade:'Mining'},tr=(id,trade,from)=>row(id,'edit-marker',{name:'Bank',category:'Tradeskill',trade,from:{name:'Bank',...from}});
 const t3=buildChanges({...fixture([]),markers:[trade],rows:[tr(1,'Fishing',{category:'Tradeskill'}),tr(2,'Cooking',{category:'Tradeskill'})]}).get('marker:bank');assert.deepEqual(plain(t3.rows[1].conflictsWith),[1]);assert.equal(t3.effective.trade,'Fishing');
}
// A refused rename never supplies the base for another rename, and additions leave live places alone.
{
 const t=buildChanges(fixture([edit(1,'First'),edit(2,'Second'),edit(3,'Third','Second'),edit(4,'Fourth','First')])).get('marker:bank');assert.deepEqual(plain(t.rows.map(r=>r.conflictsWith)),[[],[1],[1],[]]);assert.equal(t.effective.name,'Fourth');assert.equal(t.proposed.name,'Fourth');
 const add=row(10,'new-marker',{name:'Old camp',category:'Bank',x:1.3,y:2.7}),id='community-10';
 const t2=buildChanges({...fixture([add]),markers:[{id,name:'Live camp',category:'Inn'}],publishedPositions:new Map([[id,[4,5]]])}).get('marker:'+id);assert.equal(t2.effective.name,'Live camp');assert.equal(t2.effective.category,'Inn');assert.equal(t2.effective.x,4);
 const rounded=buildChanges(fixture([move(1,[10.4,19.6],[30.4,40.6]),move(2,[30.3,40.7],[50.2,60.8])])).get('marker:bank');assert.deepEqual([rounded.effective.x,rounded.effective.y],[50,61]);assert(rounded.rows.every(r=>!r.conflictsWith.length));
}
// The caller may normalise valid rows or exclude invalid rows before the ledger chains them.
{
 const seen=[],t=buildChanges({...fixture([edit(1,'  First  '),edit(2,'Invalid'),edit(3,'Third','First')]),normalise:r=>{seen.push(r.id);if(r.id===2)return null;r.payload.name=r.payload.name.trim();return r;}}).get('marker:bank');assert.deepEqual(seen,[1,2,3]);assert.equal(t.effective.name,'Third');assert.equal(t.rows.length,2);assert(t.rows.every(r=>!r.conflictsWith.length));
 const sameId=buildChanges({...fixture([row(1,'edit-label',{name:'Great bank',remove:true,from:{name:'Hall'}},{target_id:'bank'}),edit(2,'Bay bank')]),labels:[{...label,id:'bank'}],publishedLabelPositions:new Map([['bank',[3,4]]])});assert(sameId.get('label:bank').effective.removed);assert.equal(sameId.get('marker:bank').effective.name,'Bay bank');assert(!sameId.forRow(2).rows[0].conflictsWith.length);
}
for(const [a,b] of [['',''],['Old hall','New hall'],['Same  words','Same words!'],['','Hello'],['Gone','']]){
 const diff=diffWords(a,b);assert.equal(diff.filter(r=>r.op!=='ins').map(r=>r.text).join(''),a);assert.equal(diff.filter(r=>r.op!=='del').map(r=>r.text).join(''),b);assert(diff.every(r=>['same','del','ins'].includes(r.op)));
}
const browser=vm.createContext({window:{}});vm.runInContext(await readFile(new URL('../marker-schema.js',import.meta.url),'utf8'),browser);vm.runInContext(await readFile(new URL('../changes.js',import.meta.url),'utf8'),browser);assert(browser.window.atlasChanges);
const page=await readFile(new URL('../index.html',import.meta.url),'utf8');for(const script of ['changes.js','review-model.js','review-desk.js','notices.js'])assert(page.indexOf('src="'+script)<page.indexOf('src="community.js'),script+' loads before community');
{
 const r=row(600,'edit-marker',{name:'Moved bank',x:30,y:40,from:{...marker,x:10,y:20}}),t=buildChanges(fixture([r])).forRow(600);assert(fieldsOf(r).has('position'));assert.equal(t.effective.x,30);assert.equal(t.effective.name,'Moved bank');assert(!Object.hasOwn(t.effective,'approximate'));const stale=row(601,'move-marker',{name:'Bank',from:[10,20],to:[50,60]});assert.deepEqual([...buildChanges(fixture([r,stale])).forRow(601).rows[1].conflictsWith],[600]);
}
{
 const from={...marker,category:'Vendor',vendor:'Baker',sells:['Food & drink'],travel:'Lift',arrow:'up',toMap:'other',toPlace:'dock',minZoom:2,approximate:true};
 const payload={name:from.name,from,travel:'Bridge',arrow:'down',toMap:null,toPlace:null,toLevel:'upper',toMarker:'stairs',direction:'up',switchOnClick:true,level:'upper',minZoom:3,approximate:false};
 const r=row(400,'edit-marker',payload),set=buildChanges({...fixture([r]),markers:[from]}),t=set.forRow(400);
 for(const k of ['travel','arrow','toMap','toPlace','toLevel','toMarker','direction','switchOnClick','level','minZoom','approximate'])assert(fieldsOf(r).has(k),k);
 assert.equal(t.effective.travel,'Bridge');assert.equal(t.effective.toMap,undefined);assert.equal(t.effective.toMarker,'stairs');assert.equal(nextFrom(t,'edit-marker').vendor,'Baker');assert.deepEqual(plain(nextFrom(t,'edit-marker').sells),['Food & drink']);
 const blank=buildChanges({...fixture([]),markers:[{...marker,category:'Vendor'}]}).get('marker:bank');assert.equal(nextFrom(blank,'edit-marker').vendor,null);assert.equal(nextFrom(blank,'edit-marker').sells,null);
 const labelRow=row(401,'edit-label',{name:'Hall',kind:'exit',travel:'Ladder',arrow:'down',toMap:'other',toPlace:'gate',tier:'major',priority:100,minZoom:1,approximate:false,from:{name:'Hall',kind:'building'}},{target_id:'hall'});
 const place=buildChanges(fixture([labelRow])).forRow(401);assert.equal(place.effective.kind,'exit');assert.equal(place.effective.arrow,'down');assert.equal(place.effective.priority,100);
 const chipRow=row(402,'edit-marker',{name:'Tutor',building:'East guild',from:{name:'Tutor',building:'Tutor'}},{target_id:'trainer'});assert.equal(buildChanges(fixture([chipRow])).forRow(402).effective.building,'East guild');
 const split=buildChanges(fixture([edit(403,'Waiting','Bank',{status:'pending'}),edit(404,'Approved')]));assert.equal(split.get('marker:bank').effective.name,'Approved','A waiting conflict cannot hide an approved change');assert.equal(split.get('marker:bank').proposed.name,'Waiting');
}
// R17: moving a mark does not change how certain its position is.
{
 const live={...marker,approximate:true},input={...fixture([move(700,[10,20],[30,40])]),markers:[live]};assert.equal(buildChanges(input).forRow(700).effective.approximate,true);input.rows[0].payload.approximate=false;assert.equal(buildChanges(input).forRow(700).effective.approximate,false);
 input.rows=[row(701,'edit-marker',{name:'Bank',x:30,y:40,from:{name:'Bank',x:10,y:20}})];assert.equal(buildChanges(input).forRow(701).effective.approximate,true);
}
console.log('Change ledger checks passed: published positions, composition, conflicts, removals, shared places, labels, chips, floors, history, credits, word diffs, R17 approximate moves and pure inputs.');

// Levels and mobs compose independently, and stale changes conflict only on their own field.
{
 const mobs=[{name:'Goblin',wikiId:'npc-goblin',wiki:'https://monstersandmemories.wiki/npcs/goblin'}],camp={...marker,category:'Mob camp',levels:[11,15],mobs};
 const a=row(701,'edit-marker',{name:camp.name,levels:[12,16],from:camp}),b=row(702,'edit-marker',{name:camp.name,mobs:[],from:camp}),d=row(703,'edit-marker',{name:camp.name,levels:[13,17],from:camp});
 assert.deepEqual(fields(a),['levels']);assert.deepEqual(fields(b),['mobs']);const t=buildChanges({...fixture([]),markers:[camp],rows:[a,b,d]}).forRow(701);assert.deepEqual(plain(t.rows.map(r=>r.conflictsWith)),[[],[],[701]]);assert.deepEqual(plain(t.effective.levels),[12,16]);assert(!Object.hasOwn(t.effective,'mobs'));
 const fresh=row(704,'edit-marker',{name:camp.name,levels:[20,null],from:{name:camp.name,levels:null}});assert(context.atlasChanges.matchesFrom(fresh,{name:camp.name},'levels'));
 const switched=context.atlasChanges.applyTo(camp,row(705,'edit-marker',{name:camp.name,category:'Vendor',from:camp}));assert(!Object.hasOwn(switched,'mobs')&&!Object.hasOwn(switched,'levels'));
 console.log('Camp conflict checks passed: independent fields, stale levels, blank bases and changing type.');
}
{
 const named={...marker,category:'Named mob',levels:[8,8]},a=row(710,'edit-marker',{name:named.name,levels:[9,9],from:named}),b=row(711,'edit-marker',{name:'Captain',from:named}),d=row(712,'edit-marker',{name:named.name,levels:[10,10],from:named});
 const t=buildChanges({...fixture([]),markers:[named],rows:[a,b,d]}).forRow(710);assert.deepEqual(fields(a),['levels']);assert.deepEqual(plain(t.effective.levels),[9,9]);assert.equal(t.effective.name,'Captain');assert.deepEqual(plain(t.rows.map(r=>r.conflictsWith)),[[],[],[710]]);
 const apply=p=>context.atlasChanges.applyTo(named,row(713,'edit-marker',{name:named.name,...p,from:named}));for(const levels of [[8,9],[8,null],[0,0],[100,100],[1.5,1.5],[8],'8'])assert.throws(()=>apply({levels}),/level from 1 to 99/);
 assert(!Object.hasOwn(apply({category:'Bank'}),'levels'));assert(!Object.hasOwn(apply({levels:null}),'levels'));assert.deepEqual(plain(context.atlasChanges.applyTo({},row(714,'new-marker',{name:'Captain',category:'Named mob',levels:[99,99],x:10,y:20})).levels),[99,99]);
 console.log('Named mob ledger checks passed: fixed levels, independent edits, conflicts, validation and clearing.');
}

{
 const C=context.atlasChanges,plain=v=>JSON.parse(JSON.stringify(v)),fish=[{name:'Thorn Sturgeon'}],base={id:'water',name:'Fishing',category:'Fishing spot',fish},edit={id:1200,kind:'edit-marker',payload:{name:base.name,fish:[{name:'Basa'}],from:base}};
 assert.deepEqual([...C.fieldsOf(edit)],['fish']);assert(C.matchesFrom(edit,base,'fish'));assert.deepEqual(plain(C.applyTo(base,edit).fish),[{name:'Basa'}]);assert.deepEqual(plain(C.conflicts(edit,C.applyTo(base,edit),[{id:1200,fields:C.fieldsOf(edit)}])),[1200]);
 const switched=C.applyTo(base,{kind:'edit-marker',payload:{name:base.name,category:'Vendor',from:base}});assert(!Object.hasOwn(switched,'fish'));
 const passage={name:'Tunnel',category:'Passage',way:'Tunnel',oneWay:true,direction:'east',toLevel:'lower'},row={kind:'edit-marker',payload:{name:'Tunnel',way:'Swim',oneWay:false,from:passage}},next=C.applyTo(passage,row);assert.deepEqual([...C.fieldsOf(row)],['way','oneWay']);assert.equal(next.way,'Swim');assert.equal(next.oneWay,false);assert.equal(next.toLevel,'lower');
 const other=C.applyTo(passage,{kind:'edit-marker',payload:{name:'Tunnel',category:'Bank',from:passage}});assert(!Object.hasOwn(other,'way')&&!Object.hasOwn(other,'oneWay'));
 console.log('Fishing and Passage ledger checks passed: field diffs, conflicts, floor links and type cleanup.');
}
