import { expect, it, vi } from "vitest";
import { createShortcutController } from "../../../tools-runtime/shortcut.mjs";

/**
 * 录制快捷键时全局热键必须先让出来，否则用户按下的第一下就是当前生效的那组，
 * 窗口会被自己的快捷键关掉——用户想从别的组合键改回 Alt+Space 时，看到的
 * 从来不是"录进去了"，而是界面消失。这几条锁住让位/收回的语义。
 */
function boot(initial = "Alt+Space") {
  const registered = new Set<string>();
  let saved = initial;
  const api = {
    register: vi.fn((accelerator: string) => {
      if (registered.has(accelerator)) return false;
      registered.add(accelerator);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => { registered.delete(accelerator); }),
  };
  const store = {
    read: () => ({ shortcut: saved }),
    update: (patch: { shortcut: string }) => { saved = patch.shortcut; },
  };
  const controller = createShortcutController(api, store, () => {});
  return { api, registered, controller, saved: () => saved };
}

it("让出全局热键，恢复后重新注册回同一组", () => {
  const { registered, controller } = boot();
  controller.start();
  expect(registered.has("Alt+Space")).toBe(true);

  controller.pause();
  expect(registered.has("Alt+Space")).toBe(false);

  controller.resume();
  expect(registered.has("Alt+Space")).toBe(true);
  expect(controller.state).toEqual({ shortcut: "Alt+Space", shortcutReady: true });
});

it("暂停期间能从别的组合键改回 Alt+Space", () => {
  const { registered, controller, saved } = boot("Control+Space");
  controller.start();
  expect(registered.has("Control+Space")).toBe(true);

  // 用户点开设置页，开始录快捷键。
  controller.pause();
  expect(registered.has("Control+Space")).toBe(false);

  controller.change("Alt+Space");
  expect(saved()).toBe("Alt+Space");
  expect(registered.has("Alt+Space")).toBe(true);
  // 暂停时旧键早已解绑，change 不该把刚注册上的新键顺手解掉。
  expect(registered.has("Control+Space")).toBe(false);

  controller.resume();
  expect(registered.has("Alt+Space")).toBe(true);
});

it("暂停期间换键后恢复，不会把新键重复注册成冲突", () => {
  const { api, registered, controller } = boot();
  controller.start();
  controller.pause();
  controller.change("Control+Alt+K");
  api.register.mockClear();

  controller.resume();
  expect(api.register).not.toHaveBeenCalled();
  expect(registered.has("Control+Alt+K")).toBe(true);
});

it("恢复时被别的程序抢走，就把状态标成不可用而不是假装成功", () => {
  const { api, controller } = boot();
  controller.start();
  controller.pause();
  api.register.mockReturnValueOnce(false);

  controller.resume();
  expect(controller.state.shortcutReady).toBe(false);
});
