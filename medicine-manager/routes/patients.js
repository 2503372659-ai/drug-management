const express = require('express');
const router = express.Router();
const db = require('../db');

// 获取所有患者（含用药摘要和下取药日期）
router.get('/', (req, res) => {
  try {
    const patients = db.all(`SELECT * FROM patients ORDER BY created_at DESC`);
    
    const result = patients.map(p => {
      const meds = db.all(`SELECT * FROM medications WHERE patient_id = ?`, [p.id]);
      
      // 计算最近取药提醒
      let nextPickupDate = null;
      let hasUrgent = false;
      const medicationSummaries = meds.map(m => {
        const daysSupply = m.daily_dosage > 0 ? Math.floor(m.total_quantity / m.daily_dosage) : 0;
        const start = new Date(m.start_date + 'T00:00:00');
        const nextDate = new Date(start);
        nextDate.setDate(nextDate.getDate() + daysSupply);
        const today = new Date(); today.setHours(0,0,0,0);
        const isOverdue = nextDate <= new Date(today.getTime() + 3 * 86400000);
        if (isOverdue) hasUrgent = true;
        if (!nextPickupDate || nextDate < nextPickupDate) nextPickupDate = nextDate;
        return {
          id: m.id,
          drug_name: m.drug_name,
          specification: m.specification,
          total_quantity: m.total_quantity,
          daily_dosage: m.daily_dosage,
          unit: m.unit,
          start_date: m.start_date,
          days_supply: daysSupply,
          next_pickup_date: formatDate(nextDate),
          is_urgent: isOverdue
        };
      });
      
      return {
        ...p,
        medication_count: meds.length,
        has_urgent: hasUrgent,
        medications: medicationSummaries,
        next_pickup_date: nextPickupDate ? formatDate(nextPickupDate) : null
      };
    });
    
    res.json(result);
  } catch (e) {
    console.error('Patients route error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 获取单个患者
router.get('/:id', (req, res) => {
  try {
    const patient = db.get('SELECT * FROM patients WHERE id = ?', [req.params.id]);
    if (!patient) return res.status(404).json({ error: '患者不存在' });
    
    const meds = db.all('SELECT * FROM medications WHERE patient_id = ? ORDER BY created_at DESC', [req.params.id]);
    const enrichedMeds = meds.map(m => enrichMedication(m));
    
    patient.medications = enrichedMeds;
    res.json(patient);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建患者
router.post('/', (req, res) => {
  try {
    const { name, phone, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '患者姓名不能为空' });
    const result = db.run('INSERT INTO patients (name, phone, notes) VALUES (?, ?, ?)', 
      [name.trim(), phone || '', notes || '']);
    const patient = db.get('SELECT * FROM patients WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(patient);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新患者
router.put('/:id', (req, res) => {
  try {
    const { name, phone, notes } = req.body;
    db.run('UPDATE patients SET name=?, phone=?, notes=? WHERE id=?',
      [name.trim(), phone || '', notes || '', req.params.id]);
    const patient = db.get('SELECT * FROM patients WHERE id = ?', [req.params.id]);
    res.json(patient);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除患者
router.delete('/:id', (req, res) => {
  try {
    db.run('DELETE FROM patients WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 用药记录路由（嵌套在患者下） =====

// 获取患者的所有用药记录
router.get('/:id/medications', (req, res) => {
  try {
    const meds = db.all('SELECT * FROM medications WHERE patient_id = ? ORDER BY created_at DESC', [req.params.id]);
    res.json(meds.map(m => enrichMedication(m)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 添加用药记录
router.post('/:id/medications', (req, res) => {
  try {
    const { drug_name, specification, total_quantity, daily_dosage, unit, start_date, notes } = req.body;
    if (!drug_name || !total_quantity || !daily_dosage || !start_date) {
      return res.status(400).json({ error: '药品名称、总数量、每日用量、开始日期不能为空' });
    }
    const result = db.run(
      'INSERT INTO medications (patient_id, drug_name, specification, total_quantity, daily_dosage, unit, start_date, notes) VALUES (?,?,?,?,?,?,?,?)',
      [req.params.id, drug_name.trim(), specification || '', parseFloat(total_quantity), parseFloat(daily_dosage), unit || '片', start_date, notes || '']
    );
    const med = db.get('SELECT * FROM medications WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(enrichMedication(med));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function enrichMedication(m) {
  const daysSupply = m.daily_dosage > 0 ? Math.floor(m.total_quantity / m.daily_dosage) : 0;
  const start = new Date(m.start_date + 'T00:00:00');
  const nextDate = new Date(start);
  nextDate.setDate(nextDate.getDate() + daysSupply);
  const today = new Date(); today.setHours(0,0,0,0);
  const daysUntilPickup = Math.ceil((nextDate.getTime() - today.getTime()) / 86400000);
  
  // 获取取药历史
  const pickups = db.all('SELECT * FROM pickup_records WHERE medication_id = ? ORDER BY pickup_date DESC', [m.id]);
  
  return {
    ...m,
    days_supply: daysSupply,
    next_pickup_date: formatDate(nextDate),
    days_until_pickup: daysUntilPickup,
    is_urgent: daysUntilPickup <= 3,
    is_overdue: daysUntilPickup <= 0,
    pickup_records: pickups
  };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = router;
