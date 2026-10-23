import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Project } from '@tessera/compiler/project'
import { scoreFiles, sumScores } from '../src'

const root = fileURLToPath(new URL('../../../examples/kitchen-sink', import.meta.url)).replaceAll(
  '\\',
  '/',
)
const project = new Project(root, { today: '2026-10-22' })

const page = (body: string, style = '') =>
  `<template><main>${body}</main></template>\n${style ? `<style>\n${style}\n</style>\n` : ''}`

describe('scoring generated code', () => {
  it('counts nothing for code that is on the system', () => {
    const score = scoreFiles(project, [
      {
        path: `${root}/app/pages/ok.tess`,
        source: page('<Button>Save</Button>', 'main { padding: $space.4; }'),
      },
    ])
    expect(score).toMatchObject({ files: 1, errors: 0 })
  })

  it('sorts what is off the system into raw values, invented components and invented variants', () => {
    const score = scoreFiles(project, [
      {
        path: `${root}/app/pages/bad.tess`,
        source: page(
          '<Button tone="loud">Save</Button><Fancy />',
          'main { padding: 13px; color: #ff0000; }',
        ),
      },
    ])
    expect(score.offences).toEqual({
      rawValue: 2,
      wrongToken: 0,
      unknownComponent: 1,
      unknownVariantOrSlotOrEvent: 1,
      other: 0,
    })
    expect(score.errors).toBe(4)
    expect(score.byCode['T4007']).toBe(1)
  })

  it('adds scores across prompts', () => {
    const one = scoreFiles(project, [
      { path: `${root}/app/pages/a.tess`, source: page('<Fancy />') },
    ])
    const total = sumScores([one, one])
    expect(total.errors).toBe(2)
    expect(total.files).toBe(2)
    expect(total.offences.unknownComponent).toBe(2)
  })
})
