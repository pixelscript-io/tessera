import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractContract } from '@tessera/compiler'
import { page, project, read, run } from './helpers'

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
