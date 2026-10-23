const Database = require('./sqlite');
const fs = require('fs');
const path = require('path');
let db;
function initialize() {
  db.exec("CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  for (const sql of require('./schema.json')) {
    try { db.exec(sql); } catch (error) {
      if (!sql.startsWith('ALTER TABLE') || !/duplicate column name/.test(error.message)) throw error;
    }
  }
}
function getDb() {
  if (!db) {
    const filename = path.join(__dirname, '../../data/office.db');
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    db = new Database(filename);
    db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
    initialize();
  }
  return db;
}
function getSetting(key) { return getDb().prepare('SELECT value FROM app_settings WHERE key=?').get(key)?.value ?? null; }
function setSetting(key,value) { getDb().prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP').run(key,String(value)); }
function __setDbForTests(instance,{initialize: init=true}={}) { db=instance; if(init) initialize(); return db; }
module.exports={getDb,getSetting,setSetting,__setDbForTests};
