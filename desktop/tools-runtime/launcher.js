/* global document, window */
const $ = (id) => document.getElementById(id);
const query = $("query");
let entries = [];
let selected = 0;
let buttons = [];
let expanded = false;
let showAll = false;
let refreshing = 0;
let busy = false;
const icons = {
  workflow: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/><path d="M6.5 10v5a3 3 0 0 0 3 3H14M14 6h4v4"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
  tool: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
};
function status(text) { $("message").hidden = !text; $("message").textContent = text?.replace(/^Error invoking remote method '[^']+': Error: /, ""); }
function choose(index) {
  selected = index;
  buttons.forEach((button, at) => button.setAttribute("aria-current", String(at === index)));
}
async function open(id) {
  if (busy) return;
  busy = true;
  try { await window.launcher.open(id); }
  catch (error) { status(error.message); }
  finally { busy = false; }
}
function tile(entry) {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.className = "item";
  button.title = entry.description;
  button.dataset.id = entry.id;
  const icon = document.createElement("span");
  icon.className = "item-mark";
  icon.dataset.icon = entry.icon;
  if (entry.source === "personal") icon.dataset.tone = String([...entry.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4);
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = `<svg viewBox="0 0 24 24">${icons[entry.icon] ?? icons.tool}</svg>`;
  const label = document.createElement("span");
  label.className = "item-label";
  label.textContent = entry.name;
  button.append(icon, label);
  button.addEventListener("click", () => void open(entry.id));
  button.addEventListener("focus", () => choose(buttons.indexOf(button)));
  const pin = document.createElement("button");
  pin.className = "pin";
  pin.textContent = entry.pinned ? "★" : "☆";
  pin.setAttribute("aria-label", `${entry.pinned ? "取消固定" : "固定"} ${entry.name}`);
  pin.setAttribute("aria-pressed", String(entry.pinned));
  pin.title = entry.pinned ? "取消固定" : "固定到小窗";
  pin.addEventListener("click", async () => {
    try { await window.launcher.pin(entry.id, !entry.pinned); await refresh(false); }
    catch (error) { status(error.message); }
  });
  li.append(button, pin);
  return li;
}
function render() {
  const term = query.value.trim().toLowerCase();
  const searching = Boolean(term) || showAll;
  const matches = entries.filter((entry) => `${entry.name} ${entry.keywords.join(" ")}`.toLowerCase().includes(term));
  const recent = matches.filter((entry) => entry.recent > 0);
  const columns = Math.max(1, Math.floor(($("results").clientWidth + 4) / (window.innerWidth <= 580 ? 82 : 92)));
  const shown = searching ? matches : expanded ? recent : recent.slice(0, columns);
  $("caption").textContent = term ? `搜索结果 · ${matches.length}` : showAll ? `全部功能 · ${matches.length}` : "最近使用";
  $("results").setAttribute("aria-label", $("caption").textContent);
  $("results").replaceChildren(...shown.map(tile));
  $("expand").hidden = searching || recent.length <= columns;
  $("expand").textContent = expanded ? "收起" : `展开 (${recent.length})`;
  $("pinned-section").hidden = searching;
  $("pinned").replaceChildren(...(searching ? [] : entries.filter((entry) => entry.pinned).sort((a, b) => a.pinOrder - b.pinOrder).map(tile)));
  $("pin-empty").hidden = entries.some((entry) => entry.pinned);
  $("empty").hidden = shown.length > 0;
  $("empty").textContent = searching ? "没有找到匹配的功能，试试其他关键词。" : "从已固定或全部功能打开，最近使用会出现在这里。";
  buttons = [...document.querySelectorAll(".item")];
  choose(0);
}
function shortcutState(result) {
  $("shortcut").textContent = result.shortcutReady ? result.shortcut.replace("Control", "Ctrl").replaceAll("+", " + ") : "快捷键被占用 · 点击设置";
  $("accelerator").value = result.shortcut;
}
async function refresh(reset = true) {
  const generation = ++refreshing;
  try {
    const result = await window.launcher.entries();
    if (generation !== refreshing) return;
    entries = result.entries;
    shortcutState(result);
    if (reset) { query.value = ""; showAll = false; expanded = false; settings(false); status(""); }
    render();
    if (reset) query.focus();
  } catch (error) { status(error.message); }
}
function settings(visible) {
  $("settings").hidden = !visible;
  $("content").hidden = visible;
  query.disabled = visible;
  if (visible) { $("accelerator").focus(); $("accelerator").select(); }
  else query.focus();
}
async function saveShortcut(value) {
  try { shortcutState(await window.launcher.shortcut(value)); status("快捷键已保存，即刻生效。"); }
  catch (error) { status(error.message); }
}
query.addEventListener("input", () => { showAll = false; status(""); render(); });
$("all").addEventListener("click", () => { showAll = true; render(); query.focus(); });
$("expand").addEventListener("click", () => { expanded = !expanded; render(); });
$("settings-open").addEventListener("click", () => settings($("settings").hidden));
$("shortcut").addEventListener("click", () => settings(true));
$("settings-close").addEventListener("click", () => { settings(false); status(""); });
$("close").addEventListener("click", () => window.launcher.hide());
$("shortcut-form").addEventListener("submit", (event) => { event.preventDefault(); void saveShortcut($("accelerator").value); });
$("reset-shortcut").addEventListener("click", () => void saveShortcut("Alt+Space"));
document.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    if (!$("settings").hidden) { settings(false); status(""); }
    else if (query.value || showAll) { query.value = ""; showAll = false; render(); }
    else window.launcher.hide();
  }
  if (!buttons.length || event.target !== query) return;
  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    const current = buttons[selected];
    const row = buttons.filter((button) => button.getBoundingClientRect().top === current.getBoundingClientRect().top);
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: row.length, ArrowUp: -row.length }[event.key];
    choose((selected + delta + buttons.length) % buttons.length);
    buttons[selected].scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter") { event.preventDefault(); void open(buttons[selected].dataset.id); }
});
window.addEventListener("resize", render);
window.launcher.onRefresh(() => void refresh());
void refresh();
