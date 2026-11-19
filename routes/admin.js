const express = require('express');
const pool = require('../db');
const router = express.Router();

router.use((req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).send('관리자만 접근할 수 있어요.');
  next();
});

router.get('/', async (req, res) => {
  const [[counts]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM posts) AS posts,
            (SELECT COUNT(*) FROM comments) AS comments`);
  const [users] = await pool.query(
    'SELECT id, student_no, name, email, role, grade, created_at FROM users ORDER BY id');
  res.render('admin/index', { counts, users });
});

router.post('/users/:id/role', async (req, res) => {
  const role = req.body.role;
  if (!['student', 'professor', 'admin'].includes(role)) return res.redirect('/admin');
  if (Number(req.params.id) === req.session.user.id) return res.redirect('/admin'); // 본인 권한은 변경 불가
  await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
  res.redirect('/admin');
});

module.exports = router;
