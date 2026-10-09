export class EngineAudio {
  constructor() {this.enabled=false;this.ctx=null;}
  async toggle() {
    if(!this.ctx) {
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!Context)return false;
      this.ctx=new Context();this.master=this.ctx.createGain();this.master.gain.value=0;this.master.connect(this.ctx.destination);
      this.engine=this.ctx.createOscillator();this.engine.type='sawtooth';
      this.filter=this.ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=550;
      this.gain=this.ctx.createGain();this.engine.connect(this.filter).connect(this.gain).connect(this.master);this.engine.start();
      const buffer=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate),data=buffer.getChannelData(0);
      for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      this.noise=this.ctx.createBufferSource();this.noise.buffer=buffer;this.noise.loop=true;
      const highpass=this.ctx.createBiquadFilter();highpass.type='highpass';highpass.frequency.value=1300;
      this.tires=this.ctx.createGain();this.noise.connect(highpass).connect(this.tires).connect(this.master);this.noise.start();
    }
    try {await this.ctx.resume();} catch {return false;}
    this.enabled=!this.enabled;this.master.gain.setTargetAtTime(this.enabled?.35:0,this.ctx.currentTime,.07);return this.enabled;
  }
  update(vehicle,input,playing) {
    if(!this.ctx)return;
    const t=this.ctx.currentTime;
    const simulatedRPM=850+(vehicle.speed*165)%5200+vehicle.throttle*700;
    this.engine.frequency.setTargetAtTime(simulatedRPM/60*2,t,.10);
    this.filter.frequency.setTargetAtTime(250+vehicle.throttle*700+vehicle.speed*9,t,.10);
    this.gain.gain.setTargetAtTime(playing?.04+vehicle.throttle*.055:0,t,.10);
    this.tires.gain.setTargetAtTime(playing?(vehicle.drift?.09:vehicle.surface!=='asphalt'?Math.min(.025,vehicle.speed*.001):0):0,t,.08);
  }
}
