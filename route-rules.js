/* Directions rules shared by the page (itinerary.js) and the hourly check (scripts/route-common.mjs), so both
   follow the same pins the same way: how paired pins join floors, and how a camp drawn as an area is reached. */
'use strict';
(root=>{
 // What a floor link costs in metres of walking, by kind.
 const COST={trap:2,teleport:2,lift:6,drop:2,stairs:4};
 const kindOf=m=>m.category==='Trap'?'trap':m.category==='Teleporter'?'teleport':m.category==='Lift'?'lift':/(^| )drop( |$)/i.test(m.name)?'drop':'stairs';
 // Paired level pins (stairs, ladders, lifts, drops, pit traps, teleporters) join floors; each pin is the way from its
 // own side. A pin with no floor to go to is a landing (where a drop or trap arrives), not a way back up.
 function floorLinks(markers,title=m=>m.name){
  const byId=new Map(markers.map(m=>[m.id,m]));
  return markers.filter(m=>m.toMarker&&m.toLevel&&!m.toMap&&byId.has(m.toMarker)).map(m=>{const b=byId.get(m.toMarker),kind=kindOf(m);
   return {id:m.id,name:title(m),from:{x:m.x,y:m.y,level:m.level},to:{x:b.x,y:b.y,level:b.level},oneWay:true,kind,cost:COST[kind]};});
 }
 // A camp drawn as an area (mobs flying over a lake) can be reached at its edge when its pin is off the ground.
 const edge=m=>m?.shape?.points?.length>2?{edge:m.shape.points}:{};
 root.atlasRouteRules={floorLinks,edge};
})(globalThis);
