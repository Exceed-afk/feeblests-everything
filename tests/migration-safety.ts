import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupBeforeMigrations, runMigrationsWithBackup } from '../src/main/db'
import { openDatabase } from './sqlite'

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'feeblest-migration-safety-'))
  const db = openDatabase()
  let count = 0
  const test = async (name: string, run: () => Promise<void>): Promise<void> => {
    await run()
    count++
    console.log('ok  ', name)
  }

  try {
    await test('pre-migration backups keep only the newest three copies', async () => {
      const dir = join(root, 'retention')
      for (let day = 1; day <= 4; day++) {
        await backupBeforeMigrations(db, dir, new Date(`2026-10-0${day}T12:00:00.000Z`))
      }
      assert.deepEqual(readdirSync(join(dir, 'before-migrate')).sort(), [
        'everything-2026-10-02T12-00-00-000Z.db',
        'everything-2026-10-03T12-00-00-000Z.db',
        'everything-2026-10-04T12-00-00-000Z.db'
      ])
    })

    await test('a migration failure is reported and prevents successful initialization', async () => {
      const dir = join(root, 'failure')
      db.exec('CREATE TABLE before_migration (value TEXT)')
      let failedWith: unknown
      let migrationStarted = false
      let backupPath = ''
      const ready = await runMigrationsWithBackup(
        db,
        dir,
        () => {
          migrationStarted = true
          const [backup] = readdirSync(join(dir, 'before-migrate'))
          assert.ok(backup)
          backupPath = join(dir, 'before-migrate', backup)
          assert.equal(existsSync(backupPath), true, 'backup exists before migration begins')
          db.exec('CREATE TABLE partial_migration (value TEXT)')
          throw new Error('forced migration failure')
        },
        (error) => { failedWith = error }
      )
      assert.equal(migrationStarted, true)
      assert.equal(ready, false)
      assert.ok(failedWith instanceof Error)
      assert.equal(failedWith.message, 'forced migration failure')
      const backup = openDatabase(backupPath)
      assert.equal((backup.prepare("SELECT name FROM sqlite_master WHERE name = 'before_migration'").get() as { name: string } | undefined)?.name, 'before_migration')
      assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name = 'partial_migration'").get(), undefined)
      backup.close()
    })

    console.log(`\n${count} migration safety checks passed`)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
