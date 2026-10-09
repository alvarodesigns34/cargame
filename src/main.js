import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Vehicle, FIXED_DT, clamp, approach } from './physics.js';
import { createWorld, createCar } from './world.js';
import { DrivingInput } from './input.js';
import { Challenges } from './challenges.js';
import { EngineAudio } from './audio.js';

const $ = id => document.getElementById(id);
const readStorage = (key, fallback) => {try {return JSON.parse(localStorage.getItem(key)) || fallback;} catch {return fallback;}};
const writeStorage = (key,value) => {try {localStorage.setItem(key,JSON.stringify(value));} catch {/* Private mode / storage denied */}};
const toastState={until:0};
function notify(message,seconds=2.7) {$('toast').textContent=message;$('toast').classList.add('show');toastState.until=performance.now()+seconds*1000;}

try { init(); } catch(error) {
  $('loading').hidden=true;$('fatal').hidden=false;
  $('fatal-text').textContent='Abre el juego en una versión reciente de Safari con WebGL 2 disponible. '+error.message;
  console.error(error);
}

function init() {
  const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance',alpha:false});
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.94;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
  $('scene').appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden','true');
  const scene=new T.Scene();scene.fog=new T.Fog(0xb6c8bd,160,850);
  const camera=new T.PerspectiveCamera(58,1,.15,2400);
  const hemi=new T.HemisphereLight(0xe0ecdf,0x66795b,1.5);scene.add(hemi);
  const sun=new T.DirectionalLight(0xffe0ac,2.15);sun.position.set(-75,120,-60);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-80;sun.shadow.camera.right=80;sun.shadow.camera.top=80;sun.shadow.camera.bottom=-80;
  sun.shadow.camera.near=1;sun.shadow.camera.far=310;sun.shadow.bias=-.0003;sun.shadow.normalBias=.035;
  scene.add(sun,sun.target);
  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();
  const env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.7;room.dispose();pmrem.dispose();
  const sky=new T.Mesh(new T.SphereGeometry(1800,24,16),new T.ShaderMaterial({
    side:T.BackSide,depthWrite:false,
    uniforms:{top:{value:new T.Color(0x7eafbf)},horizon:{value:new T.Color(0xe9ddbb)}},
    vertexShader:'varying vec3 pos; void main(){pos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'uniform vec3 top;uniform vec3 horizon;varying vec3 pos;void main(){float t=pow(max(normalize(pos).y,0.),.65);gl_FragColor=vec4(mix(horizon,top,t),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
  }));scene.add(sky);
  const sunDisc=new T.Mesh(new T.SphereGeometry(35,16,12),new T.MeshBasicMaterial({color:0xffebbb,fog:false}));sunDisc.position.set(-760,590,-900);scene.add(sunDisc);
  const world=createWorld(scene),car=createCar(scene),vehicle=new Vehicle(world.collision,world.surfaceAt);
  const input=new DrivingInput(),audio=new EngineAudio();
  const challenges=new Challenges(world,vehicle,notify,best=>{writeStorage('costa-drive-best',best);updateRecords();});
  challenges.best=readStorage('costa-drive-best',{});
  let playing=false,started=false,paused=false,accumulator=0,lastFrame=0,hudClock=0,visualClock=0;
  let cameraMode=0,cameraYaw=vehicle.yaw,qualityChoice='auto',qualityLevel=1,fpsFrames=0,fpsDuration=0,lowWindows=0;
  let frameCount=0,resetCamera=true;
  const cameraPosition=new T.Vector3(),cameraLook=new T.Vector3(),desiredCamera=new T.Vector3(),desiredLook=new T.Vector3();
  let hintRemaining=12;

  function resize() {
    const w=window.innerWidth,h=window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,[.9,1.35,1.8][qualityLevel]));
    renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();
  }
  function setQuality(level,choice=qualityChoice) {
    qualityLevel=level;qualityChoice=choice;
    renderer.shadowMap.enabled=level>0;
    const size=level===2?2048:1024;
    if(sun.shadow.mapSize.x!==size) {sun.shadow.mapSize.set(size,size);sun.shadow.map?.dispose();sun.shadow.map=null;}
    resize();$('quality').textContent=choice==='auto'?'AUTO':['BAJA','MEDIA','ALTA'][level];
    $('quality').setAttribute('aria-label',`Calidad gráfica: ${choice==='auto'?'automática':['baja','media','alta'][level]}`);
    writeStorage('costa-drive-quality',choice);
  }
  const savedQuality=readStorage('costa-drive-quality','auto');
  setQuality(['low','medium','high'].includes(savedQuality)?['low','medium','high'].indexOf(savedQuality):1,savedQuality);
  window.addEventListener('resize',resize);
  window.visualViewport?.addEventListener('resize',resize);
  $('quality').addEventListener('click',()=>{
    const choices=['auto','low','medium','high'],choice=choices[(choices.indexOf(qualityChoice)+1)%4];
    setQuality(choice==='auto'?1:choices.indexOf(choice)-1,choice);lowWindows=0;notify(`Calidad ${choice==='auto'?'automática':['baja','media','alta'][qualityLevel]}`);
  });

  // One dynamic checkpoint gate, moved to the next target instead of allocating
  // a new set of effects every time the player passes a checkpoint.
  const gate=new T.Group(),gateMaterial=new T.MeshBasicMaterial({color:0xd5f3ae,transparent:true,opacity:.8});
  const gateGlow=new T.MeshBasicMaterial({color:0xcce8a5,transparent:true,opacity:.13,depthWrite:false,side:T.DoubleSide});
  for(const x of [-10,10]) {
    const post=new T.Mesh(new T.CylinderGeometry(.12,.12,5,8),gateMaterial);post.position.set(x,2.5,0);gate.add(post);
    const glow=new T.Mesh(new T.CylinderGeometry(.38,.38,5,8),gateGlow);glow.position.copy(post.position);gate.add(glow);
  }
  const arch=new T.Mesh(new T.BoxGeometry(20.3,.18,.18),gateMaterial);arch.position.y=5;gate.add(arch);
  const pad=new T.Mesh(new T.PlaneGeometry(20,5),gateGlow);pad.rotation.x=-Math.PI/2;pad.position.y=.065;gate.add(pad);
  const arrow=new T.Mesh(new T.ConeGeometry(.7,1.7,3),gateMaterial);arrow.rotation.x=Math.PI;arrow.position.y=7.3;gate.add(arrow);
  gate.visible=false;scene.add(gate);

  // Bounded reusable skid-mark buffers and smoke pool: no accumulating meshes.
  const maxMarks=520,markPositions=new Float32Array(maxMarks*18);
  const markGeometry=new T.BufferGeometry();markGeometry.setAttribute('position',new T.BufferAttribute(markPositions,3).setUsage(T.DynamicDrawUsage));markGeometry.setDrawRange(0,0);
  const marks=new T.Mesh(markGeometry,new T.MeshBasicMaterial({color:0x182626,transparent:true,opacity:.30,depthWrite:false,side:T.DoubleSide}));marks.frustumCulled=false;scene.add(marks);
  let markIndex=0,markCount=0,markClock=0;
  const lastMark=[null,null],smokeCount=28,smokeStates=Array.from({length:smokeCount},()=>({life:0,x:0,y:0,z:0,size:0}));
  const smoke=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),new T.MeshBasicMaterial({color:0xc8c8b7,transparent:true,opacity:.1,depthWrite:false}),smokeCount);smoke.frustumCulled=false;scene.add(smoke);
  const smokeDummy=new T.Object3D();let smokeIndex=0,smokeClock=0;
  function effects(dt) {
    markClock+=dt;smokeClock+=dt;
    const slipping=(vehicle.drift||input.read().handbrake&&vehicle.speed>4)&&vehicle.surface==='asphalt';
    if(slipping&&markClock>.04) {
      markClock=0;
      for(let wheel=0;wheel<2;wheel++) {
        const side=wheel===0?-1:1,s=Math.sin(vehicle.yaw),c=Math.cos(vehicle.yaw);
        const x=vehicle.x-s*1.43+c*side*.98,z=vehicle.z-c*1.43-s*side*.98;
        const previous=lastMark[wheel];
        if(previous&&Math.hypot(x-previous.x,z-previous.z)<5) {
          const dx=c*.11,dz=-s*.11,offset=markIndex*18;
          markPositions.set([previous.x-dx,.055,previous.z-dz,previous.x+dx,.055,previous.z+dz,x-dx,.055,z-dz,previous.x+dx,.055,previous.z+dz,x+dx,.055,z+dz,x-dx,.055,z-dz],offset);
          markIndex=(markIndex+1)%maxMarks;markCount=Math.min(maxMarks,markCount+1);
        }
        lastMark[wheel]={x,z};
      }
      markGeometry.attributes.position.needsUpdate=true;markGeometry.setDrawRange(0,markCount*6);
    } else if(!slipping) {lastMark[0]=null;lastMark[1]=null;}
    if(qualityLevel>0&&(slipping||vehicle.surface!=='asphalt'&&vehicle.speed>6)&&smokeClock>.09) {
      smokeClock=0;const s=smokeStates[smokeIndex];smokeIndex=(smokeIndex+1)%smokeCount;
      Object.assign(s,{life:1,x:vehicle.x-Math.sin(vehicle.yaw)*1.7,y:.4,z:vehicle.z-Math.cos(vehicle.yaw)*1.7,size:.5});
    }
    for(let i=0;i<smokeCount;i++) {
      const p=smokeStates[i];p.life=Math.max(0,p.life-dt*.6);p.y+=dt*.45;p.size+=dt*.6;
      smokeDummy.position.set(p.x,p.y,p.z);smokeDummy.scale.setScalar(p.life>0&&qualityLevel>0?p.size*p.life:0);smokeDummy.updateMatrix();smoke.setMatrixAt(i,smokeDummy.matrix);
    }
    smoke.instanceMatrix.needsUpdate=true;
  }
  function clearEffects() {lastMark[0]=null;lastMark[1]=null;smokeStates.forEach(s=>s.life=0);}

  function recover() {
    const gate=challenges.checkpoint;
    let target=gate?challenges.index===0?world.loop.samples[0]:challenges.gates[challenges.index-1]:vehicle.lastSafe;
    let heading=target.yaw;
    if(heading===undefined) {const n=world.loop.samples[1];heading=Math.atan2(n.x-target.x,n.z-target.z);}
    const safe={x:target.x,z:target.z,yaw:heading};
    vehicle.reset(safe.x,safe.z,safe.yaw);challenges.recover();input.clear();clearEffects();resetCamera=true;
  }
  function openPanel() {
    if(!started)return;paused=true;playing=false;input.clear();accumulator=0;
    $('panel').hidden=false;$('panel-title').textContent='Elige tu ritmo.';updateRecords();
  }
  function closePanel() {$('panel').hidden=true;paused=false;playing=started;input.clear();accumulator=0;lastFrame=performance.now();}
  function updateRecords() {
    for(const mode of ['circuit','speed','drift']) {
      const value=challenges.best[mode];$('best-'+mode).textContent=value?mode==='drift'?`Récord · ${Math.floor(value)} puntos`:`Récord · ${value.toFixed(2)} s`:'Sin récord todavía';
    }
  }
  $('start').addEventListener('click',()=>{
    started=true;playing=true;$('welcome').hidden=true;$('hud').hidden=false;resetCamera=true;accumulator=0;
    notify('Bienvenido a Bahía Azul');
    // Fullscreen is optional: Safari can reject it without affecting controls.
    if(!/iPad|iPhone|iPod/.test(navigator.userAgent))document.documentElement.requestFullscreen?.().catch(()=>{});
  });
  $('camera').addEventListener('click',()=>{cameraMode=(cameraMode+1)%3;resetCamera=true;notify(['Cámara de persecución','Cámara sobre el capó','Cámara panorámica'][cameraMode]);});
  $('reset').addEventListener('click',recover);$('pause').addEventListener('click',openPanel);
  $('challenge-open').addEventListener('click',openPanel);$('panel-close').addEventListener('click',closePanel);$('resume').addEventListener('click',closePanel);
  $('sound').addEventListener('click',async()=>{const enabled=await audio.toggle();$('sound').classList.toggle('active',enabled);$('sound').setAttribute('aria-label',enabled?'Desactivar sonido':'Activar sonido');notify(enabled?'Sonido activado':'Sonido desactivado');});
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
    challenges.start(button.dataset.mode);hintRemaining=0;$('first-hint').hidden=true;clearEffects();resetCamera=true;closePanel();
  }));
  window.addEventListener('keydown',e=> {
    if(!started||e.repeat||e.target.matches('select,input,textarea'))return;
    if(e.code==='Escape') {if(paused)closePanel();else openPanel();}
    else if(!paused&&e.code==='KeyC')$('camera').click();
    else if(!paused&&e.code==='KeyR')recover();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&started)openPanel();});
  window.addEventListener('blur',()=>{if(started)openPanel();});
  document.addEventListener('contextmenu',e=>e.preventDefault());
  document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
  // Keep scrolling available inside the challenge menu on small portrait screens.
  document.addEventListener('touchmove',e=>{if(!e.target.closest('.panel'))e.preventDefault();},{passive:false});
  renderer.domElement.addEventListener('webglcontextlost',e=>{
    e.preventDefault();playing=false;input.clear();$('fatal').hidden=false;$('fatal-text').textContent='Safari ha liberado la memoria gráfica. Toca «Volver a intentar» para reiniciar.';
  });
  renderer.domElement.addEventListener('webglcontextrestored',()=>location.reload());

  const mapCanvas=$('map'),mapContext=mapCanvas.getContext('2d');
  const mapBase=document.createElement('canvas');mapBase.width=320;mapBase.height=320;const mapBaseCtx=mapBase.getContext('2d');
  const scale=320/910,toMapX=x=>(x+455)*scale,toMapZ=z=>(z+455)*scale;
  function buildMap() {
    const ctx=mapBaseCtx;ctx.clearRect(0,0,320,320);
    ctx.fillStyle='#66918b';ctx.fillRect(toMapX(327),0,320,320);ctx.fillStyle='#799177';ctx.fillRect(0,0,toMapX(327),320);
    ctx.fillStyle='#bbb994';ctx.fillRect(toMapX(327),0,18,320);
    for(const road of world.roads) {
      ctx.beginPath();road.samples.forEach((p,i)=>{if(i===0)ctx.moveTo(toMapX(p.x),toMapZ(p.z));else ctx.lineTo(toMapX(p.x),toMapZ(p.z));});
      ctx.strokeStyle='#bfcab5';ctx.lineWidth=road.width*scale;ctx.lineJoin='round';ctx.stroke();
    }
    ctx.fillStyle='#899e89';for(const b of world.collision.objects)if(b.kind==='building')ctx.fillRect(toMapX(b.x-b.halfX),toMapZ(b.z-b.halfZ),b.halfX*2*scale,b.halfZ*2*scale);
    ctx.fillStyle='#bbc6b0';for(const p of world.surfaces)ctx.fillRect(toMapX(p.x-p.hx),toMapZ(p.z-p.hz),p.hx*2*scale,p.hz*2*scale);
  }
  buildMap();
  function drawMap() {
    const ctx=mapContext;ctx.clearRect(0,0,320,320);ctx.drawImage(mapBase,0,0);
    const checkpoint=challenges.checkpoint;
    if(checkpoint) {
      ctx.beginPath();ctx.moveTo(toMapX(vehicle.x),toMapZ(vehicle.z));ctx.lineTo(toMapX(checkpoint.x),toMapZ(checkpoint.z));ctx.setLineDash([5,4]);ctx.strokeStyle='#e4f3b3';ctx.lineWidth=2;ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(toMapX(checkpoint.x),toMapZ(checkpoint.z),7,0,Math.PI*2);ctx.fillStyle='#e4f3b3';ctx.fill();
    }
    ctx.save();ctx.translate(toMapX(vehicle.x),toMapZ(vehicle.z));ctx.rotate(-vehicle.yaw);ctx.beginPath();ctx.moveTo(0,11);ctx.lineTo(-7,-7);ctx.lineTo(0,-4);ctx.lineTo(7,-7);ctx.closePath();ctx.fillStyle='#123938';ctx.strokeStyle='#f3f5cf';ctx.lineWidth=2.5;ctx.fill();ctx.stroke();ctx.restore();
  }
  function updateHUD() {
    const speed=Math.round(vehicle.speed*3.6);$('speed').textContent=speed;$('gear').textContent=vehicle.gear;
    $('power').style.width=`${clamp(speed/190*100,0,100)}%`;
    $('surface').textContent=vehicle.surface==='asphalt'?'ASFALTO':vehicle.surface==='sand'?'ARENA':'HIERBA';
    $('total-score').textContent=`${challenges.totalScore.toLocaleString('es-ES')} PTS`;
    $('location').textContent=vehicle.x>200?'AVENIDA COSTERA':vehicle.x<-170?'MIRADOR · EXPLANADA':Math.abs(vehicle.z)>200?'RUTA DE LA COSTA':'BAHÍA AZUL · CENTRO';
    let label='A TU RITMO',title='Explora Bahía Azul',detail='Toca aquí para elegir un desafío';
    if(challenges.countdown>0) {label='PREPÁRATE';title=`Salida en ${Math.ceil(challenges.countdown)}…`;detail='Puedes mantener el acelerador pulsado';}
    else if(challenges.active) {
      const time=Math.max(0,challenges.limit-challenges.elapsed).toFixed(1);
      if(challenges.mode==='circuit') {label=`VUELTA A LA COSTA · ${time} s`;title=`Checkpoint ${challenges.index+1} / 12`;detail=`Tiempo ${challenges.elapsed.toFixed(1)} s · Sigue el arco verde`;}
      else if(challenges.mode==='speed') {label=`A FONDO · ${time} s`;title=`${speed} / 120 km/h`;detail='Acelera y mantente sobre el asfalto';}
      else {label=`DERRAPE · ${time} s`;title=`${Math.floor(challenges.driftBank+challenges.driftCombo)} / 1.000 puntos`;detail='Puntúa dentro de la explanada circular';}
    } else if(challenges.result) {
      label=challenges.result.success?'RETO COMPLETADO':'OTRA OPORTUNIDAD';
      title=challenges.result.success?challenges.mode==='drift'?`${challenges.driftBank} puntos`:`${challenges.elapsed.toFixed(2)} segundos`:'Se acabó el tiempo';detail='Toca para elegir otro reto · Puedes seguir conduciendo';
    }
    $('challenge-label').textContent=label;$('challenge-title').textContent=title;$('challenge-detail').textContent=detail;
    const checkpoint=challenges.checkpoint;gate.visible=!!checkpoint;$('checkpoint-guide').hidden=!checkpoint;
    if(checkpoint) {
      gate.position.set(checkpoint.x,0,checkpoint.z);gate.rotation.y=checkpoint.yaw;
      const relative=Math.atan2(checkpoint.x-vehicle.x,checkpoint.z-vehicle.z)-vehicle.yaw;
      $('checkpoint-arrow').style.transform=`rotate(${relative}rad)`;$('checkpoint-distance').textContent=`${Math.round(Math.hypot(checkpoint.x-vehicle.x,checkpoint.z-vehicle.z))} m`;
    }
    $('drift').hidden=challenges.driftCombo<10;$('drift-points').textContent=`+${Math.floor(challenges.driftCombo)}`;
    $('drift-multiplier').textContent=`×${1+Math.min(3,Math.floor(challenges.driftDuration/2.5))}`;drawMap();
  }
  function renderVehicle(alpha,dt) {
    const p=vehicle.previous;
    const x=T.MathUtils.lerp(p.x,vehicle.x,alpha),z=T.MathUtils.lerp(p.z,vehicle.z,alpha),yaw=T.MathUtils.lerp(p.yaw,vehicle.yaw,alpha);
    car.root.position.set(x,.05,z);car.root.rotation.y=yaw;
    car.body.rotation.z=vehicle.roll;car.body.rotation.x=vehicle.pitch;
    car.body.position.y=vehicle.surface==='asphalt'?Math.sin(visualClock*15)*Math.min(.006,vehicle.speed*.0003):Math.sin(visualClock*23)*Math.min(.045,vehicle.speed*.003);
    car.wheels.forEach(w=>{w.pivot.rotation.y=w.front?vehicle.steer:0;w.spin.rotation.x=vehicle.wheelAngle;});
    const braking=input.read().brake||input.read().handbrake;car.tail.emissiveIntensity=braking?3:.65;
    cameraYaw=approach(cameraYaw,yaw,cameraMode===1?12:4.5,dt);
    const s=Math.sin(cameraYaw),c=Math.cos(cameraYaw),speedRatio=clamp(vehicle.speed/50,0,1);
    if(!started) {
      const angle=-.75+Math.sin(visualClock*.12)*.13;
      desiredCamera.set(x+Math.sin(angle)*9,3.2,z+Math.cos(angle)*9);desiredLook.set(x,1,z);
    } else if(cameraMode===1) {
      desiredCamera.set(x+s*.85,1.58,z+c*.85);desiredLook.set(x+s*30,1.8,z+c*30);
    } else {
      const distance=cameraMode===2?17:8.7+speedRatio*3;
      desiredCamera.set(x-s*distance, cameraMode===2?10:4.8+speedRatio*1.0,z-c*distance);
      desiredLook.set(x+s*(3.3+speedRatio*4),1.2,z+c*(3.3+speedRatio*4));
      // A short ray against nearby solid AABBs pulls the chase camera in before
      // walls can occlude it. Ground clearance is enforced separately.
      const rayX=desiredCamera.x-x,rayZ=desiredCamera.z-z,rayY=desiredCamera.y-1.1;
      let hit=1;
      for(const b of world.collision.query((x+desiredCamera.x)/2,(z+desiredCamera.z)/2,Math.abs(rayX)+Math.abs(rayZ)+3)) {
        if(!['building','parked car','boundary'].includes(b.kind))continue;
        let near=0,far=1;
        for(const [origin,direction,min,max] of [[x,rayX,b.x-b.halfX-.3,b.x+b.halfX+.3],[z,rayZ,b.z-b.halfZ-.3,b.z+b.halfZ+.3]]) {
          if(Math.abs(direction)<.00001) {if(origin<min||origin>max){near=2;break;}}
          else {const t1=(min-origin)/direction,t2=(max-origin)/direction;near=Math.max(near,Math.min(t1,t2));far=Math.min(far,Math.max(t1,t2));}
        }
        if(near<far&&near>0)hit=Math.min(hit,Math.max(.13,near-.04));
      }
      if(hit<1)desiredCamera.set(x+rayX*hit,1.1+rayY*hit,z+rayZ*hit);
    }
    if(resetCamera) {cameraPosition.copy(desiredCamera);cameraLook.copy(desiredLook);cameraYaw=yaw;resetCamera=false;}
    else {cameraPosition.lerp(desiredCamera,1-Math.exp(-dt*(cameraMode===1?20:7)));cameraLook.lerp(desiredLook,1-Math.exp(-dt*9));}
    cameraPosition.y=Math.max(1.15,cameraPosition.y);camera.position.copy(cameraPosition);camera.lookAt(cameraLook);
    const targetFOV=cameraMode===2?60:cameraMode===1?67+speedRatio*8:58+speedRatio*9;
    const fov=approach(camera.fov,targetFOV,3,dt);if(Math.abs(fov-camera.fov)>.01){camera.fov=fov;camera.updateProjectionMatrix();}
    car.body.visible=cameraMode!==1||!started;
    sky.position.set(camera.position.x,0,camera.position.z);
    // Shadow camera follows on a coarse grid to prevent constant texture crawl.
    const shadowX=Math.round(x/2)*2,shadowZ=Math.round(z/2)*2;
    sun.position.set(shadowX-75,120,shadowZ-60);sun.target.position.set(shadowX,0,shadowZ);
    arrow.position.y=7.3+Math.sin(visualClock*2.8)*.35;
  }
  const neutral={steer:0,throttle:false,brake:false,handbrake:false};
  function frame(now) {
    requestAnimationFrame(frame);
    const dt=Math.min((now-(lastFrame||now))/1000,.08);lastFrame=now;visualClock+=dt;frameCount++;
    if(playing) {
      accumulator+=dt;
      while(accumulator>=FIXED_DT) {
        const drive=challenges.countdown>0?neutral:input.read();
        if(challenges.countdown===0)vehicle.step(drive,FIXED_DT);
        challenges.update(FIXED_DT,drive);accumulator-=FIXED_DT;
      }
      effects(dt);hintRemaining-=dt;if(hintRemaining<=0)$('first-hint').hidden=true;
    }
    renderVehicle(playing?accumulator/FIXED_DT:1,dt||.016);
    audio.update(vehicle,input.read(),playing&&challenges.countdown===0);
    hudClock+=dt;if(hudClock>.08){hudClock=0;if(started)updateHUD();}
    if(now>toastState.until)$('toast').classList.remove('show');
    fpsFrames++;fpsDuration+=dt;
    if(fpsDuration>=4&&playing) {
      const fps=fpsFrames/fpsDuration;
      if(qualityChoice==='auto'&&qualityLevel>0) {
        lowWindows=fps<42?lowWindows+1:0;
        if(lowWindows>=2){setQuality(qualityLevel-1,'auto');notify('Calidad ajustada para una conducción más fluida');lowWindows=0;}
      }
      fpsFrames=0;fpsDuration=0;
    }
    renderer.render(scene,camera);
  }
  updateRecords();resize();renderVehicle(1,.016);renderer.render(scene,camera);
  $('loading').hidden=true;$('welcome').hidden=false;requestAnimationFrame(frame);
  // Opt-in diagnostics only on ?debug=1, used by browser smoke tests and profiling.
  if(new URLSearchParams(location.search).has('debug'))window.__costa={vehicle,world,input,challenges,renderer,camera,car,
    get state(){return{playing,paused,started,quality:qualityLevel,cameraMode,frameCount};},step:(controls,n=120)=>{for(let i=0;i<n;i++)vehicle.step(controls,FIXED_DT);},recover};
}
