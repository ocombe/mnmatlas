/* World map: zone areas (a charted zone opens its map), approximate dotted zone lines,
   and the coloured edition of the map revealed inside the zone under the pointer. */
'use strict';
// Clicking a charted zone flies the world map into that zone, fades it out while it keeps growing, then the zone's own
// map fades in from slightly closer and settles at its full view. Reduced motion (or a second click) just opens it.
function zoomIntoZone(map,area,id){
 const box=map.getContainer();
 if(box.classList.contains('zone-zooming')||matchMedia('(prefers-reduced-motion: reduce)').matches){goToMap(id);return;}
 box.classList.add('zone-zooming');
 warmTiles(registry.maps.find(c=>c.id===id));
 let left=false;
 const settle=()=>{box.classList.add('zone-enter');box.classList.remove('zone-leave');void box.offsetWidth;box.classList.remove('zone-enter','zone-zooming');};
 const leave=()=>{
  if(left)return;left=true;
  box.classList.add('zone-leave');
  setTimeout(()=>{
   // the zone map fades in once loaded; if loading fails or stalls, never leave the map hidden
   const stall=setTimeout(settle,8000);
   window.addEventListener('atlas:loaded',()=>{clearTimeout(stall);setTimeout(settle,30);},{once:true});
   goToMap(id);
  },260);
 };
 // leave when the flight ends (a moveend already queued by the map's own settling must not cut it short)
 const flight=1.1;
 map.flyToBounds(area.getBounds(),{duration:flight,easeLinearity:.2,padding:[24,24],maxZoom:map.getMaxZoom()});
 setTimeout(leave,flight*1000+40);
}
// While the world map zooms, fetch the zone map's low-zoom tiles so it appears without a blank wait.
function warmTiles(base){
 if(!base)return;
 const c=base.levels?levelConfig(base,base.levels.find(l=>l.id===base.defaultLevel)):base;
 const url=c.tilePath+'?v='+encodeURIComponent(c.tileRevision);let budget=96;
 for(let z=Math.max(0,c.minZoom);z<=Math.min(3,c.maxNativeZoom)&&budget>0;z++){
  const s=2**(z-c.coordinateZoom),nx=Math.ceil(c.width*s/c.tileSize),ny=Math.ceil(c.height*s/c.tileSize);
  for(let y=0;y<ny&&budget>0;y++)for(let x=0;x<nx&&budget>0;x++,budget--)new Image().src=url.replace('{z}',z).replace('{x}',x).replace('{y}',y);
 }
}
function setupWorldZones(map,config,data){
 const pos=xy=>map.unproject(xy,config.coordinateZoom);
 const pane=map.getPane('worldZones')||map.createPane('worldZones');pane.style.zIndex='420';
 const colour=map.getPane('worldColour')||map.createPane('worldColour');colour.style.zIndex='410';colour.style.pointerEvents='none';colour.style.display='none';
 const group=L.layerGroup().addTo(map);
 if(config.colourTilePath)L.tileLayer(config.colourTilePath+'?v='+encodeURIComponent(config.tileRevision),{pane:'worldColour',tileSize:config.tileSize,minZoom:config.minZoom,maxZoom:config.maxZoom,maxNativeZoom:config.maxNativeZoom,noWrap:true,bounds:mapBounds(),keepBuffer:1}).addTo(group);
 let shown=null;
 // The colour pane lives in the map's layer space, so its clip polygon uses layer points.
 const clip=()=>{if(shown)colour.style.clipPath='polygon('+shown.getLatLngs()[0].map(ll=>{const p=map.latLngToLayerPoint(ll);return p.x+'px '+p.y+'px';}).join(',')+')';};
 // A map without a coloured edition (already painted in colour) lights the zone under the pointer instead.
 const lit={stroke:true,color:'#fff4d6',weight:2.5,opacity:.95,fillColor:'#fff4d6',fillOpacity:.2},unlit={stroke:false,fillOpacity:0};
 const show=area=>{if(shown&&shown!==area&&!config.colourTilePath)shown.setStyle(unlit);shown=area;if(config.colourTilePath){clip();colour.style.display='';}else area.setStyle(lit);};
 const hide=area=>{if(shown===area){shown=null;if(config.colourTilePath)colour.style.display='none';else area.setStyle(unlit);}};
 const hideDuringZoom=()=>{colour.style.visibility='hidden';},restore=()=>{clip();colour.style.visibility='';};
 map.on('zoomstart',hideDuringZoom);map.on('zoomend viewreset',restore);
 for(const line of Array.isArray(data.borders)?data.borders:[])
  L.polyline(line.map(pos),{pane:'worldZones',color:'#2b1e12',weight:3.5,opacity:.8,dashArray:'1 11',lineCap:'round',interactive:false}).addTo(group);
 const areas=[];
 for(const z of Array.isArray(data.zones)?data.zones:[]){
  const target=z.toMap&&registry.maps.find(c=>c.id===z.toMap);
  const area=L.polygon(z.polygon.map(pos),{pane:'worldZones',stroke:false,fill:true,fillOpacity:0,className:'world-zone'+(target?' charted':''),bubblingMouseEvents:false}).addTo(group);
  area.bindTooltip(text('span',target?z.name:z.name+' · not charted yet'),{sticky:true,direction:'top',offset:[0,-8],className:'world-zone-tip'});
  areas.push(area);
  area.on('click',()=>{
   if(!target){show(area);return;}
   zoomIntoZone(map,area,target.id);
  });
 }
 // Follow the pointer over the map (also over zone names, which sit above the areas) and colour the zone under it.
 const inRing=(p,ring)=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.lat>p.lat)!==(b.lat>p.lat)&&p.lng<(b.lng-a.lng)*(p.lat-a.lat)/(b.lat-a.lat)+a.lng)inside=!inside;}return inside;};
 const box=map.getContainer();
 const track=e=>{const hit=areas.find(a=>inRing(e.latlng,a.getLatLngs()[0]));box.classList.toggle('over-world-zone',!!hit);if(hit){if(hit!==shown)show(hit);}else if(shown)hide(shown);};
 const leave=()=>{box.classList.remove('over-world-zone');if(shown)hide(shown);};
 map.on('mousemove',track);map.on('mouseout',leave);
 return ()=>{box.classList.remove('over-world-zone');map.off('mousemove',track);map.off('mouseout',leave);group.remove();colour.style.display='none';colour.style.clipPath='';map.off('zoomstart',hideDuringZoom);map.off('zoomend viewreset',restore);};
}
