const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { initDB, all } = require('./db');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Create uploads directory
const uploadDir = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// API routes
app.use('/api/patients', require('./routes/patients'));
app.use('/api/medications', require('./routes/medications'));
app.use('/api/ocr', require('./routes/ocr'));

// Dashboard
app.get('/api/dashboard', (req, res) => {
  try {
    const patients = all('SELECT * FROM patients ORDER BY created_at DESC');
    const urgentList = [];
    let totalMeds = 0;
    patients.forEach(p => {
      const meds = all('SELECT * FROM medications WHERE patient_id = ?', [p.id]);
      totalMeds += meds.length;
      meds.forEach(m => {
        const daysSupply = m.daily_dosage > 0 ? Math.floor(m.total_quantity / m.daily_dosage) : 0;
        const start = new Date(m.start_date + 'T00:00:00');
        const nextDate = new Date(start);
        nextDate.setDate(nextDate.getDate() + daysSupply);
        const today = new Date(); today.setHours(0,0,0,0);
        const daysUntil = Math.ceil((nextDate.getTime() - today.getTime()) / 86400000);
        if (daysUntil <= 3) {
          urgentList.push({
            patient_name: p.name, patient_id: p.id,
            medication_id: m.id, drug_name: m.drug_name,
            next_pickup_date: formatDate(nextDate),
            days_until: daysUntil, is_overdue: daysUntil <= 0
          });
        }
      });
    });
    urgentList.sort((a, b) => a.days_until - b.days_until);
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
      }
    }
    res.json({
      total_patients: patients.length,
      total_medications: totalMeds,
      urgent_count: urgentList.filter(u => !u.is_overdue).length,
      overdue_count: urgentList.filter(u => u.is_overdue).length,
      urgent_list: urgentList,
      server_ip: addresses, port: PORT
    });
  } catch (e) {
    console.error('Dashboard error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Data export
app.get('/api/export', (req, res) => {
  try {
    const db2 = require('./db');
    res.json({
      export_time: new Date().toISOString(),
      patients: db2.all('SELECT * FROM patients ORDER BY id'),
      medications: db2.all('SELECT * FROM medications ORDER BY id'),
      pickup_records: db2.all('SELECT * FROM pickup_records ORDER BY id')
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Data import
app.post('/api/import', (req, res) => {
  try {
    const data = req.body;
    if (!data.patients) return res.status(400).json({ error: '数据格式不正确' });
    const db2 = require('./db');
    db2.run('DELETE FROM pickup_records');
    db2.run('DELETE FROM medications');
    db2.run('DELETE FROM patients');
    (data.patients || []).forEach(p => {
      db2.run('INSERT INTO patients (id, name, phone, notes, created_at) VALUES (?,?,?,?,?)',
        [p.id, p.name, p.phone || '', p.notes || '', p.created_at]);
    });
    (data.medications || []).forEach(m => {
      db2.run('INSERT INTO medications (id, patient_id, drug_name, specification, total_quantity, daily_dosage, unit, start_date, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [m.id, m.patient_id, m.drug_name, m.specification || '', m.total_quantity, m.daily_dosage, m.unit || '片', m.start_date, m.notes || '', m.created_at]);
    });
    (data.pickup_records || []).forEach(r => {
      db2.run('INSERT INTO pickup_records (id, medication_id, pickup_date, quantity, notes, created_at) VALUES (?,?,?,?,?,?)',
        [r.id, r.medication_id, r.pickup_date, r.quantity, r.notes || '', r.created_at]);
    });
    res.json({ success: true, message: '数据导入成功' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve frontend
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler for OCR worker crashes
process.on('uncaughtException', e => {
  if (e.message && e.message.includes('tesseract')) {
    console.error('Tesseract worker error (non-fatal):', e.message);
  } else {
    console.error('Uncaught exception:', e.message);
  }
});
process.on('unhandledRejection', (reason) => {
  if (reason && reason.message && reason.message.includes('tesseract')) {
    console.error('Tesseract unhandled rejection (non-fatal)');
  } else {
    console.error('Unhandled rejection:', reason);
  }
});

async function start() {
  await initDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('==========================================');
    console.log('     🏥 慢性病用药管理系统');
    console.log('==========================================');
    console.log('  本地访问: http://localhost:' + PORT);
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log('  手机访问: http://' + iface.address + ':' + PORT);
        }
      }
    }
    console.log('==========================================');
    console.log('');
  });
}

start();

function formatDate(date) {
  if (!(date instanceof Date)) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}
