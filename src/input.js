export class DrivingInput {
  constructor(root = document) {
    this.pointers = new Map(); this.keys = new Set(); this.root = root;
    this.buttons = [...root.querySelectorAll('[data-drive]')];
    this.buttons.forEach(button => {
      button.addEventListener('pointerdown', e => {
        e.preventDefault();
        this.pointers.set(e.pointerId, button.dataset.drive);
        try { button.setPointerCapture(e.pointerId); } catch { /* cancelled pointer */ }
        this.paint();
      });
      button.addEventListener('lostpointercapture', e => this.release(e.pointerId));
    });
    root.addEventListener('pointerup', e => this.release(e.pointerId));
    root.addEventListener('pointercancel', e => this.release(e.pointerId));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    window.addEventListener('keydown', e => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD'].includes(e.code)) {
        if (e.target.matches('select,input,textarea')) return;
        e.preventDefault(); this.keys.add(e.code); this.paint();
      }
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); this.paint(); });
  }
  release(id) { this.pointers.delete(id); this.paint(); }
  clear() { this.pointers.clear(); this.keys.clear(); this.paint(); }
  read() {
    const actions = new Set(this.pointers.values());
    const held = (action, ...keys) => actions.has(action) || keys.some(k => this.keys.has(k));
    return {
      steer: Number(held('right', 'KeyD','ArrowRight')) - Number(held('left', 'KeyA','ArrowLeft')),
      throttle: held('throttle','KeyW','ArrowUp'), brake: held('brake','KeyS','ArrowDown'),
      handbrake: held('handbrake','Space')
    };
  }
  paint() {
    const input = this.read();
    this.buttons.forEach(b => {
      const active = b.dataset.drive === 'left' ? input.steer < 0 : b.dataset.drive === 'right' ? input.steer > 0 : input[b.dataset.drive];
      b.classList.toggle('held', !!active); b.setAttribute('aria-pressed', String(!!active));
    });
  }
}
