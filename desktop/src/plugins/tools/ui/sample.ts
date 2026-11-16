import type { ToolPackage } from "../types.ts";

export const sampleTool: ToolPackage = {
  schemaVersion: 1,
  id: "json-formatter",
  name: "JSON 格式化",
  version: "1.0.0",
  html: `<style>
  :root { color-scheme: light dark; }
  body { font: 1rem system-ui; margin: 20px; }
  form { display: grid; gap: 12px; }
  textarea { box-sizing: border-box; width: 100%; min-height: 12em; font: inherit; }
  button { justify-self: start; font: inherit; padding: 6px 14px; }
  output { white-space: pre-wrap; }
</style>
<form>
  <label for="source">输入 JSON</label>
  <textarea id="source">{"hello":"AAW"}</textarea>
  <button type="button" id="format">格式化</button>
  <output id="status" aria-live="polite"></output>
</form>
<script>
  function formatJson(text) {
    return JSON.stringify(JSON.parse(text), null, 2);
  }
  const source = document.querySelector('#source');
  const status = document.querySelector('#status');
  document.querySelector('#format').addEventListener('click', () => {
    try {
      source.value = formatJson(source.value);
      status.textContent = '格式化完成';
    } catch {
      status.textContent = '输入不是有效的 JSON';
    }
  });
</script>`,
};
