import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld, clamp } from './physics.js';

const box = new T.BoxGeometry(1, 1, 1);
const cylinder = new T.CylinderGeometry(1, 1, 1, 8);
const cone = new T.ConeGeometry(1, 1, 9);
const sphere = new T.IcosahedronGeometry(1, 1);
const dummy = new T.Object3D();
function rng(seed = 27) { return () => { seed = Math.imul(1664525, seed) + 1013904223 | 0; return (seed >>> 0) / 4294967296; }; }
const mat = (color, extra = {}) => new T.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

class Batches {
  constructor(scene) { this.scene = scene; this.groups = new Map(); }
  add(geo, material, x, y, z, sx, sy, sz, rotation = 0, color) {
    const key = `${geo.uuid}/${material.uuid}`;
    if (!this.groups.has(key)) this.groups.set(key, { geo, material, entries: [] });
    this.groups.get(key).entries.push({ x, y, z, sx, sy, sz, rotation, color });
  }
  finish() {
    for (const { geo, material, entries } of this.groups.values()) {
      const mesh = new T.InstancedMesh(geo, material, entries.length);
      entries.forEach((e, i) => {
        dummy.position.set(e.x, e.y, e.z); dummy.scale.set(e.sx, e.sy, e.sz); dummy.rotation.set(0, e.rotation, 0); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix); if (e.color) mesh.setColorAt(i, new T.Color(e.color));
      });
      mesh.castShadow = material.userData.castShadow !== false;
      mesh.receiveShadow = true; mesh.computeBoundingSphere(); this.scene.add(mesh);
    }
  }
}

export function createWorld(scene) {
  const collision = new CollisionWorld(), batches = new Batches(scene), random = rng();
  const roads = [], surfaces = [], roadSegments = [], surfaceCells = new Map();
  const materials = {
    asphalt: mat(0x41484c), lines: mat(0xe6e1ca), curb: mat(0xc8bda5), walls: mat(0xffffff),
    roof: mat(0xa7694a), windows: mat(0x49777a, { roughness: 0.28, metalness: 0.25 }),
    trunks: mat(0x776652), leaves: mat(0xffffff), metal: mat(0x344a4c), concrete: mat(0xb8baaa),
    red: mat(0xcb6759), water: mat(0x439b9f, { roughness: 0.27, metalness: 0.3 }), sand: mat(0xd7c197)
  };
  materials.lines.userData.castShadow = false; materials.windows.userData.castShadow = false;
  const textureCanvas=document.createElement('canvas');textureCanvas.width=256;textureCanvas.height=256;
  const textureContext=textureCanvas.getContext('2d'),grain=textureContext.createImageData(256,256);
  for(let i=0;i<grain.data.length;i+=4){const value=185+Math.floor(random()*65);grain.data[i]=value;grain.data[i+1]=value;grain.data[i+2]=value;grain.data[i+3]=255;}
  textureContext.putImageData(grain,0,0);
  const asphaltTexture=new T.CanvasTexture(textureCanvas);asphaltTexture.wrapS=asphaltTexture.wrapT=T.RepeatWrapping;asphaltTexture.colorSpace=T.SRGBColorSpace;asphaltTexture.anisotropy=4;
  materials.asphalt.map=asphaltTexture;
  const plane = (w, h, material, x, y, z) => {
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h), material); mesh.rotation.x = -Math.PI / 2;
    if(material===materials.asphalt){const uv=mesh.geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*w/6,uv.getY(i)*h/6);}
    mesh.position.set(x, y, z); mesh.receiveShadow = true; scene.add(mesh); return mesh;
  };
  // Broad terrain and sea; the playable land is bounded at its shore.
  plane(3000, 3000, mat(0x82946b), -600, -0.04, 0);
  plane(1900, 2800, materials.water, 1340, -0.16, 0);
  plane(130, 910, materials.sand, 377, 0.005, 0);
  plane(24, 910, materials.concrete, 316, 0.021, 0);
  for (let x = -420; x < 420; x += 12) {
    batches.add(box, materials.metal, x, 0.65, -419, 11.8, 0.28, 0.32);
    batches.add(box, materials.metal, x, 0.65, 419, 11.8, 0.28, 0.32);
  }
  for (let z = -420; z < 420; z += 12) {
    batches.add(box, materials.metal, -419, 0.65, z, 0.32, 0.28, 11.8);
    batches.add(box, materials.concrete, 415, 0.36, z, 0.7, 0.72, 11.8);
  }
  collision.add(-422, 0, 3, 425, 'boundary'); collision.add(418, 0, 3, 425, 'boundary');
  collision.add(0, -422, 425, 3, 'boundary'); collision.add(0, 422, 425, 3, 'boundary');

  const addSegment = (a, b, width) => {
    const segment = { ax: a.x, az: a.z, bx: b.x, bz: b.z, width, dx: b.x-a.x, dz: b.z-a.z };
    segment.len2 = segment.dx ** 2 + segment.dz ** 2; roadSegments.push(segment);
    for (let ix=Math.floor((Math.min(a.x,b.x)-width)/32); ix<=Math.floor((Math.max(a.x,b.x)+width)/32); ix++)
      for (let iz=Math.floor((Math.min(a.z,b.z)-width)/32); iz<=Math.floor((Math.max(a.z,b.z)+width)/32); iz++) {
        const key = `${ix},${iz}`; if (!surfaceCells.has(key)) surfaceCells.set(key, []); surfaceCells.get(key).push(segment);
      }
  };
  function road(points, width = 16, closed = false, smooth = false) {
    const nodes = points.map(p => new T.Vector3(p[0], 0, p[1]));
    const curve = smooth ? new T.CatmullRomCurve3(nodes, closed, 'centripetal') : null;
    const samples = curve ? curve.getSpacedPoints(closed ? 240 : 80) : nodes;
    if (closed && !curve) samples.push(samples[0].clone());
    const positions = [], normals = [], indices = [], uvs = [];
    for (let i=0; i<samples.length; i++) {
      const before=samples[Math.max(0,i-1)], after=samples[Math.min(samples.length-1,i+1)];
      const tangent=after.clone().sub(before).normalize(), side=new T.Vector3(tangent.z,0,-tangent.x);
      for (const sign of [-1,1]) {
        positions.push(samples[i].x + side.x * width/2 * sign, 0.028, samples[i].z + side.z * width/2 * sign);
        uvs.push((samples[i].x+side.x*width/2*sign)/6,(samples[i].z+side.z*width/2*sign)/6);
        normals.push(0,1,0);
      }
      if(i>0) { const j=i*2; indices.push(j-2,j,j-1, j-1,j,j+1); addSegment(samples[i-1],samples[i],width); }
    }
    const geo=new T.BufferGeometry(); geo.setAttribute('position',new T.Float32BufferAttribute(positions,3)); geo.setAttribute('normal',new T.Float32BufferAttribute(normals,3)); geo.setIndex(indices);
    geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
    const mesh=new T.Mesh(geo,materials.asphalt); mesh.receiveShadow=true; scene.add(mesh);
    const path={samples,width,closed}; roads.push(path);
    let distance=0, nextDash=1;
    for(let i=1;i<samples.length;i++) {
      const a=samples[i-1],b=samples[i],len=a.distanceTo(b), yaw=Math.atan2(b.x-a.x,b.z-a.z);
      while(nextDash < distance+len) {
        const t=(nextDash-distance)/len;
        const x=T.MathUtils.lerp(a.x,b.x,t),z=T.MathUtils.lerp(a.z,b.z,t);
        // Leave intersections free of longitudinal paint.
        const intersection = Math.abs(x)<=158 && Math.abs(z)<=158 && [-120,0,120].some(v=>Math.abs(x-v)<12)&&[-120,0,120].some(v=>Math.abs(z-v)<12);
        if(!intersection) batches.add(box,materials.lines,x,0.043,z,0.16,0.015,3.6,yaw);
        nextDash+=9;
      }
      const cx=(a.x+b.x)/2,cz=(a.z+b.z)/2;
      if(curve) for(const side of [-1,1]) batches.add(box,materials.lines,cx+Math.cos(yaw)*(width/2-0.9)*side,0.042,cz-Math.sin(yaw)*(width/2-0.9)*side,0.13,0.012,len+0.1,yaw);
      distance+=len;
    }
    return path;
  }
  const loop=road([[150,-240],[265,-170],[278,10],[235,190],[110,280],[-85,300],[-278,220],[-330,55],[-290,-145],[-165,-268],[0,-296]],18,true,true);
  for(const x of [-120,0,120]) road([[x,-155],[x,155]],18);
  for(const z of [-120,0,120]) road([[-155,z],[165,z]],18);
  road([[120,-155],[135,-200],[150,-240]],16,false,true);
  road([[120,155],[118,210],[110,280]],16);
  road([[-155,120],[-240,115],[-325,95]],14);
  road([[-155,-120],[-225,-125],[-290,-145]],14);
  road([[165,0],[218,0],[278,10]],18);
  road([[165,120],[205,135],[240,180]],14);
  // Parking plaza and a wide drift pad, both genuine drivable surfaces.
  const parking = { x: 202, z: -100, hx: 36, hz: 37 };
  const driftPad = { x: -224, z: 20, hx: 48, hz: 48 };
  for(const p of [parking,driftPad]) { plane(p.hx*2,p.hz*2,materials.asphalt,p.x,0.030,p.z); surfaces.push(p); }
  road([[165,-120],[202,-120],[202,-100]],12);
  road([[-155,0],[-180,0],[-224,20]],13);
  for(let i=0;i<8;i++) {
    const x=175+i*8;
    for(const z of [-122,-81]) batches.add(box,materials.lines,x,0.049,z,0.12,0.012,12);
  }
  for(let i=0;i<30;i++) {
    const a=i/30*Math.PI*2;
    batches.add(box,materials.lines,-224+29*Math.sin(a),0.048,20+29*Math.cos(a),0.14,0.012,3.2,a+Math.PI/2);
  }

  function surfaceAt(x,z) {
    if(surfaces.some(p=>Math.abs(x-p.x)<=p.hx && Math.abs(z-p.z)<=p.hz)) return 'asphalt';
    for(const p of surfaceCells.get(`${Math.floor(x/32)},${Math.floor(z/32)}`)||[]) {
      const t=clamp(((x-p.ax)*p.dx+(z-p.az)*p.dz)/p.len2,0,1);
      if((x-p.ax-p.dx*t)**2+(z-p.az-p.dz*t)**2 <= (p.width/2)**2) return 'asphalt';
    }
    return x>326 ? 'sand' : 'grass';
  }
  function building(x,z,w,d,h,color) {
    batches.add(box,materials.walls,x,h/2,z,w,h,d,0,color);
    batches.add(box,materials.curb,x,0.09,z,w+2.4,0.18,d+2.4);
    batches.add(box,materials.roof,x,h+0.13,z,w+0.8,0.26,d+0.8);
    batches.add(box,materials.concrete,x,h+1.0,z,w*0.30,1.4,d*0.25);
    collision.add(x,z,w/2+0.12,d/2+0.12);
    const floors=Math.floor(h/3.4);
    for(let f=0;f<floors;f++) {
      for(let ix=0;ix<Math.floor(w/4);ix++) for(const side of [-1,1]) {
        const xx=x-w/2+2.2+ix*4;
        batches.add(box,materials.curb,xx,2+f*3.4,z+side*(d/2+0.014),1.86,2.02,0.06);
        batches.add(box,materials.windows,xx,2+f*3.4,z+side*(d/2+0.025),1.55,1.7,0.05);
        batches.add(box,materials.curb,xx,1.12+f*3.4,z+side*(d/2+0.10),1.95,.10,.28);
        if(f===0) batches.add(box,materials.roof,xx,3.1,z+side*(d/2+0.85),2.2,0.12,1.65);
      }
      for(let iz=0;iz<Math.floor(d/5);iz++) for(const side of [-1,1]) batches.add(box,materials.windows,x+side*(w/2+0.025),2+f*3.4,z-d/2+2.5+iz*5,0.05,1.7,1.5);
    }
    batches.add(box,materials.metal,x,1.3,z+d/2+0.08,1.7,2.6,0.09);
  }
  const palette=[0xe2d2af,0xe1c4aa,0xd4d9cf,0xc2cfcb,0xdec0a0,0xb6c4bb];
  for(const cx of [-60,60]) for(const cz of [-60,60]) {
    plane(98,98,materials.curb,cx,0.016,cz);
    for(const sx of [-1,1]) for(const sz of [-1,1]) {
      const x=cx+sx*25,z=cz+sz*25;
      if(cx===60&&cz===-60&&sx===1&&sz===-1) continue;
      building(x,z,21+random()*7,22+random()*6,7+Math.floor(random()*4)*3.4,palette[Math.floor(random()*palette.length)]);
    }
  }
  // Low shops along the starting boulevard, opening views toward the sea.
  for(const z of [-150,-80,-35,40,85,150]) {
    if(z===-80) continue;
    building(155,z,15,20,6.8,palette[Math.floor(random()*palette.length)]);
  }
  building(-65,-186,55,30,13,0xd0bca0);
  building(-153,182,25,25,9,0xbdc9c1);
  building(172,210,22,19,7,0xdac4a7);
  // Pedestrian crossings and sidewalk furniture at city intersections.
  for(const x of [-120,0,120]) for(const z of [-120,0,120]) {
    for(const offset of [-13,13]) for(let i=-5;i<=5;i++) {
      batches.add(box,materials.lines,x+i*1.15,0.05,z+offset,0.65,0.015,2.5);
      batches.add(box,materials.lines,x+offset,0.05,z+i*1.15,2.5,0.015,0.65);
    }
  }
  function tree(x,z,scale=1,palm=false) {
    if(palm) {
      batches.add(cylinder,materials.trunks,x,3.5*scale,z,0.22*scale,7*scale,0.22*scale);
      for(let i=0;i<6;i++) {
        const a=i/6*Math.PI*2;
        batches.add(sphere,materials.leaves,x+Math.sin(a)*1.6*scale,6.8*scale,z+Math.cos(a)*1.6*scale,0.7*scale,0.25*scale,2.3*scale,a,0x456e57);
      }
    } else {
      batches.add(cylinder,materials.trunks,x,1.6*scale,z,0.26*scale,3.2*scale,0.26*scale);
      batches.add(sphere,materials.leaves,x,4*scale,z,2.1*scale,2.8*scale,2.1*scale,random()*6,random()>.5?0x567a4e:0x688c55);
      batches.add(sphere,materials.leaves,x+.8*scale,4.6*scale,z+.3*scale,1.5*scale,2*scale,1.5*scale,0,0x688855);
    }
    collision.add(x,z,.36*scale,.36*scale,'tree');
  }
  for(let i=0;i<190;i++) {
    const x=-390+random()*680,z=-390+random()*780;
    if(surfaceAt(x,z)!=='asphalt'&&!collision.query(x,z,5).size&&!surfaces.some(p=>Math.abs(x-p.x)<p.hx+5&&Math.abs(z-p.z)<p.hz+5)) tree(x,z,0.8+random()*.8);
  }
  for(let z=-350;z<370;z+=28) tree(317,z,1,true);
  for(const x of [-108,12,108]) for(let z=-135;z<=140;z+=46) {
    if(!collision.query(x,z,2).size) tree(x,z,.7,true);
  }
  function lamp(x,z,angle=0) {
    batches.add(cylinder,materials.metal,x,3.3,z,.10,6.6,.10);
    batches.add(box,materials.metal,x+Math.sin(angle)*.8,6.5,z+Math.cos(angle)*.8,.14,.14,1.8,angle);
    batches.add(box,materials.lines,x+Math.sin(angle)*1.65,6.45,z+Math.cos(angle)*1.65,.52,.12,.9,angle);
    collision.add(x,z,.18,.18,'lamp');
  }
  for(let z=-165;z<200;z+=45) { lamp(132,z,-Math.PI/2); lamp(-132,z,Math.PI/2); }
  function sign(x,z,label,angle=0) {
    batches.add(cylinder,materials.metal,x,1.7,z,.06,3.4,.06);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#e5e2d3';ctx.fillRect(0,0,256,128);ctx.strokeStyle='#49706c';ctx.lineWidth=10;ctx.strokeRect(8,8,240,112);
    ctx.fillStyle='#28433f';ctx.font='bold 32px sans-serif';ctx.textAlign='center';ctx.fillText(label,128,76);
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
    const panel=new T.Mesh(new T.BoxGeometry(2.4,1.2,.08),new T.MeshStandardMaterial({map:texture,roughness:.9}));panel.position.set(x,3.1,z);panel.rotation.y=angle;scene.add(panel);
    collision.add(x,z,.15,.15,'sign');
  }
  sign(134,-145,'BAHÍA AZUL',Math.PI); sign(-166,-130,'COSTA',Math.PI/2); sign(225,17,'MIRADOR',Math.PI);
  // Bollards and parked cars make the parking area useful for manoeuvres.
  for(let x=174;x<239;x+=8) {
    batches.add(cylinder,materials.metal,x,.42,-138,.16,.84,.16);
    collision.add(x,-138,.2,.2,'bollard');
  }
  for(let i=0;i<4;i++) {
    const x=181+i*16,z=-86;
    batches.add(box,materials.walls,x,.65,z,1.85,.7,4.0,0,[0xcc9e72,0x738d89,0xa6adac,0xa36f68][i]);
    batches.add(box,materials.windows,x,1.15,z-.2,1.5,.65,2.1);
    for(const side of [-1,1]) for(const f of [-1.2,1.2]) batches.add(box,materials.metal,x+side*.96,.35,z+f,.22,.6,.65);
    collision.add(x,z,1.03,2.12,'parked car');
  }
  // Docks, small boats, distant hills and ocean streaks anchor the horizon.
  for(const z of [-240,-60,120]) {
    batches.add(box,materials.curb,386,.16,z,100,.32,6);
    for(let x=350;x<430;x+=14) batches.add(cylinder,materials.trunks,x,0.7,z+3.8,.19,1.5,.19);
    for(let j=0;j<3;j++) {
      const x=365+j*22;
      batches.add(sphere,materials.walls,x,.04,z+12,3.5,.9,7,0,0xebdfc4);
      batches.add(box,materials.windows,x,1.0,z+11,2.5,1.4,3.3);
      batches.add(cylinder,materials.metal,x,4,z+11,.045,6,.045);
    }
  }
  for(let i=0;i<28;i++) {
    const x=-1000+random()*1100,z=-700-random()*330;
    batches.add(cone,materials.leaves,x,30,z,95+random()*70,80+random()*120,80+random()*80,random()*6,0x829184);
  }
  for(let i=0;i<100;i++) batches.add(box,materials.lines,460+random()*650,-.12,-700+random()*1400,4+random()*25,.008,.12,0);
  for(let i=0;i<20;i++) {
    const a=i/20*Math.PI*2;
    batches.add(box,materials.red,-224+45*Math.sin(a),.23,20+45*Math.cos(a),2.0,.45,1.0,a);
  }
  batches.finish();
  return { collision, roads, roadSegments, surfaces, loop, surfaceAt, spawn:{x:124,z:-110,yaw:0}, driftPad, parking };
}

function loft(sections, material) {
  const positions=[],indices=[];
  for(const [z,width,bottom,top] of sections) {
    positions.push(-width*.82,bottom,z,-width,bottom+.12,z,-width,top-.10,z,-width*.78,top,z,
      width*.78,top,z,width,top-.10,z,width,bottom+.12,z,width*.82,bottom,z);
  }
  for(let i=1;i<sections.length;i++) for(let j=0;j<8;j++) {
    const a=(i-1)*8+j,b=(i-1)*8+(j+1)%8,c=i*8+j,d=i*8+(j+1)%8;
    indices.push(a,c,b,b,c,d);
  }
  for(let j=1;j<7;j++) {indices.push(0,j,j+1); const end=(sections.length-1)*8;indices.push(end,end+j+1,end+j);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
  const mesh=new T.Mesh(g,material);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
}

export function createCar(scene) {
  const root=new T.Group(),body=new T.Group();root.add(body);scene.add(root);
  const paint=mat(0x167b80,{roughness:.28,metalness:.52}),glass=mat(0x243e48,{roughness:.12,metalness:.58});
  const black=mat(0x18282c,{roughness:.65}),rubber=mat(0x242729),chrome=mat(0xaab8b9,{roughness:.25,metalness:.8});
  const lights=mat(0xfff3d3,{emissive:0xffdf9f,emissiveIntensity:1.1});
  const tail=mat(0x932c25,{emissive:0xc83020,emissiveIntensity:.6});
  const part=(g,m,x,y,z,parent=body)=>{const mesh=new T.Mesh(g,m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  const cube=(m,x,y,z,w,h,d,parent=body)=>{const mesh=part(box,m,x,y,z,parent);mesh.scale.set(w,h,d);return mesh;};
  body.add(loft([[-2.25,.77,.48,.84],[-1.82,.99,.45,1.0],[-.9,1.02,.46,1.10],[.65,1.02,.46,1.00],[1.60,.99,.46,.90],[2.28,.79,.49,.72]],paint));
  body.add(loft([[-1.31,.83,1.02,1.08],[-.91,.75,1.00,1.68],[.10,.73,.98,1.71],[.85,.82,.92,1.08]],glass));
  cube(paint,-.02,1.705,-.38,1.18,.055,1.06);
  for(const side of [-1,1]) {
    cube(paint,side*.75,1.45,-.78,.05,.48,.12);
    const pillar=cube(paint,side*.76,1.38,.47,.05,.70,.08);pillar.rotation.x=-.68;
    cube(paint,side*.89,.95,-.36,.05,.05,1.98);
    cube(chrome,side*1.027,.96,-.52,.022,.035,.20);
    cube(paint,side*1.13,1.12,.45,.31,.13,.28);
    cube(black,side*1.22,1.14,.44,.055,.10,.22);
    cube(black,side*.98,.52,0,.06,.1,3.2);
    const head=cube(lights,side*.61,.77,2.08,.48,.075,.15);head.rotation.y=side*.17;
    cube(black,side*.66,.60,2.17,.34,.15,.10);
    cube(tail,side*.60,.82,-2.10,.49,.08,.14);
    part(new T.CylinderGeometry(.065,.065,.24,10),chrome,side*.58,.51,-2.25).rotation.x=Math.PI/2;
  }
  cube(black,0,.53,2.19,1.20,.12,.15);cube(black,0,.67,2.19,.70,.15,.07);
  cube(black,0,.50,-2.21,1.55,.15,.10);cube(chrome,0,.76,-2.26,.42,.12,.015);
  cube(paint,0,.98,-1.87,1.64,.065,.19);
  cube(black,0,.42,0,1.6,.13,3.7);
  const wheels=[];
  function bake(group) {
    const byMaterial=new Map();
    for(const mesh of [...group.children]) {
      if(!mesh.isMesh) continue;
      mesh.updateMatrix();const geometry=mesh.geometry.clone();geometry.applyMatrix4(mesh.matrix);geometry.deleteAttribute('uv');
      if(!byMaterial.has(mesh.material)) byMaterial.set(mesh.material,[]);
      byMaterial.get(mesh.material).push(geometry);group.remove(mesh);
    }
    for(const [material,geometries] of byMaterial) {
      const merged=mergeGeometries(geometries);const mesh=new T.Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
      geometries.forEach(g=>g.dispose());
    }
  }
  for(const side of [-1,1]) for(const z of [-1.43,1.35]) {
    const pivot=new T.Group();pivot.position.set(side*.99,.37,z);root.add(pivot);
    const spin=new T.Group();pivot.add(spin);
    const tire=part(new T.CylinderGeometry(.365,.365,.245,20),rubber,0,0,0,spin);tire.rotation.z=Math.PI/2;
    const rim=part(new T.CylinderGeometry(.265,.265,.255,16),chrome,0,0,0,spin);rim.rotation.z=Math.PI/2;
    const dark=part(new T.CylinderGeometry(.225,.225,.26,16),black,0,0,0,spin);dark.rotation.z=Math.PI/2;
    for(let i=0;i<5;i++) {
      const a=i/5*Math.PI*2;
      const spoke=cube(chrome,side*.14,Math.cos(a)*.115,Math.sin(a)*.115,.025,.23,.048,spin);spoke.rotation.x=a;
    }
    const hub=part(new T.CylinderGeometry(.065,.065,.30,12),chrome,0,0,0,spin);hub.rotation.z=Math.PI/2;
    bake(spin);
    wheels.push({pivot,spin,front:z>0});
  }
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;
  const ctx=shadowCanvas.getContext('2d'),gradient=ctx.createRadialGradient(64,64,15,64,64,63);gradient.addColorStop(0,'rgba(0,0,0,.48)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const contact=new T.Mesh(new T.PlaneGeometry(3.3,6.2),new T.MeshBasicMaterial({map:new T.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));contact.rotation.x=-Math.PI/2;contact.position.y=.035;root.add(contact);
  bake(body);
  return {root,body,wheels,tail};
}
