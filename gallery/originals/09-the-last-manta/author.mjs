// ART-ORIG-009: The Last Manta. Original vector score, not a raster proxy.
// All paths are particles released into the deterministic FIELDWEAVER simulation.
import { createRecipe, serializeRecipe } from '../../../src/recipe/index.js';

const Q=65536;
const q=n=>Math.round(n*Q);
function world(x,y){
  const cx=Math.floor(x/256),cy=Math.floor(y/256);
  return {chunkX:cx,chunkY:cy,localX:q(x-cx*256),localY:q(y-cy*256)};
}
function field(id,operator,parameters,x=0,y=0,enabled=false){
  return {id,kind:'vector',operator,enabled,blend:'add',cellsPerChunk:256,
    transform:{origin:world(x,y),scaleXQ16:Q,scaleYQ16:Q},
    parameters,chunks:[]};
}
function ramp(a,b,n=32){return Array.from({length:n},(_,i)=>Math.round(a+(b-a)*i/(n-1)));}
function palette(id,name,start,end){
  return {schemaVersion:'fw-lut-v1',id,name,size:32,
    channels:{a:Array(32).fill(65535),r:ramp(start[0],end[0]),g:ramp(start[1],end[1]),b:ramp(start[2],end[2])}};
}
function colourMap(id,materialId,lutId,lifetime){
  return {version:'fw-lut-map-v1',id,materialId,lutId,source:'ageTicks',
    channel:'rgba',destination:'color',addressMode:'clamp',inputMin:0,inputMax:lifetime-1,
    scaleNumerator:1,scaleDenominator:1,bias:0,outputMin:0,outputMax:65535};
}
const command=(id,tick,type,more)=>({id,tick,version:'fw-command-v1',type,...more});
const cubic=(a,b,c,d,t)=>{
  const s=1-t;
  return [0,1].map(j=>s*s*s*a[j]+3*s*s*t*b[j]+3*s*t*t*c[j]+t*t*t*d[j]);
};
export const ART_ID='09-the-last-manta';
export const SEED=0x519af26d;
export const TARGET_TICK=166;
export const INTERMEDIATE_TICK=73;
export const CROP={widthPx:480,heightPx:320,center:world(182,116),unitsPerPixelQ16:q(0.80)};
export function createLastManta(){
  const emitters=[];
  const add=(x0,y0,x1,y1,materialId=1,opt={})=>{
    const id=emitters.length+1;
    if(id>300)throw new RangeError('Artwork emitter ceiling (300)');
    const at=opt.at??4;
    const flight=opt.flight??100;
    const jitter=opt.jitter??125;
    const r=opt.rate??1;
    emitters.push({id,materialId,startTick:at,stopTick:at,intervalTicks:1,rate:r,
      bursts:[],geometry:{type:'box',origin:world(x0,y0),widthQ16:Math.max(600,jitter*3),
        heightQ16:Math.max(600,jitter*3)},
      velocityXQ16:q((x1-x0)/flight),velocityYQ16:q((y1-y0)/flight),
      velocityJitterQ16:jitter});
    return id;
  };
  const path=(points,mat=1,opt={})=>{
    for(let k=1;k<points.length;k++)add(...points[k-1],...points[k],mat,
      {...opt,at:(opt.at??4)+(k%5)*2});
  };
  const curve=(a,b,c,d,n=12,mat=1,opt={})=>
    path(Array.from({length:n+1},(_,i)=>cubic(a,b,c,d,i/n)),mat,opt);

  // The shape is a single immense animal in oblique flight, not a ring,
  // mechanical plan, or skyline. One wing is higher and much more ragged.
  const shoulder=[179,155],keel=[181,128];
  curve(shoulder,[121,181],[42,210],[17,175],19,1,{at:4,jitter:105});
  curve([17,175],[35,133],[96,98],keel,19,1,{at:8,jitter:118});
  curve(shoulder,[234,198],[304,209],[352,163],19,1,{at:7,jitter:100});
  curve([352,163],[330,120],[274,81],keel,19,1,{at:11,jitter:118});
  // Underwing torn membranes: parallel bands, left/right unequal.
  curve([24,172],[77,163],[118,129],[177,133],15,4,{at:18,jitter:105});
  curve([186,134],[259,126],[313,144],[343,167],15,4,{at:18,jitter:110});
  curve([38,179],[109,192],[152,174],[180,153],13,2,{at:24,jitter:115});
  curve([182,154],[232,170],[282,191],[331,180],13,2,{at:26,jitter:110});
  // Lamellae: a coherent fan of radial structural veins rather than fill noise.
  for(let i=0;i<13;i++){
    const t=(i+1)/14;
    const a=cubic(shoulder,[121,181],[42,210],[17,175],t);
    const b=cubic([17,175],[35,133],[96,98],keel,1-t);
    add(a[0],a[1],b[0],b[1],i%3===0?3:2,
      {at:17+i*2,flight:96,jitter:125});
  }
  for(let i=0;i<14;i++){
    const t=(i+1)/15;
    const a=cubic(shoulder,[234,198],[304,209],[352,163],t);
    const b=cubic([352,163],[330,120],[274,81],keel,1-t);
    add(a[0],a[1],b[0],b[1],i%4===0?3:2,
      {at:15+i*2,flight:98,jitter:118});
  }
  // A bone-white dorsal crest and a brighter pair of cephalic lobes.
  curve([156,158],[166,168],[169,186],[174,179],8,3,{at:16});
  curve([186,179],[193,187],[199,171],[205,156],8,3,{at:18});
  add(169,151,173,139,3,{at:23,flight:82});
  add(189,151,187,139,3,{at:23,flight:82});
  // Gills (not arbitrary hatch marks), deliberately offset left/right.
  for(let i=0;i<5;i++){
    const y=147-i*4.7;
    add(166-i*2.5,y,174-i*0.6,y-3,2,{at:31+i*3,flight:79,jitter:60});
    add(189+i*2.2,y,181+i*0.8,y-3.5,2,{at:31+i*3,flight:79,jitter:60});
  }
  // A needle-like caudal appendage, visibly interrupted.
  curve([179,127],[183,100],[174,75],[177,57],11,3,{at:26,flight:84});
  curve([177,48],[180,40],[186,33],[191,19],7,3,{at:35,flight:87});
  // Residual current after passage: arcs in water, not a repeated animal.
  curve([33,97],[66,88],[95,83],[119,92],10,4,{at:43,flight:89});
  curve([229,56],[263,54],[302,65],[329,87],10,4,{at:47,flight:89});
  curve([38,64],[74,47],[105,54],[130,68],8,4,{at:51,flight:89});
  // Sparse displaced sediment particles clustered near the tail wake.
  for(let i=0;i<22;i++){
    const x=132+(i*47%97), y=21+(i*31%54);
    const len=3+(i%5)*2.2;
    add(x,y,x+(i%2===0?len:-len/2),y-(i%4)*1.3, i%4===0?2:4,
      {at:54+i%11*3,flight:57,jitter:220,rate:i%7===0?2:1});
  }
  const materials=[
    {id:1,kind:'ink',inertiaNumerator:1,inertiaDenominator:1,steeringNumerator:1,
      steeringDenominator:48,lifetimeTicks:104,depositEvery:1,primitive:'disc',
      radiusQ16:41500,strengthQ16:64000,quantizeAxis:false},
    {id:2,kind:'filament',inertiaNumerator:1,inertiaDenominator:1,steeringNumerator:1,
      steeringDenominator:55,lifetimeTicks:103,depositEvery:1,primitive:'segment',
      radiusQ16:25500,strengthQ16:57000,quantizeAxis:false},
    {id:3,kind:'dust',inertiaNumerator:1,inertiaDenominator:2,steeringNumerator:1,
      steeringDenominator:3,lifetimeTicks:99,depositEvery:1,primitive:'disc',
      radiusQ16:24500,strengthQ16:65000,quantizeAxis:false},
    {id:4,kind:'shard',inertiaNumerator:1,inertiaDenominator:1,steeringNumerator:1,
      steeringDenominator:26,lifetimeTicks:101,depositEvery:1,primitive:'segment',
      radiusQ16:28500,strengthQ16:56000,quantizeAxis:true}
  ];
  const lut={schemaVersion:'fw-lut-v1',assets:[
    palette(1,'deep lagoon wing margins',[23000,58500,62500],[13000,38500,51500]),
    palette(2,'quartz wing filaments',[55500,62500,53000],[31000,48500,57000]),
    palette(3,'bone crest, tail, gills',[61500,58000,44000],[50000,42000,28000]),
    palette(4,'residual violet current',[47000,31000,63500],[25500,17000,47000]),
    {schemaVersion:'fw-lut-v1',id:5,name:'phase-opened sediment radii',size:32,
      channels:{logic:Array.from({length:32},(_,i)=>12500+(i%8)*2700)}}
  ],mappings:[
    colourMap(1,1,1,104),colourMap(2,2,2,103),
    colourMap(3,3,3,99),colourMap(4,4,4,101),
    {version:'fw-lut-map-v1',id:5,materialId:3,lutId:5,source:'ageTicks',
      channel:'logic',destination:'radiusQ16',addressMode:'clamp',
      inputMin:0,inputMax:98,scaleNumerator:1,scaleDenominator:1,
      bias:0,outputMin:8500,outputMax:39000}
  ]};
  const layers=[
    field(1,'uniform',{vectorXQ16:12,vectorYQ16:-38},0,0,true),
    field(2,'turbulence',{seed:0x2fc8214d,amplitudeQ16:155,cellSizeQ16:q(16)},0,0,true),
    field(3,'vortex',{radiusQ16:q(75),strengthQ16:3600},112,163),
    field(4,'vortex',{radiusQ16:q(70),strengthQ16:-3650},258,154),
    field(5,'attractor',{radiusQ16:q(93),strengthQ16:4900},177,135),
    field(6,'direction-quantizer',{sectors:8},0,0),
    field(7,'uniform',{vectorXQ16:850,vectorYQ16:-510},0,0)
  ];
  const cmds=[
    command(10,22,'set-field-enabled',{fieldId:3,enabled:true}),
    command(20,33,'set-field-enabled',{fieldId:4,enabled:true}),
    command(30,49,'set-field-enabled',{fieldId:3,enabled:false}),
    command(40,58,'set-field-enabled',{fieldId:4,enabled:false}),
    command(50,64,'release-burst',{emitterId:12,count:3}),
    command(60,71,'set-field-enabled',{fieldId:5,enabled:true}),
    command(70,84,'set-field-enabled',{fieldId:5,enabled:false}),
    command(80,91,'set-simulation-frozen',{frozen:true}),
    command(90,97,'set-simulation-frozen',{frozen:false}),
    command(100,107,'set-field-enabled',{fieldId:6,enabled:true}),
    command(110,114,'set-field-enabled',{fieldId:6,enabled:false}),
    command(120,121,'set-field-enabled',{fieldId:7,enabled:true}),
    command(130,128,'set-field-enabled',{fieldId:7,enabled:false}),
    command(140,137,'release-burst',{emitterId:57,count:4}),
    command(150,144,'release-burst',{emitterId:101,count:4})
  ];
  return createRecipe({
    schemaVersion:'fw-recipe-v1',engineVersion:'fw-agents-v1',seed:SEED,
    framing:CROP,
    fields:{format:'fw-fields-v1',nextId:8,order:layers.map(x=>x.id),layers},
    materials,emitters,lut,commands:cmds,lineage:null
  });
}
export function authoredRecipeText(){return serializeRecipe(createLastManta());}
