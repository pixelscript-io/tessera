import type { Readable, Writable } from 'node:stream'
import type { AgentManifest } from '@tessera/compiler'
import type { Project } from '@tessera/compiler/project'
import { TOOLS, ToolError } from './tools'

const PROTOCOL_VERSION = '2024-11-05'

/** JSON-RPC 2.0 error codes. */
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

interface Request {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export interface ServerOptions {
  /** Version reported to the client. */
  version?: string
}

/**
 * A read-only Model Context Protocol server over newline-delimited JSON-RPC. It answers questions about a
 * project (components, tokens, routes, rules) and checks code with the compiler. It never writes a file.
 */
export class McpServer {
  private manifestCache: AgentManifest | undefined

  constructor(
    private readonly project: Project,
    private readonly options: ServerOptions = {},
  ) {}

  /** Built on first use after a `refresh`, so one call builds it once however many tools ask. */
  private manifest = (): AgentManifest => (this.manifestCache ??= this.project.agentManifest())

  /** Forget everything read from disk. */
  refresh(): void {
    this.project.resetAll()
    this.manifestCache = undefined
  }

  /** Handle one message. Returns the response, or undefined for a notification. */
  handle(message: unknown): object | undefined {
    const request = message as Request
    if (
      !request ||
      typeof request !== 'object' ||
      request.jsonrpc !== '2.0' ||
      typeof request.method !== 'string'
    ) {
      return error(null, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request.')
    }
    const id = request.id
    const isNotification = id === undefined
    const reply = (result: unknown) => (isNotification ? undefined : { jsonrpc: '2.0', id, result })
    const fail = (code: number, text: string) =>
      isNotification ? undefined : error(id ?? null, code, text)

    switch (request.method) {
      case 'initialize':
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'tessera', version: this.options.version ?? '0.0.0' },
          instructions:
            'Tessera is a governed UI framework. Build with the components and design tokens of this project, never raw values or invented components. ' +
            'Look components up with search_components and get_component, tokens with list_tokens and resolve_value, ' +
            'and run validate_snippet on code before presenting it: it returns the errors the build would.',
        })
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        })
      case 'tools/call': {
        const name = request.params?.['name']
        const tool = TOOLS.find((t) => t.name === name)
        if (!tool) return fail(INVALID_PARAMS, `Unknown tool: ${String(name)}.`)
        const args = (request.params?.['arguments'] ?? {}) as Record<string, unknown>
        // The agent is editing files while the server runs: every call reads the project as it is now.
        this.refresh()
        try {
          const result = tool.run(args, { project: this.project, manifest: this.manifest })
          return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
        } catch (e) {
          if (!(e instanceof ToolError)) throw e
          return reply({ isError: true, content: [{ type: 'text', text: e.message }] })
        }
      }
      default:
        // Notifications such as notifications/initialized need no answer.
        if (request.method.startsWith('notifications/')) return undefined
        return fail(METHOD_NOT_FOUND, `Method not found: ${request.method}.`)
    }
  }

  /** Read newline-delimited messages from `input`, write responses to `output`, and resolve when input ends. */
  serve(input: Readable, output: Writable): Promise<void> {
    return new Promise((resolve) => {
      let buffer = ''
      const write = (message: object | undefined) => {
        if (message) output.write(JSON.stringify(message) + '\n')
      }
      const line = (text: string) => {
        if (!text.trim()) return
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          return write(error(null, PARSE_ERROR, 'Could not parse the message as JSON.'))
        }
        const messages = Array.isArray(parsed) ? parsed : [parsed]
        for (const m of messages) {
          try {
            write(this.handle(m))
          } catch (e) {
            const id = (m as Request | undefined)?.id ?? null
            write(error(id, -32603, e instanceof Error ? e.message : String(e)))
          }
        }
      }
      input.setEncoding('utf8')
      input.on('data', (chunk: string) => {
        buffer += chunk
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          line(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
        }
      })
      input.on('end', () => {
        line(buffer)
        resolve()
      })
    })
  }
}

function error(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
