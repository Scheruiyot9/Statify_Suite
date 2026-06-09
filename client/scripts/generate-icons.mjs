/**
 * Generates PNG icons for the PWA manifest from the existing SVG icon.
 * Run once: node scripts/generate-icons.mjs
 * Requires: npm install -D sharp
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath   = path.join(__dirname, '../public/statify-icon.svg');
const outDir    = path.join(__dirname, '../public/icons');
const sizes     = [72, 96, 128, 144, 152, 192, 384, 512];

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const svgBuf = fs.readFileSync(svgPath);

for (const size of sizes) {
  await sharp(svgBuf)
    .resize(size, size)
    .png()
    .toFile(path.join(outDir, `icon-${size}.png`));
  console.log(`✓ icon-${size}.png`);
}

console.log('\nAll icons generated in public/icons/');
