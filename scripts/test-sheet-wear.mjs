// The wear painted over a map's tiles: the same pixels however it is computed, and one painting per map and floor.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../sheet-edge.js',import.meta.url),'utf8');
let painted=0;
const canvas=()=>{const cv={width:0,height:0,getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),putImageData(image){cv.image=image;painted++;}})};return cv;};
const context=new Function('document','location','L',source+';return {sheetWear,sheetWearFor};')({createElement:canvas},{search:''},{});
const hash=cv=>createHash('sha256').update(cv.image.data).digest('hex').slice(0,16);
// Sums taken from the wear as published before it skipped the middle of the sheet (2026-11-04): any change to these is a change to the look.
const expected={'4320x3968/123':'bf742a49d29958e8','5120x5120/98765':'aafc2f4bacaf49ac','3000x1500/4242':'15d5df48b87f4f36','1200x4000/7':'dadad92a31d27b2d'};
for(const [width,height,seed] of [[4320,3968,123],[5120,5120,98765],[3000,1500,4242],[1200,4000,7]]){
 const sum=hash(context.sheetWear({x:0,y:0,width,height},seed)),key=width+'x'+height+'/'+seed;
 assert.equal(sum,expected[key],'Wear pixels unchanged for '+key);
}
{
 painted=0;const frame={x:0,y:0,width:2000,height:2000},a={id:'a',levelId:'lower'};
 const first=context.sheetWearFor(a,frame);assert.equal(context.sheetWearFor(a,frame),first,'A floor seen again reuses its painting');assert.equal(painted,1);
 assert.notEqual(context.sheetWearFor({id:'a',levelId:'upper'},frame),first,'Another floor gets its own wear');assert.equal(painted,2);
 for(let i=0;i<12;i++)context.sheetWearFor({id:'m'+i},frame);painted=0;context.sheetWearFor(a,frame);assert.equal(painted,1,'Only the most recent paintings are kept');
 console.log('Sheet wear checks passed: same pixels, one painting per floor.');
}
