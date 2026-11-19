const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  // usage: node scripts/build-icons.cjs [opaque.png] [transparent.png]; defaults to the copies in art/
  const art = path.resolve(__dirname, '../art');
  // Home-screen icons must be opaque (iOS paints transparency black); tab favicons look better transparent.
  const source = process.argv[2] ?? path.join(art, 'multistream-original.png');
  const tab = process.argv[3] ?? path.join(art, 'multistream-transparent.png');
  const dest = path.resolve(__dirname, '../public');
  await fs.mkdir(path.join(dest, 'icons'), { recursive: true });
  for (const [from, name, size] of [
    [source, 'apple-touch-icon.png', 180], [source, 'icons/icon-192.png', 192], [source, 'icons/icon-512.png', 512],
    [tab, 'icons/favicon-16.png', 16], [tab, 'icons/favicon-32.png', 32],
  ]) {
    await sharp(from).resize(size, size).png().toFile(path.join(dest, name));
  }
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map(size => sharp(tab).resize(size, size).png().toBuffer()));
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = sizes[i];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await fs.writeFile(path.join(dest, 'favicon.ico'), Buffer.concat([header, ...pngs]));
  console.log('Created five PNG sizes and a three-size ICO.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
