import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractContract } from '@tessera/compiler'
import { page, project, read, run, write } from './helpers'

const BUTTON = readFileSync(
  fileURLToPath(new URL('../../../packages/ui/components/Button.tess', import.meta.url)),
  'utf8',
)

/** A project with the system's Button in a `system/` folder that has a version. */
const withSystem = () => {
  const root = project({ 'app/pages/index.tess': page() })
  write(root, 'system/components/Button.tess', BUTTON)
  write(root, 'system/package.json', JSON.stringify({ name: 'system', version: '0.4.2' }))
  return root
}

describe('tessera new component', () => {
  it('creates a component that passes check as it is', async () => {
    const root = project({ 'app/pages/index.tess': page('<UserCard>Hi</UserCard>') })
    const { code, out } = await run(root, 'new', 'component', 'UserCard')
    expect(code).toBe(0)
    expect(out).toContain('Created app/components/UserCard.tess.')
    const contract = extractContract(read(root, 'app/components/UserCard.tess'), 'UserCard.tess')
    expect(contract?.name).toBe('UserCard')
    // Used in a page with no import, and clean.
    expect((await run(root, 'check')).code).toBe(0)
  })

  it('refuses a bad name, an existing component, and a name another component has', async () => {
    const root = project({ 'app/pages/index.tess': page() })
    expect((await run(root, 'new', 'component', 'userCard')).err).toContain(
      '"userCard" is not a valid component name.',
    )
    await run(root, 'new', 'component', 'Card')
    const again = await run(root, 'new', 'component', 'Card')
    expect(again.code).toBe(1)
    expect(again.err).toContain('A component named Card already exists (app/components/Card.tess).')
  })

  it('says how to use the command when given nothing', async () => {
    const root = project({ 'app/pages/index.tess': page() })
    const { code, err } = await run(root, 'new')
    expect(code).toBe(1)
    expect(err).toContain('Say what to create.')
  })
})

describe('tessera new page', () => {
  it('creates a page for the route its path implies, and the result passes check', async () => {
    const root = project({ 'app/pages/index.tess': page() })
    const made = await run(root, 'new', 'page', 'blog/[slug]')
    expect(made.out).toContain('Created app/pages/blog/[slug].tess for /blog/:slug.')
    expect(read(root, 'app/pages/blog/[slug].tess')).toContain('{ "title": "Slug" }')
    expect((await run(root, 'check')).code).toBe(0)
  })

  it('titles the home page and a folder default sensibly', async () => {
    const root = project({})
    await run(root, 'new', 'page', 'index')
    expect(read(root, 'app/pages/index.tess')).toContain('"title": "Home"')
    await run(root, 'new', 'page', 'blog/index')
    expect(read(root, 'app/pages/blog/index.tess')).toContain('"title": "Blog"')
  })

  it('refuses a page that would conflict with another route, naming both files', async () => {
    const root = project({ 'app/pages/blog/index.tess': page() })
    const { code, err } = await run(root, 'new', 'page', 'blog')
    expect(code).toBe(1)
    expect(err).toContain('Route conflict: blog.tess and blog/index.tess both map to "/blog".')
    expect(existsSync(join(root, 'app/pages/blog.tess'))).toBe(false)
  })

  it('refuses a page name that cannot be a route, and one that exists', async () => {
    const root = project({ 'app/pages/about.tess': page() })
    expect((await run(root, 'new', 'page', 'my page')).err).toContain(
      '"my page" is not a valid route segment.',
    )
    expect((await run(root, 'new', 'page', 'about')).err).toContain('already exists')
  })

  it('accepts a leading slash and a .tess ending', async () => {
    const root = project({})
    await run(root, 'new', 'page', '/team/people.tess')
    expect(existsSync(join(root, 'app/pages/team/people.tess'))).toBe(true)
  })
})

describe('tessera eject', () => {
  it('copies a system component under a new name and records forkedFrom', async () => {
    const root = withSystem()
    const { code, out } = await run(root, 'eject', 'Button', 'FancyButton')
    expect(code).toBe(0)
    expect(out).toContain('Created app/components/FancyButton.tess, forked from Button@0.4.2.')

    const source = read(root, 'app/components/FancyButton.tess')
    const contract = extractContract(source, 'FancyButton.tess')!
    expect(contract.name).toBe('FancyButton')
    expect(contract.forkedFrom).toEqual({ component: 'Button', version: '0.4.2' })
    // Everything else, comments included, is the original.
    expect(source).toContain('// first value is the default')
    expect(source).toContain('"role": "button"')
    expect(source).toContain('<button class="root"')
  })

  it('produces a working component: it passes check and can be used by tag', async () => {
    const root = withSystem()
    await run(root, 'eject', 'Button', 'FancyButton')
    write(
      root,
      'app/pages/index.tess',
      page('<FancyButton tone="danger">Go</FancyButton><Button>Original</Button>'),
    )
    const { code, out } = await run(root, 'check')
    expect(out).toContain('0 errors')
    expect(code).toBe(0)
    // The copy is scoped under its own name, so the two do not share styles.
    const { Project } = await import('@tessera/compiler/project')
    const checked = new Project(root, { tokens: join(root, '..', 'nope') }).compileFile(
      join(root, 'app/components/FancyButton.tess'),
      read(root, 'app/components/FancyButton.tess'),
    )
    expect(checked.result.code).toContain('t-FancyButton__root')
  })

  it('refuses unknown components, names that are taken, bad names and your own components', async () => {
    const root = withSystem()
    expect((await run(root, 'eject', 'Nope', 'X')).err).toContain(
      'There is no component named Nope.',
    )
    expect((await run(root, 'eject', 'Button', 'button')).err).toContain(
      '"button" is not a valid component name.',
    )
    expect((await run(root, 'eject', 'Button', 'Button')).err).toContain(
      'A component named Button already exists',
    )
    await run(root, 'eject', 'Button', 'Mine')
    const again = await run(root, 'eject', 'Mine', 'Other')
    expect(again.code).toBe(1)
    expect(again.err).toContain('Mine is already your own component')
    expect((await run(root, 'eject', 'Button')).err).toContain('Say which component to copy')
  })

  it('keeps a lineage when a fork is forked from the system again', async () => {
    const root = withSystem()
    await run(root, 'eject', 'Button', 'A')
    // Pretend the copy lives in the system folder, then eject it: forkedFrom is replaced, not duplicated.
    write(root, 'system/components/A.tess', read(root, 'app/components/A.tess'))
    const { rmSync } = await import('node:fs')
    rmSync(join(root, 'app/components/A.tess'))
    await run(root, 'eject', 'A', 'B')
    const contract = extractContract(read(root, 'app/components/B.tess'), 'B.tess')!
    expect(contract.forkedFrom).toEqual({ component: 'A', version: '0.4.2' })
    expect(read(root, 'app/components/B.tess').match(/forkedFrom/g)).toHaveLength(1)
  })
})

describe('tessera eject: a component of the library', () => {
  const ui = fileURLToPath(new URL('../../ui', import.meta.url))
  /** A project with a design system and the component library installed. */
  const withLibrary = () => {
    const root = project({ 'app/pages/index.tess': page() })
    write(root, 'system/tokens/base.tokens.json', '{}')
    mkdirSync(join(root, 'node_modules/@pixelscriptio'), { recursive: true })
    symlinkSync(ui, join(root, 'node_modules/@pixelscriptio/tessera-ui'), 'junction')
    return root
  }

  it('copies it under its own name, which then replaces the library component', async () => {
    const root = withLibrary()
    const { code, out } = await run(root, 'eject', 'Button')
    expect(code).toBe(0)
    expect(out).toContain('Created app/components/Button.tess, forked from Button@')
    const contract = extractContract(read(root, 'app/components/Button.tess'), 'Button.tess')
    expect(contract?.name).toBe('Button')
    expect(contract?.forkedFrom?.component).toBe('Button')
    // The project's Button wins, without a duplicate-name error.
    const again = await run(root, 'eject', 'Button')
    expect(again.code).toBe(1)
    expect(again.err).toContain('Button is already your own component')
  })

  it('still copies it under a new name', async () => {
    const root = withLibrary()
    expect((await run(root, 'eject', 'Button', 'FancyButton')).code).toBe(0)
    expect(existsSync(join(root, 'app/components/FancyButton.tess'))).toBe(true)
  })
})
