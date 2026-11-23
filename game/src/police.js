// police.js — the law. A heat value from 0..5 drives the star display;
// crimes add heat, hiding decays it. The police fleet spawns at the edge of
// the player's world, pursues in cars, rams the player's car, and surrounds
// the player on foot so game.js can run the busted meter.
window.PM = window.PM || {};

PM.Wanted = {
  heat: 0,
  unseenTimer: 0,
  lastSeenAt: 0,

  get stars() {
    return this.heat <= 0.05 ? 0 : Math.min(5, Math.ceil(this.heat));
  },

  /** Register a crime: `amount` of heat, scaled by how public it was. */
  addCrime(amount) {
    this.heat = PM.clamp(this.heat + amount, 0, 5);
  },

  setHeat(value) {
    this.heat = PM.clamp(value, 0, 5);
  },

  clear() {
    this.heat = 0;
    this.unseenTimer = 0;
  },

  /**
   * Decay: while any police unit is close enough to see the player the heat
   * holds; out of sight for a few seconds it bleeds away, faster at low heat.
   */
  update(dt, playerPos, policePositions) {
    let seen = false;
    for (const p of policePositions) {
      if (PM.dist2d(playerPos, p) < 58) { seen = true; break; }
    }
    if (seen) {
      this.unseenTimer = 0;
    } else if (this.heat > 0) {
      this.unseenTimer += dt;
      if (this.unseenTimer > 6) {
        this.heat = Math.max(0, this.heat - dt * 0.09);
      }
    }
    return seen;
  },
};

PM.Police = {
  cars: [],
  flashPhase: 0,

  /** Remove a car entity from the scene and every registry. */
  removeCar(scene, car) {
    scene.remove(car.mesh);
    const drop = (list) => {
      const i = list.indexOf(car);
      if (i >= 0) list.splice(i, 1);
    };
    drop(this.cars);
    drop(PM.Vehicles.all);
    drop(PM.Vehicles.traffic);
    drop(PM.Vehicles.parked);
  },

  /** Spawn a police car at an intersection well away from the player. */
  spawnOne(scene, rng, playerPos) {
    const H = PM.CITY.half;
    let best = null;
    for (let tries = 0; tries < 12; tries += 1) {
      const i = rng.int(-H, H);
      const j = rng.int(-H, H);
      const x = PM.City.avenue(i);
      const z = PM.City.avenue(j);
      const d = PM.dist2d(playerPos, { x, z });
      if (d > 70 && d < 190) { best = { x, z }; break; }
      if (!best || d > PM.dist2d(playerPos, best)) best = { x, z };
    }
    const car = PM.Vehicles.spawnCar(scene, rng, 'police', 0xf4f6f8, 'police');
    car.mesh.position.set(best.x, 0, best.z);
    car.maxSpeed = 34;
    this.cars.push(car);
    return car;
  },

  /**
   * Keep the fleet matched to the star count and drive the pursuit.
   * `target` is {pos, speed, inCar}. Returns {nearestDist, anySirenNear}.
   */
  update(scene, rng, dt, target) {
    const want = PM.Wanted.stars;
    if (this.cars.length < want) {
      this.spawnOne(scene, rng, target.pos);
    }
    // Surplus or obsolete units peel off and despawn away from the action.
    for (let i = this.cars.length - 1; i >= 0; i -= 1) {
      const car = this.cars[i];
      const d = PM.dist2d(target.pos, car.mesh.position);
      if ((this.cars.length > want && d > 60) || d > 320) {
        this.removeCar(scene, car);
      }
    }

    let nearestDist = Infinity;
    let anySirenNear = false;

    for (const car of this.cars) {
      const dist = PM.Vehicles.pursue(car, target.pos, dt, target.inCar ? 33 : 16, 2.6);
      // On foot they box the player in rather than run him down.
      if (!target.inCar && dist < 8) {
        car.speed = Math.min(car.speed, Math.max(0, (dist - 5)) * 1.2);
      }
      if (dist < nearestDist) nearestDist = dist;
      if (dist < 70) anySirenNear = true;
    }
    this.flashLights(dt);
    return { nearestDist, anySirenNear };
  },

  /** Alternate the red/blue light-bar halves on every police car. */
  flashLights(dt) {
    this.flashPhase += dt * 7;
    const flashOn = Math.sin(this.flashPhase) > 0;
    for (const car of this.cars) {
      const red = car.mesh.userData.lightRed;
      const blue = car.mesh.userData.lightBlue;
      if (red && blue) {
        red.visible = flashOn;
        blue.visible = !flashOn;
      }
    }
  },

  /** All police positions, for the wanted system's line-of-sight test. */
  positions() {
    return this.cars.map((c) => c.mesh.position);
  },

  /** Full reset (new game / after a bust): every unit leaves the map. */
  clearAll(scene) {
    for (let i = this.cars.length - 1; i >= 0; i -= 1) this.removeCar(scene, this.cars[i]);
    PM.Wanted.clear();
  },
};
