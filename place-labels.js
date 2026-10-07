/* Community place names. Text only, no HTML input. */
'use strict';
let atlasLabels,trainerDetails=new Map(),labelPins=new Map(),schedulePlaceLabels=()=>{};
function trainerIcon(m){
 const detail=trainerDetails.get(m.id);
 // A trainer without a chip of the map's own (a personal note) shows the classes it was given, or CLASS.
 const own=Array.isArray(m.classes)?m.classes.map(c=>classAbbreviations[c]).filter(Boolean):[];
 const face=text('span',detail?detail.abbreviations.join(' · '):own.length?own.join(' · '):'CLASS','trainer-badge');
 if(m.color)face.style.backgroundColor=m.color;
 const width=Math.max(40,face.textContent.length*6.7+14);
 const body=text('div','','trainer-body');body.append(text('i','','trainer-leader'),face);
 return L.divIcon({className:'trainer-pin',html:body,iconSize:[width,25],iconAnchor:[width/2,32],popupAnchor:[0,-30]});
}
function setupPlaceLabels(data){
 labelPins.clear();
 atlasLabels=data;trainerDetails=new Map(data.trainers.map(r=>[r.id,r]));
 const key=storageKey('place-names'),toggle=$('place-names-toggle'),showAll=$('alignment-all-labels');
 showAll.checked=false;showAll.onchange=()=>schedulePlaceLabels();
 try{toggle.checked=localStorage.getItem(key)!=='false';}catch{toggle.checked=true;}
 const pane=map.getPane('placeNames')||map.createPane('placeNames');pane.style.zIndex=alignmentMode?'650':'450';pane.style.pointerEvents='none';
 const entries=data.labels.filter(atLevel).sort((a,b)=>b.priority-a.priority).map(row=>{
  const target=(row.kind==='exit'||row.kind==='zone')&&!alignmentMode&&registry.maps.find(c=>c.id===row.toMap);
  const face=text(target?'a':'span',row.kind==='exit'?'':row.name,'place-name '+row.kind+(target?' linked':''));
  if(row.kind==='exit'){
   // Published exits may also go up or down (ladders, roof cracks); unknown arrows fall back to a plain one.
   const glyph=exitArrows[row.arrow]||{up:'⤒',down:'⤓'}[row.arrow]||'→';
   const side=/west/.test(row.arrow)?'west':/east/.test(row.arrow)?'east':['south','down'].includes(row.arrow)?'south':'north';
   face.classList.add('to-'+side);if(!target&&!alignmentMode)face.classList.add('unmapped');
   face.append(text('b',glyph,'exit-arrow'),text('span',' '+row.name,'exit-name'));
   if(!target&&!alignmentMode)face.append(text('small','not mapped yet','exit-soon'));
  }
  // Exit names that lead to another published map open it, at the matching exit when given.
  if(target){
   const url=mapLink(target.id);if(row.toPlace)url.searchParams.set('place',row.toPlace);
   face.href=url.href;face.title='Open the '+target.title+' map';if(singleMap){face.target='_blank';face.rel='noopener';face.title+=' in MnM Atlas';}
   L.DomEvent.disableClickPropagation(face);
   face.addEventListener('click',e=>{if(singleMap||e.button||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();goToMap(target.id,url);});
  }
  const icon=L.divIcon({className:'place-name-anchor',html:face,iconSize:[0,0],iconAnchor:[0,0]});
  const marker=L.marker(locationOf(row),{icon,pane:'placeNames',alt:row.name,interactive:alignmentMode,keyboard:alignmentMode,draggable:alignmentMode,bubblingMouseEvents:false});
  if(alignmentMode){
   marker.on('click',()=>{selectAlignment(row,'label');labelEditPopup(row);});
   marker.on('dragstart',()=>{selectAlignment(row,'label');map.closePopup();});
   marker.on('dragend',()=>moveAlignedLabel(row.id,marker.getLatLng()));
  }
  labelPins.set(row.id,marker);
  return {row,face,marker};
 });
 const visibleElement=el=>el.getClientRects().length&&el.style.opacity!=='0';
 let frame,disposed=false;
 // Exit signs matter more than names, so they try a wider ring before hiding.
 const exitOffsets=[[0,0],[0,26],[0,-30],[40,0],[-40,0],[34,24],[-34,24],[34,-26],[-34,-26],[0,52],[0,-56],[70,0],[-70,0]];
 const intersects=(a,b)=>a.left<b.right+4&&a.right>b.left-4&&a.top<b.bottom+3&&a.bottom>b.top-3;
 function layout(){
  // A late callback from a replaced map (level or map switch) must not add its names to the new map.
  if(disposed)return;
  frame=null;
  const view=$('map').getBoundingClientRect(),zoom=map.getZoom();
  const trainersVisible=zoom>=3.25||(enabled.size===1&&enabled.has('Class trainer'));
  for(const pin of pins.values())if(Number.isFinite(pin.atlasMinZoom)){
   if(showPins&&(alignmentMode||zoom>=pin.atlasMinZoom)){if(!map.hasLayer(pin))pin.addTo(map);}else pin.remove();
  }
  for(const pin of pins.values())if(pin.options.icon?.options.className==='trainer-pin'){
   if(showPins&&trainersVisible){if(!map.hasLayer(pin))pin.addTo(map);}else pin.remove();
  }
  const occupied=[...document.querySelectorAll('#map .pin, #map .personal-label, #map .hidden-route, .map-title, .level-controls, .embed-toolbar, .map-tools, .compass, .leaflet-popup')]
   .filter(visibleElement).map(el=>el.getBoundingClientRect());
  const badgeRects=[];
  const chromeRects=[...document.querySelectorAll('.map-title,.level-controls,.embed-toolbar,.map-tools,.compass,.leaflet-popup')].filter(visibleElement).map(e=>e.getBoundingClientRect());
  for(const face of document.querySelectorAll('#map .trainer-badge')){
   let offset=[0,0],best=Infinity;
   // Guild badges retain their true anchor via a fine leader when displaced.
   for(const [dx,dy] of [[0,0],[0,-30],[0,30],[44,-20],[-44,-20],[65,0],[-65,0],[0,-58],[0,58],[80,40],[-80,40],[80,-45],[-80,-45],[0,85],[0,-85],[105,0],[-105,0]]){
    face.style.transform=`translate(${dx}px,${dy}px)`;
    const rect=face.getBoundingClientRect(),outside=rect.left<view.left+5||rect.right>view.right-5||rect.top<view.top+5||rect.bottom>view.bottom-16;
    const score=occupied.filter(r=>intersects(rect,r)).length+100*badgeRects.filter(r=>intersects(rect,r)).length+500*chromeRects.filter(r=>intersects(rect,r)).length+(outside?1000:0);
    if(score<best){best=score;offset=[dx,dy];}if(!score)break;
   }
   const [dx,dy]=offset;face.style.transform=`translate(${dx}px,${dy}px)`;
   const leader=face.previousElementSibling;
   leader.style.height=Math.hypot(dx,dy-20)+'px';
   leader.style.transform=`rotate(${Math.atan2(-dx,dy-20)}rad)`;
   occupied.push(face.getBoundingClientRect());badgeRects.push(face.getBoundingClientRect());
  }
  if(!toggle.checked){for(const e of entries)e.marker.remove();return;}
  const ordered=entries.slice().sort((a,b)=>Number(selectedAlignmentKind==='label'&&selectedAlignmentId===b.row.id&&alignmentMode)-Number(selectedAlignmentKind==='label'&&selectedAlignmentId===a.row.id&&alignmentMode)||b.row.priority-a.row.priority);
  for(const {row,face,marker} of ordered){
   if(zoom<row.minZoom&&!(alignmentMode&&showAll.checked)){marker.remove();continue;}
   const p=map.latLngToContainerPoint(locationOf(row));
   if(p.x<0||p.y<0||p.x>view.width||p.y>view.height){marker.remove();continue;}
   if(!map.hasLayer(marker))marker.addTo(map);
   face.style.fontSize=(row.kind==='zone'?Math.min(30,16+Math.max(0,zoom-1)*4):row.kind==='region'?Math.min(40,22+Math.max(0,zoom-1)*5):row.kind==='district'?Math.min(21,15+Math.max(0,zoom-2)*1.5):row.kind==='exit'?Math.min(16,Math.max(13,12+(zoom-2)*.8)):12)+'px';
   const selected=alignmentMode&&selectedAlignmentKind==='label'&&selectedAlignmentId===row.id;
   face.classList.toggle('selected',selected);marker.setZIndexOffset(selected?1000:0);
   face.style.visibility='hidden';
   let accepted=false;
   // Small offsets keep names close to their anchors; lower priority names hide
   // if none fits. Screen-space rectangles include actual text and marker sizes.
   for(const [dx,dy] of (alignmentMode?[[0,0]]:row.kind==='exit'?exitOffsets:[[0,0],[0,23],[0,-29],[26,17],[-26,17]])){
    face.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
    let rect=face.getBoundingClientRect();
    // Exit signs near the frame slide back inside the view instead of hiding.
    if(row.kind==='exit'&&!alignmentMode){
     const sx=Math.max(0,view.left+16-rect.left)-Math.max(0,rect.right-(view.right-16)),sy=Math.max(0,view.top+16-rect.top)-Math.max(0,rect.bottom-(view.bottom-30));
     if((sx||sy)&&Math.abs(sx)<rect.width&&Math.abs(sy)<rect.height*2){face.style.transform=`translate(calc(-50% + ${dx+sx}px),calc(-50% + ${dy+sy}px))`;rect=face.getBoundingClientRect();}
    }
    if(rect.left<view.left+16||rect.right>view.right-16||rect.top<view.top+16||rect.bottom>view.bottom-30||(selected?chromeRects:occupied).some(r=>intersects(rect,r)))continue;
    occupied.push(rect);accepted=true;break;
   }
   face.style.visibility=accepted?'visible':'hidden';
  }
 }
 schedulePlaceLabels=()=>{if(frame)cancelAnimationFrame(frame);frame=requestAnimationFrame(layout);};
 toggle.onchange=()=>{try{localStorage.setItem(key,String(toggle.checked));}catch{status('Place-name preference could not be saved.');}schedulePlaceLabels();};
 // Hover tooltips are transient; re-laying labels around them moves a label out from under the pointer.
 const onLayer=e=>{if(!(e.layer instanceof L.Tooltip))schedulePlaceLabels();};
 map.on('zoomend moveend resize',schedulePlaceLabels);map.on('layeradd layerremove',onLayer);
 schedulePlaceLabels();
 document.fonts.ready.then(schedulePlaceLabels);
 const currentMap=map,handler=schedulePlaceLabels;
 return ()=>{disposed=true;cancelAnimationFrame(frame);for(const e of entries)e.marker.remove();currentMap.off('zoomend moveend resize',handler);currentMap.off('layeradd layerremove',onLayer);schedulePlaceLabels=()=>{};};
}
