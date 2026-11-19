import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";

import { aawDevBridgePlugin } from "./scripts/devBridgePlugin.ts";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Parallel visual tests must not invalidate dependencies in the live desktop.
  cacheDir: `node_modules/.cache/vite-${mode}`,
  plugins: [react(), tailwindcss(), aawDevBridgePlugin()],

  // Vitest：jsdom 环境，测试集中在 tests/ 目录，setup 统一挂 jest-dom 匹配器
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    /**
     * 用线程池而不是默认的进程池（forks）。
     *
     * 272 个测试文件各起一个 worker，在 20 核机器上默认会同时 fork 十几个
     * node 进程；Windows 上偶发 "Failed to start forks worker"——那一批文件
     * **根本没有执行**，汇总里却仍然是 "Test Files 272 passed"，只有末尾多
     * 3 行 errors。等于"全绿"里悄悄漏了 3 个文件（threads 池跑出来是 275）。
     * 线程池同样按文件隔离（isolate 默认开），启动成本低得多：全量 112s → 65s。
     */
    pool: "threads",
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
