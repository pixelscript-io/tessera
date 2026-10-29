/**
 * The test that compares an imported component with the design. It is written next to the component and runs in a real
 * browser (the same Vitest browser setup as the generated accessibility tests).
 *
 * For every variant it mounts the component the way the design shows it, and checks two things:
 *
 *  - where things are: the box of the component and of each part, to within a pixel of the design's;
 *  - what they look like: the picture Figma made of that variant against a screenshot of the component, on white,
 *    leaving out the parts whose pixels depend on what the caller puts in (an icon) or on how the browser draws type.
 *    The share of pixels that differ must stay under the threshold in the map.
 */
export function fidelityTestFile(options: {
  name: string
  /** The folder of the design's files, relative to the test, with a trailing slash. */
  folder: string
  fonts: Array<{ family: string; file: string }>
}): string {
  const { name, folder, fonts } = options
  const fontImports = fonts.map((f, i) => `import font${i} from '${folder}${f.file}?url'`)
  const fontFaces = fonts
    .map(
      (f, i) =>
        "@font-face { font-family: '" +
        f.family +
        "'; src: url(${font" +
        i +
        '}); font-weight: 100 900; }',
    )
    .join(' ')
  return `/// <reference types="vite/client" />
import 'virtual:tessera/tokens.css'
import { userEvent } from 'vitest/browser'
import { page } from 'vitest/browser'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { flush, getRenderer, state } from '@pixelscriptio/tessera/core'
import ${name} from './${name}.tess'
import design from '${folder}${name}.figma.json'
${fontImports.join('\n')}

// Made by \`tessera figma import\`. It compares ${name} with the design in Figma: where each part is, and what it looks
// like. Run it with \`npm run test:a11y\` (the same browser setup).
const images = import.meta.glob('${folder}images/*.png', { query: '?url', eager: true, import: 'default' }) as Record<
  string,
  string
>
const r = getRenderer()
const PAD = 16
let dispose: (() => void) | undefined
let host: HTMLElement | undefined

${fonts.length ? `const style = document.createElement('style')\nstyle.textContent = \`${fontFaces}\`\ndocument.head.append(style)\n` : ''}
// The page the test runs in is shown at the size the window allows: a small one is not scaled down to fit.
beforeAll(async () => {
  await page.viewport(480, 600)
})

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = host = undefined
})

type Box = { x: number; y: number; width: number; height: number }

async function show(variant: (typeof design.variants)[number]) {
  host = document.createElement('div')
  host.style.cssText = \`position: fixed; left: 8px; top: 8px; padding: \${PAD}px; background: #fff; display: inline-block;\`
  document.body.append(host)
  const props = Object.fromEntries(Object.entries(variant.props).map(([k, v]) => [k, state(v)]))
  const disabled = state(variant.state === ':disabled')
  // What the design has in the slots: something the size of an icon, so the boxes can be compared.
  const slot = () => ['\\u200b']
  dispose = r.mount(host, () =>
    ${name}({
      props: { ...props, disabled },
      events: {},
      slots: {
        default: () => [design.sample],
        ...Object.fromEntries(design.slots.map((s: string) => [s, slot])),
      },
    }),
  )
  flush()
  const el = host.firstElementChild as HTMLElement
  if (variant.state === ':hover') await userEvent.hover(el)
  if (variant.state === ':focus-visible') {
    el.blur()
    await userEvent.tab()
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return el
}

const partBox = (el: HTMLElement, part: string): Box | null => {
  const node = part === 'root' ? el : el.querySelector<HTMLElement>(\`[class*="__\${part}"]\`)
  if (!node) return null
  const b = node.getBoundingClientRect()
  // Not shown: nothing, or a label cut down to a pixel (hidden from the eye, kept for a screen reader).
  if (b.width <= 1 && b.height <= 1) return null
  const o = el.getBoundingClientRect()
  return { x: b.x - o.x, y: b.y - o.y, width: b.width, height: b.height }
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load ' + src.slice(0, 80)))
    img.src = src
  })

const pixels = (img: HTMLImageElement, width: number, height: number, at: { x: number; y: number }, w: number, h: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, width, height)
  g.drawImage(img, at.x, at.y, w, h)
  return g.getImageData(0, 0, width, height).data
}

describe('${name} against the design', () => {
  for (const variant of design.variants) {
    it(\`has the boxes of \${variant.name}\`, async () => {
      const el = await show(variant)
      // Across, a pixel, and a little more for the type: the browser sets the same font a few percent wider or narrower
      // than the design's tool does, and every box that holds or follows the label moves with it.
      const across = 1 + 0.04 * ((variant.boxes as Record<string, Box | null>).label?.width ?? 0)
      const close = (a: number, b: number, tolerance = 1) => Math.abs(a - b) <= tolerance
      const got = Object.fromEntries(design.parts.map((p) => [p, partBox(el, p)]))
      for (const part of design.parts) {
        const want = (variant.boxes as Record<string, Box | null>)[part]
        const have = got[part]
        if (!want) {
          expect(have, \`\${part} should not be shown\`).toBeNull()
          continue
        }
        expect(have, \`\${part} should be shown\`).not.toBeNull()
        expect(
          close(have!.width, want.width, across) &&
            close(have!.height, want.height) &&
            close(have!.x, want.x, across) &&
            close(have!.y, want.y),
          \`\${part} is at \${JSON.stringify(have)} and the design has \${JSON.stringify(want)}\`,
        ).toBe(true)
      }
    })
  }

  for (const variant of design.variants) {
    const url = images['${folder}images/' + variant.file]
    if (!url) continue
    it(\`looks like \${variant.name}\`, async () => {
      const el = await show(variant)
      const { bleed } = variant
      // The picture of the design, placed where the component's box is, and a screenshot of the component's host.
      const shot = await page.screenshot({ element: host!, save: false, base64: true })
      const ours = await load('data:image/png;base64,' + (typeof shot === 'string' ? shot : (shot as { base64: string }).base64))
      const theirs = await load(url)
      // The screenshot is of the host, in the pixels of the screen it was taken on: compare at that size.
      const frame = host!.getBoundingClientRect()
      const w = ours.naturalWidth
      const h = ours.naturalHeight
      const s = w / frame.width
      const a = pixels(ours, w, h, { x: 0, y: 0 }, w, h)
      const b = pixels(
        theirs,
        w,
        h,
        { x: (PAD - bleed.left) * s, y: (PAD - bleed.top) * s },
        (theirs.naturalWidth / 2) * s,
        (theirs.naturalHeight / 2) * s,
      )
      const skip = new Uint8Array(w * h)
      for (const box of variant.ignore) {
        for (let y = Math.max(0, Math.floor((PAD + box.y) * s - 1)); y < Math.min(h, Math.ceil((PAD + box.y + box.height) * s + 1)); y++)
          for (let x = Math.max(0, Math.floor((PAD + box.x) * s - 1)); x < Math.min(w, Math.ceil((PAD + box.x + box.width) * s + 1)); x++)
            skip[y * w + x] = 1
      }
      // A pixel is different when nothing within a pixel of it in the other picture is close to it: an edge that is half a
      // pixel apart is two programs drawing the same edge, not another design (the boxes are held to a pixel above).
      const near = (p: Uint8ClampedArray, q: Uint8ClampedArray, x: number, y: number) => {
        const i = (y * w + x) * 4
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const j = (ny * w + nx) * 4
            if (
              Math.max(
                Math.abs(p[i]! - q[j]!),
                Math.abs(p[i + 1]! - q[j + 1]!),
                Math.abs(p[i + 2]! - q[j + 2]!),
              ) <= 24
            )
              return true
          }
        return false
      }
      let different = 0
      let compared = 0
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (skip[y * w + x]) continue
          compared++
          if (!near(a, b, x, y) && !near(b, a, x, y)) different++
        }
      const share = different / Math.max(1, compared)
      expect(
        share,
        \`\${variant.name}: \${(share * 100).toFixed(2)}% of the pixels differ from the design (the most allowed is \${design.threshold * 100}%)\`,
      ).toBeLessThanOrEqual(design.threshold)
    })
  }
})
`
}
