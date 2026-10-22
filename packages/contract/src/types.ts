import type { Contract } from './parse'

const q = (s: string) => JSON.stringify(s)
const doc = (text: string, indent = '  ') => `${indent}/** ${text.replace(/\*\//g, '* /')} */\n`

/**
 * TypeScript declarations for a component's props, slots and events, derived from its contract.
 * Variants become optional props whose type is the union of allowed values.
 */
export function generateTypes(contract: Contract): string {
  const { name } = contract
  const lines: string[] = [`// Generated from the ${name} contract. Do not edit.`, '']

  lines.push(`export interface ${name}Props {`)
  for (const [variant, values] of Object.entries(contract.variants)) {
    lines.push(
      `${doc(`Default: ${q(values[0]!)}`)}  ${variant}?: ${values.map(q).join(' | ')}`.trimEnd(),
    )
  }
  lines.push('}', '')

  lines.push(`export interface ${name}Slots {`)
  for (const [slot, description] of Object.entries(contract.slots)) {
    lines.push(`${doc(description)}  ${q(slot)}?: unknown`)
  }
  lines.push('}', '')

  lines.push(`export interface ${name}Events {`)
  for (const [event, description] of Object.entries(contract.events)) {
    lines.push(`${doc(description)}  ${q(event)}: unknown`)
  }
  lines.push('}', '')

  lines.push(`export type ${name}Part = ${contract.parts.map(q).join(' | ')}`, '')
  return lines.join('\n')
}
