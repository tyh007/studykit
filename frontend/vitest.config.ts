import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Node 25+ enables a built-in global `localStorage` that has no usable
// Storage methods unless `--localstorage-file` is set. It shadows the
// happy-dom implementation, so tests fail with
// "localStorage.getItem is not a function". Disable Node's web storage in
// test workers so happy-dom provides `localStorage`. Older Node versions
// do not enable it by default and do not need the flag.
const nodeMajor = Number(process.versions.node.split('.')[0])
const workerExecArgv = nodeMajor >= 25 ? ['--no-experimental-webstorage'] : []

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    poolOptions: {
      forks: { execArgv: workerExecArgv },
    },
  },
})
