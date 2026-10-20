// Field rules shared by notes, review previews and publication.
(function(root){
 'use strict';
 const copy=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v)),has=(v,k)=>Object.hasOwn(v||{},k),clear=v=>v===null||v===''||Array.isArray(v)&&!v.length;
 const privateCategories=['Personal','Ore','Wood','Herbs','Camping spot'],publicCategory=c=>typeof c==='string'&&!!c&&!privateCategories.includes(c);
 const questCategories=['Class trainer','Tradeskill','Vendor','Notable NPC','Named mob','Guild'],givesQuests=m=>m?.quests===true&&!m.noteType&&questCategories.includes(m.category);
 const typeKeys=['category','trade','classes','vendor','sells'],rosterKeys=['levels','mobs','fish','way','oneWay','ambush','quests'];
 const categoryFields={Tradeskill:['trade'],'Class trainer':['classes'],Vendor:['vendor','sells'],'Mob camp':['levels','mobs'],Ambush:['levels','mobs'],'Named mob':['levels','ambush'],'Fishing spot':['fish'],Passage:['way','oneWay']};
 for(const c of questCategories)(categoryFields[c]||=[]).push('quests');
 const typedKeys=[...typeKeys.slice(1),...rosterKeys],travelKeys=['travel','arrow','toMap','toPlace','toLevel','toMarker','direction','switchOnClick'];
 const travelKinds=['Exit','Lift','Stairs','Ladder','Bridge','Teleporter'],arrowChoices=['','up','down','updown','north','northeast','east','southeast','south','southwest','west','northwest'];
 const displayKeys=['minZoom','approximate','tier','priority'],extraKeys=['shape','noteType',...travelKeys,'level','minZoom','approximate','color','wiki','wikiId',...typedKeys];
 const editKeys=['name','note','color','level','kind',...travelKeys,...displayKeys,'building',...rosterKeys,'shape'];
 const knownLabelKeys=['linkedArea','alignmentHelper','route','timesSource','passes'];
 const publicKeys=[...knownLabelKeys,'name','note','wiki','wikiId',...typeKeys,...editKeys.filter(k=>!['name','note'].includes(k)),'x','y'];
 const metaKeys=['from','to','fromShape','remove','reason','bounty','noteType','travelArrow','labelPriority'];
 const followKeys=publicKeys.filter(k=>![...knownLabelKeys,'name','note','wiki','wikiId','x','y','shape'].includes(k));
 const commonKeys=['name','note','x','y','level','minZoom','approximate'],markerKeys=[...commonKeys,'category','color','wiki','wikiId','shape',...travelKeys],labelKeys=[...commonKeys,'kind','tier','priority',...knownLabelKeys],chipKeys=[...commonKeys,'classes','building'];
 const fields={marker:markerKeys,label:labelKeys,exit:[...labelKeys,...travelKeys],chip:chipKeys,...Object.fromEntries(Object.entries(categoryFields).map(([c,keys])=>[c,[...markerKeys,...keys,...(c==='Class trainer'?['building']:[])]]))};
 const categoriesFor=k=>Object.keys(categoryFields).filter(c=>categoryFields[c].includes(k));
 const fieldsFor=c=>categoryFields[c]||[],keysFor=p=>['category',...(p.category===undefined?typeKeys.slice(1):fieldsFor(p.category).filter(k=>typeKeys.includes(k)))];
 const fieldCategory=(k,c)=>fieldsFor(c).includes(k),shapes=()=>root.atlasShapes||root.window?.atlasShapes;
 const clean=(value,multiline=false)=>{const t=String(value??'').normalize('NFC').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff<>]/g,'');return multiline?t.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim():t.replace(/\s+/g,' ').trim();};
 const arrows=()=>arrowChoices.slice(1);
 const validators={name:v=>typeof v==='string'&&!!clean(v)&&v.length<=100,note:v=>typeof v==='string'&&v.length<=2000,building:v=>typeof v==='string'&&v.length<=100,
  category:v=>publicCategory(v),trade:v=>typeof v==='string'&&(typeof tradePaths!=='object'||has(tradePaths,v)),classes:v=>classesOk(v),vendor:v=>typeof v==='string'&&vendorKindOk(v),sells:v=>sellsOk(v),
  levels:(v,c)=>levelsOk(v,c),mobs:v=>Array.isArray(v)&&v.length<=12&&v.every(m=>m&&typeof m==='object'&&!Array.isArray(m)&&Object.keys(m).every(k=>['name','wikiId','wiki'].includes(k))&&typeof m.name==='string'&&!!m.name.trim()&&m.name.length<=100&&(!has(m,'wikiId')||typeof m.wikiId==='string'&&!!wikiIdOf(m.wikiId))&&(!has(m,'wiki')||typeof m.wiki==='string'&&!!wikiAddress(m.wiki)))&&new Set(v.map(m=>m.name.trim().toLocaleLowerCase())).size===v.length&&new Set(v.filter(m=>m.wikiId).map(m=>m.wikiId)).size===v.filter(m=>m.wikiId).length,fish:v=>fishOk(v),way:v=>wayOk(v),oneWay:v=>typeof v==='boolean',ambush:v=>typeof v==='boolean',quests:v=>typeof v==='boolean',
  wiki:v=>typeof v==='string'&&wikiAddress(v)!==null,wikiId:v=>typeof v==='string'&&wikiIdOf(v)!==null,shape:v=>{shapes().validate(v);return true;},
  arrow:v=>arrows().includes(v),direction:v=>arrows().includes(v),travel:v=>travelKinds.includes(v),kind:v=>['region','zone','district','building','exit'].includes(v),
  tier:v=>['major','minor','building','exit'].includes(v),minZoom:v=>Number.isFinite(v)&&v>=-5&&v<=10,priority:v=>typeof v==='boolean'||Number.isFinite(v)&&v>=0&&v<=1000,
  approximate:v=>typeof v==='boolean',switchOnClick:v=>typeof v==='boolean',color:v=>typeof v==='string'&&(typeof pinColours!=='object'||Object.values(pinColours).includes(v)),
  level:v=>typeof v==='string',toMap:v=>typeof v==='string',toPlace:v=>typeof v==='string'&&v.length<=100,toLevel:v=>typeof v==='string',toMarker:v=>typeof v==='string'&&v.length<=100,x:Number.isFinite,y:Number.isFinite};
 const refuse=message=>{const error=Error(message);error.name='MarkerFieldError';throw error;};
 function validate(p,{label=false,category=p.category??p.from?.category}={}){
  for(const k of Object.keys(p))if(!publicKeys.includes(k)&&!metaKeys.includes(k))refuse('unknown field '+k);
  if(!label&&has(p,'category')&&!publicCategory(p.category))refuse('Private marker types cannot be published.');
  for(const [k,v] of Object.entries(p)){if(clear(v)||v===undefined||metaKeys.includes(k)||label&&k==='category')continue;
   if(rosterKeys.includes(k)&&(label||category!==undefined&&!fieldCategory(k,category)))refuse('Unsupported '+k+'.');
   if(validators[k]&&!validators[k](v,category))refuse(k==='levels'?'Choose a level from 1 to 99.':({wiki:'Unsupported wiki link',wikiId:'Invalid wiki id',vendor:'Unsupported vendor kind',sells:'Unsupported Sells tags'}[k]||'Unsupported '+k)+'.');
  }
 }
 const sources={wikiId:['wiki'],toMap:['destination'],toLevel:['destination'],toPlace:['destination','arrival'],toMarker:['destination','arrival'],direction:['arrow'],tier:['size'],priority:['size'],switchOnClick:['destination','switchOnClick'],...Object.fromEntries(typedKeys.map(k=>[k,['category',k]]))};
 function extras(m){
  const out={},label=m.noteType==='label',exit=m.noteType==='exit';
  for(const k of extraKeys){const v=m[k];if(v===undefined||clear(v))continue;if(k==='shape'&&(label||exit)||travelKeys.includes(k)&&label||typedKeys.includes(k)&&(label||exit||!fieldCategory(k,m.category))||['color','wiki','wikiId'].includes(k)&&(label||exit)||k==='wikiId'&&!m.wiki)continue;
   out[k]=copy(k==='vendor'?vendorKindNow(v):k==='sells'?[...v].sort((a,b)=>sellTypes.indexOf(a)-sellTypes.indexOf(b)):v);
  }return out;
 }
 function apply(published,row){try{
  row=typeof normaliseChange==='function'?normaliseChange(copy(row)):copy(row);const p=row.payload||{},added=row.kind==='new-marker',label=row.kind.endsWith('label')&&!published?.category||added&&['label','exit'].includes(p.noteType);
  validate(p,{label,category:p.category??published?.category??p.from?.category});
  if(added&&(!validators.name(p.name)||![p.x,p.y].every(Number.isFinite)||!label&&!publicCategory(p.category)))refuse('Invalid marker fields.');
  const fields=(root.atlasChanges||root.window?.atlasChanges).fieldsOf(row),out=added?{}:copy(published)||{},was=published?.category;
  if(added){Object.assign(out,{id:'community-'+row.id,community:true,name:p.name,note:p.note||'',x:Math.round(p.x),y:Math.round(p.y),...((p.level||row.level)?{level:p.level||row.level}:{})});if(label)Object.assign(out,{kind:p.kind||(p.noteType==='exit'?'exit':'building'),priority:typeof p.priority==='number'?p.priority:50,minZoom:0});else out.category=p.category;}
  const put=k=>{if(!has(p,k))return;const v=p[k];if(k==='note'&&clear(v))out[k]='';else if(clear(v))delete out[k];else out[k]=copy(v);};
  if(fields.has('removed')){out.removed=true;return out;}
  if(added){for(const k of publicKeys)if(!['x','y','category','priority'].includes(k)&&!(label&&['shape','wiki','wikiId','color'].includes(k)))put(k);if(!out.note)out.note='';}
  else{
   for(const f of fields){if(f==='position'){const at=row.kind.startsWith('move-')?p.to:[p.x,p.y];if(!Array.isArray(at)||at.length!==2||!at.every(Number.isFinite))throw Error('The suggested position is missing or invalid');if(out.shape&&!fields.has('shape'))out.shape=shapes().translate(out.shape,Math.round(at[0])-out.x,Math.round(at[1])-out.y);[out.x,out.y]=at.map(Math.round);if(has(p,'approximate'))put('approximate');}
    else if(f==='type')for(const k of keysFor(p))put(k);
    else if(f==='wiki'){if(has(p,'wiki')&&p.wiki!==out.wiki&&!has(p,'wikiId'))delete out.wikiId;put('wiki');put('wikiId');}
    else put(f);
   }
  }
  for(const k of typedKeys)if(!fieldCategory(k,out.category))delete out[k];
  if(was==='Passage'&&out.category!=='Passage')delete out.direction;
  if(label){delete out.category;if(out.kind!=='exit')for(const k of travelKeys)if(added||fields.has(k))delete out[k];}
  if(Array.isArray(out.classes))out.classes=out.classes.map(c=>c==='Shadowknight'?'Shadow Knight':c);
  if(!out.wiki){delete out.wiki;delete out.wikiId;}
  if(out.shape){out.shape=shapes().validate(out.shape);[out.x,out.y]=shapes().anchor(out.shape);}
  if(out.category==='Named mob'&&out.levels!=null&&!levelsOk(out.levels,out.category))throw Error('Choose a level from 1 to 99.');
  if(fields.size)out.community=true;return out;
 }catch(error){return {refusal:error.message,name:error.name};}}
 const schema={knownLabelKeys,fields,categoriesFor,followKeys,travelKinds,arrowChoices,typeKeys,rosterKeys,typedKeys,travelKeys,displayKeys,extraKeys,editKeys,publicKeys,privateCategories,publicCategory,categoryFields,fieldsFor,keysFor,fieldCategory,validators,validate,clear,clean,sources,extras,apply,questCategories,givesQuests};
 root.atlasMarkerSchema=schema;if(root.window)root.window.atlasMarkerSchema=schema;
})(globalThis);
