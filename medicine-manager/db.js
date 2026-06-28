const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'medicine.db');
let db = null;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      drug_name TEXT NOT NULL,
      specification TEXT DEFAULT '',
      total_quantity REAL NOT NULL,
      daily_dosage REAL NOT NULL,
      unit TEXT DEFAULT '片',
      start_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pickup_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER NOT NULL,
      pickup_date TEXT NOT NULL,
      quantity REAL NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE
    )
  `);

  saveDB();
  return db;
}

function saveDB() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

function getDB() { return db; }

function run(sql, params = []) {
  const isInsert = sql.trim().toUpperCase().startsWith("INSERT");
  let tableName = "";
  if (isInsert) {
    const m = sql.match(/INSERT\s+INTO\s+(\w+)/i);
    if (m) tableName = m[1];
  }
  const stmt = db.prepare(sql);
  stmt.run(params);
  const changes = db.getRowsModified();
  stmt.free();
  let lastInsertRowid = undefined;
  if (isInsert && tableName) {
    try {
      const rows = db.exec("SELECT MAX(rowid) as id FROM " + tableName);
      if (rows && rows[0] && rows[0].values && rows[0].values[0]) {
        lastInsertRowid = rows[0].values[0][0];
      }
    } catch (e) {
      console.error("Error getting lastInsertRowid:", e.message);
    }
  }
  saveDB();
  return { lastInsertRowid, changes };
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const result = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return result;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

module.exports = { initDB, saveDB, getDB, run, get, all };
