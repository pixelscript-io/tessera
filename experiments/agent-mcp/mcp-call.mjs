import process from 'node:process'
// Calls one tool of the real `tessera mcp` server (over its stdio protocol) and prints the result text. This
// stands in for an MCP client for models that can run shell commands but have no MCP connection:
//   node experiments/agent-mcp/mcp-call.mjs <project folder> <tool> '<json arguments>'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [root, tool, args = '{}'] = process.argv.slice(2)
const bin = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packages',
  'tessera',
  'bin',
  'tessera.js',
)
const child = spawn(process.execPath, [bin, 'mcp', '--root', root], {
  stdio: ['pipe', 'pipe', 'ignore'],
})
let out = ''
child.stdout.on('data', (d) => (out += d))
child.on('close', () => {
  const reply = out
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .find((m) => m.id === 2)
  const content = reply?.result?.content?.[0]?.text ?? JSON.stringify(reply?.error ?? reply)
  process.stdout.write(content + '\n')
})
const send = (m) => child.stdin.write(JSON.stringify(m) + '\n')
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
send({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: tool, arguments: JSON.parse(args) },
})
child.stdin.end()
