/* Wiki links on markers. A marker keeps one address; the sites below say which addresses are accepted,
   and the embedding sites below say what a marker's link becomes when the atlas is shown on their pages.
   Also the marker vocabulary the site, its suggestions and the publishing job share: vendor kinds, trainer classes,
   and which optional fields each kind of marker keeps (markerExtras). */
'use strict';
// Sites a marker may link to. A link to any other address is refused when it is saved and never shown.
const wikiSites={
 // home and credit: the wiki's front page and the credit its data must carry wherever it is shown (search results).
 'mnm-wiki':{name:'Monsters and Memories Wiki',hosts:['monstersandmemories.wiki'],home:'https://monstersandmemories.wiki/',credit:'Data from the Monsters and Memories Wiki'},
 'old-wiki':{name:'the old community wiki',hosts:['monstersandmemories.miraheze.org']},
 'monme':{name:'Petrichor’s database',hosts:['monme.no']},
};
// Sites that embed the atlas, by host. links: 'all' shows every link, 'own' only links to the site itself,
// 'none' no links. adapt(href,siteId,place) may turn another site's link into an address on the embedding site
// (for example once a wiki can look a page up by name); returning nothing hides the link.
// An embed on a host not listed here shows no links, so the atlas never sends a site's readers to another wiki.
const wikiEmbedHosts={
 'monstersandmemories.wiki':{site:'mnm-wiki',links:'own'},
 'monstersandmemories.miraheze.org':{site:'old-wiki',links:'own'},
 'monme.no':{site:'monme',links:'own'},
};
const wikiHostMatches=(hostname,host)=>hostname===host||hostname.endsWith('.'+host);
function wikiSiteOf(hostname){return Object.keys(wikiSites).find(id=>wikiSites[id].hosts.some(h=>wikiHostMatches(hostname,h)))||null;}
// The stored form of a link: an https address on a known site, or '' for no link; null when it is not accepted.
function wikiAddress(value){
 if(value===undefined||value===null)return '';if(typeof value!=='string')return null;
 const raw=value.trim();if(!raw)return '';if(raw.length>300||/\s/.test(raw))return null;
 let url;try{url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw)?raw:'https://'+raw);}catch{return null;}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)return null;
 url.protocol='https:';url.hostname=url.hostname.replace(/\.$/,'');
 return wikiSiteOf(url.hostname)&&url.href.length<=300?url.href:null;
}
// Where this page is shown: on the atlas itself (null), or inside another site's page (its host, '' when unknown).
function wikiEmbedParent(){
 let top=true;try{top=window.self===window.top;}catch{top=false;}if(top)return null;
 let origin='';try{origin=location.ancestorOrigins?.[0]||(document.referrer?new URL(document.referrer).origin:'');}catch{origin='';}
 try{const parent=new URL(origin);return parent.origin===location.origin?null:parent.hostname;}catch{return '';}
}
// The rule of the site embedding this page (by its host); null for a site not listed.
function embedRule(parent){const host=Object.keys(wikiEmbedHosts).find(h=>wikiHostMatches(parent,h));return host?wikiEmbedHosts[host]:null;}
// The link a place shows here, as {href,site,name}, or null when it has none or this embed hides it.
function wikiLinkFor(place,parent=wikiEmbedParent()){
 const href=wikiAddress(place?.wiki);if(!href)return null;
 const site=wikiSiteOf(new URL(href).hostname),show=h=>{const s=wikiSiteOf(new URL(h).hostname);return s?{href:h,site:s,name:wikiSites[s].name}:null;};
 if(parent===null)return show(href);
 const rule=embedRule(parent);
 if(!rule||rule.links==='none')return null;
 if(rule.links==='all'||site===rule.site)return show(href);
 const adapted=typeof rule.adapt==='function'?wikiAddress(rule.adapt(href,site,place)):'';
 return adapted&&wikiSiteOf(new URL(adapted).hostname)===rule.site?show(adapted):null;
}
// What a vendor sells, from the merchants the Monsters and Memories Wiki lists, in groups. Shady merchants and stables
// have their own marker types. Each kind lists the words that name it ("A bag merchant", "a pelt trader").
const vendorKinds={
 'Food and drink':{Baker:['baker'],Barkeep:['barkeep','bartender'],Brewer:['brewer','brewing'],Butcher:['butcher'],Cook:['cook','chef'],Fishmonger:['fishwife','fisherman','fish merchant'],'Grain seller':['grain seller','grain'],Grocer:['grocer'],Innkeeper:['innkeeper'],'Produce vendor':['produce'],'Spice merchant':['spicemonger','spice']},
 'Arms and armour':{'Plate armorer':['plate armorer','plate armor'],'Chain armorer':['chain armorer','chain armor'],'Cloth armorer':['cloth armorer','cloth armor'],'Used armor trader':['used armor'],'Used weapons dealer':['used weapons'],Weaponsmith:['weaponsmith','weapon merchant','weapons'],Bowyer:['bowyer','archery'],Fletcher:['fletcher','fletching'],Quartermaster:['quartermaster'],'Scrap dealer':['scrap dealer','rusty weapons']},
 'Trade supplies':{'Alchemy supplies':['alchemist','alchemy','apothecary'],'Blacksmithing supplies':['blacksmith','blacksmithing'],'Dye merchant':['dye'],'Fishing supplies':['fishing'],'Herbalism supplies':['herbalist','herbalism'],'Jewelcrafting supplies':['jewelcrafter','jewelcrafting'],'Leatherworking supplies':['leatherworker','leatherworking','pelt trader'],'Lumberjack supplies':['lumberjack','woodworker'],'Mining supplies':['miner','mining'],'Smelting supplies':['smelter','smelting'],'Spinning supplies':['spinner','spinning'],'Spycraft supplies':['spymaster','spycraft'],'Stone cutting supplies':['stonecutter','stone cutting','mason'],'Survival supplies':['survivalist','outdoorsman','wilderness'],'Tailoring supplies':['tailor','tailoring'],'Tanning supplies':['tanner','tanning'],'Tinkering supplies':['tinkerer','tinkering'],Cobbler:['cobbler']},
 'Spells and reagents':{'Reagent vendor':['reagent'],'Spell scribe':['scribe','spell vendor','spells vendor'],'Poison maker':['poison'],Enchanter:['enchanter']},
 'General goods':{'General goods':['goods merchant','general goods','supplies vendor','supplier'],'Bag merchant':['bag merchant','bags'],'Adventuring supplies':['adventure gear','adventuring','outfitter'],'Traveling merchant':['merchant traveler','traveling merchant'],'Instrument merchant':['instrument'],'Property merchant':['property','housing','realtor'],Medic:['medic']},
};
const vendorKindList=Object.values(vendorKinds).flatMap(g=>Object.keys(g));
const vendorGroupOf=kind=>Object.keys(vendorKinds).find(g=>Object.hasOwn(vendorKinds[g],kind))||'';
const vendorKindOk=v=>v===undefined||vendorKindList.includes(v);
const vendorWords=kind=>{const g=vendorGroupOf(kind);return g?[kind,g,...vendorKinds[g][kind]].join(' '):'';};
// The kind a vendor's name or note names, the longest words first ("used weapons" before "weapon"); '' if none.
const vendorForms=Object.values(vendorKinds).flatMap(g=>Object.entries(g).flatMap(([kind,forms])=>forms.map(f=>[f,kind]))).sort((a,b)=>b[0].length-a[0].length);
function vendorKindNamed(words){
 const said=' '+String(words??'').toLowerCase().replace(/[^a-z]+/g,' ')+' ';
 return vendorForms.find(([f])=>said.includes(' '+f+' ')||said.includes(' '+f+'s '))?.[1]||'';
}
// The trade a name or note names ("an enchanting trainer" -> "(Dis)Enchanting"), from the atlas's trade list; '' if none.
function tradeNamed(words,trades){
 const said=' '+String(words??'').toLowerCase().replace(/[^a-z]+/g,' ')+' ';
 for(const trade of trades){const forms=trade.toLowerCase().replace(/\((dis)\)/,'$1|').split(/\s*\/\s*/).flatMap(f=>f.includes('|')?[f.replace('|',''),f.split('|')[1]]:[f]);
  if(forms.some(f=>f&&said.includes(' '+f.replace(/[^a-z]+/g,' ').trim()+' ')))return trade;}
 return '';
}
// Whether this page may send readers to a wiki site at all: always on the atlas itself; inside another site only when
// its rule shows every link or that wiki is its own (as wikiLinkFor decides for one link). Features built on a wiki
// (the Wanted board, the Name field's wiki suggestions) only appear where that wiki may be linked.
function wikiSiteShown(site,parent=wikiEmbedParent()){
 if(parent===null)return true;
 const rule=embedRule(parent);
 return !!rule&&rule.links!=='none'&&(rule.links==='all'||rule.site===site);
}
const wikiHint='A wiki link must be a page on '+Object.values(wikiSites).map(s=>s.name).join(', ').replace(/, ([^,]*)$/,' or $1')+'.';
// A link picked from the wiki search also keeps the wiki's id for that entry (the wiki asks partners to store ids,
// not copies of its text). The id is a short plain string; '' for none, null when it is not accepted.
function wikiIdOf(value){
 if(value===undefined||value===null||value==='')return '';
 return typeof value==='string'&&value.length<=160&&value.trim()===value&&!/[\u0000-\u001f\u007f<>]/.test(value)?value:null;
}
// The id rides on the address field with the address it was picked for, so typing another address or clearing it drops the id.
function setWikiPick(input,href,id){input.dataset.wikiUrl=wikiAddress(href)||'';input.dataset.wikiId=wikiIdOf(id)||'';}
function wikiIdFor(input,href){return href&&input.dataset.wikiUrl===href?input.dataset.wikiId||'':'';}
// The classes the atlas's trainers teach (as on the class chips: ARC, BRD, BST, CLR, DRU, ELE, ENC, FTR, INQ, MNK, NEC,
// PAL, RNG, ROG, SHD, SHM, SPB, WIZ).
const classAbbreviations={Archer:'ARC',Bard:'BRD',Beastlord:'BST',Beastmaster:'BST',Cleric:'CLR',Druid:'DRU',Elementalist:'ELE',Enchanter:'ENC',Fighter:'FTR',Inquisitor:'INQ',Monk:'MNK',Necromancer:'NEC',Paladin:'PAL',Ranger:'RNG',Rogue:'ROG','Shadow Knight':'SHD',Shaman:'SHM',Spellblade:'SPB',Wizard:'WIZ'};
const atlasClasses=Object.keys(classAbbreviations);
const classesOk=v=>v===undefined||Array.isArray(v)&&v.length>0&&v.length<=6&&v.every(c=>atlasClasses.includes(c));
// The wiki's own class for an NPC: its class field or a class among its hover-card tags ("Human · Enchanter"). The
// wiki's Warrior is the atlas's Fighter; a guess ("Shadow Knight?") is left out.
function wikiClassesOf(row){
 const parts=[row?.class,...(Array.isArray(row?.tags)?row.tags:[row?.tags])].flatMap(v=>typeof v==='string'?v.split(/\s*[·,\/]\s*/):[]).map(v=>v.trim()).filter(v=>v&&!v.includes('?'));
 const found=[];for(const p of parts){const c=p.toLowerCase()==='warrior'?'Fighter':atlasClasses.find(x=>x.toLowerCase()===p.toLowerCase());if(c&&!found.includes(c))found.push(c);}
 return found;
}
// The wiki files class trainers as merchants, so a trainer is known by its name or the wiki's trainer role, and its class
// by the wiki's class or tags, else by its name: a class with instructor, trainer or
// guildmaster ("A beastmaster instructor" teaches Beastmaster). Only the name counts: plenty of other merchants stand in
// a guild hall. "Instructor"/"guildmaster" alone, or the wiki's own "trainer" role, still mark a trainer of unknown class.
const trainerWords=/\b(instructors?|trainers?|guild\s*masters?|guildmasters?)\b/i,teacherWords=/\b(instructors?|guild\s*masters?|guildmasters?)\b/i;
function trainerClasses(row){
 // A bounty row may carry the classes the wiki gives (see scripts/make-bounties.mjs).
 if(Array.isArray(row?.classes)){const given=row.classes.filter(c=>atlasClasses.includes(c));if(given.length)return given;}
 const name=String(row?.name??''),named=trainerWords.test(name);
 // For a trainer, the wiki's own class wins over the one read from the name (any NPC's tags name a class, so only then).
 if(named||row?.role==='trainer'){const given=wikiClassesOf(row);if(given.length)return given;}
 if(!named)return [];
 return atlasClasses.filter(c=>new RegExp('\\b'+c.replace(' ','\\s*')+'s?\\b','i').test(name));
}
const isClassTrainer=row=>trainerClasses(row).length>0||row?.role==='trainer'||teacherWords.test(String(row?.name??''));
// The classes a map already shows trainers for: class trainer markers and trainer chips (older chips only have their
// abbreviations, BST standing for both Beastlord and Beastmaster). A map keeps one marker or chip per guild, so an
// instructor whose classes all have one is on the map already, whatever their name.
function mapTrainerClasses(markers,chips){
 const found=new Set();
 for(const m of markers||[])if(m?.category==='Class trainer'&&Array.isArray(m.classes))for(const c of m.classes)if(atlasClasses.includes(c))found.add(c);
 for(const t of chips||[]){for(const c of Array.isArray(t?.classes)?t.classes:[])if(atlasClasses.includes(c))found.add(c);
  for(const a of Array.isArray(t?.abbreviations)?t.abbreviations:[])for(const c of atlasClasses)if(classAbbreviations[c]===a)found.add(c);}
 return found;
}
const trainerOnMap=(row,classes)=>{const c=trainerClasses(row);return c.length>0&&c.every(x=>classes.has(x));};
// The optional fields a marker keeps, by what it is, so a note, its backup, its suggestion and the review bar all keep
// the same ones: an area label nothing else; a zone exit its arrow and the map it leads to; a marker its colour and wiki
// page (with the wiki's id), a tradeskill its trade, a class trainer its classes, a vendor its kind. Values are checked
// where they are saved (app.js valid(), scripts/apply-approved.mjs).
const markerExtraKeys=['noteType','arrow','toMap','color','wiki','wikiId','trade','classes','vendor'];
function markerExtras(m){
 const out={};
 if(m.noteType==='label'||m.noteType==='exit'){out.noteType=m.noteType;if(m.noteType==='exit'){if(m.arrow)out.arrow=m.arrow;if(m.toMap)out.toMap=m.toMap;}return out;}
 if(m.color)out.color=m.color;if(m.wiki){out.wiki=m.wiki;if(m.wikiId)out.wikiId=m.wikiId;}
 if(m.category==='Tradeskill'&&m.trade)out.trade=m.trade;
 if(m.category==='Class trainer'&&Array.isArray(m.classes)&&m.classes.length)out.classes=[...m.classes];
 if(m.category==='Vendor'&&m.vendor)out.vendor=m.vendor;
 return out;
}
