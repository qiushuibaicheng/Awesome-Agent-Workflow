export function safeSourcePath(path: string): boolean {
  return path.length > 0 && path.length <= 200 && !/[\\:<>"|?*]/.test(path) && ![...path].some((ch) => ch.charCodeAt(0) < 32)
    && path.split("/").every((part) => part && part !== "." && part !== ".."
      && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
      && !["__proto__", "prototype", "constructor"].includes(part));
}

export function readSourceFiles(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 64) return undefined;
  const paths = new Set<string>();
  let bytes = 0;
  for (const [path, source] of entries) {
    if (!safeSourcePath(path) || paths.has(path.toLowerCase()) || ["manifest.json", "index.html"].includes(path.toLowerCase()) || typeof source !== "string") return undefined;
    paths.add(path.toLowerCase());
    bytes += new TextEncoder().encode(source).length;
    if (bytes > 512 * 1024) return undefined;
  }
  return Object.fromEntries(entries);
}
