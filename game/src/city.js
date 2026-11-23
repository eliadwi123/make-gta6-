// city.js — Port Marisol itself: a 7x7 avenue grid on a coast. The south edge
// of town gives onto a boardwalk, a sandy beach, a pier with a lighthouse and
// open water. Everything is placed from the shared seed, and every building
// registers an axis-aligned collider the rest of the game tests against.
window.PM = window.PM || {};

PM.CITY = {
  pitch: 58,          // distance between neighbouring avenues
  half: 3,            // avenues run from -half..+half on both axes
  roadHalf: 8,        // asphalt half-width (16 m roads)
  laneOffset: 3.6,    // traffic lane offset from the road centre line
  pedOffset: 10.6,    // sidewalk offset from the road centre line
  beachZ: 202,        // sand starts here
  waterZ: 238,        // water starts here
  extent: 250,        // playable ground half-size
};

PM.City = {
  group: null,
  colliders: [],      // {minX, maxX, minZ, maxZ, height}
  water: null,
  waterTexture: null,
  lighthouseLight: null,
  beaconMeshes: [],

  /** Avenue centre-line coordinate for grid index i (i in -half..half). */
  avenue(i) { return i * PM.CITY.pitch; },

  /** All intersection points {x, z, i, j}. */
  intersections() {
    const out = [];
    const H = PM.CITY.half;
    for (let i = -H; i <= H; i += 1) {
      for (let j = -H; j <= H; j += 1) out.push({ x: this.avenue(i), z: this.avenue(j), i, j });
    }
    return out;
  },

  /** True when (x, z) is on asphalt (either avenue direction). */
  onRoad(x, z) {
    const P = PM.CITY.pitch;
    const R = PM.CITY.roadHalf + 0.6;
    const fx = Math.abs(((x % P) + P) % P);
    const fz = Math.abs(((z % P) + P) % P);
    const nearX = Math.min(fx, P - fx) < R;
    const nearZ = Math.min(fz, P - fz) < R;
    return (nearX || nearZ) && Math.abs(x) <= PM.CITY.extent && z < PM.CITY.beachZ;
  },

  /** Push a circle (x, z, radius) out of every building collider. */
  collideCircle(pos, radius) {
    for (const c of this.colliders) {
      const nx = PM.clamp(pos.x, c.minX, c.maxX);
      const nz = PM.clamp(pos.z, c.minZ, c.maxZ);
      const dx = pos.x - nx;
      const dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          pos.x = nx + (dx / d) * radius;
          pos.z = nz + (dz / d) * radius;
        } else {
          // Centre inside the box: push out along the smallest penetration.
          const left = pos.x - c.minX;
          const right = c.maxX - pos.x;
          const top = pos.z - c.minZ;
          const bottom = c.maxZ - pos.z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = c.minX - radius;
          else if (m === right) pos.x = c.maxX + radius;
          else if (m === top) pos.z = c.minZ - radius;
          else pos.z = c.maxZ + radius;
        }
      }
    }
    // World bounds: keep everyone on the island; the sea is swimmable-shallow
    // only along the beach strip, so clamp z before deep water — except on
    // the pier, which can be walked/driven to the lighthouse.
    pos.x = PM.clamp(pos.x, -PM.CITY.extent, PM.CITY.extent);
    const onPier = pos.x > 109 && pos.x < 123 && pos.z > PM.CITY.beachZ;
    const zMax = onPier ? PM.CITY.waterZ + 108 : PM.CITY.waterZ + 26;
    pos.z = PM.clamp(pos.z, -PM.CITY.extent, zMax);
  },

  /** Deck height at a point: pier boards and the boardwalk sit above grade. */
  groundHeightAt(x, z) {
    const C = PM.CITY;
    if (x > 110 && x < 122 && z > C.waterZ - 6) return 0.62;
    if (Math.abs(x) < 282 && z > C.beachZ - 3 && z < C.beachZ + 8) return 0.5;
    return 0;
  },

  /** A canvas texture of lit windows, tinted per building at draw time. */
  makeWindowTexture(rng) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#8f97a3';
    ctx.fillRect(0, 0, 128, 256);
    for (let y = 8; y < 240; y += 16) {
      for (let x = 8; x < 116; x += 14) {
        const lit = rng.chance(0.42);
        ctx.fillStyle = lit ? '#ffd98a' : '#3c4656';
        ctx.fillRect(x, y, 9, 10);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },

  /**
   * A canvas texture for asphalt: dark grey with a dashed centre line.
   * `horizontal` draws the dashes along U instead of V, for east-west roads.
   */
  makeRoadTexture(horizontal) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#33373d';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#c8cdd4';
    if (horizontal) ctx.fillRect(4, 30, 24, 4);
    else ctx.fillRect(30, 4, 4, 24);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  },

  /** Build the whole city into `scene`. `rng` is the shared seeded source. */
  build(scene, rng) {
    const C = PM.CITY;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.colliders = [];

    // --- Ground: city concrete, then the beach and the sea. ---
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(C.extent * 2 + 160, C.extent * 2 + 160),
      new THREE.MeshLambertMaterial({ color: 0x9aa0a3 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = 60;
    this.group.add(ground);

    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(900, C.waterZ - C.beachZ + 30),
      new THREE.MeshLambertMaterial({ color: 0xe8d193 })
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0.03, (C.beachZ + C.waterZ) / 2 + 6);
    this.group.add(sand);

    // Water: a striped canvas texture scrolled slowly in game.js.
    const wcanvas = document.createElement('canvas');
    wcanvas.width = 128;
    wcanvas.height = 128;
    const wctx = wcanvas.getContext('2d');
    wctx.fillStyle = '#1668a8';
    wctx.fillRect(0, 0, 128, 128);
    wctx.strokeStyle = 'rgba(255,255,255,0.25)';
    wctx.lineWidth = 3;
    for (let i = 0; i < 5; i += 1) {
      wctx.beginPath();
      wctx.moveTo(0, 12 + i * 26);
      wctx.bezierCurveTo(40, 4 + i * 26, 90, 20 + i * 26, 128, 12 + i * 26);
      wctx.stroke();
    }
    this.waterTexture = new THREE.CanvasTexture(wcanvas);
    this.waterTexture.wrapS = this.waterTexture.wrapT = THREE.RepeatWrapping;
    this.waterTexture.repeat.set(24, 10);
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(1100, 420),
      new THREE.MeshLambertMaterial({ map: this.waterTexture, transparent: true, opacity: 0.94 })
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, 0.12, C.waterZ + 190);
    this.group.add(this.water);

    // --- Roads: one long strip per avenue, both directions. ---
    const roadTexV = this.makeRoadTexture(false);
    const roadTexH = this.makeRoadTexture(true);
    const span = (C.half * 2 + 1) * C.pitch + C.roadHalf * 2;
    for (let i = -C.half; i <= C.half; i += 1) {
      const a = this.avenue(i);
      const texV = roadTexV.clone();
      texV.needsUpdate = true;
      texV.repeat.set(1, span / 16);
      const roadV = new THREE.Mesh(
        new THREE.PlaneGeometry(C.roadHalf * 2, span),
        new THREE.MeshLambertMaterial({ map: texV })
      );
      roadV.rotation.x = -Math.PI / 2;
      roadV.position.set(a, 0.06, 0);
      this.group.add(roadV);

      const texH = roadTexH.clone();
      texH.needsUpdate = true;
      texH.repeat.set(span / 16, 1);
      const roadH = new THREE.Mesh(
        new THREE.PlaneGeometry(span, C.roadHalf * 2),
        new THREE.MeshLambertMaterial({ map: texH })
      );
      roadH.rotation.x = -Math.PI / 2;
      roadH.position.set(0, 0.055, a);
      this.group.add(roadH);
    }
    // Coastal road along the boardwalk.
    const coastTex = roadTexH.clone();
    coastTex.needsUpdate = true;
    coastTex.repeat.set(span / 16, 1);
    const coast = new THREE.Mesh(
      new THREE.PlaneGeometry(span, C.roadHalf * 2),
      new THREE.MeshLambertMaterial({ map: coastTex })
    );
    coast.rotation.x = -Math.PI / 2;
    coast.position.set(0, 0.06, C.beachZ - 14);
    this.group.add(coast);

    // --- Buildings on every block, taller near the centre. ---
    const windowTex = this.makeWindowTexture(rng);
    const palette = [0xf2e3c6, 0xd9e6f2, 0xf2c6c6, 0xcfe8d4, 0xe6d7f2, 0xf7f0dc, 0xc6e2f2];
    const H = C.half;
    for (let bi = -H; bi < H; bi += 1) {
      for (let bj = -H; bj < H; bj += 1) {
        const cx = (this.avenue(bi) + this.avenue(bi + 1)) / 2;
        const cz = (this.avenue(bj) + this.avenue(bj + 1)) / 2;
        // Two special blocks: a park (west-centre) and a car park (east-centre).
        if (bi === -2 && bj === 0) { this.buildPark(cx, cz, rng); continue; }
        if (bi === 1 && bj === 0) { this.buildCarPark(cx, cz); continue; }
        const centreDist = Math.sqrt(cx * cx + cz * cz) / (H * C.pitch);
        const perBlock = rng.int(1, 2);
        for (let k = 0; k < perBlock; k += 1) {
          const w = rng.range(13, 19);
          const d = rng.range(13, 19);
          const h = rng.range(10, 20) + (1 - centreDist) * rng.range(8, 30);
          const ox = perBlock === 1 ? 0 : (k === 0 ? -10.5 : 10.5);
          const oz = perBlock === 1 ? 0 : (k === 0 ? -10.5 : 10.5);
          const x = cx + ox;
          const z = cz + oz;
          const mat = new THREE.MeshLambertMaterial({ map: windowTex, color: rng.pick(palette) });
          const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
          box.position.set(x, h / 2, z);
          this.group.add(box);
          const roof = new THREE.Mesh(
            new THREE.BoxGeometry(w + 0.6, 0.8, d + 0.6),
            new THREE.MeshLambertMaterial({ color: 0x5a5148 })
          );
          roof.position.set(x, h + 0.4, z);
          this.group.add(roof);
          this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: h });
        }
      }
    }

    this.buildBoardwalkAndPier(rng);
    this.buildStreetProps(rng);
  },

  /** A palm-dotted park block. Trees are decorative (no colliders). */
  buildPark(cx, cz, rng) {
    const lawn = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 42),
      new THREE.MeshLambertMaterial({ color: 0x62b95e })
    );
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(cx, 0.05, cz);
    this.group.add(lawn);
    for (let i = 0; i < 9; i += 1) {
      this.addPalm(cx + rng.range(-18, 18), cz + rng.range(-18, 18), rng);
    }
  },

  /** A flat car-park block; game.js fills it with parked cars. */
  buildCarPark(cx, cz) {
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 42),
      new THREE.MeshLambertMaterial({ color: 0x4a4e55 })
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(cx, 0.05, cz);
    this.group.add(slab);
    PM.CITY.carPark = { x: cx, z: cz };
  },

  /** One palm tree: curved trunk segments and a fan of fronds. */
  addPalm(x, z, rng) {
    const palm = new THREE.Group();
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b46 });
    let px = 0;
    let py = 0;
    const lean = rng.range(-0.16, 0.16);
    for (let s = 0; s < 4; s += 1) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.22 - s * 0.03, 0.26 - s * 0.03, 1.6, 6), trunkMat);
      px += lean * 1.6;
      py += 1.5;
      seg.position.set(px, py - 0.8, 0);
      seg.rotation.z = -lean;
      palm.add(seg);
    }
    const frondMat = new THREE.MeshLambertMaterial({ color: 0x2f9e4f, side: THREE.DoubleSide });
    for (let f = 0; f < 6; f += 1) {
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.7), frondMat);
      const ang = (f / 6) * Math.PI * 2;
      frond.position.set(px + Math.cos(ang) * 1.4, py + 0.25, Math.sin(ang) * 1.4);
      frond.rotation.y = -ang;
      frond.rotation.z = -0.5;
      palm.add(frond);
    }
    palm.position.set(x, 0, z);
    this.group.add(palm);
    return palm;
  },

  /** Boardwalk, pier and the lighthouse at the pier's end. */
  buildBoardwalkAndPier(rng) {
    const C = PM.CITY;
    const woodMat = new THREE.MeshLambertMaterial({ color: 0xa97c50 });
    const walk = new THREE.Mesh(new THREE.BoxGeometry(560, 0.5, 10), woodMat);
    walk.position.set(0, 0.25, C.beachZ + 2);
    this.group.add(walk);

    const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, 120), woodMat);
    pier.position.set(116, 0.3, C.waterZ + 46);
    this.group.add(pier);
    for (let i = 0; i < 6; i += 1) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3, 6), woodMat);
      post.position.set(112, -0.8, C.waterZ + 8 + i * 20);
      this.group.add(post);
      const post2 = post.clone();
      post2.position.x = 120;
      this.group.add(post2);
    }

    // Lighthouse: striped tower + a lamp the game pulses at nightfall vibes.
    const lh = new THREE.Group();
    const stripeWhite = new THREE.MeshLambertMaterial({ color: 0xf5f2ea });
    const stripeRed = new THREE.MeshLambertMaterial({ color: 0xd23b2e });
    for (let s = 0; s < 4; s += 1) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6 - s * 0.3, 2.9 - s * 0.3, 3.4, 12),
        s % 2 ? stripeRed : stripeWhite
      );
      seg.position.y = 1.7 + s * 3.4;
      lh.add(seg);
    }
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2, 10), lampMat);
    lamp.position.y = 15.2;
    lh.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.6, 10), stripeRed);
    cap.position.y = 17;
    lh.add(cap);
    this.lighthouseLight = new THREE.PointLight(0xffe9a0, 1.1, 90);
    this.lighthouseLight.position.y = 15.2;
    lh.add(this.lighthouseLight);
    lh.position.set(116, 0, C.waterZ + 104);
    this.group.add(lh);
    PM.CITY.lighthouse = { x: 116, z: C.waterZ + 104 };
    PM.CITY.pierBase = { x: 116, z: C.waterZ - 6 };

    // Beach dressing: umbrellas and towels on the sand.
    const umbColors = [0xff5b4d, 0xffd23e, 0x4dc3ff, 0xff8ad8];
    for (let i = 0; i < 14; i += 1) {
      const x = rng.range(-240, 240);
      if (Math.abs(x - 116) < 12) continue;
      const z = rng.range(C.beachZ + 10, C.waterZ - 4);
      const umb = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5), woodMat);
      pole.position.y = 1.1;
      umb.add(pole);
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.7, 8), new THREE.MeshLambertMaterial({ color: rng.pick(umbColors) }));
      top.position.y = 2.3;
      umb.add(top);
      umb.position.set(x, 0, z);
      this.group.add(umb);
    }
  },

  /** Lampposts along the avenues and palms along the coast road. */
  buildStreetProps(rng) {
    const C = PM.CITY;
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2e3238 });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 });
    const postGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.6, 6);
    const bulbGeo = new THREE.SphereGeometry(0.32, 8, 6);
    for (let i = -C.half; i <= C.half; i += 1) {
      for (let j = -C.half; j <= C.half; j += 1) {
        if ((i + j) % 2 !== 0) continue;
        const x = this.avenue(i) + C.roadHalf + 1.2;
        const z = this.avenue(j) + C.roadHalf + 1.2;
        const post = new THREE.Mesh(postGeo, poleMat);
        post.position.set(x, 2.8, z);
        this.group.add(post);
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(x, 5.7, z);
        this.group.add(bulb);
      }
    }
    for (let x = -230; x <= 230; x += 23) {
      if (Math.abs(x - 116) < 14) continue;
      this.addPalm(x + rng.range(-3, 3), C.beachZ - 4, rng);
    }
  },

  /** The gold mission beacon: a translucent pillar visible across town. */
  makeBeacon() {
    const geo = new THREE.CylinderGeometry(2.4, 2.4, 60, 18, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 30;
    mesh.visible = false;
    this.group.add(mesh);
    this.beaconMeshes.push(mesh);
    return mesh;
  },

  /** Slow water scroll + lighthouse pulse, called once per frame. */
  animate(dt, elapsed) {
    if (this.waterTexture) {
      this.waterTexture.offset.y = (elapsed * 0.014) % 1;
      this.waterTexture.offset.x = Math.sin(elapsed * 0.05) * 0.02;
    }
    if (this.lighthouseLight) {
      this.lighthouseLight.intensity = 0.75 + Math.sin(elapsed * 2.2) * 0.45;
    }
    for (const b of this.beaconMeshes) {
      if (b.visible) b.rotation.y += dt * 0.8;
    }
  },
};
