const GROWTH_PREFIX = "gh_growth_v1_";
const LEGACY_KEY = "gh_growth_legacy_v1";
const LOADOUT_KEY = "gh_loadout_v1";
const LEGACY_PREFIX = "gh_legacy_v1_";
const LOADOUT_PREFIX = "gh_loadout_v1_";
const WEAPON_IDS = ["ar", "smg", "shotgun", "pistol"];
const COUNTERS = ["xp", "matches", "wins", "kills"];
const PARTS = ["optic", "muzzle", "underbarrel", "magazine", "stock", "camo"];
const clone = (value) => JSON.parse(JSON.stringify(value));
const number = (value) => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error("invalid progress counter");
  return value;
};
function emptyProfile() {
  return { xp: 0, matches: 0, wins: 0, kills: 0, weapons: Object.fromEntries(WEAPON_IDS.map((id) => [id, { kills: 0, headshots: 0 }])) };
}
function profile(value) {
  if (!value || typeof value !== "object" || !value.weapons) throw Error("invalid progress");
  const out = emptyProfile();
  for (const field of COUNTERS) out[field] = number(value[field]);
  for (const id of WEAPON_IDS) {
    const weapon = value.weapons[id];
    out.weapons[id] = { kills: number(weapon?.kills), headshots: number(weapon?.headshots) };
    if (weapon.headshots > weapon.kills) throw Error("invalid headshots");
  }
  if (out.wins > out.matches || WEAPON_IDS.reduce((n, id) => n + out.weapons[id].kills, 0) > out.kills) throw Error("inconsistent progress");
  return out;
}
function combine(a, b, operation) {
  const out = emptyProfile();
  for (const field of COUNTERS) out[field] = operation(a[field], b[field]);
  for (const id of WEAPON_IDS) for (const field of ["kills", "headshots"]) out.weapons[id][field] = operation(a.weapons[id][field], b.weapons[id][field]);
  return profile(out);
}
const addProfile = (a, b) => combine(a, b, (x, y) => number(x + y));
const maxProfile = (a, b) => {
  const totalKills = WEAPON_IDS.reduce((n, id) => n + Math.max(a.weapons[id].kills, b.weapons[id].kills), 0);
  return combine({ ...a, kills: Math.max(a.kills, totalKills) }, b, Math.max);
};
const profileDelta = (after, before) => combine(after, before, (x, y) => Math.max(0, x - y));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function loadout(value) {
  if (!value || !["ar", "smg", "shotgun"].includes(value.primary) || !value.builds || typeof value.builds !== "object") throw Error("invalid loadout");
  const builds = {};
  for (const id of WEAPON_IDS) {
    const build = {};
    for (const part of PARTS) {
      const choice = value.builds[id]?.[part];
      if (choice !== void 0) {
        if (typeof choice !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(choice)) throw Error("invalid attachment");
        build[part] = choice;
      }
    }
    builds[id] = build;
  }
  return { primary: value.primary, builds };
}
function pack(value) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > 1024) throw Error("progress exceeds Toy value limit");
  return text;
}
function readProfile(raw) {
  const data = JSON.parse(raw);
  if (data.v !== 1) throw Error("unsupported progress schema");
  return profile(data.p);
}
function readLoadout(raw) {
  if (raw === void 0) return null;
  const data = JSON.parse(raw);
  if (data.v !== 1 || !Number.isSafeInteger(data.at) || data.at < 0 || typeof data.device !== "string") throw Error("invalid loadout revision");
  return { v: 1, at: data.at, device: data.device, value: loadout(data.value) };
}
function newest(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.at > b.at || a.at === b.at && a.device >= b.device ? a : b;
}
class ProgressLedger {
  constructor(storage) {
    this.storage = storage;
    this.reset();
  }
  reset() {
    this.ready = false;
    this.key = this.localKey = null;
    this.own = emptyProfile();
    this.legacyOwn = emptyProfile();
    this.legacyCloud = emptyProfile();
    this.components = /* @__PURE__ */ new Map();
    this.loadouts = /* @__PURE__ */ new Map();
    this.preferencesOwn = null;
    this.data = {};
    this.warning = "";
  }
  open({ identity, component, data }) {
    this.reset();
    this.component = component;
    this.key = GROWTH_PREFIX + component;
    this.legacyKey = LEGACY_PREFIX + component;
    this.loadoutKey = LOADOUT_PREFIX + component;
    this.localKey = identity ? `gh_growth_pending_v1_${encodeURIComponent(identity)}_${component}` : null;
    this.mergeCloud(data);
    this.mergeLocal();
    this.ready = true;
    this.persist();
  }
  mergeLocal() {
    let raw;
    try {
      raw = this.localKey && this.storage?.getItem(this.localKey);
    } catch {
      this.warning = "\u672C\u5730\u5F85\u540C\u6B65\u5B58\u6863\u8BFB\u53D6\u5931\u8D25\u3002";
    }
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.v !== 1) throw Error("unsupported pending progress");
    this.own = maxProfile(this.own, profile(saved.own));
    this.legacyOwn = maxProfile(this.legacyOwn, profile(saved.legacy));
    this.preferencesOwn = newest(this.preferencesOwn, saved.preferences ? readLoadout(JSON.stringify(saved.preferences)) : null);
  }
  mergeCloud(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("invalid cloud progress");
    const components = /* @__PURE__ */ new Map(), loadouts = /* @__PURE__ */ new Map();
    let legacy = data[LEGACY_KEY] === void 0 ? emptyProfile() : readProfile(data[LEGACY_KEY]);
    for (const [key, raw] of Object.entries(data)) {
      if (key.startsWith(GROWTH_PREFIX)) components.set(key, readProfile(raw));
      if (key.startsWith(LEGACY_PREFIX)) legacy = maxProfile(legacy, readProfile(raw));
      if (key.startsWith(LOADOUT_PREFIX)) loadouts.set(key, readLoadout(raw));
    }
    if (data[LOADOUT_KEY]) loadouts.set(LOADOUT_KEY, readLoadout(data[LOADOUT_KEY]));
    const own = maxProfile(this.own, components.get(this.key) ?? emptyProfile());
    const legacyOwn = maxProfile(this.legacyOwn, data[this.legacyKey] === void 0 ? emptyProfile() : readProfile(data[this.legacyKey]));
    let total = addProfile(maxProfile(legacy, legacyOwn), own);
    for (const [key, value] of components) if (key !== this.key) total = addProfile(total, value);
    this.components = components;
    this.loadouts = loadouts;
    this.own = own;
    this.legacyCloud = legacy;
    this.legacyOwn = legacyOwn;
    this.preferencesOwn = newest(this.preferencesOwn, loadouts.get(this.loadoutKey));
    this.data = data;
  }
  get legacy() {
    return maxProfile(this.legacyCloud, this.legacyOwn);
  }
  get preferences() {
    let selected = this.preferencesOwn;
    for (const value of this.loadouts.values()) selected = newest(selected, value);
    return selected;
  }
  total(own = this.own, legacyOwn = this.legacyOwn) {
    let out = addProfile(maxProfile(this.legacyCloud, legacyOwn), own);
    for (const [key, value] of this.components) if (key !== this.key) out = addProfile(out, value);
    return out;
  }
  record(delta) {
    if (!this.ready) return false;
    this.mergeLocal();
    const next = addProfile(this.own, profile(delta));
    this.total(next);
    this.own = next;
    this.persist();
    return true;
  }
  importLegacy(value) {
    this.mergeLocal();
    const next = maxProfile(this.legacyOwn, profile(value));
    this.total(this.own, next);
    this.legacyOwn = next;
    this.persist();
  }
  saveLoadout(value, now = Date.now()) {
    this.mergeLocal();
    const next = loadout(value);
    if (same(next, this.preferences?.value)) return;
    const revision = { v: 1, at: Math.max(now, (this.preferences?.at ?? 0) + 1), device: this.component, value: next };
    pack(revision);
    this.preferencesOwn = revision;
    this.persist();
  }
  writes() {
    if (!this.ready) return {};
    const writes = {};
    if (!same(this.own, this.components.get(this.key) ?? emptyProfile())) writes[this.key] = pack({ v: 1, p: this.own });
    const legacy = this.data[this.legacyKey] === void 0 ? emptyProfile() : readProfile(this.data[this.legacyKey]);
    if (!same(this.legacyOwn, legacy)) writes[this.legacyKey] = pack({ v: 1, p: this.legacyOwn });
    if (this.preferencesOwn && !same(this.preferencesOwn, this.loadouts.get(this.loadoutKey) ?? null)) writes[this.loadoutKey] = pack(this.preferencesOwn);
    return writes;
  }
  pending() {
    return Object.keys(this.writes()).length > 0;
  }
  persist() {
    if (!this.localKey || !this.storage) return;
    try {
      this.storage.setItem(this.localKey, JSON.stringify({ v: 1, own: this.own, legacy: this.legacyOwn, preferences: this.preferencesOwn }));
    } catch {
      this.warning = "\u672C\u5730\u5B58\u50A8\u4E0D\u53EF\u7528\uFF0C\u672A\u540C\u6B65\u8FDB\u5EA6\u4EC5\u5728\u5F53\u524D\u9875\u9762\u4FDD\u7559\uFF0C\u8BF7\u5728\u79BB\u5F00\u524D\u540C\u6B65\u4E91\u6863\u3002";
    }
  }
  snapshot() {
    return clone(this.total());
  }
}
export {
  GROWTH_PREFIX,
  LEGACY_KEY,
  LEGACY_PREFIX,
  LOADOUT_KEY,
  LOADOUT_PREFIX,
  ProgressLedger,
  WEAPON_IDS,
  addProfile,
  emptyProfile,
  loadout,
  maxProfile,
  profile,
  profileDelta,
  same
};
