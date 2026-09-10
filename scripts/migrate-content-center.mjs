import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [source, destination] = process.argv.slice(2);
if (!source || !destination || !path.isAbsolute(source) || !path.isAbsolute(destination)) throw new Error('用法：node scripts/migrate-content-center.mjs <源数据库绝对路径> <新数据库绝对路径>');
if (fs.existsSync(destination)) throw new Error('目标数据库已存在，拒绝覆盖。请使用新的路径。');
const db = new Database(source, { readonly: true, fileMustExist: true });
const tables = ['business_units', 'accounts', 'columns', 'notes', 'candidates', 'images', 'products', 'templates'];
function snapshot(database) {
  return Object.fromEntries(tables.map(table => {
    const rows = database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
    const hash = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    return [table, { count: rows.length, sha256: hash }];
  }));
}
fs.mkdirSync(path.dirname(destination), { recursive: true });
const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
try {
  await db.backup(temporary);
  const restored = new Database(temporary, { readonly: true });
  let verification;
  try {
    if (restored.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('数据库完整性检查失败');
    verification = snapshot(restored);
    if (JSON.stringify(snapshot(db)) !== JSON.stringify(verification)) throw new Error('原始数据已变化或校验不一致，请暂停录入后重新迁移');
  } finally { restored.close(); }
  fs.chmodSync(temporary, 0o600);
  fs.linkSync(temporary, destination); // Atomic, refuses to overwrite an existing target.
  console.log(JSON.stringify({ destination, verification }, null, 2));
} finally { db.close(); for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(temporary + suffix)) fs.unlinkSync(temporary + suffix); }
