// hud.js — everything drawn over the 3D view: health, cash, wanted stars,
// the objective banner, prompts, dialogue boxes, toasts, the speedometer,
// the busted meter, and the circular minimap with its blips.
window.PM = window.PM || {};

PM.HUD = {
  els: {},
  toastTimer: null,

  init() {
    const byId = (id) => document.getElementById(id);
    this.els = {
      hud: byId('hud'),
      healthfill: byId('healthfill'),
      money: byId('money'),
      wanted: byId('wanted'),
      objective: byId('objective'),
      objTitle: document.querySelector('#objective .obj-title'),
      objText: document.querySelector('#objective .obj-text'),
      minimap: byId('minimap'),
      speedo: byId('speedo'),
      speed: document.querySelector('#speedo .speed'),
      prompt: byId('prompt'),
      crosshair: byId('crosshair'),
      bustedmeter: byId('bustedmeter'),
      bustedfill: byId('bustedfill'),
      dialogue: byId('dialogue'),
      speaker: document.querySelector('#dialogue .speaker'),
      line: document.querySelector('#dialogue .line'),
      toast: byId('toast'),
      startscreen: byId('startscreen'),
      endscreen: byId('endscreen'),
      endTitle: byId('end-title'),
      endText: byId('end-text'),
      btnContinue: byId('btn-continue'),
    };
    this.mapCtx = this.els.minimap.getContext('2d');
  },

  showGameHud() { this.els.hud.classList.remove('hidden'); },
  hideStart() { this.els.startscreen.classList.add('hidden'); },

  setHealth(health01) {
    this.els.healthfill.style.width = PM.clamp(health01 * 100, 0, 100) + '%';
  },

  setMoney(amount) {
    this.els.money.textContent = '$' + amount.toLocaleString('en-US');
  },

  setWanted(stars) {
    let html = '';
    for (let i = 0; i < 5; i += 1) {
      html += i < stars ? '★' : '<span class="off">★</span>';
    }
    if (this.els.wanted.innerHTML !== html) this.els.wanted.innerHTML = html;
  },

  setObjective(title, text) {
    if (!title) {
      this.els.objective.classList.add('hidden');
      return;
    }
    this.els.objective.classList.remove('hidden');
    this.els.objTitle.textContent = title;
    this.els.objText.textContent = text || '';
  },

  setPrompt(text) {
    if (!text) {
      this.els.prompt.classList.add('hidden');
      return;
    }
    this.els.prompt.classList.remove('hidden');
    this.els.prompt.textContent = text;
  },

  setSpeedo(kmh) {
    if (kmh === null) {
      this.els.speedo.classList.add('hidden');
      return;
    }
    this.els.speedo.classList.remove('hidden');
    this.els.speed.textContent = String(Math.round(kmh));
  },

  setCrosshair(on) {
    this.els.crosshair.classList.toggle('hidden', !on);
  },

  setBusted(frac) {
    if (frac <= 0) {
      this.els.bustedmeter.classList.add('hidden');
      return;
    }
    this.els.bustedmeter.classList.remove('hidden');
    this.els.bustedfill.style.width = PM.clamp(frac * 100, 0, 100) + '%';
  },

  showDialogue(who, text) {
    this.els.dialogue.classList.remove('hidden');
    this.els.speaker.textContent = who;
    this.els.line.textContent = text;
  },

  hideDialogue() { this.els.dialogue.classList.add('hidden'); },

  toast(text) {
    this.els.toast.textContent = text;
    this.els.toast.style.opacity = '1';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.els.toast.style.opacity = '0'; }, 3400);
  },

  showEnd(kind, title, text) {
    this.els.endscreen.classList.remove('hidden');
    this.els.endTitle.textContent = title;
    this.els.endTitle.className = kind;
    this.els.endText.textContent = text;
  },

  hideEnd() { this.els.endscreen.classList.add('hidden'); },

  /**
   * The minimap: sea to the south, the avenue grid, the gold mission target,
   * red police blips, grey traffic, and the player's white arrow in the middle
   * of a north-up view that scrolls with the player.
   */
  drawMinimap(game) {
    const ctx = this.mapCtx;
    const size = 184;
    const halfView = 120; // metres visible from centre to edge
    const scale = (size / 2) / halfView;
    const px = game.playerPos().x;
    const pz = game.playerPos().z;
    const toMap = (wx, wz) => [(wx - px) * scale + size / 2, (wz - pz) * scale + size / 2];

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    // Land, beach and sea bands.
    ctx.fillStyle = '#7c8894';
    ctx.fillRect(0, 0, size, size);
    const [, beachY] = toMap(0, PM.CITY.beachZ);
    const [, waterY] = toMap(0, PM.CITY.waterZ);
    ctx.fillStyle = '#e8d193';
    ctx.fillRect(0, beachY, size, waterY - beachY);
    ctx.fillStyle = '#1668a8';
    ctx.fillRect(0, waterY, size, size - waterY);

    // Roads.
    ctx.strokeStyle = '#3a3f46';
    ctx.lineWidth = PM.CITY.roadHalf * 2 * scale;
    for (let i = -PM.CITY.half; i <= PM.CITY.half; i += 1) {
      const a = PM.City.avenue(i);
      const [vx] = toMap(a, 0);
      ctx.beginPath();
      ctx.moveTo(vx, 0);
      ctx.lineTo(vx, size);
      ctx.stroke();
      const [, hz] = toMap(0, a);
      ctx.beginPath();
      ctx.moveTo(0, hz);
      ctx.lineTo(size, hz);
      ctx.stroke();
    }

    // Traffic blips.
    ctx.fillStyle = '#cfd6dd';
    for (const car of PM.Vehicles.traffic) {
      if (car.kind !== 'traffic') continue;
      const [x, y] = toMap(car.mesh.position.x, car.mesh.position.z);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    // Mission target.
    const target = game.beaconTarget();
    if (target) {
      const [x, y] = toMap(target.x, target.z);
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(x, y, 5 + Math.sin(performance.now() * 0.006) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Police blips.
    ctx.fillStyle = '#ff3b30';
    for (const car of PM.Police.cars) {
      const [x, y] = toMap(car.mesh.position.x, car.mesh.position.z);
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player arrow, pointing along the player's heading.
    const heading = game.playerHeading();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI - heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(4.6, 5);
    ctx.lineTo(0, 2.4);
    ctx.lineTo(-4.6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
};
