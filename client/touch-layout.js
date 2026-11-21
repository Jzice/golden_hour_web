const LAYOUT_KEY = "gh-touch-layout-v1";
const CONTROL_DEFS = [
  ["stick", "\u79FB\u52A8\u6447\u6746", 112],
  ["fire", "\u5F00\u706B", 64],
  ["aim", "\u7784\u51C6", 48],
  ["jump", "\u8DF3\u8DC3", 48],
  ["crouch", "\u8E72\u4E0B", 48],
  ["reload", "\u6362\u5F39", 48],
  ["swap", "\u5207\u67AA", 48],
  ["sprint", "\u51B2\u523A", 44],
  ["grenade", "\u624B\u96F7", 44],
  ["melee", "\u8FD1\u6218", 44],
  ["upgrade", "\u519B\u72AC", 44],
  ["dive", "\u98DE\u6251", 44],
  ["score", "\u6218\u7EE9", 44],
  ["pause", "\u6682\u505C", 44],
  ["inspect", "\u68C0\u89C6", 44],
  ["fullscreen", "\u5168\u5C4F", 44]
];
const finite = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
function defaultLayout(width = 844, height = 390) {
  width = Math.max(320, width);
  height = Math.max(240, height);
  const centers = {
    stick: [90, height - 80],
    fire: [width - 100, height - 136],
    aim: [width - 36, height - 144],
    jump: [width - 36, height - 90],
    crouch: [width - 36, height - 36],
    reload: [width - 92, height - 72],
    swap: [width - 148, height - 36],
    sprint: [50, height - 174],
    grenade: [width - 202, height - 34],
    melee: [width - 202, height - 86],
    upgrade: [width - 202, height - 138],
    dive: [width - 202, height - 190],
    score: [width - 184, 30],
    pause: [width - 134, 30],
    inspect: [width - 84, 30],
    fullscreen: [width - 34, 30]
  };
  return {
    version: 1,
    sensitivity: 1,
    fireLook: true,
    controls: Object.fromEntries(CONTROL_DEFS.map(([id, , size]) => [id, {
      x: centers[id][0] / width,
      y: centers[id][1] / height,
      size,
      opacity: 0.7
    }]))
  };
}
function normalizeLayout(value, width, height) {
  const layout = defaultLayout(width, height);
  if (!value || value.version !== 1) return layout;
  layout.sensitivity = finite(value.sensitivity, 1, 0.25, 3);
  layout.fireLook = typeof value.fireLook === "boolean" ? value.fireLook : true;
  for (const [id, , size] of CONTROL_DEFS) {
    const item = value.controls?.[id];
    if (!item || typeof item !== "object") continue;
    layout.controls[id] = {
      x: finite(item.x, layout.controls[id].x, 0, 1),
      y: finite(item.y, layout.controls[id].y, 0, 1),
      size: finite(item.size, size, id === "stick" ? 80 : 44, id === "stick" ? 180 : 120),
      opacity: finite(item.opacity, 0.7, 0.25, 1)
    };
  }
  return layout;
}
function controlRect(control, width, height) {
  const size = Math.min(control.size, width, height);
  return {
    left: Math.max(0, Math.min(width - size, control.x * width - size / 2)),
    top: Math.max(0, Math.min(height - size, control.y * height - size / 2)),
    size
  };
}
function overlappingControls(layout, selected, width, height) {
  const a = controlRect(layout.controls[selected], width, height);
  return CONTROL_DEFS.filter(([id]) => {
    if (id === selected) return false;
    const b = controlRect(layout.controls[id], width, height);
    return a.left < b.left + b.size && b.left < a.left + a.size && a.top < b.top + b.size && b.top < a.top + a.size;
  }).map(([, label]) => label);
}
function readLayout(storage, width, height) {
  try {
    return normalizeLayout(JSON.parse(storage?.getItem(LAYOUT_KEY)), width, height);
  } catch {
    return defaultLayout(width, height);
  }
}
function saveLayout(storage, layout) {
  try {
    if (!storage) return false;
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    return true;
  } catch {
    return false;
  }
}
function canStartLook(x, bounds, hasLookOwner = false) {
  return !hasLookOwner && x >= bounds.left + bounds.width / 2 && x <= bounds.left + bounds.width;
}
function touchLookDelta(dx, dy, sensitivity, ads = false, out = {}) {
  const aim = typeof ads === "number" ? finite(ads, 0, 0, 1) : Number(ads);
  const scale = finite(sensitivity, 1, 0.25, 3) * 2 * (1 - 0.35 * aim);
  out.x = dx * scale;
  out.y = dy * scale;
  return out;
}
export {
  CONTROL_DEFS,
  LAYOUT_KEY,
  canStartLook,
  controlRect,
  defaultLayout,
  normalizeLayout,
  overlappingControls,
  readLayout,
  saveLayout,
  touchLookDelta
};
