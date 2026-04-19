/**
 * Start FastAPI + Vite with coordinated free ports (avoids EADDRINUSE on 8000/5173).
 * Forwards SIGINT/SIGTERM to both children.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Pick first port in [start, end] that accepts a listen on host. */
function findFreePort(host, start, end) {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > end) {
        reject(new Error(`No free TCP port on ${host} between ${start} and ${end}`))
        return
      }
      const srv = createServer()
      srv.once('error', () => tryPort(p + 1))
      srv.listen(p, host, () => {
        srv.close((err) => {
          if (err) tryPort(p + 1)
          else resolve(p)
        })
      })
    }
    tryPort(start)
  })
}

const apiPort =
  process.env.API_PORT != null && process.env.API_PORT !== ''
    ? Number(process.env.API_PORT)
    : await findFreePort('127.0.0.1', 8000, 8099)

const webPort =
  process.env.WEB_PORT != null && process.env.WEB_PORT !== ''
    ? Number(process.env.WEB_PORT)
    : await findFreePort('127.0.0.1', 5173, 5273)

const py =
  process.platform === 'win32'
    ? join(pkgRoot, 'backend', '.venv', 'Scripts', 'python.exe')
    : join(pkgRoot, 'backend', '.venv', 'bin', 'python')

const envBase = { ...process.env, API_PORT: String(apiPort) }

console.log(
  `\n\x1b[36mHydroOptFoil\x1b[0m  API \x1b[1mhttp://127.0.0.1:${apiPort}\x1b[0m  →  UI \x1b[1mhttp://localhost:${webPort}\x1b[0m\n`,
)

const api = spawn(
  py,
  [
    '-m',
    'uvicorn',
    'server:app',
    '--reload',
    '--host',
    '127.0.0.1',
    '--port',
    String(apiPort),
  ],
  {
    cwd: join(pkgRoot, 'backend'),
    stdio: 'inherit',
    env: envBase,
  },
)

const viteCli = join(pkgRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const web = spawn(process.execPath, [viteCli, '--port', String(webPort)], {
  cwd: pkgRoot,
  stdio: 'inherit',
  env: envBase,
})

let shuttingDown = false

function exitAll(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of [api, web]) {
    if (c && !c.killed) c.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 250)
}

api.on('exit', (code) => {
  if (shuttingDown) return
  exitAll(code === 0 || code === null ? 0 : code ?? 1)
})

web.on('exit', (code) => {
  if (shuttingDown) return
  exitAll(code === 0 || code === null ? 0 : code ?? 1)
})

process.on('SIGINT', () => exitAll(0))
process.on('SIGTERM', () => exitAll(0))
