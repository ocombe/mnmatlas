/* Code most visits never run loads when it is first needed: its script tags, with their cache tags, sit in index.html's
   <template id="lazy-code">. This file also holds what Directions must show before its code loads: the button and the card and menu entries. */
'use strict';
window.atlasBeta=new Set(['directions']);
{
 const started=new Map();
 window.atlasLazy=file=>{
  if(!started.has(file))started.set(file,new Promise((done,failed)=>{
   const tag=document.createElement('script');tag.src=document.getElementById('lazy-code')?.content.querySelector('script[src^="'+file+'"]')?.getAttribute('src')||file;
   tag.onload=done;tag.onerror=()=>{started.delete(file);tag.remove();failed(Error('Could not load '+file));};document.head.append(tag);
  }));
  return started.get(file);
 };
 const routable=id=>!!registry?.maps.find(c=>c.id===id)?.routes;
 const directions=()=>Promise.all([window.atlasLazy('route-rules.js'),window.atlasLazy('itinerary.js')]).then(()=>window.atlasDirections);
 const use=act=>directions().then(act).catch(()=>status('Directions could not load. Please try again.'));
 window.atlasSpotActions=[...(window.atlasSpotActions||[]),
  {label:'Directions from here',shown:()=>routable(config.id),run:at=>use(d=>d.set('from',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level}))},
  {label:'Directions to here',shown:()=>routable(config.id),run:at=>use(d=>d.set('to',{kind:'spot',id:'spot',x:at.x,y:at.y,level:at.level}))}];
 window.atlasPopupActions=[...(window.atlasPopupActions||[]),
  {label:'Directions',icon:'route',shown:m=>routable(config.id)&&!singleMap&&Number.isFinite(m.x),run:m=>{map.closePopup();use(d=>d.toMarker(m));}}];
 window.addEventListener('atlas:loaded',()=>{
  // The button sits in the search field, the way map apps do it.
  let open=$('route-open');const box=$('search')?.closest('.search-box');
  if(!open&&box){open=button('',()=>use(d=>d.open()),'route-open');open.id='route-open';open.title='Directions';open.setAttribute('aria-label','Directions');const mark=text('span','','route-open-icon route-icon-directions');mark.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12 12 3l9 9-9 9z M9 14v-3h5 M12 8.5l2.5 2.5-2.5 2.5"/></svg>';open.append(mark,text('span','Directions','route-open-label'));open.onpointerenter=()=>{directions().catch(()=>{});};box.append(open);}
  if(open)open.hidden=!routable(config.id);
  // An address carrying a route opens it, on the first load or on Back and Forward.
  if(new URL(location.href).searchParams.get('route'))directions().catch(()=>{});
 });
}
