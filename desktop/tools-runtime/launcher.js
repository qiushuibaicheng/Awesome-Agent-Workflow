/* global document, window */
const query = document.getElementById("query");
const results = document.getElementById("results");
const message = document.getElementById("message");
const shortcut = document.getElementById("shortcut");
const caption = document.getElementById("caption");
const count = document.getElementById("count");

let entries = [];
let visible = [];
let selected = 0;
let signedIn = false;
let refreshing = 0;

function status(text) {
  message.hidden = !text;
  message.textContent = text;
}

function choose(index) {
  selected = index;
  Array.from(results.children).forEach((item, at) =>
    item.firstElementChild?.setAttribute("aria-current", String(at === selected)));
}

async function open(id) {
  try {
    await window.launcher.open(id);
  } catch (error) {
    status(error.message);
  }
}

function render() {
  const term = query.value.trim().toLowerCase();
  visible = entries.filter((entry) => `${entry.name} ${entry.id}`.toLowerCase().includes(term));
  caption.textContent = term ? "搜索结果" : "最近使用";
  count.textContent = String(visible.length);
  results.replaceChildren(...visible.map((entry, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item";
    const icon = document.createElement("span");
    icon.className = "item-mark";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = Array.from(entry.name)[0] || "✦";
    const label = document.createElement("span");
    label.className = "item-label";
    const title = document.createElement("strong");
    title.textContent = entry.name;
    const detail = document.createElement("small");
    detail.textContent = `v${entry.version}${entry.actions.length ? " · 支持 CLI" : ""}`;
    const end = document.createElement("span");
    end.className = "item-end";
    end.textContent = "打开 ↗";
    label.append(title, detail);
    button.append(icon, label, end);
    button.addEventListener("focus", () => choose(index));
    button.addEventListener("click", () => void open(entry.id));
    li.append(button);
    return li;
  }));
  choose(0);
  status(visible.length ? "" : !signedIn ? "请先在 AAW Desktop 登录。" : term
    ? "没有匹配的工具。" : "在 AAW Desktop 的工具面板安装工具后，即可在这里打开。");
}

async function refresh() {
  const generation = ++refreshing;
  try {
    const result = await window.launcher.entries();
    if (generation !== refreshing) return;
    entries = result.entries;
    signedIn = result.signedIn;
    query.value = "";
    shortcut.textContent = result.shortcutReady
      ? result.shortcut.replace("CommandOrControl", "Ctrl").replaceAll("+", " + ")
      : "快捷键不可用，可从托盘打开";
    render();
    query.focus();
  } catch (error) {
    if (generation === refreshing) status(error.message);
  }
}

query.addEventListener("input", render);
document.getElementById("close").addEventListener("click", () => window.launcher.hide());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.launcher.hide();
  if (event.isComposing || !visible.length || event.target !== query) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const next = (selected + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
    choose(next);
    results.children[next]?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter") void open(visible[selected].id);
});
window.launcher.onRefresh(() => void refresh());
void refresh();
