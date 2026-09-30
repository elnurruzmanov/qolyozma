// Runs the E2E suite in the official Playwright Docker image, the same one CI uses, so the visual snapshots
// match on any OS. Extra arguments go to `playwright test`, e.g.:
//   npm run e2e:docker -- tests/e2e/visual.spec.ts
//   npm run e2e:update-snapshots
// The image tag follows the installed @playwright/test version (tests/unit/ci.test.ts keeps CI in step).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../node_modules/@playwright/test/package.json', import.meta.url)))
const image = `mcr.microsoft.com/playwright:v${version}-noble`
const args = process.argv.slice(2).map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')
// node_modules is an anonymous volume: the host's copy may be built for another OS.
// Files written as root in the container are handed back to the host user (Linux/macOS).
const owner = process.getuid ? `${process.getuid()}:${process.getgid()}` : ''
const script = [
  'npm ci --no-audit --no-fund || exit 1',
  `VISUAL=1 npx playwright test ${args}`,
  'status=$?',
  owner ? `chown -R ${owner} tests dist test-results playwright-report 2>/dev/null` : ':',
  'exit $status',
].join('\n')

const result = spawnSync(
  'docker',
  ['run', '--rm', '--ipc=host', '-v', `${process.cwd()}:/work`, '-v', '/work/node_modules', '-w', '/work', image, 'sh', '-c', script],
  { stdio: 'inherit' },
)
process.exit(result.status ?? 1)
