const CDN = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
let pending = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(Error("peer.js \u8F7D\u5165\u5931\u8D25\u3002"));
    document.head.append(script);
  });
}
function loadPeerLibrary() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  if (pending) return pending;
  pending = (async () => {
    const sources = [];
    try {
      sources.push(new URL("../vendor/peerjs.min.js", import.meta.url).href);
    } catch {
    }
    sources.push(CDN);
    let lastError = null;
    for (const src of sources) {
      try {
        await loadScript(src);
        if (globalThis.Peer) return globalThis.Peer;
        lastError = Error("peer.js \u8F7D\u5165\u5931\u8D25\u3002");
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || Error("peer.js \u8F7D\u5165\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002");
  })().catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}
const ROOM_PREFIX = "gh-";
const CODE_ALPHABET = "0123456789ABCDEF";
function randomRoomCode(length = 8) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte & 15];
  return code;
}
const roomPeerId = (code) => ROOM_PREFIX + String(code || "").toUpperCase();
function parseRoomCode(value) {
  if (typeof value !== "string") return "";
  let text = value.trim();
  if (!text) return "";
  const query = /[?&#]room=([^&#\s]+)/i.exec(text);
  if (query) text = decodeURIComponent(query[1]);
  text = text.toUpperCase();
  if (text.startsWith(ROOM_PREFIX)) text = text.slice(ROOM_PREFIX.length);
  text = text.replace(/[^0-9A-F]/g, "");
  return /^[0-9A-F]{8}$/.test(text) ? text : "";
}
const isRoomPeer = (id) => typeof id === "string" && id.toLowerCase().startsWith(ROOM_PREFIX);
function signalingOptions() {
  const query = new URLSearchParams(location.search);
  const raw = query.get("signal") || document.documentElement.dataset.peerHost || "";
  if (!raw) return {};
  let text = raw.trim();
  let secure = true;
  if (/^wss?:\/\//i.test(text)) {
    const url = new URL(text);
    secure = url.protocol === "wss:";
    text = url.host + url.pathname;
  } else if (text.startsWith("ws://")) {
    secure = false;
    text = text.slice(5);
  }
  const [authority, ...rest] = text.split("/");
  const [host, port] = authority.split(":");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const options = { host, secure: secure && !local };
  if (port) options.port = Number(port);
  if (rest.length) options.path = "/" + rest.join("/");
  const key = query.get("signalKey");
  if (key) options.key = key;
  return options;
}
function peerServerConfig(options = {}) {
  const config = { debug: 0 };
  if (options.host) {
    config.host = options.host;
    config.port = options.port || (options.secure === false ? 80 : 443);
    config.path = options.path || "/";
    config.secure = options.secure !== false;
    if (options.key) config.key = options.key;
  }
  return config;
}
async function createPeer(id, options = {}) {
  const Peer = await loadPeerLibrary();
  const config = peerServerConfig(options);
  const peer = id ? new Peer(id, config) : new Peer(config);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("\u4FE1\u4EE4\u670D\u52A1\u5668\u8FDE\u63A5\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002")),
      15e3
    );
    peer.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    peer.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return peer;
}
export {
  ROOM_PREFIX,
  createPeer,
  isRoomPeer,
  loadPeerLibrary,
  parseRoomCode,
  peerServerConfig,
  randomRoomCode,
  roomPeerId,
  signalingOptions
};
