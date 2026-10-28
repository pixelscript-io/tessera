import { ARIA_ROLES } from './roles'

const identifiers = {
  part: '^[a-z][a-zA-Z0-9-]*$',
  variant: '^[a-z][A-Za-z0-9]*$',
  member: '^[a-z][A-Za-z0-9-]*$',
}

const stringMap = (description: string, names: string) => ({
  type: 'object',
  description,
  propertyNames: { pattern: names },
  additionalProperties: { type: 'string', description: 'Description shown in the docs.' },
})

/**
 * JSON Schema (draft 2020-12) for the `<contract>` block, for editor autocomplete and inline errors.
 * Published as `contract.schema.json`; the compiler's own validation remains the source of truth for
 * rules a schema cannot express (name matches file, contrast parts exist, behavior requirements).
 */
export const contractSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://tessera.dev/schemas/contract.schema.json',
  title: 'Tessera component contract',
  type: 'object',
  required: ['name', 'role', 'parts'],
  additionalProperties: false,
  properties: {
    name: {
      type: 'string',
      pattern: '^[A-Z][A-Za-z0-9]*$',
      description: 'PascalCase component name. Must match the file name.',
    },
    role: {
      enum: [...ARIA_ROLES],
      description: 'The ARIA role of the component root.',
    },
    description: { type: 'string', description: 'What the component is for.' },
    parts: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', pattern: identifiers.part },
      contains: { const: 'root' },
      description: 'The public anatomy: documented class names. Must include "root".',
    },
    variants: {
      type: 'object',
      propertyNames: { pattern: identifiers.variant },
      additionalProperties: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
      },
      description: 'Variant name to allowed values. The first value is the default.',
    },
    states: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
      description: 'States the component can be in, for example "hover" or "disabled".',
    },
    behavior: {
      type: 'string',
      description: 'Headless interaction behavior to attach, for example "press".',
    },
    slots: stringMap('Slot name to description.', identifiers.member),
    events: stringMap('Event name to description.', identifiers.member),
    contrast: {
      type: 'array',
      description: 'Foreground and background parts whose colors are checked for contrast.',
      items: {
        type: 'object',
        required: ['foreground', 'background'],
        additionalProperties: false,
        properties: {
          foreground: { type: 'string', pattern: identifiers.part },
          background: { type: 'string', pattern: identifiers.part },
        },
      },
    },
    since: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$',
      description: 'Version that introduced the component.',
    },
    deprecated: {
      type: 'string',
      description: 'Why the component is deprecated and what to use instead.',
    },
    renamedFrom: {
      type: 'string',
      pattern: '^[A-Z][A-Za-z0-9]*$',
      description: 'Previous component name, used by codemods.',
    },
    deprecatedValues: {
      type: 'object',
      description:
        'Variant name to the values that are deprecated, each with why and what to use instead. The values stay allowed.',
      additionalProperties: { type: 'object', additionalProperties: { type: 'string' } },
    },
    renamedValues: {
      type: 'object',
      description:
        'Variant name to values that were renamed, each old value mapped to its replacement. Used by codemods; the old value is no longer allowed.',
      additionalProperties: { type: 'object', additionalProperties: { type: 'string' } },
    },
    forkedFrom: {
      type: 'object',
      required: ['component', 'version'],
      additionalProperties: false,
      properties: {
        component: { type: 'string', pattern: '^[A-Z][A-Za-z0-9]*$' },
        version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$' },
      },
      description: 'The component this was copied from, and its version.',
    },
    preview: {
      type: 'object',
      additionalProperties: false,
      description:
        'Sample props and slot content to show the component with in the docs, the generated tests and usage examples.',
      properties: {
        props: { type: 'object', description: 'Prop name to a sample value.' },
        slots: {
          type: 'object',
          description:
            'Slot name to content: text, a { "component", "props", "slots" } node, a { "tag", "attrs", "text", "children" } element, or a list of them.',
        },
      },
    },
  },
} as const
