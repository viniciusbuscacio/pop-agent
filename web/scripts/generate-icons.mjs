import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Generates the placeholder app icons: an accent tile with a blocky "P".
 *
 * Written by hand rather than pulled from an image library because the icons
 * are a placeholder until the mascot is designed (popy.spec §14), and a
 * hundred lines of PNG encoding is cheaper than a build dependency that exists
 * to draw four rectangles.
 *
 * Run: node web/scripts/generate-icons.mjs
 */

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const ACCENT = [0x4c, 0xc2, 0xff, 0xff];
const INK = [0x00, 0x3a, 0x5c, 0xff];

/** Icons Android may crop to any shape need their art inside a safe circle. */
const MASKABLE_SCALE = 0.7;

function draw(size, scale) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    pixels.set(ACCENT, i * 4);
  }

  const put = (x, y, w, h) => {
    for (let row = Math.round(y); row < Math.round(y + h); row += 1) {
      for (let col = Math.round(x); col < Math.round(x + w); col += 1) {
        if (row < 0 || col < 0 || row >= size || col >= size) continue;
        pixels.set(INK, (row * size + col) * 4);
      }
    }
  };

  // A "P": stem, top bar, middle bar, and the short right edge joining them.
  const box = size * scale;
  const originX = (size - box) / 2;
  const originY = (size - box) / 2;
  const stroke = box * 0.16;
  const bowl = box * 0.55;
  const bowlHeight = box * 0.42;

  put(originX, originY, stroke, box);
  put(originX, originY, bowl, stroke);
  put(originX, originY + bowlHeight, bowl, stroke);
  put(originX + bowl - stroke, originY, stroke, bowlHeight + stroke);

  return pixels;
}

function png(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row += 1) {
    raw[row * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT_DIR, { recursive: true });

const icons = [
  ['icon-192.png', 192, 0.52],
  ['icon-512.png', 512, 0.52],
  ['icon-maskable-512.png', 512, 0.52 * MASKABLE_SCALE],
  ['apple-touch-icon.png', 180, 0.52],
];

for (const [name, size, scale] of icons) {
  writeFileSync(join(OUT_DIR, name), png(size, draw(size, scale)));
  console.log(`wrote ${name} (${String(size)}px)`);
}
