/* global document, window */

function updatePicker(preview, side, offset) {
  preview.dataset.side = side;
  preview.style.setProperty("--offset", `${offset}%`);
}

function bindPicker(preview, onMove) {
  function move(event) {
    const bounds = preview.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const sides = [
      ["left", x],
      ["right", bounds.width - x],
      ["top", y],
      ["bottom", bounds.height - y],
    ];
    const [side] = sides.reduce((nearest, item) =>
      item[1] < nearest[1] ? item : nearest,
    );
    const across = side === "top" || side === "bottom";
    const offset = Math.round(
      100 * (across ? x / bounds.width : y / bounds.height),
    );
    onMove(side, offset);
  }
  preview.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || preview.hasPointerCapture(event.pointerId))
      return;
    preview.setPointerCapture(event.pointerId);
    move(event);
  });
  preview.addEventListener("pointermove", (event) => {
    if (preview.hasPointerCapture(event.pointerId)) move(event);
  });
}

function createDock({ root, items, caption, makeIcon, open, showCenter }) {
  let buttons = [];
  let vertical = true;
  let current = null;
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  function showCaption(button) {
    if (current === button) return;
    current = button;
    caption.textContent = button?.getAttribute("aria-label") ?? "";
  }

  items.addEventListener("pointermove", (event) => {
    const hovered = event.target.closest(".dock-button");
    showCaption(hovered);
    if (motion?.matches) return;
    const pointer = vertical ? event.clientY : event.clientX;
    // 使用按钮的静态位置计算距离，放大后的图标不会改变命中区。
    const weights = buttons.map((button) => {
      const bounds = button.getBoundingClientRect();
      const center = vertical
        ? bounds.top + bounds.height / 2
        : bounds.left + bounds.width / 2;
      return hovered ? Math.max(0, 1 - Math.abs(pointer - center) / 87) : 0;
    });
    buttons.forEach((button, index) => {
      button.style.setProperty("--dock-weight", String(weights[index]));
    });
  });
  items.addEventListener("pointerleave", () => {
    showCaption(null);
    for (const button of buttons) button.style.removeProperty("--dock-weight");
  });
  items.addEventListener("focusin", (event) =>
    showCaption(event.target.closest(".dock-button")),
  );
  items.addEventListener("focusout", (event) =>
    showCaption(event.relatedTarget?.closest?.(".dock-button") ?? null),
  );

  function createButton(name, icon, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dock-button";
    button.setAttribute("aria-label", name);
    button.append(icon);
    button.addEventListener("click", action);
    return button;
  }

  return {
    render(entries, side) {
      root.dataset.side = side;
      vertical = side === "left" || side === "right";
      const length = vertical ? root.clientHeight : root.clientWidth;
      const limit = Math.max(1, Math.floor((length - 92) / 55));
      const ordered = entries
        .filter((entry) => entry.pinned || entry.recent > 0)
        .sort(
          (left, right) =>
            Number(right.pinned) - Number(left.pinned) ||
            (left.pinned
              ? left.pinOrder - right.pinOrder
              : right.recent - left.recent),
        );
      buttons = (ordered.length ? ordered : entries)
        .slice(0, limit)
        .map((entry) => {
          const button = createButton(entry.name, makeIcon(entry), () =>
            open(entry.id),
          );
          button.dataset.id = entry.id;
          return button;
        });
      const more = document.createElement("span");
      more.className = "item-mark dock-more";
      more.setAttribute("aria-hidden", "true");
      more.textContent = "···";
      items.replaceChildren(
        ...buttons,
        createButton("搜索全部功能", more, showCenter),
      );
      showCaption(null);
    },
  };
}

window.launcherDock = { create: createDock, bindPicker, updatePicker };
