// Lightweight deterministic avatar: initials on a gradient circle.
const PALETTES: Array<[string, string]> = [
  ["#6d5cff", "#9d7bff"],
  ["#0ea5e9", "#6366f1"],
  ["#10b981", "#3b82f6"],
  ["#f59e0b", "#ef4444"],
  ["#ec4899", "#8b5cf6"],
];

function pick(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length]!;
}

export function getAvatarUrl(seed: string, size = 128): string {
  const [c1, c2] = pick(seed || "user");
  const initial = (seed.trim()[0] || "U").toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<circle cx="32" cy="32" r="32" fill="url(#g)"/>` +
    `<text x="32" y="42" font-family="system-ui,sans-serif" font-size="28" font-weight="600" fill="#fff" text-anchor="middle">${initial}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
