/* Génère les icônes PWA (PNG) sans dépendance externe.
   Usage : node tools/make-icons.mjs */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

/* — Encodeur PNG minimal (RGBA 8 bits) — */
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtre "None"
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* — Rendu : fond sombre dégradé + livre ouvert, suréchantillonné 4× — */
const SS = 4;

function fillPoly(buf, S, pts, [r, g, b]) {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(S - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [xa, ya] = pts[i];
      const [xb, yb] = pts[(i + 1) % pts.length];
      if ((ya <= yc && yb > yc) || (yb <= yc && ya > yc)) {
        xs.push(xa + ((yc - ya) / (yb - ya)) * (xb - xa));
      }
    }
    xs.sort((a, c) => a - c);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xStart = Math.max(0, Math.round(xs[k]));
      const xEnd = Math.min(S - 1, Math.round(xs[k + 1]) - 1);
      for (let x = xStart; x <= xEnd; x++) {
        const o = (y * S + x) * 4;
        buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
      }
    }
  }
}

function renderIcon(size, glyphScale) {
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);

  // Fond : dégradé vertical discret, façon encre
  for (let y = 0; y < S; y++) {
    const t = y / S;
    const r = Math.round(36 - 14 * t);
    const g = Math.round(36 - 14 * t);
    const b = Math.round(39 - 14 * t);
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
    }
  }

  const cx = 0.5, cy = 0.53;
  const sc = (p) => [(cx + (p[0] - cx) * glyphScale) * S, (cy + (p[1] - cy) * glyphScale) * S];
  const paper = [245, 245, 247];
  const accent = [10, 132, 255];

  // Pages du livre ouvert (bords extérieurs relevés)
  const gap = 0.012;
  fillPoly(buf, S, [[0.18, 0.36], [0.5 - gap, 0.435], [0.5 - gap, 0.70], [0.18, 0.625]].map(sc), paper);
  fillPoly(buf, S, [[0.82, 0.36], [0.5 + gap, 0.435], [0.5 + gap, 0.70], [0.82, 0.625]].map(sc), paper);
  // Marque-page sur la page de droite
  fillPoly(buf, S, [[0.63, 0.395], [0.695, 0.41], [0.695, 0.56], [0.6625, 0.515], [0.63, 0.545]].map(sc), accent);

  // Sous-échantillonnage 4× (moyenne de bloc = anticrénelage)
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * S + x * SS + dx) * 4;
          r += buf[o]; g += buf[o + 1]; b += buf[o + 2];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return encodePNG(size, size, out);
}

for (const [name, size, scale] of [
  ['icon-180.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.82]
]) {
  writeFileSync(join(OUT, name), renderIcon(size, scale));
  console.log('✓', name);
}
