// missions.js — the Port Marisol story: four linked jobs for Rio & Maya,
// told through gold beacons, on-screen objectives and dialogue boxes.
// A mission is a list of stages; each stage knows its objective text, where
// its beacon stands, and the test that completes it.
window.PM = window.PM || {};

PM.Missions = {
  index: 0,          // which mission is current
  stageIndex: 0,
  state: 'active',   // 'active' | 'dialogue' | 'storyDone'
  timer: null,       // seconds left on timed stages
  dialogue: null,    // {lines, idx, onDone}
  boostCar: null,    // the marked car of mission 3

  /** The four jobs. Stage types: goto | dialogue | steal | park | lose. */
  buildStory() {
    const C = PM.CITY;
    return [
      {
        title: 'First Light',
        reward: 150,
        stages: [
          { type: 'goto', at: { x: 104, z: C.waterZ - 12 }, radius: 7,
            objective: 'Meet Maya at the marina pier' },
          { type: 'dialogue', lines: [
            { who: 'Maya', text: 'Rio! There you are. One weekend, one little harbour town — and the ferry money is ours if we hustle.' },
            { who: 'Rio', text: 'You said "easy money", Maya. Last time you said that, I swam home.' },
            { who: 'Maya', text: 'Details. A warehouse uptown "lost" a package. Bring it to the docks and we eat like kings. Try not to collect police on the way.' },
            { who: 'Rio', text: 'And if I do collect police?' },
            { who: 'Maya', text: 'Then lose them, genius. Out of sight, out of mind — that is literally how it works here.' },
          ] },
        ],
      },
      {
        title: 'Special Delivery',
        reward: 400,
        stages: [
          { type: 'goto', at: { x: -120, z: -145 }, radius: 7,
            objective: 'Pick up the package at the uptown warehouse' },
          { type: 'dialogue', onArrive: () => PM.Wanted.addCrime(1), lines: [
            { who: 'Maya (phone)', text: 'Got it? Good. Bad news: the warehouse camera got your good side. One star. Drive clean, Rio.' },
            { who: 'Rio', text: 'Every camera in this town loves me. Docks, right?' },
            { who: 'Maya (phone)', text: 'Docks. East end of the coast road. And hurry — the buyer hates waiting.' },
          ] },
          { type: 'goto', at: { x: 168, z: C.beachZ - 14 }, radius: 8, timed: 150,
            objective: 'Deliver the package to the docks — fast' },
        ],
      },
      {
        title: 'Grand Tour',
        reward: 650,
        stages: [
          { type: 'goto', at: { x: 122, z: -58 }, radius: 11,
            objective: 'Find the gold coupé parked on the east side' },
          { type: 'steal',
            objective: 'Steal the gold coupé' },
          { type: 'park', at: { x: 87, z: 29 }, radius: 8,
            objective: 'Park the coupé at the hideout car park (centre-east)' },
          { type: 'dialogue', lines: [
            { who: 'Maya', text: 'You actually brought it back in one piece. I owe the harbourmaster a coffee.' },
            { who: 'Rio', text: 'Tell him the coupé identifies as a ferry now. What is the last job?' },
            { who: 'Maya', text: 'Us. On the last ferry. The whole town will try to stop us — reach my lighthouse at the pier end and we are gone.' },
          ] },
        ],
      },
      {
        title: 'One Way Ticket',
        reward: 1000,
        stages: [
          { type: 'goto', at: { x: 116, z: C.waterZ + 88 }, radius: 9, onStart: () => PM.Wanted.setHeat(3),
            objective: 'Run for the lighthouse at the end of the pier!' },
        ],
      },
    ];
  },

  story: null,

  /** Begin (or restart) the story from mission `index`. */
  start(game, index) {
    if (!this.story) this.story = this.buildStory();
    this.index = index || 0;
    this.state = 'active';
    this.enterStage(game, 0);
  },

  currentMission() { return this.story ? this.story[this.index] : null; },
  currentStage() {
    const m = this.currentMission();
    return m ? m.stages[this.stageIndex] : null;
  },

  /** Enter a stage: reset its timer, place the beacon, show the objective. */
  enterStage(game, stageIndex) {
    this.stageIndex = stageIndex;
    const stage = this.currentStage();
    const mission = this.currentMission();
    if (!stage || !mission) return;
    this.timer = stage.timed || null;
    if (stage.onStart) stage.onStart();
    if (stage.type === 'dialogue') {
      if (stage.onArrive) stage.onArrive();
      this.startDialogue(game, stage.lines, () => this.completeStage(game));
      PM.HUD.setObjective(mission.title, 'Listen…');
      game.setBeacon(null);
    } else if (stage.type === 'steal') {
      PM.HUD.setObjective(mission.title, stage.objective);
      game.setBeacon(null);
    } else {
      PM.HUD.setObjective(mission.title, stage.objective);
      game.setBeacon(stage.at);
    }
  },

  /** Pay out and move on: next stage, next mission, or story's end. */
  completeStage(game) {
    const mission = this.currentMission();
    const stage = this.currentStage();
    if (stage && stage.type !== 'dialogue') PM.Audio.missionJingle();
    if (this.stageIndex + 1 < mission.stages.length) {
      this.enterStage(game, this.stageIndex + 1);
      return;
    }
    game.addMoney(mission.reward, mission.title + ' complete');
    if (this.index + 1 < this.story.length) {
      this.index += 1;
      this.enterStage(game, 0);
    } else {
      this.state = 'storyDone';
      PM.HUD.setObjective(null);
      game.setBeacon(null);
      game.winStory();
    }
    game.saveGame();
  },

  /** The dialogue engine: a queue of lines the player steps through. */
  startDialogue(game, lines, onDone) {
    this.dialogue = { lines, idx: 0, onDone };
    this.state = 'dialogue';
    PM.HUD.showDialogue(lines[0].who, lines[0].text);
  },

  advanceDialogue(game) {
    if (!this.dialogue) return;
    PM.Audio.blip(660, 660, 0.05, 'square', 0.06);
    this.dialogue.idx += 1;
    if (this.dialogue.idx >= this.dialogue.lines.length) {
      const done = this.dialogue.onDone;
      this.dialogue = null;
      this.state = 'active';
      PM.HUD.hideDialogue();
      if (done) done();
    } else {
      const line = this.dialogue.lines[this.dialogue.idx];
      PM.HUD.showDialogue(line.who, line.text);
    }
  },

  get dialogueActive() { return this.state === 'dialogue'; },

  /** Per-frame stage tests. `game` exposes the player/world queries. */
  update(dt, game) {
    if (this.state === 'dialogue' || this.state === 'storyDone') return;
    const stage = this.currentStage();
    if (!stage) return;

    if (stage.timed) {
      this.timer -= dt;
      PM.HUD.setObjective(this.currentMission().title, stage.objective + '  (' + Math.max(0, Math.ceil(this.timer)) + 's)');
      if (this.timer <= 0) {
        // Too slow: the buyer walked. Send the player back a stage.
        PM.HUD.toast('Too slow — the deal moved. Back to the warehouse!');
        PM.Audio.failJingle();
        this.enterStage(game, Math.max(0, this.stageIndex - 2));
        return;
      }
    }

    const pos = game.playerPos();
    if (stage.type === 'goto') {
      if (PM.dist2d(pos, stage.at) < stage.radius) {
        if (stage.onArrive) stage.onArrive();
        this.completeStage(game);
      }
    } else if (stage.type === 'steal') {
      if (this.boostCar && game.playerCar === this.boostCar) {
        PM.Wanted.setHeat(Math.max(PM.Wanted.heat, 2));
        PM.HUD.toast('The coupé is yours — now park it at the hideout!');
        this.completeStage(game);
      }
    } else if (stage.type === 'park') {
      if (game.playerCar === this.boostCar && PM.dist2d(pos, stage.at) < stage.radius && Math.abs(game.playerCar.speed) < 0.8) {
        this.completeStage(game);
      }
    }
  },
};
