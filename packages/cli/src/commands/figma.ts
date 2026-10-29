import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Args } from '../args'
import { flag, has } from '../args'
import { fetchComponentSet, fetchImages, parseSource, tokenFromEnv } from '../figma/fetch'
import { fidelityTestFile } from '../figma/fidelity'
import { importComponentSet } from '../figma/import'
import { inferMap } from '../figma/infer'
import { a11y } from './a11y'
import { presetFiles } from './init'
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
      'Available: tessera figma import --url <link>',
    )
  }
  // The map is optional: the design says almost everything, and what it says is written next to the component so it
  // can be changed and used again.
  const mapPath = flag(args, 'map')
  let map = typeof mapPath === 'string' ? readJson<FigmaMap>(io, mapPath, 'map') : undefined
  const component = flag(args, 'component')

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
      file = await fetchComponentSet(
        source,
        map?.component ?? (typeof component === 'string' ? component : undefined),
        token,
      )
    }
    const inferred = map === undefined
    map ??= inferMap(file)

    // Where the files go, and the tokens an earlier import wrote: the tokens of every component of a design are in one
    // file, so this import adds to it, and takes the colors it shares.
    const project = await openProject(io.cwd, args)
    const tokensFile = join(project.tokensDirOrDefault(), 'figma.tokens.json')
    let earlierTokens: Record<string, unknown> | undefined
    if (existsSync(tokensFile)) {
      try {
        earlierTokens = JSON.parse(readFileSync(tokensFile, 'utf8')) as Record<string, unknown>
      } catch {
        throw new CliError(
          `The file ${shown(io, tokensFile)} is not valid JSON, so the tokens in it cannot be added to.`,
          'Fix it, or move it away, and run the import again.',
        )
      }
    }
    const result = importComponentSet(file, map, earlierTokens)
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

    const given = flag(args, 'out')
    const components =
      typeof given === 'string'
        ? resolve(io.cwd, given)
        : join(
            project.root,
            FOLDERS.find((f) => existsSync(join(project.root, f))) ?? 'app/components',
          )
    const design = join(components, 'figma', map.name)
    // A file is written again when the person says so, when an earlier import wrote it, or when it is the starter's own
    // (the Button the project began with): importing a design is what replaces that.
    const starters = new Set(
      ['tailwind', 'unstyled'].flatMap((preset) =>
        Object.values(presetFiles(preset as 'tailwind')),
      ),
    )
    const earlier = existsSync(join(design, map.name + '.figma.json'))
    const replace = has(args, 'replace') || earlier
    const replaceable = (abs: string) =>
      replace || (existsSync(abs) && starters.has(readFileSync(abs, 'utf8')))

    const wrote: string[] = []
    const left: string[] = []
    const put = (abs: string, content: string | Uint8Array) => {
      if (existsSync(abs) && !replaceable(abs)) {
        left.push(shown(io, abs))
        return
      }
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
      wrote.push(shown(io, abs))
    }

    put(join(components, map.name + '.tess'), result.tess)
    // The starter's notes on its own Button describe a component that is no longer there.
    const notes = join(components, map.name + '.docs.md')
    if (existsSync(notes) && starters.has(readFileSync(notes, 'utf8'))) {
      rmSync(notes)
      wrote.push(shown(io, notes) + ' (removed: it described the starter Button)')
    }
    if (inferred) put(join(design, 'figma.map.json'), JSON.stringify(map, null, 2) + '\n')
    // The tokens file holds those of every import, so it is written again whatever is in it.
    mkdirSync(dirname(tokensFile), { recursive: true })
    writeFileSync(tokensFile, JSON.stringify(result.tokens, null, 2) + '\n')
    wrote.push(shown(io, tokensFile))
    put(
      join(design, `${map.name}.figma.json`),
      JSON.stringify(
        {
          name: map.name,
          sample: map.sample ?? map.name,
          parts: Object.keys(map.parts),
          kind: map.kind,
          slots: Object.keys(map.slots ?? {}),
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
        : resolve(dirname(resolve(io.cwd, String(mapPath))), font.file)
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

    // The tests that come with it need the browser setup of `tessera a11y`; it is done here, and never overwrites a file.
    const quiet: Io = { ...io, out: () => {}, err: () => {}, ui: undefined }
    await a11y({ positional: [], flags: new Map() }, quiet).catch(() => 1)

    const ui = io.ui
    const r = result.report
    const note = inferred
      ? 'The map was worked out from the design and is in ' +
        shown(io, join(design, 'figma.map.json')) +
        '; use it with --map to change what it says.'
      : undefined
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
      if (note) io.out(ui.dim('  ' + note))
      io.out('')
      io.out(ui.heading('Next'))
      io.out(`  ${ui.dim('1')}  ${ui.bold('npm install')}`)
      io.out(
        `  ${ui.dim('2')}  ${ui.bold('npm run dev')}  ${ui.dim('and open the docs to see ' + map.name)}`,
      )
      io.out(
        `  ${ui.dim('3')}  ${ui.bold('npm run test:a11y')}  ${ui.dim('to test it against the design')}`,
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
    if (note) io.out(note)
    io.out('Next: npm install, npm run dev (and open the docs), npm run test:a11y.')
    return 0
  } catch (error) {
    if (error instanceof FigmaError)
      throw new CliError(`${error.code}: ${error.message}`, error.hint)
    throw error
  }
}
