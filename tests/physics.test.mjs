import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, CollisionWorld, FIXED_DT } from '../src/physics.js';

const drive = (v,input,seconds) => {for(let i=0;i<Math.round(seconds/FIXED_DT);i++)v.step(input);};
const neutral={steer:0,throttle:false,brake:false,handbrake:false};

test('progressive acceleration moves along the road and coasting loses speed',()=>{
  const v=new Vehicle();v.reset(0,0);
  drive(v,{...neutral,throttle:true},5);
  assert.ok(v.z>35);assert.ok(v.speed>15&&v.speed<28);assert.ok(Math.abs(v.x)<.01);assert.equal(v.gear,'D');
  const speed=v.speed;drive(v,neutral,4);assert.ok(v.speed<speed);
});
test('the brake stops forward motion, then becomes reverse; throttle brakes reverse',()=>{
  const v=new Vehicle();v.reset(0,0);drive(v,{...neutral,throttle:true},5);
  const peakZ=v.z;drive(v,{...neutral,brake:true},6);
  assert.ok(v.longitudinal<-2);assert.equal(v.gear,'R');assert.ok(v.z<peakZ+25);
  drive(v,{...neutral,throttle:true},4);assert.ok(v.longitudinal>2);assert.equal(v.gear,'D');
});
test('right/left steering is mirrored and reverse reverses steering direction',()=>{
  const right=new Vehicle(),left=new Vehicle();right.reset(0,0);left.reset(0,0);
  drive(right,{...neutral,throttle:true,steer:1},2);drive(left,{...neutral,throttle:true,steer:-1},2);
  assert.ok(right.x>2&&right.yaw>.1);assert.ok(left.x<-2&&left.yaw<-.1);
  assert.ok(Math.abs(left.x+right.x)<1e-8);assert.ok(Math.abs(left.z-right.z)<1e-8);
  const reverse=new Vehicle();reverse.reset(0,0);drive(reverse,{...neutral,brake:true,steer:1},3);assert.ok(reverse.yaw<-.1);
});
test('holding both pedals brakes to rest without alternating drive and reverse',()=>{
  const v=new Vehicle();v.reset(0,0);drive(v,{...neutral,throttle:true},3);
  drive(v,{...neutral,throttle:true,brake:true},4);assert.ok(v.speed<.02);
});
test('handbrake breaks rear grip and off-road increases drag',()=>{
  const grip=new Vehicle(),slide=new Vehicle();grip.reset(0,0);slide.reset(0,0);
  drive(grip,{...neutral,throttle:true},5);drive(slide,{...neutral,throttle:true},5);
  drive(grip,{...neutral,steer:1},.8);drive(slide,{...neutral,steer:1,handbrake:true},.8);
  assert.ok(Math.abs(slide.slip)>Math.abs(grip.slip)+.05);
  const asphalt=new Vehicle(),grass=new Vehicle(new CollisionWorld(),()=> 'grass');asphalt.reset(0,0);grass.reset(0,0);
  drive(asphalt,{...neutral,throttle:true},5);drive(grass,{...neutral,throttle:true},5);
  assert.ok(grass.speed<asphalt.speed);
});
test('solid buildings stop the car; it can reverse out and escape embedded spawns',()=>{
  const world=new CollisionWorld();world.add(0,25,8,2);const v=new Vehicle(world);v.reset(0,0);
  drive(v,{...neutral,throttle:true},6);assert.ok(v.z<23);assert.ok(Number.isFinite(v.yaw));
  const impactZ=v.z;drive(v,{...neutral,brake:true},3);assert.ok(v.z<impactZ-2);
  v.reset(0,25);drive(v,neutral,.1);
  assert.ok(Math.abs(v.z-25)>3||Math.abs(v.x)>9);
});
test('fixed-step simulation gives identical results at 30, 60 and 120 render FPS',()=>{
  function simulate(fps){const v=new Vehicle();v.reset(0,0);let accumulator=0;for(let frame=0;frame<fps*8;frame++){accumulator+=1/fps;while(accumulator+1e-10>=FIXED_DT){v.step({...neutral,throttle:true,steer:.12});accumulator-=FIXED_DT;}}return v;}
  const a=simulate(30),b=simulate(60),c=simulate(120);
  for(const key of ['x','z','yaw','vx','vz']) {assert.ok(Math.abs(a[key]-b[key])<1e-9);assert.ok(Math.abs(a[key]-c[key])<1e-9);}
});
test('extended aggressive driving stays finite on every surface',()=>{
  for(const surface of ['asphalt','grass','sand']) {
    const v=new Vehicle(new CollisionWorld(),()=>surface);v.reset(0,0);
    for(let i=0;i<120*90;i++) {v.step({throttle:i%500<380,brake:i%500>450,steer:Math.sin(i/70),handbrake:i%600>480});assert.ok(Number.isFinite(v.x+v.z+v.yaw+v.vx+v.vz));assert.ok(v.speed<90);}
  }
});
