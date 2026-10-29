import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Args } from '../args'
import { flag, has } from '../args'
import { fetchComponentSet, fetchImages, parseSource, tokenFromEnv } from '../figma/fetch'
import { fidelityTestFile } from '../figma/fidelity'
import { importComponentSet } from '../figma/import'
import { FigmaError, type ComponentSetFile, type FigmaMap } from '../figma/model'
import type { Io } from '../io'
import { CliError } from '../io'
import { openProject } from '../project'

const forward = (p: string) => p.replaceAll('\\', '/')

const FOLDERS = ['system/components', 'app/components']

function readJson<T>(io: Io, path: string, what: string): T {
  const abs = resolve(io.cwd, path)
  if (!existsSync(abs)) throw new CliError(`There is no ${what} at "${path}".`)
  try {
    return JSON.parse(readFileSync(abs, 'utf8')) as T
  } catch (error) {
    throw new CliError(
      `The ${what} "${path}" is not valid JSON.`,
      error instanceof Error ? error.message : undefined,
    )
  }
}

/** The part of a path under the working folder, so a file the import writes is named as the user would. */
const shown = (io: Io, abs: string) => forward(relative(io.cwd, abs))

/**
 * `tessera figma import`: turn one component set of a Figma file into a component. It reads the set (from Figma, with a
 * token in FIGMA_TOKEN, or from a saved response), makes the component, the tokens it needs, and a test that compares
 * the component with the design, and writes them. It never overwrites a file unless `--replace` is given.
 */
export async function figma(args: Args, io: Io): Promise<number> {
  const [sub] = args.positional
  if (sub !== 'import') {
    throw new CliError(
      sub ? `Unknown figma command "${sub}".` : 'Say what to do with Figma.',
      'Available: tessera figma import --map <file> (--url <link> | --from-json <file>)',
    )
  }
  const mapPath = flag(args, 'map')
  if (typeof mapPath !== 'string')
    throw new CliError(
      'Say which map to use: --map <file>.',
      'The map says which Figma component set becomes which component, and what its parts, props and states are.',
    )
  const map = readJson<FigmaMap>(io, mapPath, 'map')

  try {
    // Where the data comes from.
    const saved = flag(args, 'from-json')
    let file: ComponentSetFile
    let images = new Map<string, Uint8Array>()
    let token: string | undefined
    if (typeof saved === 'string') {
      file = readJson<ComponentSetFile>(io, saved, 'saved response')
    } else {
      token = tokenFromEnv()
      const url = flag(args, 'url')
      const source = parseSource(
        typeof url === 'string' ? url : undefined,
        typeof flag(args, 'file') === 'string' ? String(flag(args, 'file')) : undefined,
        typeof flag(args, 'node') === 'string' ? String(flag(args, 'node')) : undefined,
      )
      file = await fetchComponentSet(source, map.component, token)
    }

    const result = importComponentSet(file, map)
    if (has(args, 'strict') && result.report.unbound.length) {
      throw new FigmaError(
        'F014',
        `${result.report.unbound.length} value${result.report.unbound.length === 1 ? ' has' : 's have'} no style in the design, so ${result.report.unbound.length === 1 ? 'it has' : 'they have'} no name for a token:\n${result.report.unbound.map((u) => `  ${u}`).join('\n')}`,
        'Give them styles in Figma, or run again without --strict to get tokens named from their values.',
      )
    }

    // Figma's own picture of each variant, for the comparison, unless a saved response has them next to it.
    const wantImages = !has(args, 'no-images') && typeof saved !== 'string'
    if (wantImages) {
      images = await fetchImages(
        file.fileKey ?? '',
        result.variants.map((v) => v.id),
        token!,
      )
    }

    // Where the files go.
    const project = await openProject(io.cwd, args)
    const given = flag(args, 'out')
    const components =
      typeof given === 'string'
        ? resolve(io.cwd, given)
        : join(
            project.root,
            FOLDERS.find((f) => existsSync(join(project.root, f))) ?? 'app/components',
          )
    const tokensDir = project.tokensDirOrDefault()
    const design = join(components, 'figma', map.name)
    const replace = has(args, 'replace')

    const wrote: string[] = []
    const left: string[] = []
    const put = (abs: string, content: string | Uint8Array) => {
      if (existsSync(abs) && !replace) {
        left.push(shown(io, abs))
        return
      }
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
      wrote.push(shown(io, abs))
    }

    put(join(components, `${map.name}.tess`), result.tess)
    put(join(tokensDir, 'figma.tokens.json'), JSON.stringify(result.tokens, null, 2) + '\n')
    put(
      join(design, `${map.name}.figma.json`),
      JSON.stringify(
        {
          name: map.name,
          sample: map.sample ?? map.name,
          parts: Object.keys(map.parts),
          threshold: map.fidelity?.threshold ?? 0.01,
          variants: result.variants,
        },
        null,
        2,
      ) + '\n',
    )
    for (const variant of result.variants) {
      const png = images.get(variant.id)
      if (png) put(join(design, 'images', variant.file), png)
    }
    // The design's fonts, as files the map points to (relative to the map), so the comparison draws the same type.
    const fonts = (map.fidelity?.fonts ?? []).map((f) => ({ ...f, file: forward(f.file) }))
    for (const font of fonts) {
      const from = isAbsolute(font.file)
        ? font.file
        : resolve(dirname(resolve(io.cwd, mapPath)), font.file)
      if (!existsSync(from))
        throw new CliError(`The font file "${font.file}" in the map is not there.`)
      put(join(design, 'fonts', font.file.split('/').pop()!), readFileSync(from))
    }
    put(
      join(components, `${map.name}.figma.browser.test.ts`),
      fidelityTestFile({
        name: map.name,
        folder: `./figma/${map.name}/`,
        fonts: fonts.map((f) => ({ family: f.family, file: `fonts/${f.file.split('/').pop()!}` })),
      }),
    )

    const ui = io.ui
    const r = result.report
    if (ui) {
      io.out(ui.ok(ui.bold(`Imported ${map.name} from Figma`)))
      io.out('')
      for (const f of wrote) io.out(`  ${ui.green(ui.sym.ok)} ${f}`)
      for (const f of left)
        io.out(`  ${ui.dim(`${ui.sym.bullet} ${f} (already there; --replace writes it again)`)}`)
      io.out('')
      for (const line of r.mapped) io.out(`  ${ui.dim(ui.sym.bullet)} ${line}`)
      io.out(
        `  ${ui.dim(ui.sym.bullet)} ${r.tokens.length} tokens made from the design's styles and values`,
      )
      for (const line of r.skipped) io.out(`  ${ui.warn(line)}`)
      if (r.unbound.length)
        io.out(
          ui.dim(
            `  ${r.unbound.length} value${r.unbound.length === 1 ? '' : 's'} had no style in Figma, so ${r.unbound.length === 1 ? 'its token is' : 'their tokens are'} named from the value. Use --strict to stop on these.`,
          ),
        )
      io.out('')
      io.out(ui.heading('Next'))
      io.out(`  ${ui.dim('1')}  ${ui.bold('npx tessera check')}`)
      io.out(
        `  ${ui.dim('2')}  ${ui.bold('npx tessera a11y')}  ${ui.dim('(once), then')} ${ui.bold('npm run test:a11y')}`,
      )
      return 0
    }
    io.out(`Imported ${map.name} from Figma.`)
    if (wrote.length) io.out(`Wrote: ${wrote.join(', ')}`)
    if (left.length)
      io.out(`Left alone (already there; --replace writes it again): ${left.join(', ')}`)
    for (const line of r.mapped) io.out(`- ${line}`)
    io.out(`- ${r.tokens.length} tokens made from the design's styles and values`)
    for (const line of r.skipped) io.out(`Skipped: ${line}`)
    return 0
  } catch (error) {
    if (error instanceof FigmaError)
      throw new CliError(`${error.code}: ${error.message}`, error.hint)
    throw error
  }
}
