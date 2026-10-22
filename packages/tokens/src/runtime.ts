/**
 * Theme switching only sets a `data-*` attribute; the CSS custom properties do the rest, so nothing re-renders.
 * The target is anything with attribute methods, so this file does not depend on the DOM.
 */
export interface AttributeTarget {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

function defaultTarget(): AttributeTarget {
  const doc = (globalThis as { document?: { documentElement: AttributeTarget } }).document
  if (!doc)
    throw new Error(
      'No document found. Pass the element to put the theme on as the second argument.',
    )
  return doc.documentElement
}

export function setTheme(name: string | null, target: AttributeTarget = defaultTarget()): void {
  set(target, 'data-theme', name)
}

export function setDensity(name: string | null, target: AttributeTarget = defaultTarget()): void {
  set(target, 'data-density', name)
}

export function getTheme(target: AttributeTarget = defaultTarget()): string | null {
  return target.getAttribute('data-theme')
}

export function getDensity(target: AttributeTarget = defaultTarget()): string | null {
  return target.getAttribute('data-density')
}

/** Passing `null` removes the attribute and returns to the base values. */
function set(target: AttributeTarget, attribute: string, name: string | null): void {
  if (name === null) target.removeAttribute(attribute)
  else target.setAttribute(attribute, name)
}
