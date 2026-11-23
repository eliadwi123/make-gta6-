// people.js — the low-poly citizens of Port Marisol: a shared character
// factory with swinging limbs, the player character Rio, sidewalk
// pedestrians who flee from violence, and Maya, Rio's partner in crime.
window.PM = window.PM || {};

PM.People = {
  peds: [],

  SKIN_TONES: [0xf2c79b, 0xc68863, 0x8d5524, 0xffdbac, 0x6b4423],
  SHIRTS: [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e06c, 0xff9ff3, 0x54a0ff, 0xf368e0, 0xff9f43, 0x1dd1a1, 0xc8d6e5],
  PANTS: [0x2f3542, 0x57606f, 0x747d8c, 0x3b3b98, 0x82589f, 0x222f3e],

  /** A box-person ~1.8 m tall facing +Z, limbs pivoted for walk swings. */
  buildPerson(look) {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: look.skin });
    const shirt = new THREE.MeshLambertMaterial({ color: look.shirt });
    const pants = new THREE.MeshLambertMaterial({ color: look.pants });

    const legGeo = new THREE.BoxGeometry(0.21, 0.85, 0.24);
    legGeo.translate(0, -0.42, 0);
    const legL = new THREE.Mesh(legGeo, pants);
    legL.position.set(-0.13, 0.85, 0);
    const legR = new THREE.Mesh(legGeo, pants);
    legR.position.set(0.13, 0.85, 0);
    g.add(legL, legR);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.3), shirt);
    torso.position.y = 1.19;
    g.add(torso);

    const armGeo = new THREE.BoxGeometry(0.15, 0.72, 0.17);
    armGeo.translate(0, -0.32, 0);
    const armL = new THREE.Mesh(armGeo, shirt);
    armL.position.set(-0.34, 1.5, 0);
    const armR = new THREE.Mesh(armGeo, shirt);
    armR.position.set(0.34, 1.5, 0);
    g.add(armL, armR);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), skin);
    head.position.y = 1.78;
    g.add(head);

    if (look.cap) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.26, 0.12, 10), new THREE.MeshLambertMaterial({ color: look.cap }));
      cap.position.y = 1.95;
      g.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.28), cap.material);
      brim.position.set(0, 1.9, 0.3);
      g.add(brim);
    } else if (look.hair !== undefined) {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.245, 10, 6, 0, Math.PI * 2, 0, 1.9), new THREE.MeshLambertMaterial({ color: look.hair }));
      hair.position.y = 1.8;
      g.add(hair);
    }

    g.userData.limbs = { legL, legR, armL, armR };
    return g;
  },

  /** Animate the walk swing for a person moving at `speed01` (0..1). */
  animateWalk(mesh, phase, speed01) {
    const limbs = mesh.userData.limbs;
    if (!limbs) return;
    const swing = Math.sin(phase) * 0.65 * speed01;
    limbs.legL.rotation.x = swing;
    limbs.legR.rotation.x = -swing;
    limbs.armL.rotation.x = -swing * 0.8;
    limbs.armR.rotation.x = swing * 0.8;
  },

  /** Lay a person flat (punched / shot / scared stiff). */
  knockDown(ped, seconds) {
    ped.state = 'down';
    ped.downTimer = seconds;
    ped.mesh.rotation.x = -Math.PI / 2;
    ped.mesh.position.y = 0.25;
  },

  /** Spawn the sidewalk population. */
  populate(scene, rng, count) {
    for (let n = 0; n < count; n += 1) {
      const look = {
        skin: rng.pick(this.SKIN_TONES),
        shirt: rng.pick(this.SHIRTS),
        pants: rng.pick(this.PANTS),
        hair: rng.pick([0x1a1210, 0x3a2415, 0x6e4a2f, 0xb8b0a4, 0xd9a441]),
      };
      const mesh = this.buildPerson(look);
      scene.add(mesh);
      const node = PM.Vehicles.randomNode(rng);
      const ped = {
        mesh,
        heading: 0,
        speed: rng.range(1.3, 2.1),
        walkPhase: rng.range(0, 6),
        route: null,
        state: 'walk',       // 'walk' | 'flee' | 'down'
        fleeFrom: null,
        fleeTimer: 0,
        downTimer: 0,
        isMaya: false,
      };
      const options = PM.Vehicles.neighbours(node.i, node.j);
      const next = options[rng.int(0, options.length - 1)];
      ped.route = { fromI: node.i, fromJ: node.j, toI: next.i, toJ: next.j, t: rng.next() };
      this.peds.push(ped);
    }
  },

  /** Maya stands at her post (marina / mission spots) until the story moves her. */
  spawnMaya(scene, x, z, heading) {
    const mesh = this.buildPerson({ skin: 0xc68863, shirt: 0xff8c42, pants: 0x3b3b98, hair: 0x1a1210 });
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading || 0;
    scene.add(mesh);
    const maya = {
      mesh, heading: heading || 0, speed: 0, walkPhase: 0, route: null,
      state: 'stand', fleeFrom: null, fleeTimer: 0, downTimer: 0, isMaya: true,
    };
    this.peds.push(maya);
    return maya;
  },

  /** Sidewalk point along a route: same graph as traffic, wider offset. */
  pedPoint(route, t) {
    const ax = PM.City.avenue(route.fromI);
    const az = PM.City.avenue(route.fromJ);
    const bx = PM.City.avenue(route.toI);
    const bz = PM.City.avenue(route.toJ);
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const off = PM.CITY.pedOffset;
    return { x: ax + dx * t + (-uz) * off, z: az + dz * t + ux * off, ux, uz, len };
  },

  /** Scare every pedestrian within `radius` of a point into running away. */
  panicNear(pos, radius) {
    for (const ped of this.peds) {
      if (ped.isMaya || ped.state === 'down') continue;
      if (PM.dist2d(pos, ped.mesh.position) < radius) {
        ped.state = 'flee';
        ped.fleeFrom = { x: pos.x, z: pos.z };
        ped.fleeTimer = 2.6;
      }
    }
  },

  /** Advance all pedestrians. */
  update(dt, rng) {
    for (const ped of this.peds) {
      const pos = ped.mesh.position;
      if (ped.state === 'stand') continue;
      if (ped.state === 'down') {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) {
          ped.state = 'flee';
          ped.fleeTimer = 2;
          ped.fleeFrom = { x: pos.x + rng.range(-4, 4), z: pos.z + rng.range(-4, 4) };
          ped.mesh.rotation.x = 0;
          ped.mesh.position.y = 0;
        }
        continue;
      }
      if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        const away = Math.atan2(pos.x - ped.fleeFrom.x, pos.z - ped.fleeFrom.z);
        ped.heading = PM.lerpAngle(ped.heading, away, PM.clamp(dt * 6, 0, 1));
        pos.x += Math.sin(ped.heading) * 4.4 * dt;
        pos.z += Math.cos(ped.heading) * 4.4 * dt;
        PM.City.collideCircle(pos, 0.45);
        ped.walkPhase += dt * 11;
        this.animateWalk(ped.mesh, ped.walkPhase, 1);
        ped.mesh.rotation.y = ped.heading;
        if (ped.fleeTimer <= 0) {
          ped.state = 'walk';
          // Rejoin the sidewalk graph at the nearest intersection.
          const ci = PM.clamp(Math.round(pos.x / PM.CITY.pitch), -PM.CITY.half, PM.CITY.half);
          const cj = PM.clamp(Math.round(pos.z / PM.CITY.pitch), -PM.CITY.half, PM.CITY.half);
          const options = PM.Vehicles.neighbours(ci, cj);
          const next = options[rng.int(0, options.length - 1)];
          ped.route = { fromI: ci, fromJ: cj, toI: next.i, toJ: next.j, t: 0 };
        }
        continue;
      }
      // Normal stroll along the sidewalk graph.
      const route = ped.route;
      const pt = this.pedPoint(route, route.t);
      route.t += (ped.speed * dt) / pt.len;
      if (route.t >= 1) {
        const arrived = { i: route.toI, j: route.toJ };
        const options = PM.Vehicles.neighbours(arrived.i, arrived.j);
        const next = options[rng.int(0, options.length - 1)];
        ped.route = { fromI: arrived.i, fromJ: arrived.j, toI: next.i, toJ: next.j, t: 0 };
      }
      const now = this.pedPoint(ped.route, ped.route.t);
      pos.set(now.x, 0, now.z);
      ped.heading = PM.lerpAngle(ped.heading, Math.atan2(now.ux, now.uz), PM.clamp(dt * 6, 0, 1));
      ped.mesh.rotation.y = ped.heading;
      ped.walkPhase += dt * 6.5;
      this.animateWalk(ped.mesh, ped.walkPhase, 0.7);
    }
  },
};

/** The player character, Rio: on-foot movement + walk animation. */
PM.Player = {
  mesh: null,
  heading: 0,
  walkPhase: 0,
  moving: false,

  spawn(scene, x, z) {
    this.mesh = PM.People.buildPerson({ skin: 0xc68863, shirt: 0x12b5a5, pants: 0x2f3542, cap: 0xd23b2e });
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
    this.heading = Math.PI; // face the sea / camera at spawn
    this.mesh.rotation.y = this.heading;
    return this;
  },

  get pos() { return this.mesh.position; },

  /**
   * Move on foot. `wish` is a camera-relative direction {x, z} (already
   * normalised, or zero), `sprint` multiplies speed. Returns the speed.
   */
  update(dt, wish, sprint) {
    const pos = this.mesh.position;
    const speed = sprint ? 7.4 : 4.4;
    this.moving = wish.x !== 0 || wish.z !== 0;
    if (this.moving) {
      const targetHeading = Math.atan2(wish.x, wish.z);
      this.heading = PM.lerpAngle(this.heading, targetHeading, PM.clamp(dt * 12, 0, 1));
      pos.x += wish.x * speed * dt;
      pos.z += wish.z * speed * dt;
      PM.City.collideCircle(pos, 0.5);
      this.walkPhase += dt * (sprint ? 11 : 8);
      PM.People.animateWalk(this.mesh, this.walkPhase, sprint ? 1 : 0.75);
    } else {
      PM.People.animateWalk(this.mesh, 0, 0);
    }
    this.mesh.rotation.y = this.heading;
    return this.moving ? speed : 0;
  },
};
