/* Finds walking routes on a map's ground file, away from the page. Messages: load, drop, route. */
'use strict';
// Each map's ground, loaded once.
const grounds={};

async function load(meta,url,key){
 if(meta.format==='raster'?meta.version!==3:meta.version!==4)throw Error('Route data for this map is out of date.');
 const res=await fetch(url);if(!res.ok)throw Error('Route data could not load.');
 const bytes=new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
 if(meta.format==='raster'){grounds[key]=loadRaster(meta,bytes);if(meta.drop>0)drops(grounds[key]);return;}
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
 const x=new Float32Array(count),z=new Float32Array(count),px=new Float32Array(count),py=new Float32Array(count);
 place(meta,col,h,lv,x,z,px,py);
 stretch(meta,px,py);
 grounds[key]={meta,count,col,h,ceil,surf,lv,swim,flags,dirs,pick,first,many,x,z,px,py};
}
// Map pixels of each cell. Floors drawn as separate sheets may each have their own projection (meta.projects, by floor).
function place(meta,col,h,lv,x,z,px,py){
 const pr=(meta.projects||[meta.project]).map(p=>[...p.x,...p.y]),many=!!meta.projects,{nx,cell,x0,z0}=meta;
 for(let i=0;i<col.length;i++){
  const k=pr[many?lv[i]:0],c=col[i],xi=(c%nx+.5)*cell+x0,zi=(Math.floor(c/nx)+.5)*cell+z0;
  x[i]=xi;z[i]=zi;px[i]=k[0]*xi+k[1]*h[i]+k[2]*zi+k[3];py[i]=k[4]*xi+k[5]*h[i]+k[6]*zi+k[7];
 }
}
// Maps whose art is gently stretched against the straight projection carry a grid of corrections (site px, tenths),
// read between the four nearest grid points.
function stretch(meta,px,py){
 const w=meta.warp;if(!w)return;
 const d=Float32Array.from(w.d,v=>v/10),inv=1/w.step,mu=w.nx-1.0001,mv=w.ny-1.0001,row=w.nx*2;
 for(let n=0;n<px.length;n++){
  const u=Math.min(mu,Math.max(0,(px[n]-w.x0)*inv)),v=Math.min(mv,Math.max(0,(py[n]-w.y0)*inv)),i=u|0,j=v|0,fu=u-i,fv=v-j;
  const a=(j*w.nx+i)*2,b=a+row,k00=(1-fu)*(1-fv),k10=fu*(1-fv),k01=(1-fu)*fv,k11=fu*fv;
  px[n]+=k00*d[a]+k10*d[a+2]+k01*d[b]+k11*d[b+2];py[n]+=k00*d[a+1]+k10*d[a+3]+k01*d[b+1]+k11*d[b+3];
 }
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
 const x=new Float32Array(count),z=new Float32Array(count),px=new Float32Array(count),py=new Float32Array(count);
 place(meta,col,h,lv,x,z,px,py);
 stretch(meta,px,py);
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
// Safe drops on open-ground maps (meta.drop: the highest fall that does no harm, measured in game): from a square to
// lower ground up to 2 squares away, falling more than a step and at most meta.drop, steeply (no walking down a slope
// the ground already offers). One way only. Kept as a list per square (dStart/dTo).
const DROP={name:'Jump down',kind:'drop'};
function drops(g){
 const {nx,nz,drop,step,cell}=g.meta,n=g.count,start=new Int32Array(n+1),to=[],off=[];
 for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++)if(dx||dz)off.push([dx,dz,Math.sqrt(dx*dx+dz*dz)*cell]);
 for(let i=0;i<n;i++){
  start[i]=to.length;
  // Only a square at an edge (some step out of it closed) can drop; open ground all round has nowhere to fall.
  if(g.swim[i]||g.steps[i]===255)continue;const c=g.col[i],cx=c%nx,cz=(c-cx)/nx,h=g.h[i];
  for(const [dx,dz,run] of off){
   const x=cx+dx,z=cz+dz;if(x<0||z<0||x>=nx||z>=nz)continue;
   const j=g.first[z*nx+x];if(j<0)continue;const fall=h-g.h[j];
   if(fall>step&&fall<=drop&&fall>=run)to.push(j);
  }
 }
 start[n]=to.length;g.dStart=start;g.dTo=Int32Array.from(to);
}
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
function snap(g,p,reach=p.reach||90,within=null){
 // A spot named on a floor this map's ground does not have is looked for on its only (or first) floor.
 const level=Math.max(0,g.meta.levels.indexOf(p.level??g.meta.levels[0])),B=64;
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
   if(within&&!within(g.px[i],g.py[i]))continue;
   // Ground reachable from an entrance wins over roofs and cut-off ledges right under the pin.
   const dx=g.px[i]-p.x,dy=g.py[i]-p.y,d=dx*dx+dy*dy+(p.h===undefined?0:4*(g.h[i]-p.h)**2)+(p.exact?0:(g.swim[i]?1600:0)+(g.flags[i]&4?0:6400));if(d<bd){bd=d;best=i;}
  }
 }
 return best;
}
function inside(poly,x,y){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
// (Math.hypot is slow in browsers; this runs for every step the search looks at.)
function dist(g,a,b){const dx=g.x[a]-g.x[b],dy=g.h[a]-g.h[b],dz=g.z[a]-g.z[b];return Math.sqrt(dx*dx+dy*dy+dz*dz);}
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
 // An exit sign drawn away from its doorway (on a roof, over a hall) routes to the doorway the map's data names.
 const door=p=>{const d=p.reach&&(g.meta.doors||[]).find(d=>Math.abs(d.at[0]-p.x)<1&&Math.abs(d.at[1]-p.y)<1);return d?{...p,x:d.x,y:d.y,h:d.h,level:d.level??p.level,exact:true}:p;};
 // A pin drawn off the open ground (on a rock, in a roughly placed camp) takes the nearest ground within 260 px;
 // a camp drawn as an area (mobs flying over a lake) takes the nearest ground inside its area.
 const near=p=>{const q=door(p),i=snap(g,q);if(i>=0||q.exact)return i;const j=snap(g,q,260);if(j>=0||!p.edge)return j;
  const e=p.edge;let r=0;for(const [x,y] of e)r=Math.max(r,Math.hypot(x-p.x,y-p.y));
  return snap(g,{...q,reach:undefined},r,(x,y)=>inside(e,x,y));};
 const from=near(req.from),to=near(req.to);
 if(from<0)return {error:'The start is not on open ground or water. Pick a spot on a floor, corridor or path.'};
 if(to<0)return {error:'The finish is not on open ground or water. Pick a spot on a floor, corridor or path.'};
 const safer=req.mode==='safer',dangers=req.dangers||[],swimCost=g.meta.swim||2.5;
 for(const d of dangers)d.node=snap(g,d,140);
 const field=safer?dangerField(g,dangers):new Float32Array(g.count);
 // Marked links (stairs pins, drops, pit traps) and known openings join spots the ground alone does not.
 const extra=new Map(),add=(a,b,link)=>{if(!extra.has(a))extra.set(a,[]);extra.get(a).push({to:b,link});};
 for(const link of [...(req.links||[]),...(g.meta.joins||[])]){if(link.kind==='trap'&&safer)continue;const a=snap(g,link.from,60),b=snap(g,link.to,60);if(a<0||b<0||a===b)continue;add(a,b,link);if(!link.oneWay)add(b,a,link);}
 // Long routes on big maps go by blocks first (see corridor); a short hop, or a corridor that turns out closed,
 // searches every square. The search leans towards the finish so it answers quickly; routes stay close to the best.
 let found=null;
 // A block can be crossed in one place but not another, so a corridor that fails is tried once more, wider.
 if(g.count>150000&&dist(g,from,to)>150)for(const spread of safer?[3,8]:[2,6]){const keep=corridor(g,from,to,extra,spread);if(!keep)break;found=search(g,from,to,field,extra,keep,1.3,swimCost);if(found)break;}
 if(!found)found=search(g,from,to,field,extra,null,g.count>400000?1.8:1.3,swimCost);
 if(!found)return {error:'No known way between these two spots.'};
 const {nodes,links}=found;
 const out=describe(g,smooth(g,nodes,links,field),dangers);out.cost=Math.round(found.cost);return out;
}
// ---- search
// Big maps hold a million squares or more, so a long route is found in two passes: first across blocks of squares
// (about 48 m a side, per floor), then square by square inside the blocks that first pass crossed and their
// neighbours. If that corridor turns out closed, the whole map is searched.
function blocks(g){
 if(g.cg)return g.cg;
 // Pieces: the squares of one block (about 48 m a side, one floor) that join up inside it. A block holding a
 // street and the roof above it, or two sides of a wall, has one piece for each, so the first pass never
 // crosses where the ground does not.
 const nx=g.meta.nx,B=Math.max(6,Math.round(48/g.meta.cell)),bw=Math.ceil(nx/B),bh=Math.ceil(g.meta.nz/B);
 const blk=new Int32Array(g.count);
 for(let i=0;i<g.count;i++){const c=g.col[i];blk[i]=(g.lv[i]*bh+Math.floor(Math.floor(c/nx)/B))*bw+Math.floor((c%nx)/B);}
 const piece=new Int32Array(g.count).fill(-1),queue=new Int32Array(g.count),cx=[],cz=[],ch=[];let np=0;
 for(let s=0;s<g.count;s++){
  if(piece[s]>=0)continue;
  let head=0,tail=0,sx=0,sz=0,sh=0;queue[tail++]=s;piece[s]=np;
  while(head<tail){const i=queue[head++];sx+=g.x[i];sz+=g.z[i];sh+=g.h[i];const m=neighbours(g,i);
   for(let q=0;q<m;q++){const j=NB[q];if(piece[j]<0&&blk[j]===blk[i]){piece[j]=np;queue[tail++]=j;}}}
  cx.push(sx/tail);cz.push(sz/tail);ch.push(sh/tail);np++;
 }
 // Piece steps: any square step from one piece into another.
 const pairs=new Set();
 for(let i=0;i<g.count;i++){const m=neighbours(g,i),a=piece[i];for(let q=0;q<m;q++){const b=piece[NB[q]];if(b!==a)pairs.add(a*np+b);}
  if(g.dStart)for(let q=g.dStart[i];q<g.dStart[i+1];q++){const b=piece[g.dTo[q]];if(b!==a)pairs.add(a*np+b);}}
 const start=new Uint32Array(np+1);for(const p of pairs)start[Math.floor(p/np)+1]++;for(let b=0;b<np;b++)start[b+1]+=start[b];
 const adj=new Int32Array(pairs.size),fill=start.slice(0,np);for(const p of pairs){const a=Math.floor(p/np);adj[fill[a]++]=p-a*np;}
 return g.cg={np,piece,cx:Float64Array.from(cx),cz:Float64Array.from(cz),ch:Float64Array.from(ch),start,adj};
}
function corridor(g,from,to,extra,spread){
 const {np,piece,cx,cz,ch,start,adj}=blocks(g),a=piece[from],z=piece[to];
 const d=(p,q)=>{const dx=cx[p]-cx[q],dy=ch[p]-ch[q],dz=cz[p]-cz[q];return Math.sqrt(dx*dx+dy*dy+dz*dz);};
 // The request's own links (stairs pins, joins) join pieces too.
 const more=new Map();for(const [i,list] of extra)for(const e of list){const p=piece[i];if(!more.has(p))more.set(p,[]);more.get(p).push(piece[e.to]);}
 const cost=new Float64Array(np).fill(Infinity),parent=new Int32Array(np).fill(-1),done=new Uint8Array(np),heap=[];
 const push=(b,f)=>{heap.push([f,b]);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p][0]<=f)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}};
 const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;for(;;){let c=2*i+1;if(c>=heap.length)break;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=heap[i][0])break;[heap[c],heap[i]]=[heap[i],heap[c]];i=c;}}return top;};
 cost[a]=0;push(a,d(a,z));
 while(heap.length){
  const [,b]=pop();if(done[b])continue;done[b]=1;if(b===z)break;
  const step=c=>{if(done[c])return;const v=cost[b]+d(b,c);if(v<cost[c]){cost[c]=v;parent[c]=b;push(c,v+d(c,z));}};
  for(let q=start[b];q<start[b+1];q++)step(adj[q]);
  for(const c of more.get(b)||[])step(c);
 }
 if(!done[z])return null;
 // The pieces crossed, and those up to `spread` steps from them, so the square search can still go round things.
 const keep=new Uint8Array(np);let ring=[];
 for(let b=z;b>=0;b=parent[b]){keep[b]=1;ring.push(b);}
 for(let r=0;r<spread;r++){const next=[];for(const b of ring)for(let q=start[b];q<start[b+1];q++){const c=adj[q];if(!keep[c]){keep[c]=1;next.push(c);}}ring=next;}
 return keep;
}
// A* over the squares. Work arrays are kept per map and reused; `gen` marks which entries belong to this search.
function search(g,from,to,field,extra,keep,lean,swimCost){
 const n=g.count;
 if(!g.work)g.work={cost:new Float32Array(n),parent:new Int32Array(n),viaOf:new Int32Array(n),mark:new Uint32Array(n),gen:0,heapI:new Int32Array(1<<16),heapF:new Float32Array(1<<16)};
 const w=g.work,gen=w.gen+=2,open=gen,shut=gen+1,{cost,parent,viaOf,mark}=w,via=[],blk=keep?g.cg.piece:null;
 // On maps with painted roads (flag 8), a step off them counts meta.offroad times its length, so routes keep to roads.
 const off=g.meta.offroad||1,fl=g.flags;
 let size=0,heapI=w.heapI,heapF=w.heapF;
 const push=(i,f)=>{if(size>=heapI.length){const a=new Int32Array(heapI.length*2),b=new Float32Array(heapI.length*2);a.set(heapI);b.set(heapF);heapI=w.heapI=a;heapF=w.heapF=b;}let k=size++;while(k>0){const p=(k-1)>>1;if(heapF[p]<=f)break;heapI[k]=heapI[p];heapF[k]=heapF[p];k=p;}heapI[k]=i;heapF[k]=f;};
 const pop=()=>{const top=heapI[0],li=heapI[--size],lf=heapF[size];let k=0;for(;;){let c=2*k+1;if(c>=size)break;if(c+1<size&&heapF[c+1]<heapF[c])c++;if(heapF[c]>=lf)break;heapI[k]=heapI[c];heapF[k]=heapF[c];k=c;}heapI[k]=li;heapF[k]=lf;return top;};
 const relax=(i,j,c,link)=>{if(mark[j]===shut)return;if(mark[j]!==open||c<cost[j]){mark[j]=open;cost[j]=c;parent[j]=i;viaOf[j]=link?via.push(link)-1:-1;push(j,c+lean*dist(g,j,to));}};
 mark[from]=open;cost[from]=0;parent[from]=-1;viaOf[from]=-1;push(from,lean*dist(g,from,to));
 while(size){
  const i=pop();if(mark[i]===shut)continue;mark[i]=shut;if(i===to)break;
  // Neighbours are worked out only for the squares the search reaches.
  const m=neighbours(g,i);
  for(let q=0;q<m;q++){const j=NB[q];if(keep&&!keep[blk[j]])continue;relax(i,j,cost[i]+dist(g,i,j)*(wet(g,i,j)?swimCost:off>1&&!(fl[i]&fl[j]&8)?off:1)*(1+(field[i]+field[j])/2),null);}
  for(const e of extra.get(i)||[])relax(i,e.to,cost[i]+(e.link.cost??4),e.link);
  if(g.dStart)for(let q=g.dStart[i];q<g.dStart[i+1];q++){const j=g.dTo[q];if(!keep||keep[blk[j]])relax(i,j,cost[i]+dist(g,i,j)+2,DROP);}
 }
 if(mark[to]!==shut)return null;
 const nodes=[],links=[];for(let i=to;i>=0;i=parent[i]){nodes.push(i);links.push(viaOf[i]>=0?via[viaOf[i]]:null);}
 nodes.reverse();links.reverse();
 return {nodes,links,cost:cost[to]};
}
// Straight runs replace the grid's zigzag wherever the way between two points stays open on one floor.
function clear(g,a,b,field){
 if(g.lv[a]!==g.lv[b]||g.swim[a]!==g.swim[b])return false;
 const len=Math.hypot(g.x[b]-g.x[a],g.z[b]-g.z[a]),steps=Math.max(1,Math.ceil(len/(g.meta.cell*.5))),limit=Math.max(field[a],field[b])+.05,below=under(g,a);
 // A run between two road squares stays on the road (no cutting across the grass at a bend).
 const road=(g.meta.offroad||1)>1&&g.flags[a]&g.flags[b]&8;
 let prev=a;
 for(let s=1;s<=steps;s++){
  const t=s/steps,x=g.x[a]+(g.x[b]-g.x[a])*t,z=g.z[a]+(g.z[b]-g.z[a])*t,cx=Math.floor((x-g.meta.x0)/g.meta.cell),cz=Math.floor((z-g.meta.z0)/g.meta.cell);
  if(cx<0||cz<0||cx>=g.meta.nx||cz>=g.meta.nz)return false;
  const c=cz*g.meta.nx+cx,f=g.first[c];if(f<0)return false;
  // Each square the straight run crosses must be one step of the route graph from the last, on the same floor.
  let hit=-1,bd=Infinity;
  if(g.col[prev]===c)hit=prev;else{const m=neighbours(g,prev);for(let q=0;q<m;q++){const j=NB[q];if(g.col[j]!==c)continue;const d=Math.abs(g.h[j]-g.h[prev]);if(d<bd){bd=d;hit=j;}}}
  if(hit<0||g.lv[hit]!==g.lv[a]||field[hit]>limit||under(g,hit)!==below||g.swim[hit]!==g.swim[a]||road&&!(g.flags[hit]&8))return false;
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
   if(g.lv[prev]!==g.lv[i]||p.link)changes.push({index:k,from:levels[g.lv[prev]],to:levels[g.lv[i]],rise:Math.round((g.h[i]-g.h[prev])*10)/10,link:p.link?{name:p.link.name,kind:p.link.kind,id:p.link.id}:null});}
 });
 // Mobs the route still passes close to, nearest pass first; one at the start or the finish is where the walker wants to be.
 const passed=[],ends=[points[0].node,points[points.length-1].node];
 dangers.forEach((d,index)=>{
  const at=d.node??-1;if(at<0)return;
  if(ends.some(e=>Math.abs(g.h[e]-g.h[at])<=4&&Math.hypot(g.x[e]-g.x[at],g.z[e]-g.z[at])<d.radius))return;
  // Nearest approach along each walked run (a straight run can pass a camp between its two ends); jumps along a link are not walked.
  let near=Infinity;
  for(let k=0;k<points.length;k++){
   const i=points[k].node;if(Math.abs(g.h[i]-g.h[at])<=4)near=Math.min(near,Math.hypot(g.x[i]-g.x[at],g.z[i]-g.z[at]));
   if(!k||points[k].link)continue;const j=points[k-1].node;if(Math.abs(g.h[j]-g.h[at])>4&&Math.abs(g.h[i]-g.h[at])>4)continue;
   const dx=g.x[i]-g.x[j],dz=g.z[i]-g.z[j],t=Math.max(0,Math.min(1,((g.x[at]-g.x[j])*dx+(g.z[at]-g.z[j])*dz)/(dx*dx+dz*dz||1)));
   near=Math.min(near,Math.hypot(g.x[j]+dx*t-g.x[at],g.z[j]+dz*t-g.z[at]));
  }
  if(near<d.radius)passed.push({index,distance:Math.round(near)});
 });
 return {points:out,changes,length:Math.round(length),swim:Math.round(swum),passed:passed.sort((a,b)=>a.distance-b.distance)};
}
self.onmessage=async e=>{
 const {id,type}=e.data;
 try{
  // Loading also files every spot into its square (and big maps into blocks), so the first route does not wait.
  if(type==='load'){if(!grounds[e.data.map]){await load(e.data.meta,e.data.url,e.data.map);const g=grounds[e.data.map];snap(g,{x:0,y:0},1);if(g.count>150000)blocks(g);}self.postMessage({id,ok:true});return;}
  if(type==='drop'){delete grounds[e.data.map];self.postMessage({id,ok:true});return;}
  if(type==='route'){const t=performance.now(),result=route(e.data);result.ms=Math.round(performance.now()-t);self.postMessage({id,ok:true,result});}
 }catch(err){self.postMessage({id,ok:false,error:err.message||String(err)});}
};
