// Original illustrated panels are used as vector art in 2D and as textures in 3D.
const stars = Array.from(
  { length: 75 },
  (_, i) =>
    `<circle cx="${(i * 197 + 17) % 800}" cy="${(i * i * 17 + 19) % 116}" r="${i % 8 === 0 ? 1.65 : 0.8}" fill="#ffeadc"/>`,
).join("");
const lights = Array.from(
  { length: 66 },
  (_, i) =>
    `<rect x="${i * 12.9}" y="${134 + ((i * 17) % 21)}" width="${1 + (i % 3)}" height="1" fill="${i % 3 ? "#ffc08e" : "#92c6d7"}"/>`,
).join("");
export const windowArt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 160" preserveAspectRatio="none"><defs><linearGradient id="sky" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#433e74"/><stop offset=".44" stop-color="#99729b"/><stop offset=".8" stop-color="#f2af95"/><stop offset="1" stop-color="#ffcf9a"/></linearGradient></defs><rect width="800" height="160" fill="url(#sky)"/>${stars}<circle cx="544" cy="61" r="33" fill="#ffd4a7"/><path d="M480 84q129-50 128-44 11 8-122 49" fill="none" stroke="#f9d9b9" stroke-width="3"/><path d="m0 120 45-22 35 5 55-36 42 24 29-4 72 25 40-33 24 11 59-44 55 39 21-7 60 39 47-24 28 10 71-40 85 45 35-10 14 19v38H0" fill="#9b7e9f"/><path d="m0 104 41 8 54-19 47 18 46-8 52 20 33-5 82-34 46 13 29-20 47 19 73 26 24-6 84-24 38 13 29-5 85 23v37H0" fill="#6f698d"/><path d="m0 128 60-10 65 6 62-15 69 22 73-6 44 10 73-13 73 10 66-18 72 13 49-11 94 18v26H0" fill="#494c71"/>${lights}<path d="M0 153q230-16 405 1t395-2v8H0" fill="#393f62"/></svg>`;
export function wallSign(arm: string, accent: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 95"><rect width="380" height="95" fill="#293956"/><rect x="9" y="8" width="362" height="79" rx="3" fill="none" stroke="#607088"/><path d="m27 62 24-40 24 40H27m16-8 9-16 9 16" fill="none" stroke="${accent}" stroke-width="4"/><text x="94" y="37" font-family="monospace" font-weight="bold" font-size="13" letter-spacing="4" fill="#a9b7ca">RESEARCH LAB</text><text x="92" y="68" font-family="sans-serif" font-weight="bold" font-size="28" letter-spacing="1" fill="#ffdbbc">SECTOR ${arm}</text><path d="M324 34h26m-26 7h18m-18 7h22" stroke="${accent}" stroke-width="2"/></svg>`;
}
export const dataImage = (svg: string) =>
  "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
