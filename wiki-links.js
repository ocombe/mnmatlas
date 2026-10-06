/* Wiki links on markers. A marker keeps one address; the sites below say which addresses are accepted,
   and the embedding sites below say what a marker's link becomes when the atlas is shown on their pages. */
'use strict';
// Sites a marker may link to. A link to any other address is refused when it is saved and never shown.
const wikiSites={
 'mnm-wiki':{name:'Monsters and Memories Wiki',hosts:['monstersandmemories.wiki']},
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
// The link a place shows here, as {href,site,name}, or null when it has none or this embed hides it.
function wikiLinkFor(place,parent=wikiEmbedParent()){
 const href=wikiAddress(place?.wiki);if(!href)return null;
 const site=wikiSiteOf(new URL(href).hostname),show=h=>{const s=wikiSiteOf(new URL(h).hostname);return s?{href:h,site:s,name:wikiSites[s].name}:null;};
 if(parent===null)return show(href);
 const host=Object.keys(wikiEmbedHosts).find(h=>wikiHostMatches(parent,h)),rule=host&&wikiEmbedHosts[host];
 if(!rule||rule.links==='none')return null;
 if(rule.links==='all'||site===rule.site)return show(href);
 const adapted=typeof rule.adapt==='function'?wikiAddress(rule.adapt(href,site,place)):'';
 return adapted&&wikiSiteOf(new URL(adapted).hostname)===rule.site?show(adapted):null;
}
const wikiHint='A wiki link must be a page on '+Object.values(wikiSites).map(s=>s.name).join(', ').replace(/, ([^,]*)$/,' or $1')+'.';
