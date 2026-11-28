/* global document, window */

function bindDrag(items, drag) {
  let hold;
  let origin;
  let consumeClick = false;
  function cancelHold() {
    window.clearTimeout(hold);
    hold = undefined;
    origin = undefined;
  }
  items.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    cancelHold();
    consumeClick = false;
    origin = [event.clientX, event.clientY];
    hold = window.setTimeout(() => {
      cancelHold();
      consumeClick = true;
      drag();
    }, 260);
  });
  items.addEventListener("pointermove", (event) => {
    if (
      origin &&
      Math.hypot(event.clientX - origin[0], event.clientY - origin[1]) > 8
    )
      cancelHold();
  });
  for (const event of ["pointerup", "pointercancel", "pointerleave"])
    items.addEventListener(event, cancelHold);
  items.addEventListener(
    "click",
    (event) => {
      if (!consumeClick || !event.detail) return;
      consumeClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}

function createDock({
  root,
  items,
  caption,
  makeIcon,
  open,
  showCenter,
  drag,
}) {
  let buttons = [];
  let vertical = true;
  let current = null;
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  bindDrag(items, drag);

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
  function resetMagnification() {
    showCaption(null);
    for (const button of buttons) button.style.removeProperty("--dock-weight");
  }
  items.addEventListener("pointerleave", resetMagnification);
  items.addEventListener("scroll", resetMagnification);
  items.addEventListener(
    "wheel",
    (event) => {
      const horizontalOverflow = items.scrollWidth - items.clientWidth;
      if (
        vertical ||
        horizontalOverflow <= 0 ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      )
        return;
      event.preventDefault();
      const scale =
        event.deltaMode === 1
          ? 24
          : event.deltaMode === 2
            ? items.clientWidth
            : 1;
      items.scrollLeft += event.deltaY * scale;
    },
    { passive: false },
  );
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
      const scroll = vertical ? items.scrollTop : items.scrollLeft;
      const ordered = entries
        .slice()
        .sort(
          (left, right) =>
            Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
            (left.pinned
              ? left.pinOrder - right.pinOrder
              : (right.recent ?? 0) - (left.recent ?? 0)),
        );
      buttons = ordered.map((entry) => {
        const button = createButton(entry.name, makeIcon(entry), () =>
          open(entry.id),
        );
        button.dataset.id = entry.id;
        return button;
      });
      const more = document.createElement("span");
      more.className = "item-mark dock-more";
      more.setAttribute("aria-hidden", "true");
      more.innerHTML =
        '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><rect x="14" y="14" width="6" height="6" rx="1.2"/></svg>';
      items.replaceChildren(
        ...buttons,
        createButton("搜索全部功能", more, showCenter),
      );
      if (vertical) items.scrollTop = scroll;
      else items.scrollLeft = scroll;
      showCaption(null);
    },
  };
}

window.launcherDock = { create: createDock };
