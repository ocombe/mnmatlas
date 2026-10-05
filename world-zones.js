/* World map: zone areas (a charted zone opens its map), approximate dotted zone lines,
   and the coloured edition of the map revealed inside the zone under the pointer. */
'use strict';
function setupWorldZones(map,config,data){
 const pos=xy=>map.unproject(xy,config.coordinateZoom);
 const pane=map.getPane('worldZones')||map.createPane('worldZones');pane.style.zIndex='420';
 const colour=map.getPane('worldColour')||map.createPane('worldColour');colour.style.zIndex='410';colour.style.pointerEvents='none';colour.style.display='none';
 const group=L.layerGroup().addTo(map);
 if(config.colourTilePath)L.tileLayer(config.colourTilePath+'?v='+encodeURIComponent(config.tileRevision),{pane:'worldColour',tileSize:config.tileSize,minZoom:config.minZoom,maxZoom:config.maxZoom,maxNativeZoom:config.maxNativeZoom,noWrap:true,bounds:mapBounds(),keepBuffer:1}).addTo(group);
 let shown=null;
 // The colour pane lives in the map's layer space, so its clip polygon uses layer points.
 const clip=()=>{if(shown)colour.style.clipPath='polygon('+shown.getLatLngs()[0].map(ll=>{const p=map.latLngToLayerPoint(ll);return p.x+'px '+p.y+'px';}).join(',')+')';};
 const show=area=>{shown=area;clip();colour.style.display='';};
 const hide=area=>{if(shown===area){shown=null;colour.style.display='none';}};
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
   goToMap(target.id);
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
