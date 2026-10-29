/**
 * Works out the CSS rules for one property from its value in every variant of a set.
 *
 * A variant is a place on each axis (Size=md, Hierarchy=Primary, ...). The rules are a base and then conditions that
 * override it, each condition one or more `axis = value`. Which rule wins where several match is fixed, and the
 * stylesheet is written in that order, so what the importer works out is what the browser does:
 *
 *  1. the rule with more conditions (each one is an attribute or a pseudo-class, which weigh the same in a selector);
 *  2. of rules with as many, the one that names the axis that comes later in the set (Size, then Hierarchy, then Icon,
 *     then State), so a hierarchy's padding beats a size's.
 *
 * The state with no pseudo-class (`Default`) is written with `:where(:not(...))`, which weighs nothing: it is a
 * condition that adds no weight.
 *
 * The rules are found greedily: take the condition that fixes the most variants that are wrong without breaking more
 * than it fixes.
 */

export interface Condition {
  axis: string
  value: string
  /** Adds nothing to what the selector weighs (the state with no pseudo-class). */
  light?: boolean
}

export interface LearnedRule {
  when: Condition[]
  value: string
}

export interface LearnInput {
  /** Each variant's place on each axis. */
  places: Array<Record<string, string>>
  /** What the property is in each variant. */
  values: string[]
  /** The axes that can be in a condition, with their values in the set, in the order that decides a tie. */
  axes: Array<{ name: string; values: string[]; defaultValue: string }>
  /** Axes whose default value is a condition that weighs nothing (a state). */
  light: Set<string>
}

const matches = (place: Record<string, string>, when: Condition[]): boolean =>
  when.every((c) => place[c.axis] === c.value)

/** A rule's standing: its weight, then the axes it names, latest first. Compared in order; larger wins. */
export function rankOf(when: Condition[], order: string[]): number[] {
  return [
    when.reduce((n, c) => n + (c.light ? 0 : 1), 0),
    ...when.map((c) => order.indexOf(c.axis)).sort((a, b) => b - a),
  ]
}

export function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1)
    if (d) return d
  }
  return 0
}

/** What the cascade gives a variant: the matching rule that stands highest, else the base. */
export function winner(
  place: Record<string, string>,
  base: string,
  rules: LearnedRule[],
  order: string[],
): string {
  let best = base
  let rank: number[] | undefined
  for (const r of rules) {
    if (!matches(place, r.when)) continue
    const mine = rankOf(r.when, order)
    if (!rank || compareRank(mine, rank) >= 0) {
      best = r.value
      rank = mine
    }
  }
  return best
}

function* conditionSets(input: LearnInput, size: number, from = 0): Generator<Condition[]> {
  if (size === 0) {
    yield []
    return
  }
  for (let i = from; i < input.axes.length; i++) {
    const axis = input.axes[i]!
    for (const value of axis.values) {
      const light = input.light.has(axis.name) && value === axis.defaultValue
      for (const rest of conditionSets(input, size - 1, i + 1))
        yield [{ axis: axis.name, value, ...(light ? { light } : {}) }, ...rest]
    }
  }
}

export const sameWhen = (x: Condition[], y: Condition[]): boolean =>
  x.length === y.length && x.every((c, i) => c.axis === y[i]!.axis && c.value === y[i]!.value)

export function learn(input: LearnInput): { base: string; rules: LearnedRule[] } {
  const { places, values } = input
  const order = input.axes.map((a) => a.name)
  const defaultIndex = places.findIndex((p) =>
    input.axes.every((a) => p[a.name] === a.defaultValue),
  )
  const base = values[defaultIndex >= 0 ? defaultIndex : 0]!
  const rules: LearnedRule[] = []
  const predict = (i: number, extra?: LearnedRule) =>
    winner(places[i]!, base, extra ? [...rules, extra] : rules, order)
  for (let guard = 0; guard < 2000; guard++) {
    const wrong = places.map((_, i) => i).filter((i) => predict(i) !== values[i])
    if (!wrong.length) break
    let best: { when: Condition[]; value: string; net: number; gain: number } | undefined
    for (let size = 1; size <= input.axes.length && !best; size++) {
      for (const when of conditionSets(input, size)) {
        if (rules.some((r) => sameWhen(r.when, when))) continue
        const inGroup = places.map((p, i) => (matches(p, when) ? i : -1)).filter((i) => i >= 0)
        if (!inGroup.length) continue
        const targets = new Set(wrong.filter((i) => inGroup.includes(i)).map((i) => values[i]!))
        for (const value of targets) {
          const extra = { when, value }
          let gain = 0
          let harm = 0
          for (const i of inGroup) {
            const before = predict(i) === values[i]
            const after = predict(i, extra) === values[i]
            if (!before && after) gain++
            else if (before && !after) harm++
          }
          const net = gain - harm
          if (net > 0 && (!best || net > best.net || (net === best.net && gain > best.gain)))
            best = { when, value, net, gain }
        }
      }
    }
    if (!best) throw new Error('The rules for a property could not be worked out.')
    rules.push({ when: best.when, value: best.value })
  }
  return { base, rules }
}
