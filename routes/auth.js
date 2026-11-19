const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const router = express.Router();

router.get('/register', (req, res) => {
  res.render('register', { error: null, form: {} });
});

router.post('/register', async (req, res) => {
  const { student_no, name, email, password, password2, grade } = req.body;
  const form = { student_no, name, email, grade };
  const fail = (msg) => res.render('register', { error: msg, form });

  if (!student_no || !name || !email || !password) return fail('모든 항목을 입력해주세요.');
  if (password.length < 6) return fail('비밀번호는 6자 이상이어야 해요.');
  if (password !== password2) return fail('비밀번호가 서로 달라요.');

  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (student_no, name, email, password_hash, grade) VALUES (?, ?, ?, ?, ?)',
      [student_no, name, email, hash, grade || null]
    );
    res.redirect('/login');
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail('이미 가입된 학번 또는 이메일이에요.');
    console.error(e);
    fail('가입 중 오류가 발생했어요.');
  }
});

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { student_no, password } = req.body;
  const [rows] = await pool.query('SELECT * FROM users WHERE student_no = ?', [student_no]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    return res.render('login', { error: '학번 또는 비밀번호가 올바르지 않아요.' });
  }
  req.session.user = { id: u.id, name: u.name, student_no: u.student_no, role: u.role };
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
