import { Client } from 'pg';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
const schema = `scene_rehearsal_${randomUUID().replaceAll('-', '')}`;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
let tables = ['User', 'Campaign', 'Session', 'CampaignMember', 'Invite', 'MediaFile', 'Scene', 'Token', 'SharedMap', 'MapFragment', 'MapElement', '_prisma_migrations'];
const data: Record<string, Record<string, unknown>[]> = {};
const canonical = (rows: unknown[]) => JSON.stringify(rows.map(row => JSON.stringify(row)).sort());
let created = false;
let step = 'connect';
try {
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const present = new Set((await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows.map(row=>row.table_name));
  assert.ok([...present].every(name=>tables.includes(String(name))),'Unrecognized table must be included in backup');
  tables=tables.filter(table=>present.has(table));
  for (const table of tables) data[table] = (await client.query(`SELECT * FROM public.${quote(table)}`)).rows;
  await client.query('COMMIT');
  step = 'save backup';
  const applied = new Set(data._prisma_migrations!.filter(row => row.finished_at && !row.rolled_back_at).map(row => String(row.migration_name)));
  const sql: Record<string, string> = {};
  for (const name of await readdir('prisma/migrations')) {
    if (name.match(/^\d+_/)) sql[name] = await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8');
  }
  for (const name of applied) assert.ok(sql[name], 'Applied migration is missing locally');
  const backup = { createdAt: new Date().toISOString(), format: 'table-foundation-v2', data, migrations: Object.fromEntries([...applied].map(name => [name, sql[name]])) };
  const bytes = JSON.stringify(backup);
  await mkdir('../../.backups', { recursive: true });
  const path = `../../.backups/pre-table-foundation-${Date.now()}.json`;
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  await writeFile(`${path}.sha256`, createHash('sha256').update(bytes).digest('hex'), { mode: 0o600 });
  const saved = JSON.parse(await readFile(path, 'utf8')) as typeof backup;
  step = 'restore schema';
  await client.query(`CREATE SCHEMA ${quote(schema)}`); created = true;
  await client.query(`SET search_path TO ${quote(schema)}`);
  for (const name of [...applied].sort()) await client.query(saved.migrations[name]!);
  await client.query(`CREATE TABLE ${quote(schema)}."_prisma_migrations" (LIKE public."_prisma_migrations" INCLUDING ALL)`);
  for (const table of tables) {
    step = `restore ${table}`;
    for (const row of saved.data[table]!) {
      const columns = Object.keys(row);
      await client.query(`INSERT INTO ${quote(schema)}.${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, columns.map(column => table==='Campaign'&&column==='activeLocationId'?null:table==='MapElement'&&column==='points'?JSON.stringify(row[column]):row[column]));
    }
  }
  for(const row of data.Campaign??[]) if(row.activeLocationId) await client.query(`UPDATE ${quote(schema)}."Campaign" SET "activeLocationId"=$1 WHERE id=$2`,[row.activeLocationId,row.id]);
  for (const name of Object.keys(sql).filter(name => !applied.has(name)).sort()) {
    step = `migrate ${name}`;
    assert.ok(!/(^|;)\s*(DROP|TRUNCATE|DELETE)\b/im.test(sql[name]!.replace(/^--.*$/gm, '')), 'Migration must be additive');
    await client.query(sql[name]!);
  }
  for (const table of tables) {
    step = `verify ${table}`;
    const columns = (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', ['public', table])).rows.map(row => row.column_name as string);
    const restored = (await client.query(`SELECT ${columns.map(quote).join(',')} FROM ${quote(schema)}.${quote(table)}`)).rows;
    assert.equal(canonical(restored), canonical(data[table]!));
  }
  console.log('PASS: consistent backup written to ignored .backups; all rows restored exactly; pending additive migration preserves all existing columns/records.');
  console.log(`Backup: ${path}`);
} catch (error) { console.error(`FAIL: migration/backup rehearsal at ${step}; code ${error && typeof error === 'object' && 'code' in error ? error.code : 'verification'}. Production migration NOT approved.`); process.exitCode = 1; }
finally {
  try {
    await client.query('ROLLBACK');
    if (created && /^scene_rehearsal_[a-f0-9]{32}$/.test(schema)) await client.query(`DROP SCHEMA ${quote(schema)} CASCADE`);
  } finally { await client.end(); }
}
