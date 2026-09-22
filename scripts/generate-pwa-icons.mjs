// One-off icon generation from the existing brand mark (public/favicon.svg) -- not wired into
// the regular build, icons change rarely. Re-run manually with `node scripts/generate-pwa-icons.mjs`
// if the logo ever changes.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.resolve(__dirname, '../public')
const svgPath = path.join(publicDir, 'favicon.svg')
const svg = readFileSync(svgPath)

// White, not the brand purple -- the logo itself is purple/blue, so a purple background gives
// almost no contrast (confirmed by eye on the first generated pass).
const MASKABLE_BACKGROUND = '#ffffff'

async function main() {
  await sharp(svg, { density: 384 })
    .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(path.join(publicDir, 'icon-192.png'))

  await sharp(svg, { density: 1024 })
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toFile(path.join(publicDir, 'icon-512.png'))

  // Maskable: logo at ~60% scale, centered, on a solid brand-color background so Android's
  // adaptive-icon mask (which can crop up to ~20% from each edge) never clips the mark.
  const maskableLogo = await sharp(svg, { density: 1024 })
    .resize(307, 307, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer()

  await sharp({
    create: { width: 512, height: 512, channels: 4, background: MASKABLE_BACKGROUND },
  })
    .composite([{ input: maskableLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(publicDir, 'icon-512-maskable.png'))

  console.log('Generated icon-192.png, icon-512.png, icon-512-maskable.png in public/')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
