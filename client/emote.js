const EMOTES = [
  "\u{1F44D}",
  "\u{1F525}",
  "\u{1F62E}",
  "\u{1F480}",
  "\u{1F3AF}",
  "\u{1F6E1}",
  "\u{1F605}",
  "\u{1F3C6}"
];
const LABELS = {
  "\u{1F44D}": "\u5E72\u5F97\u6F02\u4EAE",
  "\u{1F525}": "\u706B\u529B\u5168\u5F00",
  "\u{1F62E}": "\u5403\u4E86\u4E00\u60CA",
  "\u{1F480}": "\u5012\u4E0B\u4E86",
  "\u{1F3AF}": "\u547D\u4E2D",
  "\u{1F6E1}": "\u5B88\u4F4F\u9635\u5730",
  "\u{1F605}": "\u522B\u6025",
  "\u{1F3C6}": "MVP"
};
function installEmotes({ send, onToast = () => {
} } = {}) {
  const layer = document.createElement("div");
  layer.className = "gh-emote-layer";
  layer.setAttribute("aria-live", "polite");
  document.body.append(layer);
  const show = ({ name = "\u5E72\u5458", emoji = EMOTES[0] } = {}) => {
    const toast = document.createElement("div");
    toast.className = "gh-emote-toast";
    const glyph = document.createElement("b");
    glyph.textContent = emoji;
    const who = document.createElement("span");
    who.textContent = name;
    const hint = document.createElement("em");
    hint.textContent = LABELS[emoji] || "";
    toast.append(glyph, who, hint);
    layer.append(toast);
    onToast({ name, emoji });
    setTimeout(() => {
      toast.classList.add("out");
      setTimeout(() => toast.remove(), 320);
    }, 2200);
  };
  const emit = (emoji) => {
    try {
      send({ type: "emote", emoji });
    } catch {
    }
  };
  const bar = (container) => {
    if (!container) return;
    container.classList.add("gh-emote-bar");
    container.replaceChildren();
    for (const emoji of EMOTES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gh-emote";
      button.textContent = emoji;
      button.title = LABELS[emoji] || emoji;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        emit(emoji);
      });
      container.append(button);
    }
  };
  return { show, emit, bar };
}
export {
  EMOTES,
  installEmotes
};
