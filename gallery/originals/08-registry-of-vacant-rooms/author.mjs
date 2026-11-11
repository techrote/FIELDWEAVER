// Original composition 08: Registry of Vacant Rooms.
// Every shape, source, field, colour and intervention is newly authored here.
import {createRecipe,serializeRecipe} from '../../../src/recipe/index.js';
const Q=65536, q=n=>Math.round(n*Q);
const world=(x,y)=>{
  const cx=Math.floor(x/256),cy=Math.floor(y/256);
  return {chunkX:cx,chunkY:cy,localX:q(x-cx*256),localY:q(y-cy*256)};
};
const layer=(id,operator,parameters,origin=[0,0],enabled=false)=>({
  id,kind:'vector',operator,enabled,blend:'add',cellsPerChunk:256,
  transform:{origin:world(...origin),scaleXQ16:Q,scaleYQ16:Q},
  parameters,chunks:[]
});
const ramp=(a,b)=>Array.from({length:32},(_,i)=>Math.round(a+(b-a)*i/31));
const colour=(id,name,start,end)=>({
  schemaVersion:'fw-lut-v1',id,name,size:32,
  channels:{a:Array(32).fill(65535),b:ramp(start[2],end[2]),
   g:ramp(start[1],end[1]),r:ramp(start[0],end[0])}
});
const colourMap=(id,lutId,materialId,lifetimeTicks)=>({
  version:'fw-lut-map-v1',id,materialId,lutId,
  source:'ageTicks',channel:'rgba',destination:'color',
  addressMode:'clamp',inputMin:0,inputMax:lifetimeTicks-1,
  scaleNumerator:1,scaleDenominator:1,bias:0,outputMin:0,outputMax:65535
});
const command=(id,tick,type,more)=>({version:'fw-command-v1',id,tick,type,...more});
export const ART_ID='08-registry-of-vacant-rooms';
export const TARGET_TICK=162;
export const SEED=0x6da27f19;
export function createVacantRooms(){
  const emitters=[];
  function stroke(ax,ay,bx,by,mat=2,{at=2,duration=76,spread=100,rate=1}={}){
    if(emitters.length>=240)throw Error('Emitter count exceeded the artwork budget');
    const id=emitters.length+1;
    emitters.push({
      id,materialId:mat,startTick:at,stopTick:at,intervalTicks:1,rate,bursts:[],
      geometry:{type:'box',origin:world(ax,ay),widthQ16:Math.max(500,spread*3),heightQ16:Math.max(500,spread*3)},
      velocityXQ16:q((bx-ax)/duration),velocityYQ16:q((by-ay)/duration),
      velocityJitterQ16:spread
    });
    return id;
  }
  // Three large doors, none sharing a baseline. Their outer jambs are broad,
  // layered marks, not a bitmap or a rectangle drawing in the renderer.
  function jamb(x0,y0,x1,y1,mat,at,weight=3){
    for(let i=0;i<weight;i++){
      const o=(i-(weight-1)/2)*0.9;
      stroke(x0+o,y0+o,x1+o,y0+o,mat,{at,duration:90,spread:85});
      stroke(x0+o,y0+o,x0+o,y1+o,mat,{at:at+2,duration:92,spread:85});
      stroke(x1+o,y0+o,x1+o,y1+o,mat,{at:at+4,duration:92,spread:85});
      // The fourth side is withheld: each doorway refuses closure.
    }
  }
  // Ochre stone: a broad left-hand archive portal with dense, ruled partitions.
  jamb(37,57,103,202,1,4,3);
  for(let k=0;k<9;k++){
    const y=73+k*14;
    stroke(43,y,94-(k%3)*5,y,1,{at:13+k*2,duration:74,spread:75});
    if(k%2===0)stroke(46,y+3,73+(k%3)*7,y+3,3,{at:24+k,duration:49,spread:75});
  }
  // White central chamber: most of its inner wall is deliberately vacant.
  jamb(125,32,200,226,2,8,3);
  stroke(128,214,145,214,2,{at:8,duration:61});
  stroke(178,214,198,214,2,{at:9,duration:61});
  stroke(136,43,136,77,4,{at:18,duration:62});
  stroke(190,139,190,176,4,{at:21,duration:64});
  // Two small index tabs oppose the great empty surface.
  for(const [x,y,dir] of [[117,152,-1],[202,122,1],[201,88,1],[123,58,-1]]){
    stroke(x,y,x+dir*13,y,3,{at:19,duration:49,spread:100});
    stroke(x+dir*13,y,x+dir*13,y+10,3,{at:21,duration:50,spread:100});
  }
  // Violet right-hand portal; its lower wall fails and breaks into shear marks.
  jamb(218,76,287,193,4,13,4);
  for(let i=0;i<11;i++){
    const y=87+i*9.3,x=225+(i%3)*3;
    stroke(x,y,266-(i%4)*4,y+(i%3-1)*3.8,4,{at:25+i,duration:66,spread:125});
  }
  for(let i=0;i<12;i++){
    const y=76+i*11.2,x=272+(i%3)*4;
    stroke(x,y,x+8+i*0.75,y+7+(i%3)*2.1,3,
      {at:32+i*2,duration:51,spread:105});
  }
  // A diagonal fault is expressed as displaced segments on both sides of
  // an invisible slash; the missing span is the subject.
  for(let i=0;i<8;i++){
    const x=65+i*10.1, y=40+i*7.7;
    stroke(x,y,x+12,y+8,3,{at:31+i*2,duration:65,spread:140});
  }
  for(let i=0;i<9;i++){
    const x=210+i*8.5,y=165+i*4.3;
    stroke(x,y,x+8,y+3,2,{at:38+i,duration:58,spread:90});
  }
  // Isolated floor thresholds, deliberately missing their connecting room.
  for(const [x0,x1,y,mat] of [
    [24,58,39,1],[67,94,39,1],[117,142,23,2],[173,195,23,2],
    [214,235,48,4],[252,282,48,4],[78,93,214,3],[228,246,207,3]
  ])stroke(x0,y,x1,y,mat,{at:39,duration:78,spread:80});
  // Sparse four-point archival punches and loose flakes in the omitted region.
  for(let k=0;k<14;k++){
    const x=148+(k*37%43),y=58+(k*29%141);
    stroke(x,y,x+(k%2?2:-2),y+(k%3-1)*2,3,
      {at:57+k*2,duration:38,spread:150,rate:k%4===0?2:1});
  }
  const materials=[
    {id:1,kind:'ink',inertiaNumerator:1,inertiaDenominator:1,
     steeringNumerator:1,steeringDenominator:56,lifetimeTicks:119,
     depositEvery:1,primitive:'disc',radiusQ16:46500,
     strengthQ16:59000,quantizeAxis:false},
    {id:2,kind:'filament',inertiaNumerator:1,inertiaDenominator:1,
     steeringNumerator:1,steeringDenominator:64,lifetimeTicks:129,
     depositEvery:1,primitive:'segment',radiusQ16:37500,
     strengthQ16:63000,quantizeAxis:false},
    {id:3,kind:'dust',inertiaNumerator:1,inertiaDenominator:3,
     steeringNumerator:2,steeringDenominator:3,lifetimeTicks:58,
     depositEvery:1,primitive:'point',radiusQ16:25500,
     strengthQ16:58000,quantizeAxis:false},
    {id:4,kind:'shard',inertiaNumerator:1,inertiaDenominator:1,
     steeringNumerator:1,steeringDenominator:25,lifetimeTicks:109,
     depositEvery:1,primitive:'segment',radiusQ16:39500,
     strengthQ16:64000,quantizeAxis:true}
  ];
  const lut={schemaVersion:'fw-lut-v1',assets:[
    colour(1,'brass document | fading carbon',[60200,34000,17500],[39000,28000,14800]),
    colour(2,'chalk jamb | turquoise shadow',[55300,60400,57400],[31500,52200,55800]),
    colour(3,'loose leaf | spare index punch',[62000,46000,19800],[56000,29000,12800]),
    colour(4,'damaged register | dried iris',[49200,33700,61800],[32000,25200,46500]),
    {schemaVersion:'fw-lut-v1',id:5,name:'Alternating archival aperture',size:32,
     channels:{logic:Array.from({length:32},(_,i)=>
       [11500,18500,25000,14500,30000,10500,20500,13500][i%8])}}
  ],mappings:[
    colourMap(1,1,1,119),colourMap(2,2,2,129),
    colourMap(3,3,3,58),colourMap(4,4,4,109),
    {version:'fw-lut-map-v1',id:5,materialId:3,lutId:5,
     source:'ageTicks',channel:'logic',destination:'radiusQ16',
     addressMode:'clamp',inputMin:0,inputMax:57,
     scaleNumerator:1,scaleDenominator:1,bias:0,
     outputMin:6500,outputMax:34000}
  ]};
  const fields=[
    layer(1,'uniform',{vectorXQ16:17,vectorYQ16:-60},[0,0],true),
    layer(2,'turbulence',{amplitudeQ16:190,cellSizeQ16:q(14),seed:0x21b5ad62},[0,0],true),
    layer(3,'vortex',{radiusQ16:q(54),strengthQ16:-4200},[252,143]),
    layer(4,'attractor',{radiusQ16:q(73),strengthQ16:3900},[160,129]),
    layer(5,'direction-quantizer',{sectors:4}),
    layer(6,'uniform',{vectorXQ16:1600,vectorYQ16:350}),
    layer(7,'vortex',{radiusQ16:q(41),strengthQ16:3200},[72,111])
  ];
  const cmds=[
    command(10,17,'release-burst',{emitterId:9,count:5}),
    command(20,30,'set-field-enabled',{fieldId:7,enabled:true}),
    command(30,43,'set-field-enabled',{fieldId:7,enabled:false}),
    command(40,48,'set-field-enabled',{fieldId:3,enabled:true}),
    command(50,61,'set-field-enabled',{fieldId:3,enabled:false}),
    command(60,67,'release-burst',{emitterId:55,count:6}),
    command(70,74,'set-field-enabled',{fieldId:5,enabled:true}),
    command(80,81,'set-field-enabled',{fieldId:5,enabled:false}),
    command(90,91,'set-simulation-frozen',{frozen:true}),
    command(100,98,'set-simulation-frozen',{frozen:false}),
    command(110,106,'set-field-enabled',{fieldId:6,enabled:true}),
    command(120,119,'set-field-enabled',{fieldId:6,enabled:false}),
    command(130,125,'set-field-enabled',{fieldId:4,enabled:true}),
    command(140,132,'set-field-enabled',{fieldId:4,enabled:false}),
    command(150,139,'release-burst',{emitterId:78,count:8}),
    command(160,147,'release-burst',{emitterId:112,count:4})
  ];
  return createRecipe({
    schemaVersion:'fw-recipe-v1',engineVersion:'fw-agents-v1',seed:SEED,
    framing:{widthPx:432,heightPx:304,center:world(157,125),
     unitsPerPixelQ16:q(0.76)},
    fields:{format:'fw-fields-v1',nextId:8,order:fields.map(x=>x.id),layers:fields},
    materials,emitters,lut,commands:cmds,lineage:null
  });
}
export function authoredRecipeText(){return serializeRecipe(createVacantRooms());}
