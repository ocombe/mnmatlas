/* Worn sheet edge: every map drawn as one sheet of used parchment, with a ragged, darkened rim
   and the same surround past it, whatever the colours at the edge of its art. Painted on canvas
   tiles in map coordinates, so the rim keeps its shape while panning and zooming. */
'use strict';
const SHEET_STYLES={
 // The rim cuts just inside the art; past it, the brown of the world map's surround.
 worn:{margin:0,inset:.004,ragged:.005,burn:.016,age:.06,fade:0,outside:'brown'},
 // The art fades into a band of plain parchment, which then gets the worn rim.
 margin:{margin:.03,inset:0,ragged:.006,burn:.018,age:.06,fade:.02,outside:'brown'},
 // The worn rim, then the page's own dark colour, as if the sheet lay on the desk.
 desk:{margin:0,inset:.004,ragged:.005,burn:.016,age:.06,fade:0,outside:'desk'}
};
function sheetStyle(){const p=new URLSearchParams(location.search).get('edge');return SHEET_STYLES[p]?p:null;}
// Value noise with smooth steps; fbm sums octaves while they stay larger than about two screen pixels.
const sheetHash=(x,y,s)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(s,1442695041);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967296;};
function sheetNoise(x,y,s){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
 const a=sheetHash(ix,iy,s),b=sheetHash(ix+1,iy,s),c=sheetHash(ix,iy+1,s),d=sheetHash(ix+1,iy+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function sheetFbm(x,y,s,oct){let t=0,amp=.5,f=1,n=0;for(let o=0;o<oct;o++){t+=amp*sheetNoise(x*f,y*f,s+o*31);n+=amp;amp*=.5;f*=2;}return t/n;}
function setupSheetEdge(map,config,frame,name){
 const st=SHEET_STYLES[name],cz=config.coordinateZoom,S=Math.max(frame.width,frame.height);
 const m=st.margin*S,sheet={x:frame.x-m,y:frame.y-m,width:frame.width+2*m,height:frame.height+2*m};
 const box=map.getContainer(),desk=[30,24,18],brown=[118,86,56],brownFar=[58,41,26],paper=[214,186,140],burnt=[74,44,22];
 box.style.backgroundColor=`rgb(${(st.outside==='desk'?desk:brownFar).join(',')})`;box.style.backgroundImage='none';box.classList.add('sheet-'+name);
 const pane=map.getPane('sheet')||map.createPane('sheet');pane.style.zIndex='260';pane.style.pointerEvents='none';
 const Layer=L.GridLayer.extend({createTile(c){
  const t=document.createElement('canvas'),N=256;t.width=t.height=N;t.className='sheet-tile';
  const k=2**(cz-c.z),X0=c.x*N*k,Y0=c.y*N*k,px=k/S;
  // Distance from the sheet's edge, in sheet lengths (positive inside); tiles deep inside stay empty.
  const dist=(X,Y)=>{const u=(X-sheet.x)/S,v=(Y-sheet.y)/S,w=sheet.width/S,h=sheet.height/S,ox=Math.max(-u,u-w,0),oy=Math.max(-v,v-h,0);return ox||oy?-Math.hypot(ox,oy):Math.min(u,v,w-u,h-v);};
  const reach=st.inset+st.ragged+Math.max(st.burn*1.6,st.age*1.8)+st.fade+st.margin+.002,inner=Math.min(X0-sheet.x,Y0-sheet.y,sheet.x+sheet.width-(X0+N*k),sheet.y+sheet.height-(Y0+N*k))/S;
  if(inner>reach)return t;
  const g=t.getContext('2d'),img=g.createImageData(N,N),d=img.data;
  let oct=1;while(oct<9&&1/(28*2**oct)>2*px)oct++;
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
   const X=X0+(i+.5)*k,Y=Y0+(j+.5)*k,u=(X-sheet.x)/S,v=(Y-sheet.y)/S,D=dist(X,Y),q=(j*N+i)*4;
   if(D>reach)continue;
   const line=st.inset+st.ragged*(sheetFbm(u*28,v*28,7,oct)*2-1)+(st.ragged*.6)*(sheetFbm(u*140,v*140,9,Math.max(1,oct-2))-.5),e=D-line;
   const grain=(sheetHash(c.x*N+i,c.y*N+j,c.z)-.5)*10,mot=sheetFbm(u*9,v*9,3,oct)-.5,stain=sheetFbm(u*40,v*40,5,oct);
   let r,gr,b,a;
   if(e<0){
    // Past the sheet: the surround, mottled like old leather or the world map's margin, darkening outwards.
    if(st.outside==='desk'){const sh=Math.max(0,1-(-e)/.012);r=desk[0]-12*sh;gr=desk[1]-10*sh;b=desk[2]-8*sh;a=255;}
    else{const far=Math.min(1,-e/.08),f=far*far*(3-2*far);r=brown[0]+(brownFar[0]-brown[0])*f;gr=brown[1]+(brownFar[1]-brown[1])*f;b=brown[2]+(brownFar[2]-brown[2])*f;const mm=1+mot*.35;r*=mm;gr*=mm;b*=mm;a=255;}
    // A thin dark lip right at the torn edge.
    const lip=Math.max(0,1-(-e)/(1.5*px+.0008));r+=(burnt[0]*.6-r)*lip;gr+=(burnt[1]*.6-gr)*lip;b+=(burnt[2]*.6-b)*lip;
   }else{
    // Layers over the art, composited in order: plain parchment (margin style), a broad age stain,
    // the burnt rim, foxing spots and the dark lip of the torn edge.
    r=0;gr=0;b=0;a=0;
    const over=(cr,cg,cb,ca)=>{if(ca<=0)return;const na=ca+a*(1-ca);r=(cr*ca+r*a*(1-ca))/na;gr=(cg*ca+gr*a*(1-ca))/na;b=(cb*ca+b*a*(1-ca))/na;a=na;};
    if(st.margin){const into=D-st.margin+st.fade*.6*(sheetFbm(u*70,v*70,11,oct)-.5),fz=st.fade*(.5+.8*stain);let pa=into<=0?1:Math.max(0,1-into/fz);pa=pa*pa*(3-2*pa);
     const fib=sheetFbm(u*400,v*400,13,Math.max(1,oct-3))-.5,tone=1+mot*.3+fib*.08;over(paper[0]*tone,paper[1]*tone,paper[2]*tone,pa);}
    const age=Math.max(0,1-e/(st.age*(.6+.8*mot+.4)));over(120,78,40,.32*age*age*(.5+stain));
    const bw=st.burn*(.4+1.2*stain),bt=Math.max(0,1-e/bw);over(burnt[0],burnt[1],burnt[2],Math.min(.85,bt*bt*bt*(.6+.7*stain)));
    const fox=sheetFbm(u*90,v*90,17,Math.max(1,oct-1));if(fox>.68&&e<st.age)over(110,70,36,Math.min(.45,(fox-.68)*4)*(1-e/st.age));
    if(e<1.2*px+.0005)over(burnt[0]*.7,burnt[1]*.7,burnt[2]*.7,.45);
    if(a<=.003)continue;a*=255;
   }
   d[q]=r+grain;d[q+1]=gr+grain;d[q+2]=b+grain;d[q+3]=a;
  }
  g.putImageData(img,0,0);return t;
 }});
 const layer=new Layer({pane:'sheet',tileSize:256,minZoom:config.minZoom,maxZoom:config.maxZoom,noWrap:true,updateWhenZooming:false,keepBuffer:1}).addTo(map);
 return ()=>{layer.remove();box.classList.remove('sheet-'+name);box.style.removeProperty('background-color');box.style.removeProperty('background-image');};
}
// The view's limits and fit cover the whole sheet, margin included.
function sheetFrame(config,name){const f=config.frame||{x:0,y:0,width:config.width,height:config.height},st=SHEET_STYLES[name];if(!st||!st.margin)return f;const m=st.margin*Math.max(f.width,f.height);return {x:f.x-m,y:f.y-m,width:f.width+2*m,height:f.height+2*m};}
