/* Finds walking routes on a map's ground file, away from the page. Messages: load, route. */
'use strict';
let ground=null;
const DIRS=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

async function load(meta,url){
 const res=await fetch(url);if(!res.ok)throw Error('Route data could not load.');
 const bytes=new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
 const view=new DataView(bytes.buffer),count=view.getUint32(0,true),col=new Uint32Array(count);
 let o=4,c=0;
 for(let i=0;i<count;i++){let v=0,s=0,b;do{b=bytes[o++];v+=(b&127)*2**s;s+=7;}while(b&128);c+=v;col[i]=c;}
 const tenths=()=>{const a=new Float32Array(count);for(let i=0;i<count;i++)a[i]=view.getInt16(o+i*2,true)/10;o+=count*2;return a;};
 const h=tenths(),ceil=tenths(),surf=tenths(),lv=bytes.slice(o,o+count),swim=bytes.slice(o+count,o+2*count);
 const first=new Int32Array(meta.nx*meta.nz).fill(-1),many=new Uint8Array(meta.nx*meta.nz);
 for(let i=count-1;i>=0;i--){first[col[i]]=i;many[col[i]]++;}
 const x=new Float32Array(count),z=new Float32Array(count),px=new Float32Array(count),py=new Float32Array(count),[ax,ay,az,bx]=meta.project.x,[cx,cy,cz,by]=meta.project.y;
 for(let i=0;i<count;i++){x[i]=(col[i]%meta.nx+.5)*meta.cell+meta.x0;z[i]=(Math.floor(col[i]/meta.nx)+.5)*meta.cell+meta.z0;px[i]=ax*x[i]+ay*h[i]+az*z[i]+bx;py[i]=cx*x[i]+cy*h[i]+cz*z[i]+by;}
 ground={meta,count,col,h,ceil,surf,lv,swim,first,many,x,z,px,py,adj:new Int32Array(count*MAXN).fill(-2)};
}
// Can the walker go from cell i to cell j? Up or down a step, through open water, or off a ledge into deep water.
function ok(g,i,j){
 const hi_=g.h[i],hj=g.h[j],lo=hi_<=hj?i:j,top=Math.max(hi_,hj);
 if(g.swim[lo]&&top<=g.ceil[lo]&&top<=g.surf[lo]+g.meta.step)return true;
 if(Math.abs(hj-hi_)<=g.meta.step)return true;
 return hi_>hj&&g.swim[j]&&hi_>=g.surf[j]&&hi_<=g.surf[j]+6;
}
function stepTo(g,i,dx,dz){
 const nx=g.meta.nx,cx=g.col[i]%nx+dx,cz=Math.floor(g.col[i]/nx)+dz;
 if(cx<0||cz<0||cx>=nx||cz>=g.meta.nz)return -1;
 const c=cz*nx+cx,f=g.first[c];if(f<0)return -1;
 let best=-1,bd=Infinity;
 for(let j=f;j<f+g.many[c];j++){const d=Math.abs(g.h[j]-g.h[i]);if(d<bd&&ok(g,i,j)){bd=d;best=j;}}
 return best;
}
// Each cell's neighbours, worked out the first time a search reaches it and kept for later routes.
const MAXN=12;
function neighbours(g,i){
 const base=i*MAXN;
 if(g.adj[base]!==-2){const out=[];for(let k=base;k<base+MAXN&&g.adj[k]>=0;k++)out.push(g.adj[k]);return out;}
 const out=[],orth=[];
 for(let k=0;k<4;k++){const [dx,dz]=DIRS[k];orth.push(stepTo(g,i,dx,dz));if(orth[k]>=0)out.push(orth[k]);}
 // A diagonal step needs both sides open, so it never cuts a corner.
 for(let k=4;k<8;k++){const [dx,dz]=DIRS[k];if(orth[dx>0?0:1]<0||orth[dz>0?2:3]<0)continue;const j=stepTo(g,i,dx,dz);if(j>=0)out.push(j);}
 // Straight up or down through open water.
 const c=g.col[i],f=g.first[c];for(let j=f;j<f+g.many[c];j++)if(j!==i&&(g.swim[i]||g.swim[j])&&ok(g,i,j))out.push(j);
 g.adj.fill(-1,base,base+MAXN);for(let k=0;k<out.length&&k<MAXN;k++)g.adj[base+k]=out[k];
 return out;
}
// The open-ground spot nearest to a map point on one floor, within reach.
function snap(g,p,reach=90){
 const level=g.meta.levels.indexOf(p.level??g.meta.levels[0]);let best=-1,bd=reach*reach;
 for(let i=0;i<g.count;i++){if(g.lv[i]!==level)continue;const dx=g.px[i]-p.x,dy=g.py[i]-p.y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=i;}}
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
 const g=ground;if(!g)throw Error('Route data is not ready.');
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
 cost[from]=0;push(from,dist(g,from,to));
 while(size){
  const i=pop();if(closed[i])continue;closed[i]=1;if(i===to)break;
  // Neighbours are worked out only for the cells the search reaches.
  for(const j of neighbours(g,i)){if(closed[j])continue;const c=cost[i]+dist(g,i,j)*(wet(g,i,j)?swimCost:1)*(1+(field[i]+field[j])/2);if(c<cost[j]){cost[j]=c;parent[j]=i;viaOf[j]=-1;push(j,c+dist(g,j,to));}}
  for(const e of extra.get(i)||[]){const j=e.to;if(closed[j])continue;const c=cost[i]+(e.link.cost??4);if(c<cost[j]){cost[j]=c;parent[j]=i;viaOf[j]=via.push(e.link)-1;push(j,c+dist(g,j,to));}}
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
  if(type==='load'){await load(e.data.meta,e.data.url);self.postMessage({id,ok:true});return;}
  if(type==='route'){const t=performance.now(),result=route(e.data);result.ms=Math.round(performance.now()-t);self.postMessage({id,ok:true,result});}
 }catch(err){self.postMessage({id,ok:false,error:err.message||String(err)});}
};
