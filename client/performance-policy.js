function startupPolicy({
  coarse = false,
  mobile = false,
  userAgent = "",
  platform = "",
  maxTouchPoints = 0
} = {}) {
  const handheld = coarse || mobile || /Android|iPhone|iPad|iPod/i.test(userAgent) || platform === "MacIntel" && maxTouchPoints > 1;
  return {
    mobile: handheld,
    cacheMaterials: true,
    materialCacheBytes: (handheld ? 72 : 160) * 1024 * 1024,
    textureLimit: handheld ? 512 : Infinity,
    cubeSize: handheld ? 128 : 256
  };
}
function textureSize(width, height, limit) {
  const scale = Math.min(1, limit / Math.max(width, height));
  return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}
function limitTextureData(data, width, height, limit) {
  if (Math.max(width, height) <= limit) return null;
  const [w, h] = textureSize(width, height, limit);
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = Math.min(height - 1, Math.floor((y + 0.5) * height / h)) * width;
    for (let x = 0; x < w; x++) {
      const source = (row + Math.min(width - 1, Math.floor((x + 0.5) * width / w))) * 4;
      const target = (y * w + x) * 4;
      pixels[target] = data[source];
      pixels[target + 1] = data[source + 1];
      pixels[target + 2] = data[source + 2];
      pixels[target + 3] = data[source + 3];
    }
  }
  return { data: pixels, width: w, height: h };
}
class AdaptiveQuality {
  constructor(now = 0) {
    this.reset(now);
  }
  reset(now) {
    this.slow = 0;
    this.changedAt = now;
  }
  observe({
    now,
    automatic,
    playing,
    hidden,
    count,
    mean,
    p95,
    quality,
    scale
  }) {
    if (!automatic || !playing || hidden || count < 4) {
      this.slow = 0;
      return null;
    }
    if (now - this.changedAt < 8e3) return null;
    this.slow = mean > 23 || p95 > 34 ? this.slow + 1 : 0;
    if (this.slow < 2) return null;
    this.reset(now);
    if (quality === "high" || quality === "ultra") return { quality: "medium" };
    if (quality === "medium") return { quality: "low" };
    if (quality === "low" && scale > 0.7)
      return { scale: Math.max(0.7, Number((scale - 0.1).toFixed(10))) };
    return null;
  }
}
export {
  AdaptiveQuality,
  limitTextureData,
  startupPolicy,
  textureSize
};
