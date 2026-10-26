import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Recover a campaign snapshot into a NEW schema only. Never overwrite live public data.
const path = resolve(process.argv[2] ?? '');
if (dirname(path) !== resolve('../../.backups') || !path.endsWith('.json')) throw new Error('Choose a backup JSON inside the repository .backups directory');
const bytes = await readFile(path, 'utf8');
assert.equal(createHash('sha256').update(bytes).digest('hex'), (await readFile(`${path}.sha256`, 'utf8')).trim());
const backup = JSON.parse(bytes) as { format: string; data: Record<string, Record<string, unknown>[]>; migrations: Record<string, string> };
assert.ok(['scene-foundation-v1','table-foundation-v2'].includes(backup.format));
const schema = `scene_recovery_${randomUUID().replaceAll('-', '')}`;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const tables = ['User', 'Campaign', 'Session', 'CampaignMember', 'Invite','MediaFile','Scene','Token', 'SharedMap', 'MapFragment', 'MapElement', 'CombatEncounter', 'CombatParticipant', 'PresentationMaterial', 'AudioAsset', 'AudioChannel', 'AudioCue', '_prisma_migrations'].filter(table=>backup.data[table]);
assert.ok(Object.keys(backup.data).every(table=>tables.includes(table)), 'Backup contains an unrecognized table; extend the recovery order first');
const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
try {
  await client.connect(); await client.query('BEGIN');
  await client.query(`CREATE SCHEMA ${quote(schema)}`); await client.query(`SET LOCAL search_path TO ${quote(schema)}`);
  for (const name of Object.keys(backup.migrations).sort()) await client.query(backup.migrations[name]!);
  await client.query(`CREATE TABLE ${quote(schema)}."_prisma_migrations" (LIKE public."_prisma_migrations" INCLUDING ALL)`);
  for (const table of tables) {
    for (const row of backup.data[table]!) {
      const columns = Object.keys(row);
      await client.query(`INSERT INTO ${quote(schema)}.${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, columns.map(column => table==='Campaign'&&['activeLocationId','presentationMaterialId'].includes(column)?null:table==='CombatEncounter'&&column==='currentParticipantId'?null:table==='MapElement'&&column==='points'?JSON.stringify(row[column]):row[column]));
    }
  }
  for(const row of backup.data.Campaign??[]) if(row.activeLocationId)await client.query(`UPDATE ${quote(schema)}."Campaign" SET "activeLocationId"=$1 WHERE id=$2`,[row.activeLocationId,row.id]);
  for(const row of backup.data.CombatEncounter??[]) if(row.currentParticipantId) await client.query(`UPDATE ${quote(schema)}."CombatEncounter" SET "currentParticipantId"=$1 WHERE id=$2`,[row.currentParticipantId,row.id]);
  for(const row of backup.data.Campaign??[]) if(row.presentationMaterialId) await client.query(`UPDATE ${quote(schema)}."Campaign" SET "presentationMaterialId"=$1 WHERE id=$2`,[row.presentationMaterialId,row.id]);
  for(const table of tables){
    const restored = (await client.query(`SELECT * FROM ${quote(schema)}.${quote(table)}`)).rows;
    const canonical = (rows: unknown[]) => JSON.stringify(rows.map(row => JSON.stringify(row)).sort());
    assert.equal(canonical(restored), canonical(backup.data[table]!));
  }
  const verifyOnly = process.argv.includes('--verify-only');
  if (verifyOnly && /^scene_recovery_[a-f0-9]{32}$/.test(schema)) await client.query(`DROP SCHEMA ${quote(schema)} CASCADE`);
  await client.query('COMMIT');
  console.log(`PASS: campaign data restored and verified in ${schema}. Public schema unchanged. ${verifyOnly ? 'Verification schema removed.' : 'Review before selectively recovering records.'}`);
} catch (error) { console.error('Recovery diagnostic:', error && typeof error === 'object' && 'code' in error ? error.code : 'verification'); await client.query('ROLLBACK').catch(() => {}); console.error('Recovery failed; transaction rolled back, public data unchanged.'); process.exitCode = 1; }
finally { await client.end(); }
