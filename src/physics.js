export const FIXED_DT = 1 / 120;
export const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
export const approach = (x, target, rate, dt) => x + (target - x) * (1 - Math.exp(-rate * dt));

export class CollisionWorld {
  constructor() { this.cells = new Map(); this.objects = []; }
  add(x, z, halfX, halfZ, kind = 'building') {
    const item = { x, z, halfX, halfZ, kind, id: this.objects.length };
    this.objects.push(item);
    for (let i = Math.floor((x - halfX) / 32); i <= Math.floor((x + halfX) / 32); i++) {
      for (let j = Math.floor((z - halfZ) / 32); j <= Math.floor((z + halfZ) / 32); j++) {
        const key = `${i},${j}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(item);
      }
    }
    return item;
  }
  query(x, z, radius = 4) {
    const result = new Set();
    for (let i = Math.floor((x - radius) / 32); i <= Math.floor((x + radius) / 32); i++)
      for (let j = Math.floor((z - radius) / 32); j <= Math.floor((z + radius) / 32); j++)
        for (const item of this.cells.get(`${i},${j}`) || []) result.add(item);
    return result;
  }
}

/** Planar rigid body with front/rear tire slip, friction circles and load transfer.
 * SI units; +z forward, +x right, positive yaw turns right. Visual suspension
 * is layered on top, so camera and collisions never depend on body roll. */
export class Vehicle {
  constructor(world = new CollisionWorld(), surfaceAt = () => 'asphalt') {
    this.world = world; this.surfaceAt = surfaceAt;
    this.mass = 1420; this.inertia = 2380;
    this.reset(124, -110, 0);
  }
  reset(x, z, yaw = 0) {
    Object.assign(this, { x, z, yaw, vx: 0, vz: 0, yawRate: 0, steer: 0, throttle: 0,
      longitudinal: 0, lateral: 0, speed: 0, slip: 0, ax: 0, az: 0,
      roll: 0, pitch: 0, wheelAngle: 0, collision: 0, surface: 'asphalt', gear: 'N', drift: false });
    this.previous = { x, z, yaw }; this.lastSafe = { x, z, yaw };
  }
  step(input, dt = FIXED_DT) {
    this.previous.x = this.x; this.previous.z = this.z; this.previous.yaw = this.yaw;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const u = this.vx * s + this.vz * c;
    const v = this.vx * c - this.vz * s;
    const absU = Math.abs(u);
    const kin = 1 - clamp((absU - 1.5) / 4, 0, 1);
    this.surface = this.surfaceAt(this.x, this.z);
    const onRoad = this.surface === 'asphalt';
    const mu = onRoad ? 1.03 : this.surface === 'sand' ? 0.48 : 0.61;
    const targetSteer = clamp(input.steer || 0, -1, 1) * (0.58 / (1 + absU / 28));
    this.steer = approach(this.steer, targetSteer, input.steer ? 9 : 12, dt);
    this.throttle = approach(this.throttle, input.throttle ? 1 : 0, 5, dt);
    let engine = 0, brake = 0;
    if (input.throttle) {
      if (u < -0.45) brake = 11200;
      else engine = this.throttle * 7900 / (1 + Math.max(u, 0) / 24);
    }
    if (input.brake) {
      if (u > 0.45) brake = 13200;
      else if (!input.throttle) engine = -3600 * clamp((10 + u) / 3, 0, 1);
    }
    const direction = Math.sign(u) || (engine < 0 ? -1 : 1);
    if (input.throttle && input.brake) { engine = 0; brake = 13200; }
    let longitudinal = engine - direction * brake;
    if (input.handbrake) longitudinal -= Math.tanh(u * 2) * 3100;
    const drag = 0.43 * u * absU + (onRoad ? 175 : 560) * Math.tanh(u * 2.5);
    longitudinal -= drag;
    if (brake && Math.abs(longitudinal * dt / this.mass) > absU) longitudinal = -u * this.mass / dt;
    const transfer = clamp(longitudinal * 0.52 / 2.65, -2400, 2400);
    const loadFront = this.mass * 9.81 * 1.45 / 2.65 - transfer;
    const loadRear = this.mass * 9.81 * 1.20 / 2.65 + transfer;
    const gripFront = mu * loadFront;
    const gripRear = mu * loadRear * (input.handbrake ? 0.28 : 1);
    const effectiveSpeed = Math.max(absU, 4.5);
    const alphaF = Math.atan2(v + 1.20 * this.yawRate, effectiveSpeed) - this.steer * Math.sign(u);
    const alphaR = Math.atan2(v - 1.45 * this.yawRate, effectiveSpeed);
    const longFront = brake ? longitudinal * 0.68 : longitudinal * 0.12;
    const longRear = longitudinal - longFront;
    const limitFront = Math.sqrt(Math.max(0, gripFront ** 2 - Math.min(Math.abs(longFront), gripFront * 0.94) ** 2));
    const limitRear = Math.sqrt(Math.max(0, gripRear ** 2 - Math.min(Math.abs(longRear), gripRear * 0.94) ** 2));
    const fFront = limitFront * Math.tanh(-68000 * alphaF / Math.max(limitFront, 1));
    const fRear = limitRear * Math.tanh(-72000 * alphaR / Math.max(limitRear, 1));
    const lateralForce = fFront * Math.cos(this.steer) + fRear;
    longitudinal -= fFront * Math.sin(this.steer) * (1 - kin);
    const aForward = longitudinal / this.mass;
    const aRight = lateralForce / this.mass;
    this.vx += (aForward * s + aRight * c * (1 - kin)) * dt;
    this.vz += (aForward * c - aRight * s * (1 - kin)) * dt;
    const dynamicYawAcceleration = (1.20 * fFront * Math.cos(this.steer) - 1.45 * fRear) / this.inertia;
    this.yawRate += (dynamicYawAcceleration - this.yawRate * 0.35) * dt * (1 - kin);
    if (kin > 0) {
      this.yawRate = approach(this.yawRate, u * Math.tan(this.steer) / 2.65, kin * 15, dt);
      const remainingLateral = (this.vx * c - this.vz * s) * (1 - Math.exp(-kin * 18 * dt));
      this.vx -= remainingLateral * c; this.vz += remainingLateral * s;
    }
    this.yawRate = clamp(this.yawRate, -2.4, 2.4);
    this.yaw += this.yawRate * dt;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.collision = Math.max(0, this.collision - dt * 2);
    this.resolveCollisions();
    const sn = Math.sin(this.yaw), cn = Math.cos(this.yaw);
    this.longitudinal = this.vx * sn + this.vz * cn;
    this.lateral = this.vx * cn - this.vz * sn;
    this.speed = Math.hypot(this.vx, this.vz);
    this.slip = Math.atan2(this.lateral, Math.max(Math.abs(this.longitudinal), 1));
    this.ax = approach(this.ax, aRight, 8, dt); this.az = approach(this.az, aForward, 8, dt);
    this.roll = approach(this.roll, clamp(-aRight * 0.009, -0.085, 0.085), 9, dt);
    this.pitch = approach(this.pitch, clamp(aForward * 0.010, -0.070, 0.070), 9, dt);
    this.wheelAngle += this.longitudinal / 0.36 * dt;
    this.gear = this.longitudinal < -0.3 ? 'R' : this.longitudinal > 0.3 || input.throttle ? 'D' : 'N';
    this.drift = this.speed > 7 && Math.abs(this.slip) > 0.14 && Math.abs(this.slip) < 1.3 && !this.collision;
    const clearOfSolids = [...this.world.query(this.x, this.z, 4)].every(b => Math.abs(this.x-b.x)>b.halfX+2.5 || Math.abs(this.z-b.z)>b.halfZ+3);
    if (onRoad && this.collision === 0 && clearOfSolids) {
      this.lastSafe.x = this.x; this.lastSafe.z = this.z; this.lastSafe.yaw = this.yaw;
    }
  }
  resolveCollisions() {
    for (let pass = 0; pass < 3; pass++) {
      let overlap = false;
      const candidates = this.world.query(this.x, this.z, 4);
      for (const offset of [-1.22, 0, 1.22]) {
        const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
        const px = this.x + s * offset, pz = this.z + c * offset, radius = 1.03;
        for (const box of candidates) {
          const closestX = clamp(px, box.x - box.halfX, box.x + box.halfX);
          const closestZ = clamp(pz, box.z - box.halfZ, box.z + box.halfZ);
          let nx = px - closestX, nz = pz - closestZ, d = Math.hypot(nx, nz), penetration;
          if (d >= radius) continue;
          overlap = true;
          if (d < 0.00001) {
            const dx = box.halfX - Math.abs(px - box.x), dz = box.halfZ - Math.abs(pz - box.z);
            if (dx < dz) { nx = px >= box.x ? 1 : -1; nz = 0; penetration = radius + dx; }
            else { nx = 0; nz = pz >= box.z ? 1 : -1; penetration = radius + dz; }
          } else { nx /= d; nz /= d; penetration = radius - d; }
          this.x += nx * (penetration + 0.002); this.z += nz * (penetration + 0.002);
          const rx = s * offset, rz = c * offset;
          const contactVX = this.vx + this.yawRate * rz, contactVZ = this.vz - this.yawRate * rx;
          const normalV = contactVX * nx + contactVZ * nz;
          if (normalV < 0) {
            const lever = rz * nx - rx * nz;
            const impulse = -(1.12 * normalV) / (1 / this.mass + lever * lever / this.inertia);
            this.vx += impulse * nx / this.mass; this.vz += impulse * nz / this.mass;
            this.yawRate += impulse * lever / this.inertia;
            this.vx *= 0.93; this.vz *= 0.93;
            this.collision = Math.min(1, -normalV / 12);
          }
        }
      }
      if (!overlap) break;
    }
    if (!Number.isFinite(this.x + this.z + this.yaw + this.vx + this.vz)) this.reset(124, -110, 0);
  }
}
