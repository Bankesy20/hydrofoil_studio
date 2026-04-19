/**
 * On first run: npm install + backend venv. Then `npm start` can be the only command after clone.
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const backend = join(root, 'backend')

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (!existsSync(join(root, 'node_modules'))) {
  console.log('HydroOptFoil: installing npm dependencies (first run)…')
  run('npm', ['install'], { cwd: root })
}

const py =
  process.platform === 'win32'
    ? join(backend, '.venv', 'Scripts', 'python.exe')
    : join(backend, '.venv', 'bin', 'python')

if (!existsSync(py)) {
  console.log('HydroOptFoil: creating backend/.venv and installing Python deps (first run)…')
  const venvDir = join(backend, '.venv')
  run('python3', ['-m', 'venv', venvDir], { cwd: root })
  run(py, ['-m', 'pip', 'install', '-r', join(backend, 'requirements.txt')], { cwd: root })
}
