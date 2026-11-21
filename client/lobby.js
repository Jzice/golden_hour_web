import {
  createPeer,
  isRoomPeer,
  parseRoomCode,
  roomPeerId,
  signalingOptions
} from "./peer.js";
import { textFrame } from "./webrtc.js";
const RECENT_KEY = "gh.recentRooms";
const RECENT_LIMIT = 8;
const RECENT_TTL = 30 * 60 * 1e3;
function joinHello(mode, name, room) {
  if (mode === "quick") return { name, quick: true };
  if (mode === "create") return { name, create: true, public: true };
  if (mode !== "listed" || typeof room !== "string" || !room)
    throw Error("\u8BF7\u4ECE\u5927\u5385\u9009\u62E9\u623F\u95F4\u3002");
  return { name, room };
}
function loadRecent() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    const cutoff = Date.now() - RECENT_TTL;
    return value.filter((item) => item && item.code && (item.at || 0) > cutoff);
  } catch {
    return [];
  }
}
function rememberRoom(code, name = "") {
  try {
    const list = loadRecent().filter((item) => item.code !== code);
    list.unshift({ code, name, at: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)));
  } catch {
  }
}
function forgetRoom(code) {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(loadRecent().filter((item) => item.code !== code))
    );
  } catch {
  }
}
function recentRooms(onlineIds = /* @__PURE__ */ new Set()) {
  return loadRecent().map((item) => ({
    room: item.code,
    hostName: item.name || "\u6700\u8FD1\u623F\u95F4",
    phase: "lobby",
    capacity: 10,
    humans: 0,
    bots: 0,
    joinable: true,
    recent: true,
    at: item.at || 0,
    status: onlineIds.has(roomPeerId(item.code)) ? "online" : "stale"
  }));
}
class RoomDirectory {
  constructor({ onChange, createPeer: factory = createPeer } = {}) {
    this.onChange = onChange;
    this.createPeer = factory;
    this.active = false;
    this.generation = 0;
    this.peer = null;
    this.probes = /* @__PURE__ */ new Map();
    this.rooms = [];
  }
  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    this.close();
    if (active) this.open();
  }
  retry() {
    this.close();
    if (this.active) this.open();
  }
  close() {
    this.generation++;
    for (const entry of this.probes.values()) {
      try {
        entry.conn.close();
      } catch {
      }
    }
    this.probes.clear();
    try {
      this.peer?.destroy?.();
    } catch {
    }
    this.peer = null;
  }
  /** 降级为「最近房间」列表：用在线主机集合即时标注每条记录的状态。 */
  showRecent(message, onlineIds = /* @__PURE__ */ new Set()) {
    const rooms = recentRooms(onlineIds);
    this.rooms = rooms;
    this.onChange({ state: "limited", rooms, message, limited: true });
  }
  async open() {
    const generation = this.generation;
    this.onChange({ state: "loading", rooms: [] });
    try {
      this.peer = await this.createPeer(void 0, signalingOptions());
    } catch (error) {
      if (generation !== this.generation) return;
      this.showRecent(error.message || "\u4FE1\u4EE4\u670D\u52A1\u5668\u4E0D\u53EF\u7528\uFF0C\u8BF7\u4F7F\u7528\u623F\u95F4\u7801\u52A0\u5165\u3002");
      return;
    }
    if (generation !== this.generation) return;
    this.peer.on("error", () => {
    });
    let ids = [];
    try {
      ids = await this.listPeerIds();
    } catch {
      try {
        this.peer?.destroy?.();
      } catch {
      }
      this.peer = null;
      ids = [];
    }
    if (generation !== this.generation) return;
    const hosts = (ids || []).filter((id) => isRoomPeer(id));
    const onlineIds = new Set(hosts.map((id) => id.toUpperCase()));
    if (!hosts.length) {
      this.showRecent(
        "\u5F53\u524D\u4FE1\u4EE4\u670D\u52A1\u5668\u672A\u5F00\u653E\u623F\u95F4\u5217\u8868\uFF0C\u8BF7\u7528\u623F\u95F4\u7801\u6216\u9080\u8BF7\u94FE\u63A5\u52A0\u5165\u3002",
        onlineIds
      );
      return;
    }
    const summaries = await Promise.all(
      hosts.map((id) => this.probe(id, generation))
    );
    if (generation !== this.generation) return;
    this.rooms = [...summaries.filter(Boolean), ...recentRooms(onlineIds)];
    this.onChange({ state: "ready", rooms: this.rooms });
  }
  /**
   * 列出信令服务器上登记的全部 peer id。
   * peer.js 的 Peer.listAllPeers 是「回调式」API（不是 Promise），
   * 且列举失败时它会中止并销毁 peer，因此这里统一包成 Promise，
   * 由调用方决定是降级为「只能凭房间码加入」还是重建连接。
   */
  listPeerIds(timeout = 8e3) {
    const peer = this.peer;
    if (!peer) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.off?.("error", onError);
        if (error) reject(error);
        else resolve(value);
      };
      const onError = () => finish([], Error("\u4FE1\u4EE4\u670D\u52A1\u5668\u672A\u5F00\u653E\u623F\u95F4\u5217\u8868\u3002"));
      const timer = setTimeout(() => finish([], Error("\u623F\u95F4\u5217\u8868\u8BF7\u6C42\u8D85\u65F6\u3002")), timeout);
      peer.on("error", onError);
      try {
        peer.listAllPeers((value) => finish(Array.isArray(value) ? value : []));
      } catch (error) {
        finish([], error);
      }
    });
  }
  /** 探针：连上主机读取房间摘要，并保留连接以便加入时复用。 */
  async probe(hostPeerId, generation) {
    const code = parseRoomCode(hostPeerId);
    if (!code) return null;
    try {
      const conn2 = this.peer.connect(hostPeerId, {
        reliable: true,
        serialization: "binary"
      });
      const summary = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("probe \u8D85\u65F6")), 6e3);
        conn2.on("open", () => {
          conn2.send(textFrame(JSON.stringify({ type: "probe" })));
        });
        conn2.on("data", (data) => {
          const body = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null;
          if (!body || body[0] !== 1) return;
          let message;
          try {
            message = JSON.parse(new TextDecoder().decode(body.subarray(1)));
          } catch {
            return;
          }
          if (message.type !== "probe-result" || !message.room) return;
          clearTimeout(timer);
          resolve(message.room);
        });
        conn2.on("close", () => {
          clearTimeout(timer);
          reject(Error("probe \u8FDE\u63A5\u5173\u95ED"));
        });
        conn2.on("error", () => {
          clearTimeout(timer);
          reject(Error("probe \u8FDE\u63A5\u5931\u8D25"));
        });
      });
      if (generation !== this.generation) return null;
      this.probes.set(code, { conn: conn2, summary });
      return summary;
    } catch {
      try {
        conn.close();
      } catch {
      }
      return null;
    }
  }
  /**
   * 取出探针连接供加入房间复用；没有探针记录时返回 null，
   * 由调用方新建连接。
   */
  take(code) {
    const entry = this.probes.get(code);
    if (!entry) return null;
    this.probes.delete(code);
    try {
      entry.conn.off?.("data");
    } catch {
    }
    return { peer: this.peer, connection: entry.conn };
  }
  /** 新建一条到指定主机的连接（未经过探针时使用）。 */
  async connect(hostPeerId) {
    if (!this.peer) this.peer = await this.createPeer(void 0, signalingOptions());
    return { peer: this.peer };
  }
}
export {
  RoomDirectory,
  forgetRoom,
  joinHello,
  recentRooms,
  rememberRoom
};
