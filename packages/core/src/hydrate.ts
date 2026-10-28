import type { RendererAdapter } from './adapter'

/**
 * Hydration: the page was rendered to HTML ahead of time (by `tessera build --prerender`, with the string adapter
 * writing `data-h="n"` on each element, n being the order the render made them), and the first render in the browser
 * takes the elements that are already there instead of making new ones. They keep what the person did to them while the
 * script loaded (typed text, focus, scroll), and nothing is rebuilt. The render runs exactly as it would have: only
 * `createElement` answers differently, with the element of that number, and the inserts that put it where it already is
 * do nothing.
 *
 * The page the server wrote and the page the app makes must be the same. They are, when the same data is there (the
 * data a page declares is written into the page and used for the first render). When they are not, hydration says so
 * (`finish` throws a `HydrationMismatch`) and the caller renders again from nothing: showing the right page matters
 * more than keeping the old elements.
 */
export class HydrationMismatch extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HydrationMismatch'
  }
}

export interface HydrationAdapter extends RendererAdapter<Node, Element> {
  /**
   * Call when the first render is done. Checks that every element and every piece of text of the HTML was taken, and
   * throws `HydrationMismatch` (naming the first difference) if not. After it, the adapter makes elements as usual.
   */
  finish(): void
  /** Stop taking elements from the HTML: everything is made fresh from now on. */
  abort(): void
}

const describe = (node: Node | undefined): string => {
  if (!node) return 'nothing'
  if (node.nodeType === 1) return `<${(node as Element).localName}>`
  if (node.nodeType === 3) return `the text "${((node as Text).data ?? '').slice(0, 40)}"`
  return 'something else'
}

/**
 * An adapter that hydrates `container` through `inner`: used for the first render, then it is `inner`. A difference
 * between the HTML and the render does not throw while the render runs (an error there could be swallowed, or break a
 * render halfway): it is remembered, the rest is made fresh, and `finish` reports it.
 */
export function createHydrationAdapter(
  inner: RendererAdapter<Node, Element>,
  container: Element,
): HydrationAdapter {
  let active = true
  let failure: HydrationMismatch | undefined
  let counter = 0

  /** The elements of the HTML, by the number the server gave them. */
  const claims = new Map<number, Element>()
  for (const element of container.querySelectorAll('[data-h]')) {
    const n = Number(element.getAttribute('data-h'))
    if (Number.isInteger(n) && n > 0 && !claims.has(n)) claims.set(n, element)
  }
  const adopted = new WeakSet<Node>()
  /** The nodes of the HTML still to be matched, for the container and each element taken from it, in order. */
  const waiting = new Map<Node, ChildNode[]>([[container, [...container.childNodes]]])

  const fail = (message: string) => {
    failure ??= new HydrationMismatch(message)
    active = false
  }

  return {
    ...inner,

    createElement(tag, namespace) {
      if (!active) return inner.createElement(tag, namespace)
      const n = ++counter
      const found = claims.get(n)
      // No element has this number: the server made it and threw it away, as the render does again here.
      if (!found) return inner.createElement(tag, namespace)
      if (found.localName !== tag && found.localName !== tag.toLowerCase()) {
        fail(`The page has <${found.localName}> where the app makes <${tag}>.`)
        return inner.createElement(tag, namespace)
      }
      claims.delete(n)
      found.removeAttribute('data-h')
      adopted.add(found)
      waiting.set(found, [...found.childNodes])
      return found
    },

    insert(parent, node, anchor) {
      const queue = active ? waiting.get(parent) : undefined
      // A fresh subtree, or hydration is over: an insert is an insert.
      if (!queue) return inner.insert(parent, node, anchor)

      if (node.nodeType === 3) {
        const text = (node as Text).data
        // The empty text that marks where a list or a condition goes is not in the HTML, which cannot hold it.
        if (text === '') return inner.insert(parent, node, anchor)
        const head = queue[0]
        // The browser joins neighbouring text into one piece: take from the front of it what this piece is.
        if (head?.nodeType === 3 && (head as Text).data.startsWith(text)) {
          inner.insert(parent, node, head)
          ;(head as Text).data = (head as Text).data.slice(text.length)
          if ((head as Text).data === '') {
            inner.remove(head)
            queue.shift()
          }
          return
        }
        fail(`The page has ${describe(head)} where the app has the text "${text.slice(0, 40)}".`)
        return inner.insert(parent, node, anchor)
      }

      if (adopted.has(node)) {
        const at = queue.indexOf(node as ChildNode)
        // It is where it is: nothing to do. (A list puts its items in last to first, so it need not be the first in line.)
        if (at >= 0) {
          queue.splice(at, 1)
          return
        }
        // Taken from the HTML, but put in a place other than where it was: let it move.
        return inner.insert(parent, node, anchor)
      }

      fail(`The app makes ${describe(node)} where the page has ${describe(queue[0])}.`)
      return inner.insert(parent, node, anchor)
    },

    remove(node) {
      if (active) {
        const queue = waiting.get(node.parentNode as Node)
        const at = queue?.indexOf(node as ChildNode) ?? -1
        if (at >= 0) queue!.splice(at, 1)
      }
      inner.remove(node)
    },

    finish() {
      if (!failure) {
        for (const queue of waiting.values()) {
          if (queue.length) {
            failure = new HydrationMismatch(
              `The page has ${describe(queue[0])} that the app does not make.`,
            )
            break
          }
        }
        if (!failure && claims.size) {
          const [first] = claims.values()
          failure = new HydrationMismatch(
            `The page has <${first!.localName}> that the app does not make.`,
          )
        }
      }
      active = false
      if (failure) throw failure
    },

    abort() {
      active = false
    },
  }
}
