/* The parchment around a map: its own edge colours carried outwards and softened, so the
   space beside the art reads as more of the same sheet instead of a flat box. Built once per
   map from its smallest tiles; shown only while the view can reach past the map's edges. */
'use strict';
function setupMapBackdrop(map,config,frame){
 const pane=map.getPane('backdrop')||map.createPane('backdrop');pane.style.zIndex='250';pane.style.pointerEvents='none';pane.style.transition='opacity .25s';
 const cz=config.coordinateZoom,z=config.minZoom,s=2**(z-cz),ts=config.tileSize;
 let overlay=null,url=null,gone=false;
 // Tiles of the lowest zoom covering the frame, drawn onto one canvas at that zoom's scale.
 const x0=frame.x*s,y0=frame.y*s,w=frame.width*s,h=frame.height*s;
 const tiles=[];for(let ty=Math.floor(y0/ts);ty*ts<y0+h;ty++)for(let tx=Math.floor(x0/ts);tx*ts<x0+w;tx++)tiles.push([tx,ty]);
 // onload rather than decode(): decode() can wait indefinitely while the page is in a background tab.
 const load=([tx,ty])=>new Promise((ok,fail)=>{const img=new Image();img.onload=()=>ok({img,tx,ty});img.onerror=fail;img.src=config.tilePath.replace('{z}',z).replace('{x}',tx).replace('{y}',ty)+'?v='+encodeURIComponent(config.tileRevision);});
 Promise.all(tiles.map(load)).then(loaded=>{
  if(gone)return;
  const src=document.createElement('canvas');src.width=Math.max(1,Math.round(w));src.height=Math.max(1,Math.round(h));const sg=src.getContext('2d');
  for(const t of loaded)sg.drawImage(t.img,t.tx*ts-x0,t.ty*ts-y0);
  // Colours along the very edge of the art (its outer two pixels at this zoom), in short runs per side.
  const sd=sg.getImageData(0,0,src.width,src.height).data,SW=src.width,SH=src.height,depth=Math.min(2,SW,SH);
  const avg=(xa,xb,ya,yb)=>{let r=0,g=0,b=0,n=0;for(let y=ya;y<yb;y++)for(let x=xa;x<xb;x++){const i=(y*SW+x)*4;r+=sd[i];g+=sd[i+1];b+=sd[i+2];n++;}return [r/n,g/n,b/n];};
  const small=24,k=small/Math.max(w,h),sw=Math.max(2,Math.round(w*k)),sh=Math.max(2,Math.round(h*k)),ext=small*2;
  const span=(i,len,size)=>[Math.floor(i*size/len),Math.max(Math.floor(i*size/len)+1,Math.floor((i+1)*size/len))];
  const top=[],bottom=[],left=[],right=[];
  for(let i=0;i<sw;i++){const [a,b]=span(i,sw,SW);top.push(avg(a,b,0,depth));bottom.push(avg(a,b,SH-depth,SH));}
  for(let i=0;i<sh;i++){const [a,b]=span(i,sh,SH);left.push(avg(0,depth,a,b));right.push(avg(SW-depth,SW,a,b));}
  // The average edge colour: what the far margin settles into and what the page shows past the backdrop.
  const all=[...top,...bottom,...left,...right],mean=[0,1,2].map(c=>all.reduce((t,p)=>t+p[c],0)/all.length);
  // A small colour field: the edge runs on the rim of the map area, stretched outwards to the field's border.
  const field=document.createElement('canvas');field.width=sw+2*ext;field.height=sh+2*ext;const fg=field.getContext('2d');fg.imageSmoothingQuality='high';
  fg.fillStyle=`rgb(${mean.join(',')})`;fg.fillRect(0,0,field.width,field.height);
  const rim=fg.getImageData(0,0,field.width,field.height),put=(x,y,p)=>{const i=(y*field.width+x)*4;rim.data[i]=p[0];rim.data[i+1]=p[1];rim.data[i+2]=p[2];};
  top.forEach((p,i)=>put(ext+i,ext,p));bottom.forEach((p,i)=>put(ext+i,ext+sh-1,p));left.forEach((p,i)=>put(ext,ext+i,p));right.forEach((p,i)=>put(ext+sw-1,ext+i,p));
  fg.putImageData(rim,0,0);
  const edge=(sx,sy,sw2,sh2,dx,dy,dw,dh)=>fg.drawImage(field,sx,sy,sw2,sh2,dx,dy,dw,dh);
  edge(ext,ext,sw,1,ext,0,sw,ext);edge(ext,ext+sh-1,sw,1,ext,ext+sh,sw,ext);
  edge(ext,0,1,field.height,0,0,ext,field.height);edge(ext+sw-1,0,1,field.height,ext+sw,0,ext,field.height);
  // The full-size backdrop: map area 256 px on its long side, two map lengths of margin around it.
  const big=256,K=big/Math.max(w,h),bw=Math.round(w*K),bh=Math.round(h*K),be=big*2,W=bw+2*be,H=bh+2*be;
  const out=document.createElement('canvas');out.width=W;out.height=H;const og=out.getContext('2d');og.imageSmoothingQuality='high';
  // Shrinking then growing smooths the stretched streaks into soft colour.
  const soft=document.createElement('canvas');soft.width=Math.ceil(field.width/2);soft.height=Math.ceil(field.height/2);const sog=soft.getContext('2d');sog.imageSmoothingQuality='high';sog.drawImage(field,0,0,soft.width,soft.height);
  og.drawImage(soft,0,0,W,H);
  const px=og.getImageData(0,0,W,H),d=px.data;
  const feather=Math.max(3,Math.min(bw,bh)*.03),near=Math.max(bw,bh)*.35,far=Math.max(bw,bh)*1.6;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const i=(y*W+x)*4,dx=Math.max(be-x,x-(be+bw),0),dy=Math.max(be-y,y-(be+bh),0);
   if(!dx&&!dy){d[i+3]=Math.round(255*Math.max(0,1-Math.min(x-be,be+bw-x,y-be,be+bh-y)/feather));continue;}
   const t=Math.min(1,Math.max(0,(Math.hypot(dx,dy)-near)/(far-near))),e=t*t*(3-2*t);
   const grain=(Math.random()-.5)*6;for(let c=0;c<3;c++)d[i+c]=Math.round(d[i+c]+(mean[c]-d[i+c])*e+grain);d[i+3]=255;
  }
  og.putImageData(px,0,0);
  const box=map.getContainer();box.style.backgroundColor=`rgb(${mean.map(Math.round).join(',')})`;box.style.backgroundImage='none';
  out.toBlob(blob=>{
   if(gone||!blob)return;url=URL.createObjectURL(blob);const m=frame.width/bw,ex=be*m;
   const bounds=L.latLngBounds(map.unproject([frame.x-ex,frame.y+frame.height+ex],cz),map.unproject([frame.x+frame.width+ex,frame.y-ex],cz));
   overlay=L.imageOverlay(url,bounds,{pane:'backdrop',interactive:false,className:'map-backdrop'}).addTo(map);update();
  });
 }).catch(e=>console.warn('Map backdrop unavailable:',e));
 // Once the map covers the whole view nothing past its edge can show; hiding the layer then spares
 // the browser a very large image at deep zoom.
 const update=()=>{const size=map.getSize(),scale=Math.max(size.x/frame.width,size.y/frame.height),cover=map.getScaleZoom(scale,cz);pane.style.opacity=map.getZoom()>cover+.5?'0':'1';};
 map.on('zoomend resize',update);update();
 return ()=>{gone=true;map.off('zoomend resize',update);overlay?.remove();map.getContainer().style.removeProperty('background-color');map.getContainer().style.removeProperty('background-image');if(url)URL.revokeObjectURL(url);};
}
