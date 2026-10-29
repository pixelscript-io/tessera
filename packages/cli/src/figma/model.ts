/** What the importer reads from Figma and from the map. Only the parts of the REST file format it uses. */

export interface Rgba {
  r: number
  g: number
  b: number
  a?: number
}

export interface Paint {
  type: string
  visible?: boolean
  opacity?: number
  color?: Rgba
  gradientHandlePositions?: Array<{ x: number; y: number }>
  gradientStops?: Array<{ position: number; color: Rgba }>
}

export interface Effect {
  type: string
  visible?: boolean
  color?: Rgba
  offset?: { x: number; y: number }
  radius?: number
  spread?: number
}

export interface FigmaNode {
  id: string
  name: string
  type: string
  visible?: boolean
  opacity?: number
  children?: FigmaNode[]
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE'
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL'
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL'
  primaryAxisAlignItems?: string
  counterAxisAlignItems?: string
  itemSpacing?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  cornerRadius?: number
  rectangleCornerRadii?: [number, number, number, number]
  fills?: Paint[]
  strokes?: Paint[]
  strokeWeight?: number
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER'
  effects?: Effect[]
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number }
  absoluteRenderBounds?: { x: number; y: number; width: number; height: number } | null
  characters?: string
  style?: {
    fontFamily?: string
    fontWeight?: number
    fontSize?: number
    lineHeightPx?: number
    letterSpacing?: number
    textAlignHorizontal?: string
  }
  styles?: Record<string, string>
  componentPropertyDefinitions?: Record<
    string,
    { type: string; defaultValue?: unknown; variantOptions?: string[] }
  >
}

/** What `GET /v1/files/:key/nodes` gives for a component set, with the styles it uses. */
export interface ComponentSetFile {
  file?: string
  fileKey?: string
  page?: string
  set: FigmaNode
  styles: Record<string, { name: string; styleType: string }>
}

/** A layer of a variant that becomes a part: the n-th layer with this name (depth first), and the text layer inside. */
export type PartRef = '$' | { layer: string; index?: number; text?: string }

/** One layer, or several to try in order: a variant may draw the same part with another layer (a dot for an icon). */
export type PartSpec = PartRef | PartRef[]

export interface FigmaMap {
  /** The name of the component set in Figma. */
  component: string
  /** The name of the Tessera component. */
  name: string
  /** What the component is. Only "button" is built. */
  kind: string
  role: string
  description: string
  behavior?: string
  /** Each variant property of the set: the Tessera prop it becomes, and whether it is the state. */
  props: Record<
    string,
    { prop: string; default?: string } | { states: Record<string, string | null> }
  >
  /** The other properties of the set (a boolean, an instance swap), each with why it is not a prop. */
  ignore?: Record<string, string>
  parts: Record<string, PartSpec>
  /** The slot a part is, for the parts that hold what the caller gives. */
  slots?: Record<string, string>
  /** What the label says in the preview and in the comparison. */
  sample?: string
  fidelity?: {
    /** The share of pixels that may differ, 0 to 1. Default 0.01. */
    threshold?: number
    /** Parts whose pixels are not compared (their box still is): an icon is what the caller fills in. */
    ignore?: string[]
    /** The design's fonts, as files in the project, for the comparison. */
    fonts?: Array<{ family: string; file: string }>
  }
}

export interface Report {
  /** What was mapped: variants read, props and states, parts. */
  mapped: string[]
  /** Tokens the import made because the project has none for the value. */
  tokens: string[]
  /** Things in the design the importer could not translate, and what it did instead. */
  skipped: string[]
  /** Values the design had no style for and the importer made a token for. */
  unbound: string[]
}

export class FigmaError extends Error {
  constructor(
    public code: string,
    message: string,
    public hint?: string,
  ) {
    super(message)
  }
}
