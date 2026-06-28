const express = require('express');
const router = express.Router();
const db = require('../db');

// 更新用药记录
router.put('/:id', (req, res) => {
  try {
    const { drug_name, specification, total_quantity, daily_dosage, unit, start_date, notes } = req.body;
    db.run(
      'UPDATE medications SET drug_name=?, specification=?, total_quantity=?, daily_dosage=?, unit=?, start_date=?, notes=? WHERE id=?',
      [drug_name, specification, total_quantity, daily_dosage, unit, start_date, notes, req.params.id]
    );
    const med = db.get('SELECT * FROM medications WHERE id = ?', [req.params.id]);
    res.json(enrichMedication(med));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除用药记录
router.delete('/:id', (req, res) => {
  try {
    db.run('DELETE FROM medications WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 记录取药（续方）
router.post('/:id/pickup', (req, res) => {
  try {
    const { quantity, pickup_date, notes } = req.body;
    const med = db.get('SELECT * FROM medications WHERE id = ?', [req.params.id]);
    if (!med) return res.status(404).json({ error: '用药记录不存在' });
    
    const pickupDate = pickup_date || new Date().toISOString().split('T')[0];
    db.run('INSERT INTO pickup_records (medication_id, pickup_date, quantity, notes) VALUES (?,?,?,?)',
      [req.params.id, pickupDate, parseFloat(quantity), notes || '']);
    
    // 更新用药记录：重置数量和开始日期
    db.run('UPDATE medications SET total_quantity = total_quantity + ?, start_date = ? WHERE id = ?',
      [parseFloat(quantity), pickupDate, req.params.id]);
    
    const updated = db.get('SELECT * FROM medications WHERE id = ?', [req.params.id]);
    res.json(enrichMedication(updated));
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
