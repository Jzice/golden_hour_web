import { motion, STEP, clamp, SPRINT } from "../client/simulation.js";
import { encodeSnapshot, WEAPONS } from "./protocol.js";
const TICK_HZ = 60;
const SNAPSHOT_EVERY = 2;
const ROUND_MS = 10 * 60 * 1e3;
const COUNTDOWN_MS = 3e3;
const RESPAWN_MS = 5e3;
const PROTECT_MS = 2e3;
const MAX_HP = 100;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.02;
const BODY_RADIUS = 0.4;
const DEFAULT_WEAPONS = {
  ar: { mag: 30, reserve: 150, interval: 0.092, pellets: 1, damage: 28, reload: 2.2 },
  smg: { mag: 32, reserve: 160, interval: 0.072, pellets: 1, damage: 21, reload: 1.9 },
  shotgun: { mag: 8, reserve: 48, interval: 0.85, pellets: 8, damage: 11, reload: 2.8 },
  pistol: { mag: 12, reserve: 60, interval: 0.24, pellets: 1, damage: 25, reload: 1.5 }
};
const DIFFICULTY = {
  recruit: { aim: 0.45, damage: 0.7 },
  regular: { aim: 0.7, damage: 0.85 },
  hardened: { aim: 0.85, damage: 0.95 },
  veteran: { aim: 1, damage: 1 }
};
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
function rayBox(origin, dir, box) {
  let tmin = 0;
  let tmax = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const d = dir[axis];
    const o = origin[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < box.min[axis] || o > box.max[axis]) return null;
      continue;
    }
    let t1 = (box.min[axis] - o) / d;
    let t2 = (box.max[axis] - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
function rayCylinder(origin, dir, cx, cz, radius, bottom, top) {
  const ox = origin[0] - cx;
  const oz = origin[2] - cz;
  const a = dir[0] * dir[0] + dir[2] * dir[2];
  if (a < 1e-9) return null;
  const b = 2 * (ox * dir[0] + oz * dir[2]);
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
    if (t <= 0.01) continue;
    const y = origin[1] + dir[1] * t;
    if (y < bottom || y > top) continue;
    return t;
  }
  return null;
}
class Sim {
  constructor({
    world,
    weapons,
    capacity = 10,
    scoreLimit = 40,
    code = "",
    hostId = null,
    onEvent = () => {
    },
    onSnapshot = () => {
    },
    onRoster = () => {
    }
  } = {}) {
    this.world = world;
    this.capacity = capacity;
    this.scoreLimit = scoreLimit;
    this.code = code;
    this.hostId = hostId;
    this.onEvent = onEvent;
    this.onSnapshot = onSnapshot;
    this.onRoster = onRoster;
    this.specs = { ...DEFAULT_WEAPONS };
    for (const spec of weapons || []) {
      if (!spec || !spec.id) continue;
      const fallback = DEFAULT_WEAPONS[spec.id] || DEFAULT_WEAPONS.ar;
      this.specs[spec.id] = {
        mag: spec.mag || fallback.mag,
        reserve: spec.reserve || fallback.reserve,
        interval: spec.interval || fallback.interval,
        pellets: spec.pellets || fallback.pellets,
        damage: fallback.damage,
        reload: fallback.reload
      };
    }
    this.players = /* @__PURE__ */ new Map();
    this.nextId = 1;
    this.tickCount = 0;
    this.phase = "lobby";
    this.remaining = 0;
    this.scores = [0, 0];
    this.winner = -1;
    this.difficulty = "regular";
    this.roundStartedAt = 0;
    this.timer = null;
    this.accumulator = 0;
    this.last = 0;
    this.spawns = this.findSpawns();
  }
  // -- 实体 ----------------------------------------------------------------
  spec(weapon) {
    return this.specs[weapon] || this.specs.ar || DEFAULT_WEAPONS.ar;
  }
  /** 分配一个未被占用的实体 id（真人与人机共用同一序号空间）。 */
  allocateId() {
    while (this.players.has(this.nextId)) this.nextId++;
    return this.nextId++;
  }
  /** 客户端上报本机武器参数后覆盖默认值，保证弹药与射速一致。 */
  applySpecs(weapons) {
    for (const spec of weapons || []) {
      if (!spec || !spec.id) continue;
      const fallback = DEFAULT_WEAPONS[spec.id] || DEFAULT_WEAPONS.ar;
      this.specs[spec.id] = {
        mag: spec.mag || fallback.mag,
        reserve: spec.reserve || fallback.reserve,
        interval: spec.interval || fallback.interval,
        pellets: spec.pellets || fallback.pellets,
        damage: fallback.damage,
        reload: fallback.reload
      };
    }
  }
  /** 回给客户端的武器参数（客户端 applySpecs 需要 interval/mag/reserve/pellets）。 */
  specList() {
    return Object.entries(this.specs).map(([id, spec]) => ({
      id,
      mag: spec.mag,
      reserve: spec.reserve,
      interval: spec.interval,
      pellets: spec.pellets
    }));
  }
  /**
   * 依据真实碰撞体推导可站立的出生点。
   * 只把「楼板」（水平尺寸远大于竖直厚度）当作可站立面，排除竖直的承重墙；
   * 并取每个 (x,z) 处**最低**那层楼板（地面层），避免出生在楼顶或被困高层。
   */
  findSpawns() {
    const world = this.world;
    const spots = [];
    if (!world || !world.colliders?.length) return spots;
    const floors = world.colliders.filter((box) => {
      if (box.noMove) return false;
      const dx = box.max[0] - box.min[0];
      const dz = box.max[2] - box.min[2];
      const dy = box.max[1] - box.min[1];
      return dy <= 3 && Math.max(dx, dz) >= 2.5 * dy;
    });
    for (let x = -28; x <= 28; x += 4) {
      for (let z = -22; z <= 22; z += 4) {
        let floor = Infinity;
        for (const box of floors) {
          if (x < box.min[0] || x > box.max[0] || z < box.min[2] || z > box.max[2]) continue;
          if (box.max[1] < floor) floor = box.max[1];
        }
        if (!Number.isFinite(floor)) continue;
        if (world.blockedAt(x, floor, z, 1.8)) continue;
        spots.push([x, floor, z]);
      }
    }
    return spots.length ? spots : [[0, 0, 0]];
  }
  spawnPoint() {
    const spot = pick(this.spawns);
    return { x: spot[0], y: spot[1] + 0.02, z: spot[2] };
  }
  createEntity({ id, name, team = 0, bot = false, spectate = false }) {
    const spot = this.spawnPoint();
    const entity = {
      id,
      name,
      team,
      bot,
      spectate,
      connected: true,
      alive: true,
      hp: MAX_HP,
      ammo: this.spec("ar").mag,
      reserve: this.spec("ar").reserve,
      weapon: "ar",
      kills: 0,
      deaths: 0,
      score: 0,
      cooldown: 0,
      reload: 0,
      respawn: 0,
      protected: 0,
      ready: false,
      ack: 0,
      // 该席位原本属于真人、断线后由人机代打：可用于断线重连认领。
      resumable: false,
      input: null,
      seq: 0,
      difficulty: DIFFICULTY[this.difficulty] || DIFFICULTY.regular,
      motion: motion({ x: spot.x, y: spot.y, z: spot.z, vx: 0, vy: 0, vz: 0, ground: true }),
      lastX: spot.x,
      lastZ: spot.z,
      stuckFor: 0,
      strafe: 0,
      strafeFor: 0,
      reactAt: 0,
      // 目标视线检测的限频缓存：losCheckAt 之前直接复用 targetId 的结果。
      losCheckAt: 0,
      targetId: null
    };
    this.players.set(id, entity);
    return entity;
  }
  /** 真人加入；座位总数恒定，真人顶替人机。 */
  join({ id, name, team, spectate = false }) {
    const existing = this.players.get(id);
    if (existing) {
      existing.connected = true;
      existing.bot = false;
      existing.resumable = false;
      existing.spectate = spectate;
      existing.input = null;
      existing.name = existing.name.replace(/\s*·\s*代打$/, "");
      return existing;
    }
    this.fillBots();
    const entity = this.createEntity({
      id,
      name: name || "\u5E72\u5458",
      team: Number.isInteger(team) ? team : this.pickTeam(),
      bot: false,
      spectate
    });
    this.dropBot();
    this.announce();
    return entity;
  }
  leave(id) {
    const entity = this.players.get(id);
    if (!entity) return;
    if (entity.bot) {
      this.players.delete(id);
    } else {
      entity.connected = false;
      entity.bot = true;
      entity.resumable = true;
      entity.name = entity.name.replace(/\s*·\s*代打$/, "") + " \xB7 \u4EE3\u6253";
      entity.spectate = false;
    }
    this.fillBots();
    this.announce();
  }
  pickTeam() {
    const count = [0, 0];
    for (const player of this.players.values()) count[player.team]++;
    return count[0] <= count[1] ? 0 : 1;
  }
  fillBots() {
    let guard = 0;
    while (this.players.size < this.capacity && guard++ < 32) {
      const team = this.pickTeam();
      const id = this.nextId++;
      const entity = this.createEntity({
        id,
        name: `${team ? "\u4F59\u70EC" : "\u5148\u950B"}-${String(id).padStart(2, "0")}`,
        team,
        bot: true
      });
      entity.difficulty = DIFFICULTY[this.difficulty] || DIFFICULTY.regular;
    }
  }
  dropBot() {
    if (this.players.size <= this.capacity) return;
    for (const player of this.players.values()) {
      if (player.bot) {
        this.players.delete(player.id);
        return;
      }
    }
  }
  announce() {
    this.onRoster(this.roomState());
  }
  roomState() {
    const players = [...this.players.values()].sort((a, b) => a.team - b.team || a.id - b.id).map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      score: p.score,
      bot: p.bot,
      connected: p.connected,
      host: this.hostId === p.id,
      spectate: !!p.spectate
    }));
    const humans = players.filter((p) => !p.bot && p.connected).length;
    return {
      type: "room",
      room: this.code,
      phase: this.phase,
      players,
      scores: [...this.scores],
      scoreLimit: this.scoreLimit,
      winner: this.winner,
      difficulty: this.difficulty,
      capacity: this.capacity,
      humans,
      bots: players.length - humans,
      joinable: this.phase !== "live" && humans < this.capacity
    };
  }
  // -- 输入与指令 ----------------------------------------------------------
  setInput(id, input) {
    const entity = this.players.get(id);
    if (!entity) return;
    const seq = input?.seq >>> 0;
    if (seq <= (entity.input?.seq ?? -1)) return;
    entity.input = input;
    entity.seq = Math.max(entity.seq, seq);
  }
  command(id, message) {
    const entity = this.players.get(id);
    if (!entity) return;
    switch (message.type) {
      case "equip":
        if (WEAPONS.includes(message.weapon)) {
          entity.weapon = message.weapon;
          const spec = this.spec(entity.weapon);
          entity.ammo = Math.min(entity.ammo || spec.mag, spec.mag);
          entity.reserve = spec.reserve;
        }
        break;
      case "reload":
        this.startReload(entity);
        break;
      case "team":
        if (this.phase !== "live" && (message.team === 0 || message.team === 1)) {
          entity.team = message.team;
          this.announce();
        }
        break;
      case "ready":
        entity.ready = !!message.ready;
        if (entity.ready) this.maybeStart();
        break;
      case "shot":
        this.fire(entity, message.yaw, message.pitch);
        break;
      case "melee":
        this.melee(entity, message.yaw, message.pitch);
        break;
      case "ping":
        this.onEvent({ type: "pong", nonce: message.nonce }, id);
        break;
      case "emote":
        this.onEvent({ type: "emote", id, name: entity.name, emoji: message.emoji });
        break;
      default:
        break;
    }
  }
  maybeStart() {
    if (this.phase !== "lobby" && this.phase !== "over") return;
    const humans = [...this.players.values()].filter((p) => !p.bot && p.connected);
    if (!humans.length) return;
    if (!humans.every((p) => p.ready)) return;
    this.phase = "countdown";
    this.remaining = COUNTDOWN_MS;
    this.roundStartedAt = performance.now() + COUNTDOWN_MS;
    this.winner = -1;
    for (const player of this.players.values()) {
      player.ready = false;
      if (!player.alive) this.respawn(player);
    }
    this.onEvent({ type: "round-start" });
    this.announce();
  }
  startReload(entity) {
    const spec = this.spec(entity.weapon);
    if (entity.reload > 0 || entity.ammo >= spec.mag || entity.reserve <= 0) return;
    entity.reload = Math.round(spec.reload * 1e3);
  }
  eye(entity) {
    const height = entity.motion.crouch ? EYE_CROUCH : EYE_STAND;
    return [entity.motion.x, entity.motion.y + height, entity.motion.z];
  }
  direction(yaw, pitch) {
    const cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  }
  /** 射线遮挡距离：没有命中则返回 maxDist。 */
  castDistance(origin, dir, maxDist) {
    let best = maxDist;
    for (const box of this.world?.colliders || []) {
      if (box.noRay || box.pane) continue;
      const t = rayBox(origin, dir, box);
      if (t !== null && t >= 0 && t < best) best = t;
    }
    return best;
  }
  fire(entity, yaw, pitch) {
    if (this.phase !== "live" || !entity.alive) return;
    if (entity.cooldown > 0 || entity.reload > 0) return;
    const spec = this.spec(entity.weapon);
    if (entity.ammo <= 0) {
      this.startReload(entity);
      return;
    }
    entity.ammo--;
    entity.cooldown = Math.round(spec.interval * 1e3);
    const origin = this.eye(entity);
    const base = this.direction(yaw, pitch);
    let hitAny = false;
    for (let pellet = 0; pellet < Math.max(1, spec.pellets); pellet++) {
      const spread = spec.pellets > 1 ? rand(-0.06, 0.06) : 0;
      const dir = this.direction(yaw + spread, clamp(pitch + rand(-0.02, 0.02), -1.4, 1.4));
      const result = this.hitScan(entity, origin, dir, 140);
      if (result) {
        hitAny = true;
        this.applyDamage(entity, result.victim, result.head ? spec.damage * 2 : spec.damage, result.weapon, result.head);
      }
    }
    this.onEvent({
      type: "shot",
      id: entity.id,
      x: origin[0],
      y: origin[1],
      z: origin[2],
      dx: base[0],
      dy: base[1],
      dz: base[2],
      weapon: entity.weapon,
      hit: hitAny
    });
  }
  hitScan(shooter, origin, dir, maxDist) {
    let wall = this.castDistance(origin, dir, maxDist);
    let best = null;
    for (const other of this.players.values()) {
      if (other.id === shooter.id || !other.alive) continue;
      if (other.team === shooter.team) continue;
      const height = other.motion.sliding ? 0.95 : other.motion.crouch ? 1.2 : 1.8;
      const t = rayCylinder(
        origin,
        dir,
        other.motion.x,
        other.motion.z,
        BODY_RADIUS,
        other.motion.y,
        other.motion.y + height
      );
      if (t === null || t > wall || t > maxDist) continue;
      const hitY = origin[1] + dir[1] * t;
      const head = hitY > other.motion.y + height - 0.36;
      best = { victim: other, head, weapon: shooter.weapon, distance: t };
      wall = Math.min(wall, t);
    }
    return best;
  }
  applyDamage(attacker, victim, amount, weapon, head) {
    if (!victim.alive || victim.protected > 0) return;
    const scaled = amount * (attacker.bot ? attacker.difficulty.damage : 1);
    victim.hp = Math.max(0, victim.hp - Math.round(scaled));
    this.onEvent({
      type: "damage",
      id: victim.id,
      hp: victim.hp,
      attacker: attacker.id,
      head: !!head,
      weapon
    });
    if (victim.hp > 0) return;
    victim.alive = false;
    victim.deaths++;
    victim.respawn = RESPAWN_MS;
    attacker.kills++;
    attacker.score++;
    this.scores[attacker.team] = Math.min(65535, this.scores[attacker.team] + 1);
    this.onEvent({
      type: "kill",
      killer: attacker.id,
      victim: victim.id,
      weapon,
      head: !!head
    });
    this.onEvent({ type: "spawn", id: victim.id });
    if (this.scores[attacker.team] >= this.scoreLimit) this.endRound(attacker.team);
    this.announce();
  }
  melee(entity, yaw, pitch) {
    if (this.phase !== "live" || !entity.alive) return;
    const origin = this.eye(entity);
    const dir = this.direction(yaw, pitch);
    let best = null;
    for (const other of this.players.values()) {
      if (other.id === entity.id || !other.alive) continue;
      if (other.team === entity.team) continue;
      const dx = other.motion.x - origin[0];
      const dz = other.motion.z - origin[2];
      const dy = other.motion.y + 1 - origin[1];
      const distance = Math.hypot(dx, dy, dz);
      if (distance > 2.4) continue;
      const dot = (dx * dir[0] + dy * dir[1] + dz * dir[2]) / (distance || 1);
      if (dot < 0.5) continue;
      if (!best || distance < best.distance) best = { victim: other, distance };
    }
    this.onEvent({
      type: "shot",
      id: entity.id,
      x: origin[0],
      y: origin[1],
      z: origin[2],
      dx: dir[0],
      dy: dir[1],
      dz: dir[2],
      weapon: "melee"
    });
    if (best) this.applyDamage(entity, best.victim, 34, "melee", false);
  }
  endRound(team) {
    this.phase = "over";
    this.winner = team;
    this.remaining = 0;
    this.onEvent({ type: "round-end", winner: team });
    this.announce();
  }
  respawn(entity) {
    const spot = this.spawnPoint();
    entity.motion = motion({ x: spot.x, y: spot.y, z: spot.z, vx: 0, vy: 0, vz: 0, ground: true });
    entity.alive = true;
    entity.hp = MAX_HP;
    entity.respawn = 0;
    entity.protected = PROTECT_MS;
    const spec = this.spec(entity.weapon);
    entity.ammo = spec.mag;
    entity.reserve = spec.reserve;
  }
  // -- 主循环 --------------------------------------------------------------
  // 浏览器下用 requestAnimationFrame 驱动，而非 setInterval：让模拟步进与帧时钟
  // 对齐，避免主线程被 3D 渲染占用时 setInterval 被延迟/合并导致 tick 节奏不稳、
  // 快照成簇到达（联机卡顿根因）。非浏览器环境（Node 自测）回退到 setInterval。
  start() {
    if (this.timer) return;
    this.last = performance.now();
    this.accumulator = 0;
    const useRAF = typeof window !== "undefined" && typeof requestAnimationFrame === "function";
    if (useRAF) {
      const loop = () => {
        this.pump();
        this.timer = requestAnimationFrame(loop);
      };
      this.timer = requestAnimationFrame(loop);
    } else {
      this.timer = setInterval(() => this.pump(), 1e3 / TICK_HZ);
    }
  }
  stop() {
    if (this.timer == null) return;
    if (typeof window !== "undefined" && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.timer);
    } else {
      clearInterval(this.timer);
    }
    this.timer = null;
  }
  pump() {
    this.snapshotEmittedThisPump = false;
    this._inPump = true;
    const now = performance.now();
    const elapsed = Math.min(0.25, (now - this.last) / 1e3);
    this.last = now;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= STEP && steps++ < 8) {
      this.accumulator -= STEP;
      this.tick();
    }
    this._inPump = false;
  }
  tick() {
    this.tickCount++;
    if (this.phase === "countdown") {
      this.remaining = Math.max(0, this.roundStartedAt - performance.now());
      if (this.remaining <= 0) {
        this.phase = "live";
        this.remaining = ROUND_MS;
        this.roundStartedAt = performance.now();
        this.announce();
      }
    } else if (this.phase === "live") {
      this.remaining = Math.max(0, ROUND_MS - (performance.now() - this.roundStartedAt));
    }
    for (const entity of this.players.values()) {
      if (entity.cooldown > 0) entity.cooldown = Math.max(0, entity.cooldown - STEP * 1e3);
      if (entity.protected > 0) entity.protected = Math.max(0, entity.protected - STEP * 1e3);
      if (entity.reload > 0) {
        entity.reload = Math.max(0, entity.reload - STEP * 1e3);
        if (entity.reload === 0) {
          const spec = this.spec(entity.weapon);
          const need = spec.mag - entity.ammo;
          const take = Math.min(need, entity.reserve);
          entity.ammo += take;
          entity.reserve -= take;
        }
      }
      if (!entity.alive) {
        entity.respawn = Math.max(0, entity.respawn - STEP * 1e3);
        if (entity.respawn === 0) this.respawn(entity);
        continue;
      }
      const input = entity.bot || entity.spectate ? this.botInput(entity) : entity.input;
      if (!input) continue;
      if (this.phase === "live") {
        entity.motion.yaw = input.yaw;
        entity.motion.pitch = input.pitch;
        this.world.move(entity.motion, input);
      }
      entity.ack = Math.max(entity.ack, input.seq >>> 0);
    }
    if (!this._inPump) this.snapshotEmittedThisPump = false;
    if (this.tickCount % SNAPSHOT_EVERY === 0 && !this.snapshotEmittedThisPump) {
      this.snapshotEmittedThisPump = true;
      this.emitSnapshot();
    }
  }
  /** 人机 / 观战托管的简化 AI。 */
  botInput(entity) {
    entity.seq = entity.seq + 1 >>> 0;
    const seq = entity.seq;
    const now = performance.now();
    const target = this.nearestEnemy(entity);
    let forward = 0;
    let right = 0;
    let buttons = 0;
    let yaw = entity.motion.yaw;
    let pitch = entity.motion.pitch;
    if (target) {
      const dx = target.motion.x - entity.motion.x;
      const dz = target.motion.z - entity.motion.z;
      const distance = Math.hypot(dx, dz);
      const desiredYaw = Math.atan2(-dx, -dz);
      const delta = (desiredYaw - yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      yaw += clamp(delta, -0.18, 0.18);
      const desiredPitch = clamp(
        Math.atan2(target.motion.y + 1.2 - (entity.motion.y + EYE_STAND), distance),
        -0.6,
        0.6
      );
      pitch += clamp(desiredPitch - pitch, -0.15, 0.15);
      const accuracy = entity.difficulty.aim;
      if (distance > 6 && distance < 40) {
        forward = 0.85;
        if (distance > 18) buttons |= SPRINT;
      } else if (distance < 4) {
        forward = -0.4;
      }
      if (now > entity.reactAt && distance < 45) {
        entity.reactAt = now + Math.max(120, 520 * (1.2 - accuracy));
        const spread = (1 - accuracy) * 0.16;
        const origin = this.eye(entity);
        const dir = this.direction(yaw + rand(-spread, spread), pitch + rand(-spread, spread));
        const wall = this.castDistance(origin, dir, 140);
        const hit = this.hitScan(entity, origin, dir, 140);
        const spec = this.spec(entity.weapon);
        if (entity.ammo <= 0) {
          this.startReload(entity);
        } else if (hit && hit.distance <= wall) {
          this.applyDamage(
            entity,
            hit.victim,
            spec.damage * (hit.head ? 2 : 1),
            hit.weapon,
            hit.head
          );
          entity.ammo = Math.max(0, entity.ammo - 1);
          entity.cooldown = Math.round(spec.interval * 1e3);
          this.onEvent({
            type: "shot",
            id: entity.id,
            x: origin[0],
            y: origin[1],
            z: origin[2],
            dx: dir[0],
            dy: dir[1],
            dz: dir[2],
            weapon: entity.weapon
          });
        }
      }
    } else {
      forward = 0.5;
      yaw += 0.02;
    }
    const moved = Math.hypot(entity.motion.x - entity.lastX, entity.motion.z - entity.lastZ);
    entity.lastX = entity.motion.x;
    entity.lastZ = entity.motion.z;
    if (moved < 4e-3) entity.stuckFor += STEP;
    else entity.stuckFor = 0;
    if (entity.stuckFor > 0.6) {
      entity.strafeFor += STEP;
      entity.strafe = entity.strafeFor > 1.2 ? -entity.strafe : entity.strafe || (Math.random() < 0.5 ? 1 : -1);
      right = entity.strafe;
      if (entity.strafeFor > 2.4) {
        entity.strafeFor = 0;
        entity.stuckFor = 0;
      }
    }
    return { seq, forward, right, yaw, pitch, buttons };
  }
  /** 视线检测：从观察者眼睛到目标「胸口」或「眼睛」的射线不被墙挡住即视为可见。 */
  canSee(entity, target) {
    const origin = this.eye(entity);
    const points = [
      [target.motion.x, target.motion.y + 0.9, target.motion.z],
      [target.motion.x, target.motion.y + 1.55, target.motion.z]
    ];
    for (const point of points) {
      const dx = point[0] - origin[0];
      const dy = point[1] - origin[1];
      const dz = point[2] - origin[2];
      const distance = Math.hypot(dx, dy, dz);
      if (distance < 0.01) return true;
      const dir = [dx / distance, dy / distance, dz / distance];
      if (this.castDistance(origin, dir, distance) >= distance - 0.01) return true;
    }
    return false;
  }
  nearestEnemy(entity, now = performance.now()) {
    const cached = entity.targetId != null ? this.players.get(entity.targetId) : null;
    const valid = !!cached && cached.alive && cached.team !== entity.team;
    if (now < entity.losCheckAt) return valid ? cached : null;
    const candidates = [];
    for (const other of this.players.values()) {
      if (other.id === entity.id || !other.alive) continue;
      if (other.team === entity.team) continue;
      const distance = Math.hypot(
        other.motion.x - entity.motion.x,
        other.motion.z - entity.motion.z
      );
      candidates.push({ other, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    for (const { other } of candidates) {
      if (this.canSee(entity, other)) {
        entity.targetId = other.id;
        entity.losCheckAt = now + 200;
        return other;
      }
    }
    entity.targetId = null;
    entity.losCheckAt = now + 200;
    return null;
  }
  emitSnapshot() {
    const players = [...this.players.values()].map((entity) => ({
      id: entity.id,
      ack: entity.ack,
      x: entity.motion.x,
      y: entity.motion.y,
      z: entity.motion.z,
      vx: entity.motion.vx,
      vy: entity.motion.vy,
      vz: entity.motion.vz,
      yaw: entity.motion.yaw,
      pitch: entity.motion.pitch,
      hp: entity.hp,
      ammo: entity.ammo,
      reserve: entity.reserve,
      kills: entity.kills,
      deaths: entity.deaths,
      score: entity.score,
      respawn: entity.respawn,
      reload: entity.reload,
      team: entity.team,
      alive: entity.alive,
      crouch: entity.motion.crouch,
      ground: entity.motion.ground,
      connected: entity.connected,
      protected: entity.protected > 0,
      jumpHeld: !!entity.motion.jumpHeld,
      bot: entity.bot,
      sliding: entity.motion.sliding,
      weapon: entity.weapon,
      slideCooldown: entity.motion.slideCooldown,
      cooldown: entity.cooldown,
      slideTime: entity.motion.slideTime
    }));
    const bytes = encodeSnapshot({
      tick: this.tickCount,
      time: Math.max(0, Math.round(performance.now() - (this.roundStartedAt || performance.now()))),
      phase: this.phase,
      scores: this.scores,
      remaining: Math.round(this.remaining),
      winner: this.winner,
      players
    });
    this.onSnapshot(bytes);
  }
}
export {
  SNAPSHOT_EVERY,
  Sim,
  TICK_HZ
};
