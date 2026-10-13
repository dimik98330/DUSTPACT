/** Public assets follow the hosting base, including GitHub Pages subpaths. */
export function assetUrl(file: string) {
  return `${import.meta.env?.BASE_URL ?? "/"}${file.replace(/^\/+/, "")}`;
}
