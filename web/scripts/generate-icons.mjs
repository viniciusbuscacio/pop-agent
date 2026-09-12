import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/**
 * Generates the PNG app icons from the Lucide Balloon glyph.
 *
 * The previous Tabler P assets remain in web/public as icon-p-backup-* so the
 * original icon can be restored without reconstructing it from git history.
 * See THIRD_PARTY_NOTICES.md for the icon licenses.
 *
 * Run: node web/scripts/generate-icons.mjs
 */

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function iconSvg(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
    <rect width="64" height="64" fill="#22262e"/>
    <g transform="translate(8 8) scale(2)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 16v1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v1"/>
      <path d="M12 6a2 2 0 0 1 2 2"/>
      <path d="M18 8c0 4-3.5 8-6 8s-6-4-6-8a6 6 0 0 1 12 0"/>
    </g>
  </svg>`);
}

mkdirSync(OUT_DIR, { recursive: true });

const icons = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-192.png', 192],
  ['icon-maskable-512.png', 512],
  ['apple-touch-icon.png', 180],
];

for (const [name, size] of icons) {
  await sharp(iconSvg(size)).png().toFile(join(OUT_DIR, name));
  console.log(`wrote ${name} (${String(size)}px)`);
}
