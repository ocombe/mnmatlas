// Offline checks for scripts/wiki-reconcile.mjs: name matching, the plan and applying approved rows.
import assert from 'node:assert/strict';
import {query,match,inZone,plan,applyRows} from './wiki-reconcile.mjs';

const npc=(name,zone='Underdocks',slug=name.toLowerCase().replace(/\W+/g,'-'))=>({id:'npc-'+slug,name,zone,url:'https://monstersandmemories.wiki/npcs/'+slug});
assert.equal(query('Bank — north-east quay'),'Bank');assert.equal(query('Cleric / Shadowknight trainers'),'Cleric');assert.equal(query('A baker (Night Market)'),'A baker');
assert.equal(match('Bag merchant',[npc('A bag merchant')]).kind,'exact','A leading article does not matter');
assert.equal(match('Marshall Harding',[npc('Marshal Harding')]).kind,'close','A letter off is close, not exact');
assert.equal(match('Quartermaster',[npc('Quartermaster Bren')]).kind,'none','A longer name is someone else');assert.equal(match('Undead (levels 31–40)',[npc('An undead rat')]).kind,'none');
assert.deepEqual([match('Crystallized skeletons (levels 35–39)',[npc('A crystallized skeleton')]).kind,match('Crystallized skeletons',[npc('A crystallized skeleton')]).plural],['close',true],'A camp named after its mob, in the plural, is close');
assert.equal(match('Library',[npc('A librarian')]).kind,'none');
assert.equal(match('A baker',[npc('A baker',undefined,'a-baker-1'),npc('A baker',undefined,'a-baker-2')]).kind,'ambiguous','Two equal answers need a choice');
assert(inZone({zone:'Faelindral, Night Harbor'},'Night Harbor'));assert(inZone({zone:"Keeper's Bight"},'Keeper’s Bight'));assert(!inZone({zone:'Night Harbor Sewers'},'Night Harbor'));

const c={id:'underdocks',title:'Underdocks',markersFile:'m.json',labelsFile:'l.json',extraCategories:{'Notable NPC':['●','#2388aa']}};
const markers=[{id:'bag',name:'Bag merchant',category:'Vendor',x:1,y:2},{id:'lift',name:'Lift 1',category:'Lift',x:0,y:0},{id:'marsh',name:'Marshall Harding',category:'Notable NPC',x:3,y:4}];
const labels={labels:[{id:'pay',name:'Paymaster Elara Venn',kind:'building',x:5,y:6,level:'lower',note:'1st floor.',community:true},{id:'bath',name:'Bath house',kind:'building',x:7,y:8},{id:'out',name:'to the city',kind:'exit',x:9,y:9}]};
const answers=new Map([['Bag merchant',[npc('A bag merchant'),npc('A bag merchant','Night Harbor','nh-bag')]],['Marshall Harding',[npc('Marshal Harding')]],['Paymaster Elara Venn',[npc('Paymaster Elara Venn')]],['Bath house',[]]]);
const p=plan(c,{markers:markers.map(m=>({path:'m.json',m})),labels:labels.labels.map(l=>({path:'l.json',l}))},answers);
assert.deepEqual(p.rows.map(r=>[r.id,r.match,r.approve]),[['bag','exact',true],['marsh','close',false],['pay','exact',true],['bath','none',false]],'Lifts and exits are left out; only exact matches are pre-approved; other zones do not count');
assert.equal(p.rows[0].wikiName,'A bag merchant');assert.equal(p.rows[0].newName,'A bag merchant');assert.equal(p.rows[2].toCategory,'Notable NPC');

// A rename fixes only the name part, and a camp keeps its own name while it gains the link.
{const q=plan(c,{markers:[{path:'m.json',m:{id:'baron',name:'Baron Bigtant (level 20)',category:'Named mob'}},{path:'m.json',m:{id:'camp',name:'Shard bats (levels 33–35)',category:'Mob camp'}}],labels:[]},new Map([['Baron Bigtant',[npc('Baron Bigtent')]],['Shard bats',[npc('A shard bat')]]]));
 assert.deepEqual(q.rows.map(r=>[r.match,r.newName]),[['close','Baron Bigtent (level 20)'],['close','Shard bats (levels 33–35)']]);}
// A trainer named after a class does not match a mob of that class; a named trainer does.
{const q=plan(c,{markers:[{path:'m.json',m:{id:'t1',name:'Necromancer / Shadow Knight — Concourse',category:'Class trainer'}},{path:'m.json',m:{id:'t2',name:'Nurvol Cereveth',category:'Class trainer'}}],labels:[]},new Map([['Necromancer',[npc('A necromancer')]],['Nurvol Cereveth',[npc('Nurvol Cereveth')]]]));
 assert.deepEqual(q.rows.map(r=>r.match),['none','exact']);}
const files=new Map([['m.json',structuredClone(markers)],['l.json',structuredClone(labels)]]);for(const r of p.rows)if(r.source==='label')r.markersPath='m.json';
p.rows[1].approve=true;const done=applyRows(p.rows,files);
assert.deepEqual(done,['linked bag','linked marsh','made marker pay']);
const out=files.get('m.json');assert.equal(out.find(m=>m.id==='bag').name,'A bag merchant');assert.equal(out.find(m=>m.id==='marsh').wikiId,'npc-marshal-harding');
assert.deepEqual(out.find(m=>m.id==='pay'),{id:'pay',name:'Paymaster Elara Venn',category:'Notable NPC',x:5,y:6,note:'1st floor.',level:'lower',community:true,wiki:'https://monstersandmemories.wiki/npcs/paymaster-elara-venn',wikiId:'npc-paymaster-elara-venn'});
assert(!files.get('l.json').labels.some(l=>l.id==='pay'),'The place name is gone once it is a marker');
console.log('Wiki reconcile checks passed: name matching, zones, plan, approvals and applying.');
