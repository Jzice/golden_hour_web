function installTrainingKills({ gh, account, isOnline }) {
  const { match, player, hud } = gh.debug.ctx;
  const callbacks = hud.menus.cb;
  let active = !isOnline() && ["countdown", "live", "ending"].includes(match.state);
  let highWater = Number.isSafeInteger(player.kills) && player.kills >= 0 ? player.kills : 0;
  function sample() {
    if (isOnline()) {
      active = false;
      return 0;
    }
    const kills = player.kills;
    if (!active || !Number.isSafeInteger(kills) || kills <= highWater) return 0;
    const delta = kills - highWater;
    highWater = kills;
    account.record("training", delta);
    return delta;
  }
  function flush() {
    try {
      Promise.resolve(account.flush()).catch(() => {
      });
    } catch {
    }
  }
  const start = match.start;
  match.start = function(...args) {
    sample();
    if (active) flush();
    active = false;
    const result = start.apply(this, args);
    highWater = Number.isSafeInteger(player.kills) && player.kills >= 0 ? player.kills : 0;
    active = !isOnline();
    return result;
  };
  const kill = match._kill;
  match._kill = function(...args) {
    try {
      return kill.apply(this, args);
    } finally {
      sample();
    }
  };
  function wrapSettlement(target, name) {
    const original = target[name];
    target[name] = function(...args) {
      sample();
      const finishing = active;
      try {
        return original.apply(this, args);
      } finally {
        sample();
        if (finishing && active) {
          active = false;
          flush();
        }
      }
    };
  }
  wrapSettlement(hud, "matchEnd");
  wrapSettlement(callbacks, "onQuit");
  return { sample };
}
export {
  installTrainingKills
};
