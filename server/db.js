const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to SQLite database
const dbPath = path.resolve(__dirname, 'inventory.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        // Create tables
        db.serialize(() => {
            // Employees Table
            db.run(`CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL
            )`);

            // Components Table
            db.run(`CREATE TABLE IF NOT EXISTS components (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uid TEXT UNIQUE NOT NULL,
                tracker_id TEXT,
                name TEXT NOT NULL,
                status TEXT DEFAULT 'IN',
                assigned_to TEXT,
                approved_for_uid TEXT DEFAULT NULL
            )`);

            // Transactions Log
            db.run(`CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                component_uid TEXT,
                employee_uid TEXT,
                action TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Requests Table
            db.run(`CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_uid TEXT NOT NULL,
                component_uid TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // GPS Logs
            db.run(`CREATE TABLE IF NOT EXISTS gps_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tracker_id TEXT,
                lat REAL,
                lng REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Insert Real Data if Empty
            db.get("SELECT COUNT(*) as count FROM employees", (err, row) => {
                if (row && row.count === 0) {
                    console.log("Inserting employees...");
                    db.run(`INSERT INTO employees (uid, name) VALUES ('2458CA2B', 'Employee 1')`);
                    db.run(`INSERT INTO employees (uid, name) VALUES ('BDD0D316', 'Employee 2')`);
                }
            });

            db.get("SELECT COUNT(*) as count FROM components", (err, row) => {
                if (row && row.count === 0) {
                    console.log("Inserting components...");
                    db.run(`INSERT INTO components (uid, tracker_id, name) VALUES ('D6F87C05', 'COMP-ROUTER-001', 'Cisco Router ASR-1000')`);
                    db.run(`INSERT INTO components (uid, tracker_id, name) VALUES ('55667788', 'COMP-SWITCH-002', 'Juniper Switch EX4300')`);
                }
            });
        });
    }
});

module.exports = db;
