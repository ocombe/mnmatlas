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
 const h=new Float32Array(count),lv=new Uint8Array(count);
 for(let i=0;i<count;i++)h[i]=view.getInt16(o+i*2,true)/10;o+=count*2;
 lv.set(bytes.subarray(o,o+count));
 const first=new Int32Array(meta.nx*meta.nz).fill(-1),many=new Uint8Array(meta.nx*meta.nz);
 for(let i=count-1;i>=0;i--){first[col[i]]=i;many[col[i]]++;}
 const x=new Float32Array(count),z=new Float32Array(count),px=new Float32Array(count),py=new Float32Array(count),[ax,ay,az,bx]=meta.project.x,[cx,cy,cz,by]=meta.project.y;
 for(let i=0;i<count;i++){x[i]=(col[i]%meta.nx+.5)*meta.cell+meta.x0;z[i]=(Math.floor(col[i]/meta.nx)+.5)*meta.cell+meta.z0;px[i]=ax*x[i]+ay*h[i]+az*z[i]+bx;py[i]=cx*x[i]+cy*h[i]+cz*z[i]+by;}
 const g={meta,count,col,h,lv,first,many,x,z,px,py},adj=new Int32Array(count*8).fill(-1),nb=new Int32Array(8);
 for(let i=0;i<count;i++){const n=neighbours(g,i,nb);for(let k=0;k<n;k++)adj[i*8+k]=nb[k];}
 g.adj=adj;g.region=regions(g);ground=g;
}
// The node in a neighbouring column a walker can step to from node i, or -1.
function stepTo(g,i,dx,dz){
 const nx=g.meta.nx,cx=g.col[i]%nx+dx,cz=Math.floor(g.col[i]/nx)+dz;
 if(cx<0||cz<0||cx>=nx||cz>=g.meta.nz)return -1;
 const c=cz*nx+cx,f=g.first[c];if(f<0)return -1;
 let best=-1,bd=g.meta.step;
 for(let j=f;j<f+g.many[c];j++){const d=Math.abs(g.h[j]-g.h[i]);if(d<=bd){bd=d;best=j;}}
 return best;
}
function neighbours(g,i,out){
 let n=0;
 for(let k=0;k<8;k++){const [dx,dz]=DIRS[k],j=stepTo(g,i,dx,dz);if(j<0)continue;if(k>=4&&(stepTo(g,i,dx,0)<0||stepTo(g,i,0,dz)<0))continue;out[n++]=j;}
 return n;
}
// Separate stretches of ground (a sealed cave, a balcony) get their own number.
function regions(g){
 const id=new Int32Array(g.count).fill(-1),queue=new Int32Array(g.count);let r=0;
 for(let s=0;s<g.count;s++){if(id[s]>=0)continue;let a=0,b=0;queue[b++]=s;id[s]=r;while(a<b){const i=queue[a++];for(let k=i*8;k<i*8+8;k++){const j=g.adj[k];if(j>=0&&id[j]<0){id[j]=r;queue[b++]=j;}}}r++;}
 return id;
}
// The open-ground spot nearest to a map point on one floor, within reach.
function snap(g,p,reach=90){
 const level=g.meta.levels.indexOf(p.level??g.meta.levels[0]);let best=-1,bd=reach*reach;
 for(let i=0;i<g.count;i++){if(g.lv[i]!==level)continue;const dx=g.px[i]-p.x,dy=g.py[i]-p.y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=i;}}
 return best;
}
// True where more of the same floor runs overhead: the way passes beneath a hall or bridge drawn on top.
function under(g,i){const c=g.col[i],f=g.first[c];for(let j=f;j<f+g.many[c];j++)if(j!==i&&g.lv[j]===g.lv[i]&&g.h[j]>g.h[i]+2)return true;return false;}
function dist(g,a,b){return Math.hypot(g.x[a]-g.x[b],g.h[a]-g.h[b],g.z[a]-g.z[b]);}
// Danger spreads around each mob or trap on its own floor and fades to nothing at its edge.
function dangerField(g,dangers){
 const field=new Float32Array(g.count),hits=[],nx=g.meta.nx,cell=g.meta.cell;
 dangers.forEach((d,index)=>{
  const at=snap(g,d,140);if(at<0)return;d.node=at;hits.push(index);
  const r=d.radius,cc=g.col[at],ccx=cc%nx,ccz=Math.floor(cc/nx),span=Math.ceil(r/cell);
  for(let dz=-span;dz<=span;dz++)for(let dx=-span;dx<=span;dx++){
   const cx=ccx+dx,cz=ccz+dz;if(cx<0||cz<0||cx>=nx||cz>=g.meta.nz)continue;const c=cz*nx+cx,f=g.first[c];if(f<0)continue;
   for(let j=f;j<f+g.many[c];j++){if(Math.abs(g.h[j]-g.h[at])>4)continue;const s=Math.hypot(g.x[j]-g.x[at],g.z[j]-g.z[at]);if(s<r)field[j]+=d.weight*(s<r*.5?1:2*(1-s/r));}
  }
 });
 return field;
}
function route(req){
 const g=ground;if(!g)throw Error('Route data is not ready.');
 const from=snap(g,req.from),to=snap(g,req.to);
 if(from<0)return {error:'The start is not on open ground. Pick a spot on a floor, corridor or path.'};
 if(to<0)return {error:'The finish is not on open ground. Pick a spot on a floor, corridor or path.'};
 const safer=req.mode==='safer',field=safer?dangerField(g,req.dangers||[]):new Float32Array(g.count);
 // Marked links (stairs pins, drops, pit traps) join spots the ground alone does not.
 const extra=new Map(),add=(a,b,link)=>{if(!extra.has(a))extra.set(a,[]);extra.get(a).push({to:b,link});};
 for(const link of req.links||[]){if(link.kind==='trap'&&safer)continue;const a=snap(g,link.from,60),b=snap(g,link.to,60);if(a<0||b<0||a===b)continue;link.a=a;link.b=b;add(a,b,link);if(!link.oneWay)add(b,a,link);}
 const n=g.count,cost=new Float32Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),via=new Array(0),viaOf=new Int32Array(n).fill(-1),closed=new Uint8Array(n);
 let heapI=new Int32Array(1<<16),heapF=new Float32Array(1<<16),size=0;
 const push=(i,f)=>{if(size>=heapI.length){const a=new Int32Array(heapI.length*2),b=new Float32Array(heapI.length*2);a.set(heapI);b.set(heapF);heapI=a;heapF=b;}let k=size++;while(k>0){const p=(k-1)>>1;if(heapF[p]<=f)break;heapI[k]=heapI[p];heapF[k]=heapF[p];k=p;}heapI[k]=i;heapF[k]=f;};
 const pop=()=>{const top=heapI[0],li=heapI[--size],lf=heapF[size];let k=0;for(;;){let c=2*k+1;if(c>=size)break;if(c+1<size&&heapF[c+1]<heapF[c])c++;if(heapF[c]>=lf)break;heapI[k]=heapI[c];heapF[k]=heapF[c];k=c;}heapI[k]=li;heapF[k]=lf;return top;};
 cost[from]=0;push(from,dist(g,from,to));let expanded=0;
 while(size){
  const i=pop();if(closed[i])continue;closed[i]=1;expanded++;if(i===to)break;
  for(let k=i*8;k<i*8+8;k++){const j=g.adj[k];if(j<0)break;if(closed[j])continue;const c=cost[i]+dist(g,i,j)*(1+(field[i]+field[j])/2);if(c<cost[j]){cost[j]=c;parent[j]=i;viaOf[j]=-1;push(j,c+dist(g,j,to));}}
  for(const e of extra.get(i)||[]){const j=e.to;if(closed[j])continue;const c=cost[i]+(e.link.cost??4);if(c<cost[j]){cost[j]=c;parent[j]=i;viaOf[j]=via.push(e.link)-1;push(j,c+dist(g,j,to));}}
 }
 if(!closed[to])return {error:'No known way between these two spots.'};
 const nodes=[],links=[];for(let i=to;i>=0;i=parent[i]){nodes.push(i);links.push(viaOf[i]>=0?via[viaOf[i]]:null);}
 nodes.reverse();links.reverse();
 return describe(g,smooth(g,nodes,links,field),req,field);
}
// Straight runs replace the grid's zigzag wherever the ground between two points is open on one floor.
function clear(g,a,b,field){
 if(g.lv[a]!==g.lv[b])return false;
 const len=Math.hypot(g.x[b]-g.x[a],g.z[b]-g.z[a]),steps=Math.max(1,Math.ceil(len/(g.meta.cell*.5))),limit=Math.max(field[a],field[b])+.05;
 let prev=a;const below=under(g,a);
 for(let s=1;s<=steps;s++){
  const t=s/steps,x=g.x[a]+(g.x[b]-g.x[a])*t,z=g.z[a]+(g.z[b]-g.z[a])*t,cx=Math.floor((x-g.meta.x0)/g.meta.cell),cz=Math.floor((z-g.meta.z0)/g.meta.cell);
  if(cx<0||cz<0||cx>=g.meta.nx||cz>=g.meta.nz)return false;
  const c=cz*g.meta.nx+cx,f=g.first[c];if(f<0)return false;
  let hit=-1,bd=g.meta.step;for(let j=f;j<f+g.many[c];j++){const d=Math.abs(g.h[j]-g.h[prev]);if(d<=bd){bd=d;hit=j;}}
  if(hit<0||field[hit]>limit||under(g,hit)!==below)return false;
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
function describe(g,points,req,field){
 const levels=g.meta.levels,out=[];let length=0,changes=[];
 points.forEach((p,k)=>{
  const i=p.node;out.push({x:Math.round(g.px[i]*10)/10,y:Math.round(g.py[i]*10)/10,level:levels[g.lv[i]],...(under(g,i)?{under:true}:{})});
  if(k){const prev=points[k-1].node;length+=p.link?0:dist(g,prev,i);if(g.lv[prev]!==g.lv[i]||p.link)changes.push({index:k,from:levels[g.lv[prev]],to:levels[g.lv[i]],link:p.link?{name:p.link.name,kind:p.link.kind,id:p.link.id}:null});}
 });
 // Mobs the route still passes close to, nearest pass first.
 const passed=[];
 (req.dangers||[]).forEach((d,index)=>{
  const at=d.node??snap(g,d,140);if(at<0)return;let near=Infinity;
  // A mob at the start or the finish is where the walker wants to be, not something passed on the way.
  const ends=[points[0].node,points[points.length-1].node];if(ends.some(e=>Math.abs(g.h[e]-g.h[at])<=4&&Math.hypot(g.x[e]-g.x[at],g.z[e]-g.z[at])<d.radius))return;
  for(const p of points){const i=p.node;if(Math.abs(g.h[i]-g.h[at])>4)continue;near=Math.min(near,Math.hypot(g.x[i]-g.x[at],g.z[i]-g.z[at]));}
  if(near<d.radius)passed.push({index,distance:Math.round(near)});
 });
 return {points:out,changes,length:Math.round(length),passed:passed.sort((a,b)=>a.distance-b.distance)};
}
self.onmessage=async e=>{
 const {id,type}=e.data;
 try{
  if(type==='load'){await load(e.data.meta,e.data.url);self.postMessage({id,ok:true});return;}
  if(type==='route'){const t=performance.now(),result=route(e.data);result.ms=Math.round(performance.now()-t);self.postMessage({id,ok:true,result});}
 }catch(err){self.postMessage({id,ok:false,error:err.message||String(err)});}
};
