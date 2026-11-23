// vehicles.js — every car in Port Marisol: the mesh factory, the traffic
// fleet that drives the avenue graph on the correct side of the road, parked
// cars waiting to be stolen, and the arcade driving model the player uses.
window.PM = window.PM || {};

PM.Vehicles = {
  all: [],        // every car entity, any kind
  traffic: [],    // AI-driven cars
  parked: [],     // stationary, stealable cars

  CAR_COLORS: [0xd64541, 0x3e7cb1, 0xf2a541, 0x6ab04c, 0xe8e8e8, 0x35383f, 0x8e44ad, 0x16a3a3, 0xff7f50, 0x95a5a6],

  /**
   * Build a low-poly car mesh facing +Z. Kinds: 'sedan', 'hatch', 'van',
   * 'police'. Wheels and (for police) the light bar are kept in userData so
   * the animators can spin / flash them.
   */
  buildCarMesh(color, kind) {
    const group = new THREE.Group();
    const paint = new THREE.MeshLambertMaterial({ color });
    const glass = new THREE.MeshLambertMaterial({ color: 0x18242f });
    const tyre = new THREE.MeshLambertMaterial({ color: 0x14161a });

    const length = kind === 'hatch' ? 3.6 : kind === 'van' ? 4.6 : 4.2;
    const bodyH = kind === 'van' ? 1.15 : 0.62;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, bodyH, length), paint);
    body.position.y = 0.38 + bodyH / 2;
    group.add(body);

    if (kind !== 'van') {
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.52, length * 0.45), glass);
      cabin.position.set(0, 0.38 + bodyH + 0.26, -0.15);
      group.add(cabin);
    } else {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 0.9), glass);
      cab.position.set(0, 0.95, length / 2 - 0.55);
      group.add(cab);
    }

    const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.28, 10);
    const wheels = [];
    const frontWheels = [];
    const wx = 0.86;
    const wz = length / 2 - 0.85;
    for (const [x, z, front] of [[-wx, wz, 1], [wx, wz, 1], [-wx, -wz, 0], [wx, -wz, 0]]) {
      const wheel = new THREE.Mesh(wheelGeo, tyre);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.37, z);
      group.add(wheel);
      wheels.push(wheel);
      if (front) frontWheels.push(wheel);
    }

    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff6c4 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    for (const sx of [-0.6, 0.6]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), lightMat);
      head.position.set(sx, 0.72, length / 2 + 0.01);
      group.add(head);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), tailMat);
      tail.position.set(sx, 0.76, -length / 2 - 0.01);
      group.add(tail);
    }

    group.userData.wheels = wheels;
    group.userData.frontWheels = frontWheels;
    group.userData.paint = paint;
    if (kind === 'police') {
      const bar = new THREE.Group();
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.55), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      red.position.x = -0.36;
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.55), new THREE.MeshBasicMaterial({ color: 0x2266ff }));
      blue.position.x = 0.36;
      bar.add(red);
      bar.add(blue);
      bar.position.set(0, 0.38 + bodyH + 0.62, -0.15);
      group.add(bar);
      group.userData.lightBar = bar;
      group.userData.lightRed = red;
      group.userData.lightBlue = blue;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.22, length * 0.7), new THREE.MeshLambertMaterial({ color: 0x14418c }));
      stripe.position.y = 0.62;
      group.add(stripe);
    }
    return group;
  },

  /** Create a car entity and add its mesh to the scene. */
  spawnCar(scene, rng, kind, color, carKind) {
    const mesh = this.buildCarMesh(color, carKind || 'sedan');
    scene.add(mesh);
    const car = {
      mesh,
      kind,                       // 'traffic' | 'parked' | 'police' | 'player'
      carKind: carKind || 'sedan',
      color,
      heading: 0,
      speed: 0,
      maxSpeed: 30 + rng.range(-3, 5),
      route: null,                // {fromI, fromJ, toI, toJ, t}
      cruise: 10 + rng.range(0, 3.5),
      wheelSpin: 0,
      damage: 0,
      id: this.all.length + 1,
    };
    mesh.userData.car = car;
    this.all.push(car);
    return car;
  },

  /** A random intersection node {i, j}. */
  randomNode(rng) {
    const H = PM.CITY.half;
    return { i: rng.int(-H, H), j: rng.int(-H, H) };
  },

  /** Neighbour nodes of (i, j) on the avenue graph. */
  neighbours(i, j) {
    const H = PM.CITY.half;
    const out = [];
    if (i > -H) out.push({ i: i - 1, j });
    if (i < H) out.push({ i: i + 1, j });
    if (j > -H) out.push({ i, j: j - 1 });
    if (j < H) out.push({ i, j: j + 1 });
    return out;
  },

  /** World position along a route segment, with the right-hand lane offset. */
  routePoint(route, t) {
    const ax = PM.City.avenue(route.fromI);
    const az = PM.City.avenue(route.fromJ);
    const bx = PM.City.avenue(route.toI);
    const bz = PM.City.avenue(route.toJ);
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    // Right-hand side of the direction of travel.
    const rx = -uz;
    const rz = ux;
    const off = PM.CITY.laneOffset;
    return { x: ax + dx * t + rx * off, z: az + dz * t + rz * off, ux, uz, len };
  },

  /** Give a traffic car a fresh route starting at node (i, j). */
  startRoute(car, rng, i, j) {
    const options = this.neighbours(i, j);
    const next = options[rng.int(0, options.length - 1)];
    car.route = { fromI: i, fromJ: j, toI: next.i, toJ: next.j, t: 0 };
  },

  /** Fill the streets: traffic on the graph, parked cars at the kerbs. */
  populate(scene, rng, trafficCount) {
    for (let n = 0; n < trafficCount; n += 1) {
      const node = this.randomNode(rng);
      const car = this.spawnCar(scene, rng, 'traffic', rng.pick(this.CAR_COLORS), rng.pick(['sedan', 'sedan', 'hatch', 'van']));
      this.startRoute(car, rng, node.i, node.j);
      car.route.t = rng.next();
      this.traffic.push(car);
    }
    // Kerbside parking: along a few avenues, nose-to-tail with the flow.
    for (let n = 0; n < 16; n += 1) {
      const vertical = rng.chance(0.5);
      const a = PM.City.avenue(rng.int(-PM.CITY.half, PM.CITY.half));
      const along = rng.range(-190, 190);
      const side = rng.chance(0.5) ? 1 : -1;
      const car = this.spawnCar(scene, rng, 'parked', rng.pick(this.CAR_COLORS), rng.pick(['sedan', 'hatch', 'van']));
      if (vertical) {
        car.mesh.position.set(a + side * (PM.CITY.roadHalf - 1.6), 0, along);
        car.heading = side > 0 ? Math.PI : 0;
      } else {
        car.mesh.position.set(along, 0, a + side * (PM.CITY.roadHalf - 1.6));
        car.heading = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      }
      car.mesh.rotation.y = car.heading;
      this.parked.push(car);
    }
    // The car-park block gets two neat rows.
    if (PM.CITY.carPark) {
      const { x, z } = PM.CITY.carPark;
      for (let r = 0; r < 2; r += 1) {
        for (let s = 0; s < 5; s += 1) {
          if (rng.chance(0.25)) continue;
          const car = this.spawnCar(scene, rng, 'parked', rng.pick(this.CAR_COLORS), rng.pick(['sedan', 'hatch']));
          car.mesh.position.set(x - 16 + s * 8, 0, z - 10 + r * 20);
          car.heading = Math.PI / 2;
          car.mesh.rotation.y = car.heading;
          this.parked.push(car);
        }
      }
    }
  },

  /** Is something (the player, a car) blocking this traffic car's nose? */
  trafficBlockedAhead(car, playerPos, playerCarPos) {
    const p = car.mesh.position;
    const fx = p.x + Math.sin(car.heading) * 6;
    const fz = p.z + Math.cos(car.heading) * 6;
    const targets = [];
    if (playerPos) targets.push(playerPos);
    if (playerCarPos) targets.push(playerCarPos);
    for (const other of this.traffic) {
      if (other !== car) targets.push(other.mesh.position);
    }
    for (const t of targets) {
      const dx = t.x - fx;
      const dz = t.z - fz;
      if (dx * dx + dz * dz < 9) return true;
    }
    return false;
  },

  /** Advance all traffic one step. */
  updateTraffic(dt, rng, playerPos, playerCarPos) {
    for (const car of this.traffic) {
      if (car.kind !== 'traffic') continue; // stolen by the player meanwhile
      const blocked = this.trafficBlockedAhead(car, playerPos, playerCarPos);
      const target = blocked ? 0 : car.cruise;
      car.speed = PM.lerp(car.speed, target, PM.clamp(dt * 3, 0, 1));
      if (car.speed < 0.05 && blocked) car.speed = 0;
      const route = car.route;
      const pt = this.routePoint(route, route.t);
      route.t += (car.speed * dt) / pt.len;
      if (route.t >= 1) {
        const arrived = { i: route.toI, j: route.toJ };
        const cameFrom = { i: route.fromI, j: route.fromJ };
        let options = this.neighbours(arrived.i, arrived.j).filter((n) => !(n.i === cameFrom.i && n.j === cameFrom.j));
        if (options.length === 0) options = this.neighbours(arrived.i, arrived.j);
        const next = options[rng.int(0, options.length - 1)];
        car.route = { fromI: arrived.i, fromJ: arrived.j, toI: next.i, toJ: next.j, t: 0 };
      }
      const now = this.routePoint(car.route, car.route.t);
      car.mesh.position.set(now.x, 0, now.z);
      const targetHeading = Math.atan2(now.ux, now.uz);
      car.heading = PM.lerpAngle(car.heading, targetHeading, PM.clamp(dt * 5, 0, 1));
      car.mesh.rotation.y = car.heading;
      this.spinWheels(car, dt);
    }
  },

  /** Rotate wheel meshes by travel, and yaw the front pair by `steer`. */
  spinWheels(car, dt, steer) {
    car.wheelSpin += (car.speed * dt) / 0.37;
    const wheels = car.mesh.userData.wheels || [];
    for (const w of wheels) w.rotation.x = car.wheelSpin;
    const fronts = car.mesh.userData.frontWheels || [];
    for (const w of fronts) w.rotation.y = (steer || 0) * 0.45;
  },

  /**
   * The player's arcade driving model. `input` is {throttle -1..1, steer -1..1,
   * handbrake bool}. Returns the impact speed if the car slammed something.
   */
  drivePlayerCar(car, input, dt) {
    const accel = 15;
    const brake = 26;
    const maxReverse = 9;
    if (input.throttle > 0) {
      car.speed += accel * input.throttle * dt * (car.speed < 0 ? 2.2 : 1);
    } else if (input.throttle < 0) {
      car.speed += (car.speed > 0.5 ? -brake : -accel * 0.7) * -input.throttle * dt;
    }
    // Rolling drag and a soft top speed.
    car.speed -= car.speed * (input.handbrake ? 1.6 : 0.25) * dt;
    car.speed = PM.clamp(car.speed, -maxReverse, car.maxSpeed);
    if (Math.abs(car.speed) < 0.04 && input.throttle === 0) car.speed = 0;

    const steerAuthority = PM.clamp(Math.abs(car.speed) / 6, 0, 1) * (car.speed < 0 ? -1 : 1);
    car.heading += input.steer * 1.55 * steerAuthority * dt * PM.clamp(Math.abs(car.speed) / car.maxSpeed + 0.35, 0, 1);

    const pos = car.mesh.position;
    const beforeX = pos.x;
    const beforeZ = pos.z;
    pos.x += Math.sin(car.heading) * car.speed * dt;
    pos.z += Math.cos(car.heading) * car.speed * dt;
    PM.City.collideCircle(pos, 2.3);
    // Collide with other cars as circles: shove out and bleed speed.
    let impact = 0;
    for (const other of this.all) {
      if (other === car || other.kind === 'player') continue;
      const op = other.mesh.position;
      const dx = pos.x - op.x;
      const dz = pos.z - op.z;
      const d2 = dx * dx + dz * dz;
      const minD = 3.4;
      if (d2 < minD * minD && d2 > 0.001) {
        const d = Math.sqrt(d2);
        pos.x = op.x + (dx / d) * minD;
        pos.z = op.z + (dz / d) * minD;
        impact = Math.max(impact, Math.abs(car.speed));
        car.speed *= 0.35;
        if (other.kind === 'parked') {
          op.x -= (dx / d) * 0.4;
          op.z -= (dz / d) * 0.4;
        }
      }
    }
    const correction = Math.sqrt((pos.x - beforeX) ** 2 + (pos.z - beforeZ) ** 2);
    const travelled = Math.abs(car.speed * dt);
    if (correction > travelled + 0.55 && Math.abs(car.speed) > 7) {
      impact = Math.max(impact, Math.abs(car.speed));
      car.speed *= 0.3;
    }
    car.mesh.rotation.y = car.heading;
    this.spinWheels(car, dt, input.steer);
    return impact;
  },

  /** Simple seek steering shared by police: accelerate toward a target. */
  pursue(car, targetPos, dt, topSpeed, aggression) {
    const pos = car.mesh.position;
    const dx = targetPos.x - pos.x;
    const dz = targetPos.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const desired = Math.atan2(dx, dz);
    car.heading = PM.lerpAngle(car.heading, desired, PM.clamp(dt * (aggression || 2.4), 0, 1));
    const align = Math.cos(PM.lerpAngle(0, desired - car.heading, 1));
    const want = topSpeed * PM.clamp(align + 0.35, 0.15, 1);
    car.speed = PM.lerp(car.speed, want, PM.clamp(dt * 1.6, 0, 1));
    pos.x += Math.sin(car.heading) * car.speed * dt;
    pos.z += Math.cos(car.heading) * car.speed * dt;
    PM.City.collideCircle(pos, 2.3);
    car.mesh.rotation.y = car.heading;
    this.spinWheels(car, dt);
    return dist;
  },

  /** Nearest car (any stealable kind) within `range` of a position. */
  nearestStealable(pos, range) {
    let best = null;
    let bestD = range;
    for (const car of this.all) {
      if (car.kind !== 'parked' && car.kind !== 'traffic') continue;
      const d = PM.dist2d(pos, car.mesh.position);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  },
};
