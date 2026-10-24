/* Finds walking routes on a map's ground file, away from the page. Messages: load, route. */
'use strict';
// Each map's ground, loaded once.
const grounds={};
const DIRS=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

async function load(meta,url,key){
 const res=await fetch(url);if(!res.ok)throw Error('Route data could not load.');
 const bytes=new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
 if(meta.format==='raster'){grounds[key]=loadRaster(meta,bytes);return;}
 const view=new DataView(bytes.buffer),count=view.getUint32(0,true),col=new Uint32Array(count);
 let o=4,c=0;
 for(let i=0;i<count;i++){let v=0,s=0,b;do{b=bytes[o++];v+=(b&127)*2**s;s+=7;}while(b&128);c+=v;col[i]=c;}
 // Each run of tenths is stored as changes from the value before.
 const tenths=n=>{const a=new Float32Array(n);let v=0;for(let i=0;i<n;i++){v=(v+view.getInt16(o+i*2,true))<<16>>16;a[i]=v/10;}o+=n*2;return a;};
 const h=tenths(count),lv=bytes.slice(o,o+count),flags=bytes.slice(o+count,o+2*count),dirs=bytes.slice(o+2*count,o+3*count);o+=3*count;
 const pick=new Uint32Array(count);for(let i=0;i<count;i++)pick[i]=view.getUint32(o+i*4,true);o+=count*4;
 // Ceiling and water surface are stored for swimming cells only; everywhere else they are open.
 const swim=new Uint8Array(count);let wet=0;for(let i=0;i<count;i++)if(flags[i]&1){swim[i]=1;wet++;}
 const ceil=new Float32Array(count).fill(3276.7),surf=new Float32Array(count).fill(3276.7),wc=tenths(wet),ws=tenths(wet);
 for(let i=0,k=0;i<count;i++)if(swim[i]){ceil[i]=wc[k];surf[i]=ws[k];k++;}
 const first=new Int32Array(meta.nx*meta.nz).fill(-1),many=new Uint8Array(meta.nx*meta.nz);
 for(let i=count-1;i>=0;i--){first[col[i]]=i;many[col[i]]++;}
 const x=new Float32Array(count),z=new Float32Array(count),px=new Float32Array(count),py=new Float32Array(count),[ax,ay,az,bx]=meta.project.x,[cx,cy,cz,by]=meta.project.y;
 for(let i=0;i<count;i++){x[i]=(col[i]%meta.nx+.5)*meta.cell+meta.x0;z[i]=(Math.floor(col[i]/meta.nx)+.5)*meta.cell+meta.z0;px[i]=ax*x[i]+ay*h[i]+az*z[i]+bx;py[i]=cx*x[i]+cy*h[i]+cz*z[i]+by;}
 grounds[key]={meta,count,col,h,ceil,surf,lv,swim,flags,dirs,pick,first,many,x,z,px,py};
}
// Big single-floor maps: one square per spot, with the 8 steps out of it already worked out.
function loadRaster(meta,bytes){
 const n=meta.nx*meta.nz,view=new DataView(bytes.buffer),steps0=bytes.subarray(0,n),swim0=bytes.subarray(n,2*n),q=new Int32Array(n);
 let count=0;
 for(let r=0;r<meta.nz;r++){let prev=false;for(let c=0;c<meta.nx;c++){const k=r*meta.nx+c,v=view.getInt16(2*n+k*2,true);if(v===-32768){q[k]=-32768;prev=false;continue;}q[k]=prev?q[k-1]+v:v;prev=true;count++;}}
 const col=new Uint32Array(count),h=new Float32Array(count),swim=new Uint8Array(count),steps=new Uint8Array(count),first=new Int32Array(n).fill(-1),many=new Uint8Array(n);
 const flags=new Uint8Array(count);
 for(let k=0,i=0;k<n;k++){if(q[k]===-32768)continue;col[i]=k;h[i]=q[k]*meta.hstep;swim[i]=swim0[k]&1;flags[i]=swim0[k];steps[i]=steps0[k];first[k]=i;many[k]=1;i++;}
 const ceil=new Float32Array(count).fill(3276.7),surf=ceil,lv=new Uint8Array(count);
 const x=new Float32Array(count),z=new Float32Array(count),px=new Float32Array(count),py=new Float32Array(count),[ax,ay,az,bx]=meta.project.x,[cx,cy,cz,by]=meta.project.y;
 for(let i=0;i<count;i++){x[i]=(col[i]%meta.nx+.5)*meta.cell+meta.x0;z[i]=(Math.floor(col[i]/meta.nx)+.5)*meta.cell+meta.z0;px[i]=ax*x[i]+ay*h[i]+az*z[i]+bx;py[i]=cx*x[i]+cy*h[i]+cz*z[i]+by;}
 return {meta,count,col,h,ceil,surf,lv,swim,flags,first,many,x,z,px,py,steps};
}
// Can the walker go from cell i to cell j? Up or down a step, through open water, or off a ledge into deep water.
function ok(g,i,j){
 const hi_=g.h[i],hj=g.h[j],lo=hi_<=hj?i:j,top=Math.max(hi_,hj);
 if(g.swim[lo]&&top<=g.ceil[lo]&&top<=g.surf[lo]+g.meta.step)return true;
 if(Math.abs(hj-hi_)<=g.meta.step)return true;
 return hi_>hj&&g.swim[j]&&hi_>=g.surf[j]&&hi_<=g.surf[j]+6;
}
// Each cell's neighbours go into NB (count returned), from the table worked out when the map was built.
const NB=new Int32Array(16),DX=[1,-1,0,0,1,1,-1,-1],DZ=[0,0,1,-1,1,-1,1,-1];
function neighbours(g,i){
 let n=0;const nx=g.meta.nx,c=g.col[i];
 if(g.steps){const s=g.steps[i];for(let k=0;k<8;k++)if(s>>k&1){const j=g.first[c+DZ[k]*nx+DX[k]];if(j>=0)NB[n++]=j;}return n;}
 const d=g.dirs[i],p=g.pick[i];
 for(let k=0;k<8;k++)if(d>>k&1)NB[n++]=g.first[c+DZ[k]*nx+DX[k]]+(p>>>4*k&15);
 // Straight up or down through open water.
 if(g.flags[i]&2){const f=g.first[c];for(let j=f;j<f+g.many[c];j++)if(j!==i&&(g.swim[i]||g.swim[j])&&ok(g,i,j)&&n<16)NB[n++]=j;}
 return n;
}
// The open-ground spot nearest to a map point on one floor, within reach. Spots are sorted into 64 px squares per
// floor once (a counting sort), then only the squares within reach are searched.
function snap(g,p,reach=p.reach||90){
 const level=g.meta.levels.indexOf(p.level??g.meta.levels[0]),B=64;
 if(!g.sq){
  let mx=0,my=0;for(let i=0;i<g.count;i++){if(g.px[i]>mx)mx=g.px[i];if(g.py[i]>my)my=g.py[i];}
  const bw=Math.ceil(mx/B)+1,bh=Math.ceil(my/B)+1,nb=bw*bh*g.meta.levels.length,id=new Int32Array(g.count),start=new Int32Array(nb+1),order=new Int32Array(g.count);
  for(let i=0;i<g.count;i++){const bx=Math.max(0,Math.floor(g.px[i]/B)),by=Math.max(0,Math.floor(g.py[i]/B));id[i]=(g.lv[i]*bh+by)*bw+bx;start[id[i]+1]++;}
  for(let k=0;k<nb;k++)start[k+1]+=start[k];
  const fill=start.slice(0,nb);for(let i=0;i<g.count;i++)order[fill[id[i]]++]=i;
  g.sq={bw,bh,start,order};
 }
 const {bw,bh,start,order}=g.sq,r=Math.ceil(reach/B),bx=Math.floor(p.x/B),by=Math.floor(p.y/B);let best=-1,bd=reach*reach;
 for(let y=Math.max(0,by-r);y<=Math.min(bh-1,by+r);y++)for(let x=Math.max(0,bx-r);x<=Math.min(bw-1,bx+r);x++){
  const k=(level*bh+y)*bw+x;
  for(let q=start[k];q<start[k+1];q++){
   const i=order[q];
   // A spot with no way out (a cliff rim, a sealed nook) is never picked; dry ground wins over water close by.
   if(g.steps?!g.steps[i]:!g.dirs[i]&&!(g.flags[i]&2))continue;
   // Ground reachable from an entrance wins over roofs and cut-off ledges right under the pin.
   const dx=g.px[i]-p.x,dy=g.py[i]-p.y,d=dx*dx+dy*dy+(p.exact?0:(g.swim[i]?1600:0)+(g.flags[i]&4?0:6400));if(d<bd){bd=d;best=i;}
  }
 }
 return best;
}
function dist(g,a,b){return Math.hypot(g.x[a]-g.x[b],g.h[a]-g.h[b],g.z[a]-g.z[b]);}
const wet=(g,a,b)=>g.swim[a]||g.swim[b];
// True where more of the same floor runs overhead: the way passes beneath a hall or bridge drawn on top.
function under(g,i){if(g.swim[i])return false;const c=g.col[i],f=g.first[c];for(let j=f;j<f+g.many[c];j++)if(j!==i&&g.lv[j]===g.lv[i]&&!g.swim[j]&&g.h[j]>g.h[i]+2)return true;return false;}
// Danger spreads around each mob or trap on its own floor and fades to nothing at its edge.
function dangerField(g,dangers){
 const field=new Float32Array(g.count),nx=g.meta.nx,cell=g.meta.cell;
 for(const d of dangers){
  const at=d.node;if(at<0)continue;
  const r=d.radius,cc=g.col[at],ccx=cc%nx,ccz=Math.floor(cc/nx),span=Math.ceil(r/cell);
  for(let dz=-span;dz<=span;dz++)for(let dx=-span;dx<=span;dx++){
   const cx=ccx+dx,cz=ccz+dz;if(cx<0||cz<0||cx>=nx||cz>=g.meta.nz)continue;const c=cz*nx+cx,f=g.first[c];if(f<0)continue;
   for(let j=f;j<f+g.many[c];j++){if(Math.abs(g.h[j]-g.h[at])>4)continue;const s=Math.hypot(g.x[j]-g.x[at],g.z[j]-g.z[at]);if(s<r)field[j]+=d.weight*(s<r*.5?1:2*(1-s/r));}
  }
 }
 return field;
}
function route(req){
 const g=grounds[req.map];if(!g)throw Error('Route data is not ready.');
 const from=snap(g,req.from),to=snap(g,req.to);
 if(from<0)return {error:'The start is not on open ground or water. Pick a spot on a floor, corridor or path.'};
 if(to<0)return {error:'The finish is not on open ground or water. Pick a spot on a floor, corridor or path.'};
 const safer=req.mode==='safer',dangers=req.dangers||[],swimCost=g.meta.swim||2.5;
 for(const d of dangers)d.node=snap(g,d,140);
 const field=safer?dangerField(g,dangers):new Float32Array(g.count);
 // Marked links (stairs pins, drops, pit traps) and known openings join spots the ground alone does not.
 const extra=new Map(),add=(a,b,link)=>{if(!extra.has(a))extra.set(a,[]);extra.get(a).push({to:b,link});};
 for(const link of [...(req.links||[]),...(g.meta.joins||[])]){if(link.kind==='trap'&&safer)continue;const a=snap(g,link.from,60),b=snap(g,link.to,60);if(a<0||b<0||a===b)continue;add(a,b,link);if(!link.oneWay)add(b,a,link);}
 const n=g.count,cost=new Float32Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),via=[],viaOf=new Int32Array(n).fill(-1),closed=new Uint8Array(n);
 let heapI=new Int32Array(1<<16),heapF=new Float32Array(1<<16),size=0;
 const push=(i,f)=>{if(size>=heapI.length){const a=new Int32Array(heapI.length*2),b=new Float32Array(heapI.length*2);a.set(heapI);b.set(heapF);heapI=a;heapF=b;}let k=size++;while(k>0){const p=(k-1)>>1;if(heapF[p]<=f)break;heapI[k]=heapI[p];heapF[k]=heapF[p];k=p;}heapI[k]=i;heapF[k]=f;};
 const pop=()=>{const top=heapI[0],li=heapI[--size],lf=heapF[size];let k=0;for(;;){let c=2*k+1;if(c>=size)break;if(c+1<size&&heapF[c+1]<heapF[c])c++;if(heapF[c]>=lf)break;heapI[k]=heapI[c];heapF[k]=heapF[c];k=c;}heapI[k]=li;heapF[k]=lf;return top;};
 // The search leans towards the finish (1.3x, 1.8x on big maps) so it answers quickly; routes stay close to
 // the best.
 const lean=g.count>400000?1.8:1.3;cost[from]=0;push(from,lean*dist(g,from,to));
 while(size){
  const i=pop();if(closed[i])continue;closed[i]=1;if(i===to)break;
  // Neighbours are worked out only for the cells the search reaches.
  const m=neighbours(g,i);
  for(let q=0;q<m;q++){const j=NB[q];if(closed[j])continue;const c=cost[i]+dist(g,i,j)*(wet(g,i,j)?swimCost:1)*(1+(field[i]+field[j])/2);if(c<cost[j]){cost[j]=c;parent[j]=i;viaOf[j]=-1;push(j,c+lean*dist(g,j,to));}}
  for(const e of extra.get(i)||[]){const j=e.to;if(closed[j])continue;const c=cost[i]+(e.link.cost??4);if(c<cost[j]){cost[j]=c;parent[j]=i;viaOf[j]=via.push(e.link)-1;push(j,c+lean*dist(g,j,to));}}
 }
 if(!closed[to])return {error:'No known way between these two spots.'};
 const nodes=[],links=[];for(let i=to;i>=0;i=parent[i]){nodes.push(i);links.push(viaOf[i]>=0?via[viaOf[i]]:null);}
 nodes.reverse();links.reverse();
 return describe(g,smooth(g,nodes,links,field),dangers);
}
// Straight runs replace the grid's zigzag wherever the way between two points stays open on one floor.
function clear(g,a,b,field){
 if(g.lv[a]!==g.lv[b]||g.swim[a]!==g.swim[b])return false;
 const len=Math.hypot(g.x[b]-g.x[a],g.z[b]-g.z[a]),steps=Math.max(1,Math.ceil(len/(g.meta.cell*.5))),limit=Math.max(field[a],field[b])+.05,below=under(g,a);
 let prev=a;
 for(let s=1;s<=steps;s++){
  const t=s/steps,x=g.x[a]+(g.x[b]-g.x[a])*t,z=g.z[a]+(g.z[b]-g.z[a])*t,cx=Math.floor((x-g.meta.x0)/g.meta.cell),cz=Math.floor((z-g.meta.z0)/g.meta.cell);
  if(cx<0||cz<0||cx>=g.meta.nx||cz>=g.meta.nz)return false;
  const c=cz*g.meta.nx+cx,f=g.first[c];if(f<0)return false;
  let hit=-1,bd=Infinity;
  if(g.col[prev]===c)hit=prev;else for(let j=f;j<f+g.many[c];j++){const d=Math.abs(g.h[j]-g.h[prev]);if(d<bd&&ok(g,prev,j)){bd=d;hit=j;}}
  if(hit<0||field[hit]>limit||under(g,hit)!==below||g.swim[hit]!==g.swim[a])return false;
  prev=hit;
 }
 return true;
}
function smooth(g,nodes,links,field){
 const keep=[0];let i=0;
 while(i<nodes.length-1){
  let j=i+1;
  if(!links[j]){while(j+1<nodes.length&&!links[j+1]&&clear(g,nodes[i],nodes[j+1],field))j++;}
  keep.push(j);i=j;
 }
 return keep.map(k=>({node:nodes[k],link:links[k]}));
}
function describe(g,points,dangers){
 const levels=g.meta.levels,out=[],changes=[];let length=0,swum=0;
 points.forEach((p,k)=>{
  const i=p.node,pt={x:Math.round(g.px[i]*10)/10,y:Math.round(g.py[i]*10)/10,level:levels[g.lv[i]]};
  if(k){const prev=points[k-1].node;pt.d=Math.round((length+(p.link?0:dist(g,prev,i)))*10)/10;}else pt.d=0;
  if(under(g,i))pt.under=true;if(g.swim[i])pt.swim=true;out.push(pt);
  if(k){const prev=points[k-1].node,d=p.link?0:dist(g,prev,i);length+=d;if(g.swim[prev]&&g.swim[i])swum+=d;
   if(g.lv[prev]!==g.lv[i]||p.link)changes.push({index:k,from:levels[g.lv[prev]],to:levels[g.lv[i]],link:p.link?{name:p.link.name,kind:p.link.kind,id:p.link.id}:null});}
 });
 // Mobs the route still passes close to, nearest pass first; one at the start or the finish is where the walker wants to be.
 const passed=[],ends=[points[0].node,points[points.length-1].node];
 dangers.forEach((d,index)=>{
  const at=d.node??-1;if(at<0)return;
  if(ends.some(e=>Math.abs(g.h[e]-g.h[at])<=4&&Math.hypot(g.x[e]-g.x[at],g.z[e]-g.z[at])<d.radius))return;
  let near=Infinity;for(const p of points){const i=p.node;if(Math.abs(g.h[i]-g.h[at])>4)continue;near=Math.min(near,Math.hypot(g.x[i]-g.x[at],g.z[i]-g.z[at]));}
  if(near<d.radius)passed.push({index,distance:Math.round(near)});
 });
 return {points:out,changes,length:Math.round(length),swim:Math.round(swum),passed:passed.sort((a,b)=>a.distance-b.distance)};
}
self.onmessage=async e=>{
 const {id,type}=e.data;
 try{
  // Loading also files every spot into its square, so the first route does not wait for it.
  if(type==='load'){if(!grounds[e.data.map]){await load(e.data.meta,e.data.url,e.data.map);snap(grounds[e.data.map],{x:0,y:0},1);}self.postMessage({id,ok:true});return;}
  if(type==='route'){const t=performance.now(),result=route(e.data);result.ms=Math.round(performance.now()-t);self.postMessage({id,ok:true,result});}
 }catch(err){self.postMessage({id,ok:false,error:err.message||String(err)});}
};
