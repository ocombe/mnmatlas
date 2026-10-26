// Directions outside the browser: the page's own rules (route-rules.js) and route finder (route-worker.js), run in
// Node for the hourly check (route-refresh.mjs) and for checks made while building route data.
import fs from 'fs';import vm from 'vm';import path from 'path';

export function rules(site){
 const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(site,'route-rules.js'),'utf8'),ctx);
 return ctx.atlasRouteRules;
}
// A map's route finder, loaded with its ground: route(from, to, links, mode='shorter') gives the finder's result.
export async function finder(site,map,meta){
 let reply;const ctx={self:{postMessage:m=>reply=m},fetch:async u=>new Response(fs.readFileSync(path.isAbsolute(u)?u:path.join(site,u))),Response,DecompressionStream,DataView,Uint8Array,Uint16Array,Uint32Array,Int32Array,Float32Array,Float64Array,performance,Math,Map,Set,Array,Error,console,Infinity};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(site,'route-worker.js'),'utf8'),ctx);
 const call=async m=>{reply=null;await ctx.self.onmessage({data:{...m,map}});if(reply?.error)throw Error(reply.error);return reply?.result;};
 await call({id:1,type:'load',meta,url:meta.file});
 return (from,to,links,mode='shorter')=>call({id:2,type:'route',from,to,mode,dangers:[],links});
}
