const MAGIC = 18248;
const VERSION = 1;
const TYPE_SNAPSHOT = 2;
const INPUT_BYTES = 25;
const HEADER_BYTES = 24;
const PLAYER_BYTES = 64;
const MAX_PLAYERS = 10;
const WEAPONS = ["ar", "smg", "shotgun", "pistol"];
const PHASES = ["lobby", "countdown", "live", "over"];
const FLAG_ALIVE = 1;
const FLAG_CROUCH = 2;
const FLAG_GROUND = 4;
const FLAG_CONNECTED = 8;
const FLAG_PROTECTED = 16;
const FLAG_JUMP_HELD = 32;
const FLAG_BOT = 64;
const FLAG_SLIDING = 128;
const phaseIndex = (phase) => {
  const index = PHASES.indexOf(phase);
  return index < 0 ? 0 : index;
};
const weaponIndex = (weapon) => {
  const index = WEAPONS.indexOf(weapon);
  return index < 0 ? 0 : index;
};
function encodeSnapshot(state) {
  const players = state.players.slice(0, MAX_PLAYERS);
  const count = players.length;
  const bytes = new Uint8Array(HEADER_BYTES + PLAYER_BYTES * count);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, MAGIC, true);
  view.setUint8(2, VERSION);
  view.setUint8(3, TYPE_SNAPSHOT);
  view.setUint32(4, state.tick >>> 0, true);
  view.setUint32(8, state.time >>> 0, true);
  view.setUint8(12, phaseIndex(state.phase));
  view.setUint8(13, count);
  view.setUint16(14, (state.scores?.[0] || 0) >>> 0, true);
  view.setUint16(16, (state.scores?.[1] || 0) >>> 0, true);
  view.setUint32(18, state.remaining >>> 0, true);
  view.setInt8(22, Number.isInteger(state.winner) ? state.winner : -1);
  for (let index = 0; index < count; index++) {
    const p = players[index];
    const o = HEADER_BYTES + index * PLAYER_BYTES;
    view.setUint32(o, p.id >>> 0, true);
    view.setUint32(o + 4, p.ack >>> 0, true);
    const motion = [p.x, p.y, p.z, p.vx, p.vy, p.vz, p.yaw, p.pitch];
    for (let j = 0; j < 8; j++)
      view.setFloat32(o + 8 + j * 4, Number(motion[j]) || 0, true);
    const counters = [
      p.hp,
      p.ammo,
      p.reserve,
      p.kills,
      p.deaths,
      p.score,
      p.respawn,
      p.reload
    ];
    for (let j = 0; j < 8; j++)
      view.setUint16(o + 40 + j * 2, (counters[j] || 0) >>> 0, true);
    view.setUint8(o + 56, p.team > 0 ? 1 : 0);
    let flags = 0;
    if (p.alive) flags |= FLAG_ALIVE;
    if (p.crouch) flags |= FLAG_CROUCH;
    if (p.ground) flags |= FLAG_GROUND;
    if (p.connected) flags |= FLAG_CONNECTED;
    if (p.protected) flags |= FLAG_PROTECTED;
    if (p.jumpHeld) flags |= FLAG_JUMP_HELD;
    if (p.bot) flags |= FLAG_BOT;
    if (p.sliding) flags |= FLAG_SLIDING;
    view.setUint8(o + 57, flags);
    view.setUint8(o + 58, weaponIndex(p.weapon));
    view.setUint8(o + 59, Math.min(255, Math.round((p.slideCooldown || 0) * 100)));
    view.setUint16(o + 60, (p.cooldown || 0) >>> 0, true);
    view.setUint16(o + 62, Math.min(65535, Math.round((p.slideTime || 0) * 1e3)));
  }
  return bytes;
}
function decodeInput(bytes) {
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes instanceof Uint8Array ? bytes : null;
  if (!data || data.byteLength < INPUT_BYTES) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(0, true) !== MAGIC) return null;
  if (view.getUint8(2) !== VERSION) return null;
  const input = {
    seq: view.getUint32(4, true),
    forward: view.getFloat32(8, true),
    right: view.getFloat32(12, true),
    yaw: view.getFloat32(16, true),
    pitch: view.getFloat32(20, true),
    buttons: view.getUint8(24)
  };
  if (!Number.isFinite(input.forward) || !Number.isFinite(input.right) || !Number.isFinite(input.yaw) || !Number.isFinite(input.pitch))
    return null;
  return input;
}
function encodeInput(input, bytes = new Uint8Array(INPUT_BYTES)) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint16(0, MAGIC, true);
  view.setUint8(2, VERSION);
  view.setUint8(3, 1);
  view.setUint32(4, input.seq >>> 0, true);
  view.setFloat32(8, input.forward ?? 0, true);
  view.setFloat32(12, input.right ?? 0, true);
  view.setFloat32(16, input.yaw ?? 0, true);
  view.setFloat32(20, input.pitch ?? 0, true);
  view.setUint8(24, input.buttons || 0);
  return bytes;
}
export {
  FLAG_ALIVE,
  FLAG_BOT,
  FLAG_CONNECTED,
  FLAG_CROUCH,
  FLAG_GROUND,
  FLAG_JUMP_HELD,
  FLAG_PROTECTED,
  FLAG_SLIDING,
  HEADER_BYTES,
  INPUT_BYTES,
  MAGIC,
  MAX_PLAYERS,
  PHASES,
  PLAYER_BYTES,
  TYPE_SNAPSHOT,
  VERSION,
  WEAPONS,
  decodeInput,
  encodeInput,
  encodeSnapshot
};
