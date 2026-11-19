const express = require('express');
const pool = require('../db');
const router = express.Router();

router.get('/', async (req, res) => {
  const [notices] = await pool.query(
    `SELECT p.id, p.title, p.created_at FROM posts p JOIN boards b ON b.id = p.board_id
     WHERE b.slug = 'notice' ORDER BY p.id DESC LIMIT 5`);
  const [recent] = await pool.query(
    `SELECT p.id, p.title, p.created_at, b.slug, b.name AS board_name
     FROM posts p JOIN boards b ON b.id = p.board_id
     WHERE b.slug <> 'notice' ORDER BY p.id DESC LIMIT 5`);
  const [schedules] = await pool.query(
    'SELECT * FROM schedules WHERE end_date >= CURDATE() ORDER BY start_date LIMIT 5');
  res.render('index', { notices, recent, schedules });
});

module.exports = router;
