/**
 * Run uvicorn from backend/.venv with cwd = backend (for hydro_path + imports).
 */
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const backend = join(pkgRoot, 'backend')
const py =
  process.platform === 'win32'
    ? join(backend, '.venv', 'Scripts', 'python.exe')
    : join(backend, '.venv', 'bin', 'python')

const port = process.env.API_PORT || '8000'
const child = spawn(
  py,
  ['-m', 'uvicorn', 'server:app', '--reload', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: backend, stdio: 'inherit' },
)
child.on('exit', (code) => process.exit(code ?? 0))
