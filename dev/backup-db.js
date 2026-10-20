// Saves the hosted database's data to backups/whentoraid-<date>.sql (ignored by git). The schema
// lives in supabase/migrations, so the data is all a restore needs. Needs `supabase link` and the
// database password, which the CLI asks for. See docs/OPERATIONS.md.
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const file = `backups/whentoraid-${new Date().toISOString().slice(0, 10)}.sql`
mkdirSync('backups', { recursive: true })
const result = spawnSync('npx', ['supabase', 'db', 'dump', '--linked', '--data-only', '-f', file], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.status === 0) process.stdout.write(`Saved ${file}\n`)
else {
  process.stderr.write('The backup failed; nothing was saved.\n')
  process.exitCode = result.status ?? 1
}
