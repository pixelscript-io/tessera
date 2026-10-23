import type { Project } from '@tessera/compiler/project'

/** The ways generated code can be off the system, named for the experiment's report. */
export type Offence =
  'rawValue' | 'wrongToken' | 'unknownComponent' | 'unknownVariantOrSlotOrEvent' | 'other'

const OFFENCES: Record<string, Offence> = {
  T2101: 'rawValue',
  T2102: 'rawValue',
  T2103: 'wrongToken',
  T2104: 'wrongToken',
  T2105: 'wrongToken',
  T4007: 'unknownComponent',
  T4008: 'unknownVariantOrSlotOrEvent',
  T4009: 'unknownVariantOrSlotOrEvent',
  T4010: 'unknownVariantOrSlotOrEvent',
  T2114: 'unknownVariantOrSlotOrEvent',
}

export interface Score {
  files: number
  /** Everything the compiler rejected, before any baseline. */
  errors: number
  warnings: number
  /** Errors by what the model got wrong. */
  offences: Record<Offence, number>
  byCode: Record<string, number>
}

const emptyScore = (): Score => ({
  files: 0,
  errors: 0,
  warnings: 0,
  offences: {
    rawValue: 0,
    wrongToken: 0,
    unknownComponent: 0,
    unknownVariantOrSlotOrEvent: 0,
    other: 0,
  },
  byCode: {},
})

/**
 * Count what the compiler finds off-system in some files, for comparing two ways of generating the same UI.
 * `path` is where the file would live in the project (it decides the kind and what it can import); `source` is
 * the generated text. The baseline is ignored on purpose: the question is what the model wrote, not what the
 * project tolerates.
 */
export function scoreFiles(
  project: Project,
  files: Array<{ path: string; source: string }>,
): Score {
  const score = emptyScore()
  score.files = files.length
  for (const { path, source } of files) {
    for (const d of project.compileFile(path, source, { baseline: null }).raw) {
      if (d.severity === 'warning') {
        score.warnings++
        continue
      }
      score.errors++
      score.byCode[d.code] = (score.byCode[d.code] ?? 0) + 1
      score.offences[OFFENCES[d.code] ?? 'other']++
    }
  }
  return score
}

/** Add scores together, for one arm across all prompts. */
export function sumScores(scores: Score[]): Score {
  const total = emptyScore()
  for (const s of scores) {
    total.files += s.files
    total.errors += s.errors
    total.warnings += s.warnings
    for (const k of Object.keys(total.offences) as Offence[]) total.offences[k] += s.offences[k]
    for (const [code, n] of Object.entries(s.byCode))
      total.byCode[code] = (total.byCode[code] ?? 0) + n
  }
  return total
}
