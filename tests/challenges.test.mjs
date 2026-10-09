import test from 'node:test';
import assert from 'node:assert/strict';
import { Challenges } from '../src/challenges.js';
import { Vehicle } from '../src/physics.js';
const world={loop:{samples:Array.from({length:241},(_,i)=>({x:Math.sin(i/240*Math.PI*2)*250,z:Math.cos(i/240*Math.PI*2)*250}))},driftPad:{x:0,z:0,hx:48,hz:48}};
const create=()=>new Challenges(world,new Vehicle(),()=>{},()=>{});
test('countdown freezes the challenge clock and ordered checkpoints complete the circuit',()=>{
  const c=create();c.start('circuit');c.update(2,{});assert.equal(c.elapsed,0);assert.equal(c.index,0);c.update(1,{});
  for(let i=0;i<12;i++){const gate=c.checkpoint;c.vehicle.x=gate.x;c.vehicle.z=gate.z;c.vehicle.previous={x:gate.x,z:gate.z};c.update(.1,{});}
  assert.equal(c.index,12);assert.equal(c.active,false);assert.equal(c.result.success,true);assert.ok(c.best.circuit>0);
});
test('speed objective requires real vehicle speed and records successful time',()=>{
  const c=create();c.start('speed');c.update(3,{});c.vehicle.speed=119/3.6;c.update(1,{});assert.equal(c.active,true);
  c.vehicle.speed=121/3.6;c.update(.5,{});assert.equal(c.result.success,true);assert.equal(c.best.speed,1.5);
});
test('timeout finishes a challenge and recovery imposes a time penalty',()=>{
  const c=create();c.start('circuit');c.update(3,{});c.recover();assert.equal(c.elapsed,5);c.update(146,{});assert.equal(c.result.success,false);
});
test('drift score needs slip on asphalt inside the arena; collisions discard a combo',()=>{
  const c=create();c.start('drift');c.update(3,{});Object.assign(c.vehicle,{x:0,z:0,speed:18,slip:.35,drift:true,surface:'asphalt',collision:0});
  c.update(1,{});assert.ok(c.driftCombo>50);
  c.vehicle.x=100;c.driftCombo=0;c.update(1,{});assert.equal(c.driftCombo,0);
  c.vehicle.x=0;c.update(1,{});c.vehicle.drift=false;c.vehicle.collision=.5;c.update(.1,{});assert.equal(c.driftCombo,0);
});
