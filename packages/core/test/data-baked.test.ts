import { afterEach, describe, expect, it } from 'vitest'
import { clearAllApis, createApi, createRoot, dataScript, flush, seedFromDocument } from '../src'

// The data a page declares is written into its HTML by the prerender and read back before the page first renders.
const documentWith = (text: string | null) => ({
  getElementById: (id: string) =>
    id === 'tessera-data' && text !== null ? { textContent: text } : null,
})

afterEach(() => clearAllApis())

describe('dataScript: the answers as a script the browser does not run', () => {
  it('is a JSON script with the id the page looks for, and nothing at all when there is no data', () => {
    expect(dataScript([])).toBe('')
    const html = dataScript([{ url: '/api/posts', data: [{ id: 1 }] }])
    expect(html).toBe(
      '<script type="application/json" id="tessera-data">{"v":1,"entries":[{"url":"/api/posts","data":[{"id":1}]}]}</script>',
    )
  })

  it('cannot end the script, start a comment or be read as markup, whatever the data says', () => {
    const html = dataScript([
      { url: '/x', data: '</script><script>alert(1)</script><!-- & \u2028 \u2029' },
    ])
    const inner = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))
    expect(inner).not.toContain('<')
    expect(inner).not.toContain('>')
    expect(inner).not.toContain('&')
    expect(inner).not.toMatch(/[\u2028\u2029]/)
    // And reads back as what it was.
    expect(JSON.parse(inner).entries[0].data).toBe(
      '</script><script>alert(1)</script><!-- & \u2028 \u2029',
    )
  })
})

describe('seedFromDocument', () => {
  it('gives the answers to the reads that come, as if they had been fetched', () => {
    const html = dataScript([{ url: '/api/posts', data: ['a', 'b'] }])
    const text = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))
    seedFromDocument(documentWith(text))
    const api = createApi({
      base: '/api',
      fetch: (() => Promise.reject(new Error('no request'))) as never,
    })
    const posts = createRoot(() => api.get<string[]>('/posts'))
    flush()
    expect(posts.data.value).toEqual(['a', 'b'])
    expect(posts.loading.value).toBe(false)
  })

  it.each([
    ['there is no script', null],
    ['it is empty', ''],
    ['it is not JSON', 'oops {'],
    ['it is not what was written', '{"v":2,"entries":[]}'],
    ['the entries are not a list', '{"v":1,"entries":{"url":"/x"}}'],
    ['it is a list', '[1]'],
  ])('does nothing when %s, and does not throw', (_name, text) => {
    expect(() => seedFromDocument(documentWith(text))).not.toThrow()
  })

  it('uses what is valid in a list that has something that is not', () => {
    seedFromDocument(documentWith('{"v":1,"entries":[null,{"url":5},{"url":"/ok","data":1}]}'))
    const api = createApi({ fetch: (() => Promise.reject(new Error('no request'))) as never })
    const ok = createRoot(() => api.get('/ok'))
    flush()
    expect(ok.data.value).toBe(1)
  })
})
