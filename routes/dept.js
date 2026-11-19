const express = require('express');
const pool = require('../db');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).send('관리자만 접근할 수 있어요.');
  next();
}

router.get('/about', (req, res) => res.render('dept/about'));
router.get('/curriculum', (req, res) => res.render('dept/curriculum'));

// 교수진
router.get('/professors', async (req, res) => {
  const [professors] = await pool.query('SELECT * FROM professors ORDER BY id');
  res.render('dept/professors', { professors });
});
router.post('/professors', requireAdmin, async (req, res) => {
  const { name, field, office, email, intro } = req.body;
  await pool.query(
    'INSERT INTO professors (name, field, office, email, intro) VALUES (?, ?, ?, ?, ?)',
    [name, field || null, office || null, email || null, intro || null]);
  res.redirect('/dept/professors');
});
router.post('/professors/:id/delete', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM professors WHERE id = ?', [req.params.id]);
  res.redirect('/dept/professors');
});

// 학사 일정
router.get('/schedule', async (req, res) => {
  const [schedules] = await pool.query('SELECT * FROM schedules ORDER BY start_date');
  res.render('dept/schedule', { schedules });
});
router.post('/schedule', requireAdmin, async (req, res) => {
  const { title, start_date, end_date, description } = req.body;
  await pool.query(
    'INSERT INTO schedules (title, start_date, end_date, description) VALUES (?, ?, ?, ?)',
    [title, start_date, end_date || start_date, description || null]);
  res.redirect('/dept/schedule');
});
router.post('/schedule/:id/delete', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM schedules WHERE id = ?', [req.params.id]);
  res.redirect('/dept/schedule');
});

module.exports = router;
