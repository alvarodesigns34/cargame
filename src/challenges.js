import { clamp } from './physics.js';

export class Challenges {
  constructor(world, vehicle, notify, save) {
    this.world=world;this.vehicle=vehicle;this.notify=notify;this.save=save;
    this.mode='free';this.active=false;this.elapsed=0;this.countdown=0;
    this.totalScore=0;this.driftBank=0;this.driftCombo=0;this.driftDuration=0;this.driftIdle=0;this.driftEarned=0;
    this.index=0;this.gates=[];this.best={};this.result=null;
  }
  start(mode) {
    this.mode=mode;this.active=mode!=='free';this.elapsed=0;this.countdown=this.active?3:0;
    this.index=0;this.driftBank=0;this.driftCombo=0;this.driftEarned=0;this.driftDuration=0;this.driftIdle=0;this.result=null;
    if(mode==='circuit') {
      const samples=this.world.loop.samples;
      this.gates=Array.from({length:12},(_,i)=> {
        const index=Math.round((i+1)*(samples.length-1)/12), p=samples[index],before=samples[Math.max(0,index-1)],after=samples[Math.min(samples.length-1,index+1)];
        return {x:p.x,z:p.z,yaw:Math.atan2(after.x-before.x,after.z-before.z)};
      });
      const p=samples[0],n=samples[1];this.vehicle.reset(p.x+2.5,p.z,Math.atan2(n.x-p.x,n.z-p.z));
      this.notify('Vuelta a la costa · Sigue los arcos luminosos');
    } else if(mode==='speed') {
      const samples=this.world.loop.samples,p=samples[23],n=samples[24];
      this.vehicle.reset(p.x,p.z,Math.atan2(n.x-p.x,n.z-p.z));
      this.notify('A fondo · Alcanza 120 km/h en 25 segundos');
    } else if(mode==='drift') {
      this.vehicle.reset(this.world.driftPad.x-15,this.world.driftPad.z-20,0);
      this.notify('Derrapa · Gira y toca MANO para soltar el eje trasero');
    }
    this.lastCountdown=Math.ceil(this.countdown);
  }
  get limit() { return this.mode==='circuit'?150:this.mode==='speed'?25:60; }
  get checkpoint() { return this.active&&this.mode==='circuit' ? this.gates[this.index] : null; }
  update(dt,input) {
    if(this.countdown>0) {
      this.countdown=Math.max(0,this.countdown-dt);
      if(this.countdown===0) this.notify('¡Vamos!');
      return;
    }
    const v=this.vehicle;
    const inArena=Math.abs(v.x-this.world.driftPad.x)<this.world.driftPad.hx&&Math.abs(v.z-this.world.driftPad.z)<this.world.driftPad.hz;
    const canScore=this.mode!=='drift'||inArena;
    if(v.drift && v.surface==='asphalt' && canScore) {
      this.driftDuration+=dt;this.driftIdle=0;
      const multiplier=1+Math.min(3,Math.floor(this.driftDuration/2.5));
      this.driftCombo+=dt*clamp(v.speed,0,35)*Math.abs(v.slip)*18*multiplier;
    } else if(this.driftCombo>0) {
      this.driftIdle+=dt;
      if(v.collision>.1) {this.notify('Contacto · Derrape perdido');this.driftCombo=0;this.driftDuration=0;}
      else if(this.driftIdle>1.25) this.bankDrift();
    }
    if(!this.active) return;
    this.elapsed+=dt;
    if(this.mode==='circuit') {
      const p=this.checkpoint,previous=v.previous;
      if(p) {
        // Segment-distance detection handles a checkpoint passed between frames.
        const dx=v.x-previous.x,dz=v.z-previous.z;
        const t=clamp(((p.x-previous.x)*dx+(p.z-previous.z)*dz)/Math.max(dx*dx+dz*dz,.0001),0,1);
        if(Math.hypot(previous.x+t*dx-p.x,previous.z+t*dz-p.z)<12) {
          this.index++;this.notify(this.index===12?'¡Meta!':`Checkpoint ${this.index} / 12`);
          if(this.index===12) this.finish(true);
        }
      }
    } else if(this.mode==='speed'&&v.speed*3.6>=120) this.finish(true);
    else if(this.mode==='drift'&&this.driftBank+this.driftCombo>=1000) {this.bankDrift();this.finish(true);}
    if(this.active&&this.elapsed>=this.limit) {if(this.mode==='drift')this.bankDrift();this.finish(false);}
  }
  bankDrift() {
    const pts=Math.floor(this.driftCombo);
    if(pts>15) {this.driftBank+=pts;this.totalScore+=pts;this.driftEarned+=pts;this.notify(`Derrape +${pts} puntos`);}
    this.driftCombo=0;this.driftDuration=0;this.driftIdle=0;
  }
  recover() {
    if(this.active) {this.elapsed+=5;this.notify('Coche recuperado · +5 s de penalización');}
    else this.notify('De vuelta a la carretera');
    this.driftCombo=0;this.driftDuration=0;
  }
  finish(success) {
    this.active=false;this.result={success,mode:this.mode,time:this.elapsed,score:this.driftBank};
    const value=this.mode==='drift'?this.driftBank:this.elapsed;
    const previous=this.best[this.mode];
    if(success&&(!previous||(this.mode==='drift'?value>previous:value<previous))) {this.best[this.mode]=value;this.save(this.best);}
    this.notify(success?(this.mode==='drift'?`¡Reto completado! · ${this.driftBank} puntos`:`¡Reto completado! · ${this.elapsed.toFixed(2)} s`):'Tiempo agotado · Toca el objetivo para volver a intentarlo',5);
  }
}
