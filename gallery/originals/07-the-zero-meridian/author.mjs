// Original composition 07: The Zero Meridian.
// The geometric positions, timing, materials, LUT curves and fault score below
// are independent authorial inputs. No other artwork or mutation is imported.
import { createRecipe, serializeRecipe } from '../../../src/recipe/index.js';

const Q=65536;
const q=(n)=>Math.round(n*Q);
const world=(x,y)=>{
 const cx=Math.floor(x/256),cy=Math.floor(y/256);
 return {chunkX:cx,chunkY:cy,localX:q(x-256*cx),localY:q(y-256*cy)};
};
const layer=(id,operator,parameters,origin=[0,0],enabled=false)=>({
 id,kind:'vector',operator,enabled,blend:'add',cellsPerChunk:256,
 transform:{origin:world(...origin),scaleXQ16:Q,scaleYQ16:Q},parameters,chunks:[]
});
const ramp=(first,last,size=32)=>Array.from({length:size},(_,i)=>Math.round(first+(last-first)*i/(size-1)));
const colorAsset=(id,name,start,end)=>({
 schemaVersion:'fw-lut-v1',id,name,size:32,
 channels:{a:Array(32).fill(65535),b:ramp(start[2],end[2]),g:ramp(start[1],end[1]),r:ramp(start[0],end[0])}
});
const mapColor=(id,materialId,lutId,maxAge)=>({
 version:'fw-lut-map-v1',id,materialId,lutId,source:'ageTicks',
 channel:'rgba',destination:'color',addressMode:'clamp',
 inputMin:0,inputMax:maxAge,scaleNumerator:1,scaleDenominator:1,bias:0,
 outputMin:0,outputMax:65535
});
const cmd=(id,tick,type,extras)=>({version:'fw-command-v1',id,tick,type,...extras});

export function createZeroMeridian(){
 const emitters=[];
 function line(ax,ay,bx,by,materialId=2,{startTick=2,duration=76,rate=1,spread=220}={}){
  const id=emitters.length+1;
  emitters.push({
   id,materialId,startTick,stopTick:startTick,intervalTicks:1,rate,bursts:[],
   geometry:{type:'box',origin:world(ax,ay),widthQ16:Math.max(500,spread*3),heightQ16:Math.max(500,spread*3)},
   velocityXQ16:q((bx-ax)/duration),velocityYQ16:q((by-ay)/duration),
   velocityJitterQ16:spread
  });
  return id;
 }
 // An eccentric outer compass, three deliberate omissions in its graduation.
 // Tangential chords are not a rendered line-drawing: each is a separate
 // reproducible material emitter whose filament traverses the canonical field.
 const angles=(a,b,step)=>{const out=[];for(let t=a;t<b;t+=step)out.push([t,Math.min(b,t+step)]);return out;};
 const arc=(cx,cy,rx,ry,intervals,step,mat,st,dr)=>{
  for(const [lo,hi] of intervals){
   for(const [a,b] of angles(lo,hi,step)){
    const t=a*Math.PI/180, u=b*Math.PI/180;
    line(cx+rx*Math.cos(t),cy+ry*Math.sin(t),cx+rx*Math.cos(u),cy+ry*Math.sin(u),mat,
     {startTick:st+(emitters.length%5),duration:dr,spread:mat===1?170:90});
   }
  }
 };
 // Ring A: bone-white, visibly interrupted at three compass bearings.
 arc(126,126,69,72,[[0,58],[82,163],[185,241],[286,354]],9,2,1,86);
 // Ring B: oblique rust register, not concentric with ring A.
 arc(130,129,47,53,[[11,113],[149,210],[247,326]],11,1,9,79);
 // Two displaced shadows of the original instrument.
 arc(123,126,83,78,[[116,163],[235,262]],9,4,18,64);
 // Twelve angular calibration marks; their shard material is axis quantised.
 for(let k=0;k<12;k++){
  const t=(k*30+11)*Math.PI/180;
  if(k===3||k===8)continue;
  const r=75,outer=82+(k%3===0?4:0);
  line(126+r*Math.cos(t),126+r*Math.sin(t),
       126+outer*Math.cos(t),126+outer*Math.sin(t),4,
       {startTick:14+k,duration:48,spread:90});
 }
 // The interrupted surveying needle crosses the empty centre in two colours,
 // with an intentional break at the point of registration.
 line(105,69,125,117,2,{startTick:4,duration:90,spread:95});
 line(133,131,157,185,2,{startTick:7,duration:91,spread:95});
 line(113,75,122,95,4,{startTick:11,duration:64,spread:120});
 line(142,158,158,184,4,{startTick:17,duration:65,spread:120});
 // Oblique abortive heading near the eastern wall of the dial.
 line(153,111,188,95,1,{startTick:21,duration:76,spread:110});
 line(188,95,202,78,1,{startTick:25,duration:64,spread:110});
 // Repeated calibration bars, trailing from outside the compass rather
 // than filling its intentionally unoccupied middle.
 for(let k=0;k<9;k++){
  const y=61+k*7.1;
  const a=202+(k%3)*1.7;
  line(a,y,a+8+(k%4)*2,y,3,{startTick:16+k*3,duration:42,spread:150});
 }
 // Quiet flecks at missing sectors: late dust signals interruption instead of
 // repainting the gaps.
 for(const [i,degree] of [66,72,172,176,268,274,355].entries()){
  const t=degree*Math.PI/180;
  const x=126+68*Math.cos(t),y=126+72*Math.sin(t);
  line(x,y,x+(i%2?3:-2),y+(i%3-1)*4,3,
       {startTick:34+i*5,duration:36,rate:2,spread:430});
 }
 // A separate, low, broken baseline counters the ring's circular authority.
 for(const [x1,x2] of [[55,81],[88,103],[120,145],[159,180]]){
  line(x1,38,x2,38,1,{startTick:32,duration:71,spread:75});
 }
 const materials=[
  {id:1,kind:'ink',inertiaNumerator:1,inertiaDenominator:1,steeringNumerator:1,steeringDenominator:42,lifetimeTicks:96,depositEvery:1,primitive:'disc',radiusQ16:31500,strengthQ16:58000,quantizeAxis:false},
  {id:2,kind:'filament',inertiaNumerator:1,inertiaDenominator:1,steeringNumerator:1,steeringDenominator:52,lifetimeTicks:116,depositEvery:1,primitive:'segment',radiusQ16:30000,strengthQ16:65536,quantizeAxis:false},
  {id:3,kind:'dust',inertiaNumerator:1,inertiaDenominator:3,steeringNumerator:2,steeringDenominator:3,lifetimeTicks:54,depositEvery:1,primitive:'point',radiusQ16:18000,strengthQ16:53000,quantizeAxis:false},
  {id:4,kind:'shard',inertiaNumerator:1,inertiaDenominator:1,steeringNumerator:1,steeringDenominator:16,lifetimeTicks:80,depositEvery:1,primitive:'segment',radiusQ16:31000,strengthQ16:60000,quantizeAxis:true}
 ];
 const lut={
  schemaVersion:'fw-lut-v1',
  assets:[
   colorAsset(1,'Oxide copper | dwindling bearing',[46000,19200,11200],[59000,29200,14000]),
   colorAsset(2,'Porcelain | oxidised horizon',[45000,55300,52000],[31000,56500,61000]),
   colorAsset(3,'Luminous brass | the absent degree',[61000,44600,13300],[39000,33000,10800]),
   colorAsset(4,'Iris and charcoal | misregistered needle',[33000,29000,56000],[57000,37000,48000]),
   {schemaVersion:'fw-lut-v1',id:5,name:'Discontinuous fleck diameter',size:32,
    channels:{logic:Array.from({length:32},(_,i)=>[9000,14000,24500,12000,8000,20000,12500,26500][i%8])}}
  ],
  mappings:[
   mapColor(1,1,1,95),mapColor(2,2,2,115),mapColor(3,3,3,53),mapColor(4,4,4,79),
   {version:'fw-lut-map-v1',id:5,materialId:3,lutId:5,source:'ageTicks',
    channel:'logic',destination:'radiusQ16',addressMode:'clamp',
    inputMin:0,inputMax:53,scaleNumerator:1,scaleDenominator:1,bias:0,
    outputMin:7500,outputMax:32000}
  ]
 };
 const fields=[
  layer(1,'uniform',{vectorXQ16:38,vectorYQ16:-55},[0,0],true),
  layer(2,'turbulence',{amplitudeQ16:210,cellSizeQ16:q(16),seed:0x510bc427},[0,0],true),
  layer(3,'vortex',{radiusQ16:q(77),strengthQ16:5200},[126,126]),
  layer(4,'vortex',{radiusQ16:q(48),strengthQ16:-6100},[181,112]),
  layer(5,'direction-quantizer',{sectors:8}),
  layer(6,'uniform',{vectorXQ16:-1200,vectorYQ16:860}),
  layer(7,'vortex',{radiusQ16:q(37),strengthQ16:4200},[79,64])
 ];
 const commands=[
  cmd(10,12,'release-burst',{emitterId:3,count:4}),
  cmd(20,29,'set-field-enabled',{fieldId:3,enabled:true}),
  cmd(30,43,'set-field-enabled',{fieldId:3,enabled:false}),
  cmd(40,51,'release-burst',{emitterId:15,count:6}),
  cmd(50,59,'set-field-enabled',{fieldId:4,enabled:true}),
  cmd(60,72,'set-field-enabled',{fieldId:4,enabled:false}),
  cmd(70,79,'set-field-enabled',{fieldId:5,enabled:true}),
  cmd(80,86,'set-field-enabled',{fieldId:5,enabled:false}),
  cmd(90,91,'set-simulation-frozen',{frozen:true}),
  cmd(100,97,'set-simulation-frozen',{frozen:false}),
  cmd(110,104,'set-field-enabled',{fieldId:6,enabled:true}),
  cmd(120,116,'set-field-enabled',{fieldId:6,enabled:false}),
  cmd(130,120,'release-burst',{emitterId:33,count:8}),
  cmd(140,126,'set-field-enabled',{fieldId:7,enabled:true}),
  cmd(150,139,'set-field-enabled',{fieldId:7,enabled:false}),
  cmd(160,143,'release-burst',{emitterId:54,count:7})
 ];
 return createRecipe({
  schemaVersion:'fw-recipe-v1',engineVersion:'fw-agents-v1',seed:0x5ce73a19,
  framing:{widthPx:352,heightPx:288,center:world(128,124),unitsPerPixelQ16:q(.625)},
  fields:{format:'fw-fields-v1',nextId:8,order:fields.map(f=>f.id),layers:fields},
  materials,emitters,lut,commands,lineage:null
 });
}
export const ART_ID='07-the-zero-meridian';
export const TARGET_TICK=154;
export function authoredRecipeText(){return serializeRecipe(createZeroMeridian());}
