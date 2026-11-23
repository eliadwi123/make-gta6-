// game.js — Port Marisol's bootstrap and beating heart: renderer, input,
// cameras, the on-foot / driving state machine, combat, carjacking, the
// busted & wasted rules, saving, and the ?shot= scenes used for screenshots.
window.PM = window.PM || {};

PM.Game = {
  state: 'title',        // 'title' | 'playing' | 'ended'
  scene: null,
  camera: null,
  renderer: null,
  rng: null,
  keys: {},
  playerCar: null,
  health: 100,
  money: 50,
  bustedMeter: 0,
  camYaw: Math.PI,
  camPitch: 0.32,
  camPos: null,
  maya: null,
  beacon: null,
  beaconPos: null,
  shotName: null,
  shotAutopilot: null,
  damageCooldown: 0,
  muzzle: 0,
  elapsed: 0,
  lastMissionIndex: -1,
  saveKey: 'portMarisolSaveV1',

  /* ---------------- queries the other modules use ---------------- */

  playerPos() {
    return this.playerCar ? this.playerCar.mesh.position : PM.Player.pos;
  },

  playerHeading() {
    return this.playerCar ? this.playerCar.heading : PM.Player.heading;
  },

  beaconTarget() {
    return this.beaconPos;
  },

  /** Show the gold mission beacon at a point, or hide it with null. */
  setBeacon(pos) {
    this.beaconPos = pos;
    if (!this.beacon) return;
    this.beacon.visible = !!pos;
    if (pos) this.beacon.position.set(pos.x, 30, pos.z);
  },

  /* ---------------- setup ---------------- */

  init() {
    const seedParam = parseInt(PM.queryParam('seed') || '1', 10);
    this.rng = PM.makeRng(Number.isFinite(seedParam) ? seedParam : 1);
    this.shotName = PM.queryParam('shot');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8ec9e8);
    this.scene.fog = new THREE.Fog(0x8ec9e8, 190, 620);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.camera.position.set(60, 42, 330);

    const canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7a5a, 0.95);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.35);
    sun.position.set(-140, 220, 120);
    this.scene.add(sun);
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(16, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff7ae, fog: false })
    );
    sunDisc.position.set(-420, 480, 260);
    this.scene.add(sunDisc);

    PM.City.build(this.scene, this.rng);
    PM.Vehicles.populate(this.scene, this.rng, 13);
    PM.People.populate(this.scene, this.rng, 20);
    for (const ped of PM.People.peds) ped.mesh.userData.ped = ped;

    PM.Player.spawn(this.scene, 96, 200);
    PM.Player.mesh.traverse((o) => { o.userData.isPlayer = true; });
    this.maya = PM.People.spawnMaya(this.scene, 108, 222, -0.6);
    this.beacon = PM.City.makeBeacon();

    PM.HUD.init();
    this.bindInput();
    this.refreshContinueButton();

    this.camPos = this.camera.position.clone();
    if (this.shotName) {
      this.stageShot(this.shotName);
    }

    const clock = new THREE.Clock();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      this.elapsed += dt;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  },

  bindInput() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      PM.Audio.unlock();
      if (e.code === 'KeyE') this.onInteractKey();
      if (e.code === 'KeyF') this.onPunch();
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    // Drag to orbit the camera; a clean click (no drag) shoots.
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      PM.Audio.unlock();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX;
      lastY = e.clientY;
      this.camYaw -= dx * 0.005;
      this.camPitch = PM.clamp(this.camPitch + dy * 0.004, 0.06, 1.1);
    });
    window.addEventListener('mouseup', () => {
      if (dragging && moved < 5 && this.state === 'playing' && !this.playerCar && !PM.Missions.dialogueActive) {
        this.onShoot();
      }
      dragging = false;
    });

    document.getElementById('btn-new').addEventListener('click', () => { PM.Audio.unlock(); this.newGame(); });
    document.getElementById('btn-continue').addEventListener('click', () => { PM.Audio.unlock(); this.continueGame(); });
    document.getElementById('btn-restart').addEventListener('click', () => { PM.Audio.unlock(); this.respawn(); });
  },

  /* ---------------- game flow ---------------- */

  refreshContinueButton() {
    let has = false;
    try { has = !!window.localStorage.getItem(this.saveKey); } catch (err) { has = false; }
    PM.HUD.els.btnContinue.disabled = !has;
  },

  newGame() {
    try { window.localStorage.removeItem(this.saveKey); } catch (err) { /* private mode */ }
    this.money = 50;
    this.health = 100;
    PM.Police.clearAll(this.scene);
    this.exitCar(true);
    PM.Player.mesh.visible = true;
    PM.Player.mesh.position.set(96, 0, 200);
    PM.Player.heading = Math.PI;
    this.state = 'playing';
    PM.HUD.hideStart();
    PM.HUD.hideEnd();
    PM.HUD.showGameHud();
    PM.Missions.start(this, 0);
    this.saveGame();
  },

  continueGame() {
    let save = null;
    try { save = JSON.parse(window.localStorage.getItem(this.saveKey)); } catch (err) { save = null; }
    if (!save) { this.newGame(); return; }
    this.money = save.money || 0;
    this.health = 100;
    PM.Police.clearAll(this.scene);
    this.state = 'playing';
    PM.HUD.hideStart();
    PM.HUD.hideEnd();
    PM.HUD.showGameHud();
    if (save.storyDone) {
      PM.Missions.state = 'storyDone';
      PM.HUD.setObjective(null);
      PM.HUD.toast('Welcome back to Port Marisol — the town is yours.');
    } else {
      PM.Missions.start(this, save.missionIndex || 0);
    }
  },

  saveGame() {
    if (this.shotName) return; // screenshots never touch the player's save
    try {
      window.localStorage.setItem(this.saveKey, JSON.stringify({
        money: this.money,
        missionIndex: PM.Missions.index,
        storyDone: PM.Missions.state === 'storyDone',
      }));
    } catch (err) { /* storage unavailable: play on without saving */ }
  },

  addMoney(amount, why) {
    this.money += amount;
    PM.Audio.cash();
    if (why) PM.HUD.toast(why + '  +$' + amount);
  },

  /** After a bust / a beating / the finale: reset to the marina. */
  respawn() {
    PM.HUD.hideEnd();
    PM.Police.clearAll(this.scene);
    this.exitCar(true);
    this.health = 100;
    this.bustedMeter = 0;
    PM.Player.mesh.position.set(96, 0, 200);
    PM.Player.mesh.visible = true;
    PM.Player.heading = Math.PI;
    this.state = 'playing';
    if (PM.Missions.state !== 'storyDone') {
      // Re-run the current mission from its first stage; the boost car, if
      // any, is sent back to its parking spot by ensureBoostCar().
      PM.Missions.enterStage(this, 0);
    }
    this.saveGame();
  },

  endGame(kind, title, text) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    PM.Audio.failJingle();
    PM.Audio.stopEngine();
    PM.Audio.setSiren(false);
    PM.HUD.showEnd(kind, title, text);
  },

  winStory() {
    this.endGame('win', 'YOU MADE THE FERRY', 'Rio & Maya sail out of Port Marisol $' + this.money.toLocaleString('en-US') + ' richer. The town is yours now — free roam, no curfew.');
    PM.Audio.missionJingle();
  },

  /* ---------------- cars: stealing, entering, leaving ---------------- */

  onInteractKey() {
    if (this.state !== 'playing') return;
    if (PM.Missions.dialogueActive) {
      PM.Missions.advanceDialogue(this);
      return;
    }
    if (this.playerCar) {
      this.exitCar(false);
      return;
    }
    const car = PM.Vehicles.nearestStealable(PM.Player.pos, 3.6);
    if (car) this.enterCar(car);
  },

  enterCar(car) {
    const wasTraffic = car.kind === 'traffic';
    if (wasTraffic) {
      const ti = PM.Vehicles.traffic.indexOf(car);
      if (ti >= 0) PM.Vehicles.traffic.splice(ti, 1);
    }
    const pi = PM.Vehicles.parked.indexOf(car);
    if (pi >= 0) PM.Vehicles.parked.splice(pi, 1);
    car.kind = 'player';
    car.speed = 0;
    this.playerCar = car;
    PM.Player.mesh.visible = false;
    PM.Audio.door();
    PM.Audio.startEngine();
    // Grand theft auto is, legally speaking, a crime.
    this.commitCrime(wasTraffic ? 0.7 : 0.4, car.mesh.position);
  },

  exitCar(silent) {
    const car = this.playerCar;
    if (!car) return;
    this.playerCar = null;
    car.kind = 'parked';
    car.speed = 0;
    PM.Vehicles.parked.push(car);
    const pos = car.mesh.position;
    const sideX = Math.cos(car.heading);
    const sideZ = -Math.sin(car.heading);
    PM.Player.mesh.position.set(pos.x + sideX * 2.2, 0, pos.z + sideZ * 2.2);
    PM.City.collideCircle(PM.Player.mesh.position, 0.5);
    PM.Player.mesh.visible = true;
    PM.Player.heading = car.heading;
    if (!silent) PM.Audio.door();
    PM.Audio.stopEngine();
    PM.HUD.setSpeedo(null);
  },

  /** The marked gold coupé of mission 3, spawned/kept at its parking spot. */
  ensureBoostCar() {
    if (PM.Missions.index !== 2) return;
    if (!PM.Missions.boostCar) {
      const car = PM.Vehicles.spawnCar(this.scene, this.rng, 'parked', 0xf7b731, 'hatch');
      car.maxSpeed = 37;
      car.mesh.position.set(122.4, 0, -58);
      car.heading = Math.PI;
      car.mesh.rotation.y = car.heading;
      PM.Vehicles.parked.push(car);
      PM.Missions.boostCar = car;
    } else if (PM.Missions.stageIndex === 0 && this.playerCar !== PM.Missions.boostCar) {
      const car = PM.Missions.boostCar;
      if (PM.dist2d(car.mesh.position, { x: 122.4, z: -58 }) > 20 && car.kind === 'parked') {
        car.mesh.position.set(122.4, 0, -58);
        car.heading = Math.PI;
        car.mesh.rotation.y = car.heading;
        car.speed = 0;
      }
    }
  },

  /* ---------------- crime & combat ---------------- */

  /**
   * Add heat for a crime, full strength when a pedestrian or a police unit
   * can see it happen, muffled when the street is empty.
   */
  commitCrime(amount, atPos) {
    let witnessed = PM.Police.cars.length > 0 && PM.dist2d(atPos, this.playerPos()) < 70;
    if (!witnessed) {
      for (const ped of PM.People.peds) {
        if (ped.state !== 'down' && PM.dist2d(atPos, ped.mesh.position) < 17) { witnessed = true; break; }
      }
    }
    PM.Wanted.addCrime(witnessed ? amount : amount * 0.35);
  },

  onPunch() {
    if (this.state !== 'playing' || this.playerCar || PM.Missions.dialogueActive) return;
    const pos = PM.Player.pos;
    const fx = pos.x + Math.sin(PM.Player.heading) * 1.6;
    const fz = pos.z + Math.cos(PM.Player.heading) * 1.6;
    PM.Audio.punch();
    for (const ped of PM.People.peds) {
      if (ped.isMaya || ped.state === 'down') continue;
      if (PM.dist2d({ x: fx, z: fz }, ped.mesh.position) < 1.5) {
        PM.People.knockDown(ped, 5);
        PM.People.panicNear(pos, 10);
        this.commitCrime(0.55, pos);
        if (this.rng.chance(0.4)) {
          this.money += 15;
          PM.Audio.cash();
          PM.HUD.toast('Took $15 off a very surprised local.');
        }
        return;
      }
    }
  },

  onShoot() {
    if (this.state !== 'playing') return;
    PM.Audio.shoot();
    this.muzzle = 0.09;
    this.commitCrime(0.8, this.playerPos());
    PM.People.panicNear(this.playerPos(), 16);
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: 0, y: 0 }, this.camera);
    ray.far = 90;
    const hits = ray.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      let node = hit.object;
      let car = null;
      let ped = null;
      let isPlayer = false;
      while (node) {
        if (node.userData && node.userData.car) car = node.userData.car;
        if (node.userData && node.userData.ped) ped = node.userData.ped;
        if (node.userData && node.userData.isPlayer) isPlayer = true;
        node = node.parent;
      }
      if (isPlayer) continue; // the camera sits behind Rio; never shoot himself
      if (ped && !ped.isMaya) {
        PM.People.knockDown(ped, 9);
        PM.Wanted.addCrime(0.7);
        return;
      }
      if (car && car !== this.playerCar) {
        car.damage += 1;
        PM.Audio.crash();
        if (car.kind === 'police') PM.Wanted.addCrime(0.8);
        return;
      }
      if (hit.object !== PM.Player.mesh) return; // scenery stops the bullet
    }
  },

  /* ---------------- per-frame update ---------------- */

  readDriveInput() {
    const k = this.keys;
    return {
      throttle: (k.KeyW || k.ArrowUp ? 1 : 0) + (k.KeyS || k.ArrowDown ? -1 : 0),
      steer: (k.KeyA || k.ArrowLeft ? 1 : 0) + (k.KeyD || k.ArrowRight ? -1 : 0),
      handbrake: !!k.Space,
    };
  },

  readWalkWish() {
    const k = this.keys;
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) + (k.KeyS || k.ArrowDown ? -1 : 0);
    const strafe = (k.KeyD || k.ArrowRight ? 1 : 0) + (k.KeyA || k.ArrowLeft ? -1 : 0);
    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    // Camera forward on the ground plane is (-sin(camYaw), -cos(camYaw))
    // because the camera sits at player + (sin, cos) * distance.
    let x = -sin * fwd + cos * strafe;
    let z = -cos * fwd - sin * strafe;
    const len = Math.sqrt(x * x + z * z);
    if (len > 0) { x /= len; z /= len; }
    return { x, z };
  },

  update(dt) {
    PM.City.animate(dt, this.elapsed);
    const playing = this.state === 'playing';
    const inDialogue = PM.Missions.dialogueActive;

    // The world never sleeps, even on the title screen.
    const playerPosNow = this.playerPos();
    PM.Vehicles.updateTraffic(dt, this.rng, this.playerCar ? null : playerPosNow, this.playerCar ? playerPosNow : null);
    PM.People.update(dt, this.rng);

    if (this.state === 'title') {
      const t = this.elapsed * 0.045;
      this.camera.position.set(Math.sin(t) * 150, 44 + Math.sin(this.elapsed * 0.11) * 6, 268 + Math.cos(t) * 40);
      this.camera.lookAt(0, 6, 40);
      return;
    }

    if (playing && !inDialogue && !this.shotAutopilot) {
      if (this.playerCar) this.updateDriving(dt);
      else this.updateOnFoot(dt);
    }

    // Story bookkeeping: Maya's post and the boost car follow the mission.
    if (playing) {
      this.ensureBoostCar();
      if (PM.Missions.index !== this.lastMissionIndex) {
        this.lastMissionIndex = PM.Missions.index;
        if (this.maya) {
          if (PM.Missions.index === 2) this.maya.mesh.position.set(78, 0, 22);
          else if (PM.Missions.index === 0) this.maya.mesh.position.set(108, 0, 222);
        }
      }
      PM.Missions.update(dt, this);
    }

    // Police + wanted. (In the staged 'end' screenshot the fleet holds its
    // boxed-in pose and only the light bars keep flashing.)
    const targetPos = this.playerPos();
    let policeInfo = { nearestDist: Infinity, anySirenNear: false };
    if (this.shotName === 'end') {
      PM.Police.flashLights(dt);
    } else {
      policeInfo = PM.Police.update(this.scene, this.rng, dt, {
        pos: targetPos,
        speed: this.playerCar ? this.playerCar.speed : 0,
        inCar: !!this.playerCar,
      });
    }
    const seen = PM.Wanted.update(dt, targetPos, PM.Police.positions());
    void seen;
    PM.Audio.setSiren(playing && policeInfo.anySirenNear && this.state === 'playing');

    if (playing) this.updateBustedAndDamage(dt, policeInfo);

    // Deck height for the player (pier / boardwalk), then the camera.
    if (!this.playerCar) {
      PM.Player.mesh.position.y = PM.City.groundHeightAt(PM.Player.pos.x, PM.Player.pos.z);
    } else {
      this.playerCar.mesh.position.y = PM.City.groundHeightAt(targetPos.x, targetPos.z);
    }
    this.updateCamera(dt);
    this.updateHud(policeInfo);
  },

  updateOnFoot(dt) {
    const wish = this.readWalkWish();
    const sprint = !!(this.keys.ShiftLeft || this.keys.ShiftRight);
    PM.Player.update(dt, wish, sprint);
    // The camera yaw drifts to sit behind a moving player.
    if (wish.x !== 0 || wish.z !== 0) {
      const behind = Math.atan2(wish.x, wish.z) + Math.PI;
      this.camYaw = PM.lerpAngle(this.camYaw, behind, PM.clamp(dt * 2.2, 0, 1));
    }
    // Context prompt: near a car, E is an invitation.
    const car = PM.Vehicles.nearestStealable(PM.Player.pos, 3.6);
    PM.HUD.setPrompt(car ? 'E — steal this ' + (car === PM.Missions.boostCar ? 'gold coupé' : 'car') : null);
  },

  updateDriving(dt) {
    const car = this.playerCar;
    const input = this.readDriveInput();
    const impact = PM.Vehicles.drivePlayerCar(car, input, dt);
    if (impact > 16) {
      PM.Audio.crash();
      this.damagePlayer((impact - 14) * 0.55, 'crash');
      this.commitCrime(0.35, car.mesh.position);
    } else if (impact > 6) {
      PM.Audio.crash();
      this.commitCrime(0.2, car.mesh.position);
    }
    PM.Audio.setEngine(Math.abs(car.speed) / car.maxSpeed, Math.abs(input.throttle));
    PM.HUD.setPrompt(null);
    PM.HUD.setSpeedo(Math.abs(car.speed) * 3.6);
    // Camera settles behind the car.
    this.camYaw = PM.lerpAngle(this.camYaw, car.heading + Math.PI, PM.clamp(dt * 3.2, 0, 1));
    this.camPitch = PM.lerp(this.camPitch, 0.3, PM.clamp(dt * 2, 0, 1));
  },

  /** Busted meter, ram damage, and the two ways a run ends. */
  updateBustedAndDamage(dt, policeInfo) {
    if (this.shotName) return; // staged scenes are invulnerable
    this.damageCooldown = Math.max(0, this.damageCooldown - dt);
    const pos = this.playerPos();
    let boxed = false;

    for (const cop of PM.Police.cars) {
      const d = PM.dist2d(pos, cop.mesh.position);
      if (this.playerCar) {
        if (d < 4.2 && Math.abs(cop.speed) > 7 && this.damageCooldown <= 0) {
          this.damagePlayer(7, 'ram');
          this.damageCooldown = 0.8;
          PM.Audio.crash();
        }
        if (d < 7 && Math.abs(this.playerCar.speed) < 1.6) boxed = true;
      } else if (d < 8) {
        boxed = true;
      }
    }

    if (boxed && PM.Wanted.stars > 0) {
      this.bustedMeter = Math.min(1, this.bustedMeter + dt / 2.6);
    } else {
      this.bustedMeter = Math.max(0, this.bustedMeter - dt / 1.8);
    }
    if (this.bustedMeter >= 1) {
      this.endGame('busted', 'BUSTED', 'The Port Marisol PD walks you to the cells. Bail comes out of your legend, not your wallet — try again.');
      return;
    }
    if (this.health <= 0) {
      this.endGame('wasted', 'WASTED', 'You wake up on a marina bench with an ice pack and a stern note from Maya.');
    }
  },

  damagePlayer(amount, cause) {
    void cause;
    this.health = Math.max(0, this.health - amount);
  },

  updateCamera(dt) {
    const target = this.playerPos();
    const dist = this.camDistOverride || (this.playerCar ? 11 : 8);
    const height = this.playerCar ? 4.2 : 3.4;
    const back = {
      x: target.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * dist,
      z: target.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * dist,
    };
    let camY = target.y + height + Math.sin(this.camPitch) * dist * 0.7;
    // Keep the camera out of the buildings: if its spot is inside a
    // collider footprint, lift it above that roof.
    for (const c of PM.City.colliders) {
      if (back.x > c.minX - 1 && back.x < c.maxX + 1 && back.z > c.minZ - 1 && back.z < c.maxZ + 1) {
        camY = Math.max(camY, c.height + 2.5);
      }
    }
    const desired = new THREE.Vector3(back.x, camY, back.z);
    const k = 1 - Math.exp(-dt * (this.playerCar ? 5 : 7));
    this.camPos.lerp(desired, k);
    this.camera.position.copy(this.camPos);
    // The chase screenshot aims a few metres behind the car, so the player
    // and the fleet chasing him share the frame.
    let lookX = target.x;
    let lookZ = target.z;
    if (this.camAimBack && this.playerCar) {
      lookX -= Math.sin(this.playerCar.heading) * this.camAimBack;
      lookZ -= Math.cos(this.playerCar.heading) * this.camAimBack;
    }
    this.camera.lookAt(lookX, target.y + 1.7, lookZ);

    if (this.muzzle > 0) {
      this.muzzle -= dt;
      this.camera.position.x += (Math.random() - 0.5) * 0.05;
      this.camera.position.y += (Math.random() - 0.5) * 0.05;
    }
  },

  updateHud(policeInfo) {
    void policeInfo;
    PM.HUD.setHealth(this.health / 100);
    PM.HUD.setMoney(this.money);
    PM.HUD.setWanted(PM.Wanted.stars);
    PM.HUD.setBusted(this.state === 'playing' ? this.bustedMeter : 0);
    PM.HUD.setCrosshair(this.state === 'playing' && !this.playerCar);
    if (!this.playerCar) PM.HUD.setSpeedo(null);
    PM.HUD.drawMinimap(this);
  },

  /* ---------------- screenshot scenes (?shot=) ---------------- */

  /**
   * Stage a real gameplay scene for the kit's screenshots. The world is the
   * real world, the HUD is the real HUD; only the opening positions and the
   * autopilot are arranged, like the starter's shot scenes did.
   */
  stageShot(name) {
    PM.HUD.hideStart();
    if (name === 'start') {
      this.state = 'title';
      PM.HUD.els.startscreen.classList.remove('hidden');
      return;
    }
    this.state = 'playing';
    PM.HUD.showGameHud();
    PM.Missions.start(this, 0);

    if (name === 'play') {
      // Rio is already at work: driving the coast road, Maya on the phone,
      // the delivery objective live.
      PM.Missions.index = 1;
      PM.Missions.enterStage(this, 2);
      const car = PM.Vehicles.parked.find((c) => c.carKind === 'sedan') || PM.Vehicles.parked[0];
      car.mesh.userData.paint.color.setHex(0xd64541); // hero red for the cover car
      car.mesh.position.set(40, 0, PM.CITY.beachZ - 14);
      car.heading = -Math.PI / 2;
      this.enterCar(car);
      PM.Wanted.setHeat(0); // the staged scene starts clean; enterCar's crime is undone
      this.shotAutopilot = { mode: 'coast', targetX: -260 };
      PM.HUD.showDialogue('Maya (phone)', 'Package is in the back, Rio. Docks, east end of the coast road — and hurry, the buyer hates waiting.');
      this.camYaw = car.heading + Math.PI;
      this.camPos.set(car.mesh.position.x + 9, 4.4, car.mesh.position.z + 3);
    } else if (name === 'chase' || name === 'end') {
      // Three stars on the downtown grid, the fleet already on his tail.
      const car = PM.Vehicles.parked.find((c) => c.carKind === 'sedan' && c !== PM.Missions.boostCar) || PM.Vehicles.parked[0];
      car.mesh.userData.paint.color.setHex(0xd64541);
      car.mesh.position.set(0, 0, -58);
      car.heading = Math.PI;
      this.enterCar(car);
      PM.Wanted.setHeat(3.0);
      for (let i = 0; i < 3; i += 1) {
        const cop = PM.Police.spawnOne(this.scene, this.rng, car.mesh.position);
        // Rio faces north (-Z), so his pursuers stage to the south (+Z).
        cop.mesh.position.set(-6 + i * 6, 0, -58 + 15 + i * 9);
        cop.heading = Math.PI;
        cop.speed = 8;
      }
      PM.HUD.setObjective('One Way Ticket', 'Lose the police — do not let them box you in!');
      this.camYaw = car.heading + Math.PI;
      this.camPos.set(8, 4.6, -58 + 12);
      if (name === 'chase') {
        this.shotAutopilot = { mode: 'flee' };
        this.camPitch = 0.38;
        this.camDistOverride = 16;
        this.camYaw = Math.PI; // frontal: camera ahead of the car, looking back
        this.camPos.set(5, 4.5, -58 - 17);
      } else {
        // Busted: boxed in at a standstill, lights still flashing. The
        // fleet re-stages into a tight arc on the camera side of the car.
        car.speed = 0;
        this.shotAutopilot = null;
        this.state = 'ended';
        const arc = [[-5.5, -52], [5.5, -52], [3.2, -49.5]];
        PM.Police.cars.forEach((cop, i) => {
          if (arc[i]) {
            cop.mesh.position.set(arc[i][0], 0, arc[i][1]);
            cop.heading = Math.PI;
            cop.mesh.rotation.y = Math.PI;
            cop.speed = 0;
          }
        });
        this.camPos.set(9, 6.5, -58 + 17);
        PM.HUD.setObjective(null);
        PM.HUD.showEnd('busted', 'BUSTED', 'Three stars too many. The Port Marisol PD finally boxes Rio in.');
      }
    }
  },
};

/** The shot scenes' simple autopilot, driven from the main loop. */
PM.Game.updateShotAutopilot = function updateShotAutopilot(dt) {
  const auto = this.shotAutopilot;
  if (!auto || !this.playerCar) return;
  const car = this.playerCar;
  if (auto.mode === 'coast') {
    PM.Vehicles.pursue(car, { x: auto.targetX, z: PM.CITY.beachZ - 14 }, dt, 17, 3);
    if (car.mesh.position.x < auto.targetX + 30) auto.targetX = 260;
    if (car.mesh.position.x > 230) auto.targetX = -260;
  } else if (auto.mode === 'flee') {
    // Straight up the central avenue, and the camera rides ahead of the
    // car looking back at it — the classic frontal chase shot, with the
    // fleet filling the road behind Rio.
    PM.Vehicles.pursue(car, { x: 0, z: -420 }, dt, 23, 2.4);
    this.camYaw = PM.lerpAngle(this.camYaw, car.heading, PM.clamp(dt * 4, 0, 1));
    PM.HUD.setSpeedo(Math.abs(car.speed) * 3.6);
    return;
  }
  PM.HUD.setSpeedo(Math.abs(car.speed) * 3.6);
  this.camYaw = PM.lerpAngle(this.camYaw, car.heading + Math.PI, PM.clamp(dt * 4, 0, 1));
};

// Hook the autopilot into the frame update without disturbing normal play.
const baseUpdate = PM.Game.update.bind(PM.Game);
PM.Game.update = function updateWithAutopilot(dt) {
  if (this.shotAutopilot && this.state === 'playing') this.updateShotAutopilot(dt);
  baseUpdate(dt);
};

window.addEventListener('DOMContentLoaded', () => PM.Game.init());
