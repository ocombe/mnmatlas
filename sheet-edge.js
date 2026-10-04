/* Every map drawn as one sheet of old parchment lying on the desk: a ragged, burnt rim cut just
   inside the art, the page's dark colour past it, and the wear of a well-used map (stains, rings,
   foxing, darkened edges, paper grain) multiplied over the art. Both layers are drawn in map
   coordinates, so they keep their place while panning and zooming. */
'use strict';
const SHEET={inset:.004,ragged:.005,burn:.016,desk:[30,24,18],burnt:[74,44,22]};
// Value noise with smooth steps; fbm sums octaves while they stay larger than about two screen pixels.
const sheetHash=(x,y,s)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(s,1442695041);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
function sheetNoise(x,y,s,p=0){let ix=Math.floor(x),iy=Math.floor(y);const fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
 const w=n=>p?((n%p)+p)%p:n,a=sheetHash(w(ix),w(iy),s),b=sheetHash(w(ix+1),w(iy),s),c=sheetHash(w(ix),w(iy+1),s),d=sheetHash(w(ix+1),w(iy+1),s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function sheetFbm(x,y,s,oct,p=0){let t=0,amp=.5,f=1,n=0;for(let o=0;o<oct;o++){t+=amp*sheetNoise(x*f,y*f,s+o*31,p*f);n+=amp;amp*=.5;f*=2;}return t/n;}
const sheetSeed=text=>[...text].reduce((h,ch)=>Math.imul(h^ch.charCodeAt(0),16777619)>>>0,2166136261)%100000;
// Whether this map gets the wear pass: off for art that already carries it, and for ?worn=0 previews.
function sheetWorn(config){return config.worn!==false&&new URLSearchParams(location.search).get('worn')!=='0';}

// The wear of the whole sheet as one small picture in multiply colours (white leaves the art as it is).
function sheetWear(frame,seed){
 const strength=+(new URLSearchParams(location.search).get('wear')||1.8);
 const S=Math.max(frame.width,frame.height),L=640,sc=L/S,W=Math.max(2,Math.round(frame.width*sc)),H=Math.max(2,Math.round(frame.height*sc));
 const cv=document.createElement('canvas');cv.width=W;cv.height=H;const g=cv.getContext('2d'),img=g.createImageData(W,H),d=img.data;
 const rnd=i=>sheetHash(i,seed,9);
 // Foxing spots near the edges; all wear stays in a band along the rim so the map itself stays clear.
 const spots=[];for(let i=0;i<70;i++){const e=rnd(100+i)**2*.07,side=rnd(200+i),a=rnd(300+i),w=frame.width/S,h=frame.height/S;
  spots.push({x:side<.25?a*w:side<.5?a*w:side<.75?e:w-e,y:side<.25?e:side<.5?h-e:side<.75?a*h:a*h,r:.0012+.004*rnd(400+i)**2});}
 for(let j=0;j<H;j++)for(let i=0;i<W;i++){
  const u=(i+.5)/sc/S,v=(j+.5)/sc/S,w=frame.width/S,h=frame.height/S,D=Math.min(u,v,w-u,h-v),q=(j*W+i)*4;
  const n1=sheetFbm(u*5,v*5,seed,4),n2=sheetFbm(u*16,v*16,seed+7,4);
  // Warm base, then darkening and a soft mottle along the rim and in the corners.
  let r=252,gg=245,b=232;const mul=(c,a)=>{a=Math.min(1,a*strength);r*=1-a*(1-c[0]/255);gg*=1-a*(1-c[1]/255);b*=1-a*(1-c[2]/255);};
  const edge=Math.max(0,1-D/(.045*(.6+.8*n1)));mul([204,160,108],.5*edge*edge);
  const cd=Math.min(Math.hypot(u,v),Math.hypot(w-u,v),Math.hypot(u,h-v),Math.hypot(w-u,h-v)),corner=Math.max(0,1-cd/.09);mul([190,140,90],.3*corner*corner);
  const near=Math.max(0,1-D/.08);mul([226,204,170],Math.max(0,(n1-.42)*.9)*near);
  // Small water stains along the rim: pale blotches with a darker tide line where they dried.
  const s=n2+.25*(n1-.5);if(s>.6&&near>0){const tide=Math.max(0,1-Math.abs(s-.61)/.012);mul([222,190,145],.4*Math.min(1,(s-.6)*8)*near*near);mul([175,125,75],.3*tide*near*near);}
  for(const p of spots){const k=Math.max(0,1-Math.hypot(u-p.x,v-p.y)/p.r);if(k)mul([172,122,72],.55*k*k);}
  d[q]=r;d[q+1]=gg;d[q+2]=b;d[q+3]=255;
 }
 g.putImageData(img,0,0);return cv;
}
// Fine paper fibre at screen scale, seamless over one tile, in multiply colours.
let sheetGrainCanvas=null;
function sheetGrain(){
 if(sheetGrainCanvas)return sheetGrainCanvas;const N=256,cv=document.createElement('canvas');cv.width=cv.height=N;const g=cv.getContext('2d'),img=g.createImageData(N,N),d=img.data;
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){const f=sheetFbm(i/16,j/16,5,3,16)*.6+sheetFbm(i/32,j/32,6,3,8)*.4,h=sheetHash(i,j,77),v=255-26*Math.max(0,f-.35)-10*h,q=(j*N+i)*4;d[q]=v;d[q+1]=v*.985;d[q+2]=v*.96;d[q+3]=255;}
 g.putImageData(img,0,0);return sheetGrainCanvas=cv;
}

// The map's own tiles with the wear multiplied in on canvas: still one opaque layer, so no extra seams at
// fractional zoom and no page-level blending while zooming.
function sheetTileLayer(config,frame,url,options){
 if(!sheetWorn(config))return L.tileLayer(url,options);
 const cz=config.coordinateZoom,wear=sheetWear(frame,sheetSeed(config.id+'/'+(config.levelId||''))),ws=wear.width/frame.width,grain=sheetGrain();
 const Art=L.GridLayer.extend({createTile(c,done){
  const t=document.createElement('canvas'),N=256;t.width=t.height=N;t.className='art-tile';
  const img=new Image();
  img.onload=()=>{const g=t.getContext('2d'),k=2**(cz-c.z),X0=c.x*N*k,Y0=c.y*N*k;g.drawImage(img,0,0);
   g.globalCompositeOperation='multiply';g.imageSmoothingQuality='high';g.drawImage(wear,(X0-frame.x)*ws,(Y0-frame.y)*ws,N*k*ws,N*k*ws,0,0,N,N);
   g.globalAlpha=.75;g.drawImage(grain,0,0);
   // Keep the tile's own transparency (partial tiles at the edge of the art).
   g.globalAlpha=1;g.globalCompositeOperation='destination-in';g.drawImage(img,0,0);done(null,t);};
  img.onerror=e=>done(e,t);img.src=L.Util.template(url,{x:c.x,y:c.y,z:c.z});return t;
 }});
 return new Art(options);
}
function setupSheetEdge(map,config,frame){
 const cz=config.coordinateZoom,S=Math.max(frame.width,frame.height),sheet=frame,{desk,burnt}=SHEET,box=map.getContainer();
 box.style.backgroundColor=`rgb(${desk.join(',')})`;box.style.backgroundImage='none';
 const pane=map.getPane('sheet')||map.createPane('sheet');pane.style.zIndex='260';pane.style.pointerEvents='none';
 const layers=[];
 // Rim tiles are painted a few at a time between frames, so zooming never waits on them.
 const queue=[];let timer=0;
 const work=()=>{timer=0;const end=performance.now()+6;while(queue.length&&performance.now()<end){const job=queue.shift();if(job.t.isConnected)job.run();}if(queue.length)timer=setTimeout(work,0);};
 const Edge=L.GridLayer.extend({createTile(c,done){
  const t=document.createElement('canvas');t.width=t.height=256;
  queue.push({t,run(){paintEdge(t,c);done(null,t);}});if(!timer)timer=setTimeout(work,0);return t;
 }});
 function paintEdge(t,c){
  const N=256,k=2**(cz-c.z),X0=c.x*N*k,Y0=c.y*N*k,px=k/S;
  // Distance from the sheet's edge, in sheet lengths (positive inside); tiles deep inside stay empty.
  const dist=(X,Y)=>{const u=(X-sheet.x)/S,v=(Y-sheet.y)/S,w=sheet.width/S,h=sheet.height/S,ox=Math.max(-u,u-w,0),oy=Math.max(-v,v-h,0);return ox||oy?-Math.hypot(ox,oy):Math.min(u,v,w-u,h-v);};
  const reach=SHEET.inset+SHEET.ragged+SHEET.burn*1.6+.002,inner=Math.min(X0-sheet.x,Y0-sheet.y,sheet.x+sheet.width-(X0+N*k),sheet.y+sheet.height-(Y0+N*k))/S;
  // Past the rim's shadow the desk colour is the map's own background: nothing to paint.
  const far=SHEET.ragged*1.7+SHEET.inset+.014,outer=Math.max(sheet.x-(X0+N*k),sheet.y-(Y0+N*k),X0-(sheet.x+sheet.width),Y0-(sheet.y+sheet.height))/S;
  if(inner>reach||outer>far)return;
  const g=t.getContext('2d'),img=g.createImageData(N,N),d=img.data;
  let oct=1;while(oct<7&&1/(28*2**oct)>2*px)oct++;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
   const X=X0+(i+.5)*k,Y=Y0+(j+.5)*k,u=(X-sheet.x)/S,v=(Y-sheet.y)/S,D=dist(X,Y),q=(j*N+i)*4;
   if(D>reach||D<-far)continue;
   const line=SHEET.inset+SHEET.ragged*(sheetFbm(u*28,v*28,7,oct)*2-1)+(SHEET.ragged*.6)*(sheetFbm(u*140,v*140,9,Math.max(1,oct-2))-.5),e=D-line;
   const grain=(sheetHash(c.x*N+i,c.y*N+j,c.z)-.5)*10,stain=e>=0&&e<SHEET.burn*1.6?sheetFbm(u*40,v*40,5,Math.min(oct,5)):0;
   let r,gr,b,a;
   if(e<0){
    // Past the sheet: the desk, a little darker in the sheet's shadow, with a thin dark lip at the torn edge.
    const sh=Math.max(0,1-(-e)/.012),lip=Math.max(0,1-(-e)/(1.5*px+.0008));
    r=desk[0]-12*sh;gr=desk[1]-10*sh;b=desk[2]-8*sh;r+=(burnt[0]*.6-r)*lip;gr+=(burnt[1]*.6-gr)*lip;b+=(burnt[2]*.6-b)*lip;a=255;
   }else{
    // The burnt rim, patchy as it fades inwards, then the dark lip of the torn edge.
    r=0;gr=0;b=0;a=0;
    const over=(cr,cg,cb,ca)=>{if(ca<=0)return;const na=ca+a*(1-ca);r=(cr*ca+r*a*(1-ca))/na;gr=(cg*ca+gr*a*(1-ca))/na;b=(cb*ca+b*a*(1-ca))/na;a=na;};
    const bw=SHEET.burn*(.4+1.2*stain),bt=Math.max(0,1-e/bw);over(burnt[0],burnt[1],burnt[2],Math.min(.85,bt*bt*bt*(.6+.7*stain)));
    if(e<1.2*px+.0005)over(burnt[0]*.7,burnt[1]*.7,burnt[2]*.7,.45);
    if(a<=.003)continue;a*=255;
   }
   d[q]=r+grain;d[q+1]=gr+grain;d[q+2]=b+grain;d[q+3]=a;
  }
  g.putImageData(img,0,0);
 }
 layers.push(new Edge({pane:'sheet',tileSize:256,minZoom:config.minZoom,maxZoom:config.maxZoom,noWrap:true,updateWhenZooming:false,keepBuffer:1}));
 for(const l of layers)l.addTo(map);
 return ()=>{queue.length=0;clearTimeout(timer);for(const l of layers)l.remove();box.style.removeProperty('background-color');box.style.removeProperty('background-image');};
}
