import { createPeer, randomRoomCode, roomPeerId, signalingOptions } from "../client/peer.js";
import { textFrame, binaryFrame } from "../client/webrtc.js";
import { decodeInput } from "./protocol.js";
import { Sim } from "./sim.js";
const jsonFrame = (value) => textFrame(JSON.stringify(value) + "\n");
class RemoteEndpoint {
  constructor(room, conn) {
    this.room = room;
    this.conn = conn;
    this.peerId = conn.peer || "";
    this.playerId = null;
    this.closed = false;
    conn.on("data", (data) => {
      const frame = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : typeof data === "string" ? textFrame(data) : null;
      if (frame) this.room.receive(this, frame);
    });
    conn.on("close", () => this.handleClose());
  }
  deliver(frame) {
    if (this.closed) return;
    if (this.conn.open) this.conn.send(frame);
  }
  handleClose() {
    if (this.closed) return;
    this.closed = true;
    this.room.drop(this);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.conn.close();
    } catch {
    }
    this.room.drop(this);
  }
}
class LocalEndpoint {
  constructor(room) {
    this.room = room;
    this.peerId = room.peerId;
    this.playerId = null;
    this.closed = false;
    this.frames = [];
    this.closes = [];
  }
  onFrame(callback) {
    this.frames.push(callback);
    return () => {
      const index = this.frames.indexOf(callback);
      if (index >= 0) this.frames.splice(index, 1);
    };
  }
  onClose(callback) {
    this.closes.push(callback);
  }
  /** 客户端 -> 主机。 */
  send(frame) {
    this.room.receive(this, frame);
  }
  /** 主机 -> 客户端。 */
  deliver(frame) {
    for (const callback of [...this.frames]) {
      try {
        callback(frame);
      } catch {
      }
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const callback of this.closes) callback();
    this.room.drop(this);
  }
}
class Room {
  constructor({ code, peer, world, weapons, difficulty = "regular" }) {
    this.code = code;
    this.peer = peer;
    this.peerId = peer.id || roomPeerId(code);
    this.endpoints = /* @__PURE__ */ new Set();
    this.difficulty = difficulty;
    this.sim = new Sim({
      world,
      weapons,
      code,
      scoreLimit: 40,
      capacity: 10,
      onEvent: (event, target) => this.dispatchEvent(event, target),
      onSnapshot: (bytes) => this.broadcast(binaryFrame(bytes)),
      onRoster: (state) => this.broadcastRoster(state)
    });
    this.sim.difficulty = difficulty;
    peer.on("connection", (conn) => {
      const endpoint = new RemoteEndpoint(this, conn);
      this.endpoints.add(endpoint);
    });
    peer.on("error", (error) => {
      this.onError?.(error);
    });
  }
  /** 创建房间：注册 peer id 并启动权威模拟。 */
  static async create({ world, weapons, code, signaling } = {}) {
    const roomCode = (code || randomRoomCode()).toUpperCase();
    const peer = await createPeer(roomPeerId(roomCode), signaling || signalingOptions());
    const room = new Room({ code: roomCode, peer, world, weapons });
    room.sim.start();
    return room;
  }
  /** 主机自己的客户端链路。 */
  localEndpoint() {
    const endpoint = new LocalEndpoint(this);
    this.endpoints.add(endpoint);
    return endpoint;
  }
  endpointFor(playerId) {
    for (const endpoint of this.endpoints) {
      if (endpoint.playerId === playerId) return endpoint;
    }
    return null;
  }
  // -- 收帧 ----------------------------------------------------------------
  receive(endpoint, frame) {
    const kind = frame[0];
    const body = frame.subarray(1);
    if (kind === 2) {
      const input = decodeInput(body);
      if (input && endpoint.playerId !== null)
        this.sim.setInput(endpoint.playerId, input);
      return;
    }
    if (kind !== 1) return;
    let message;
    try {
      message = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return;
    }
    if (!message || typeof message.type !== "string") return;
    if (message.type === "probe") {
      endpoint.deliver(jsonFrame({ type: "probe-result", room: this.summary() }));
      return;
    }
    if (message.type === "hello") {
      this.greet(endpoint, message);
      return;
    }
    if (message.type === "leave") {
      if (endpoint.playerId !== null) this.sim.leave(endpoint.playerId);
      endpoint.deliver(jsonFrame({ type: "left" }));
      endpoint.close();
      return;
    }
    if (endpoint.playerId === null) return;
    this.sim.command(endpoint.playerId, message);
  }
  /** 分配身份并接入模拟。 */
  greet(endpoint, message) {
    const requested = Number.isInteger(message.id) ? message.id : null;
    const existing = requested === null ? null : this.sim.players.get(requested);
    const sameSeat = endpoint.playerId === requested;
    const resumable = existing && (sameSeat || existing.resumable && !existing.connected);
    let playerId = resumable ? requested : this.sim.allocateId();
    endpoint.playerId = playerId;
    if (message.weapons?.length) this.sim.applySpecs(message.weapons);
    if (message.difficulty) {
      this.difficulty = message.difficulty;
      this.sim.difficulty = message.difficulty;
    }
    this.sim.join({
      id: playerId,
      name: message.name || "\u5E72\u5458",
      team: message.team,
      spectate: !!message.spectate
    });
    if (endpoint instanceof LocalEndpoint && !this.sim.hostId) this.sim.hostId = playerId;
    endpoint.deliver(
      jsonFrame({
        type: "welcome",
        id: playerId,
        room: this.code,
        resume: playerId,
        inputSeq: 0,
        weapons: this.sim.specList()
      })
    );
    this.broadcastRoster(this.sim.roomState());
  }
  // -- 出帧 ----------------------------------------------------------------
  dispatchEvent(event, target) {
    if (target !== void 0 && target !== null) {
      const endpoint = this.endpointFor(target);
      if (endpoint) endpoint.deliver(jsonFrame(event));
      return;
    }
    this.broadcast(jsonFrame(event));
  }
  broadcastRoster(state) {
    const players = state.players.map((player) => {
      const endpoint = this.endpointFor(player.id);
      return { ...player, peerId: endpoint?.peerId || "" };
    });
    const humans = players.filter((p) => !p.bot && p.connected).length;
    this.broadcast(
      jsonFrame({
        ...state,
        players,
        humans,
        bots: players.length - humans
      })
    );
  }
  /** 大厅探针用的房间摘要。 */
  summary() {
    const state = this.sim.roomState();
    const host = [...this.sim.players.values()].find((p) => p.id === this.sim.hostId);
    return {
      room: this.code,
      hostName: host?.name || "\u623F\u4E3B",
      phase: state.phase,
      capacity: state.capacity,
      humans: state.humans,
      bots: state.bots,
      joinable: state.joinable,
      difficulty: state.difficulty
    };
  }
  broadcast(frame) {
    for (const endpoint of this.endpoints) endpoint.deliver(frame);
  }
  drop(endpoint) {
    if (!this.endpoints.has(endpoint)) return;
    this.endpoints.delete(endpoint);
    if (endpoint.playerId !== null) this.sim.leave(endpoint.playerId);
  }
  destroy() {
    this.sim.stop();
    for (const endpoint of this.endpoints) {
      try {
        endpoint.close();
      } catch {
      }
    }
    this.endpoints.clear();
    try {
      this.peer.destroy();
    } catch {
    }
  }
}
export {
  Room
};
