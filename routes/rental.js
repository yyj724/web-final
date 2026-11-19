const express = require('express');
const pool = require('../db');
const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).send('관리자만 접근할 수 있어요.');
  next();
}
const back = (res, path, msg) => res.redirect(path + '?error=' + encodeURIComponent(msg));

// ───────── 일반 회원 ─────────

// 장비 목록 + 내 대여 현황
router.get('/', async (req, res) => {
  const [equipment] = await pool.query('SELECT * FROM equipment ORDER BY category, name');
  let myRentals = [];
  if (req.session.user) {
    [myRentals] = await pool.query(
      `SELECT r.*, e.name AS equipment_name,
              CASE WHEN r.status = 'rented' AND r.due_date < CURDATE()
                   THEN DATEDIFF(CURDATE(), r.due_date) ELSE 0 END AS overdue_days
       FROM rentals r JOIN equipment e ON e.id = r.equipment_id
       WHERE r.user_id = ? ORDER BY r.id DESC`, [req.session.user.id]);
  }
  res.render('rental/index', { equipment, myRentals, error: req.query.error || null });
});

// 대여 신청
router.post('/request', requireLogin, async (req, res) => {
  const uid = req.session.user.id;
  const eid = parseInt(req.body.equipment_id);
  const qty = Math.max(parseInt(req.body.qty) || 1, 1);

  // 연체 중이면 신청 차단
  const [[od]] = await pool.query(
    "SELECT COUNT(*) AS n FROM rentals WHERE user_id = ? AND status = 'rented' AND due_date < CURDATE()", [uid]);
  if (od.n > 0) return back(res, '/rental', '연체 중인 장비가 있어서 새로 신청할 수 없어요. 먼저 반납해 주세요.');

  const [eq] = await pool.query('SELECT * FROM equipment WHERE id = ?', [eid]);
  if (!eq[0]) return back(res, '/rental', '존재하지 않는 장비예요.');
  if (qty > eq[0].available_qty) return back(res, '/rental', '재고보다 많이 신청할 수 없어요.');

  // 같은 장비 중복 신청 방지
  const [[dup]] = await pool.query(
    "SELECT COUNT(*) AS n FROM rentals WHERE user_id = ? AND equipment_id = ? AND status = 'requested'", [uid, eid]);
  if (dup.n > 0) return back(res, '/rental', '이미 승인 대기 중인 신청이 있어요.');

  await pool.query('INSERT INTO rentals (equipment_id, user_id, qty) VALUES (?, ?, ?)', [eid, uid, qty]);
  res.redirect('/rental');
});

// 신청 취소 (승인 전에만)
router.post('/:id/cancel', requireLogin, async (req, res) => {
  await pool.query("DELETE FROM rentals WHERE id = ? AND user_id = ? AND status = 'requested'",
    [req.params.id, req.session.user.id]);
  res.redirect('/rental');
});

// ───────── 관리자 ─────────

router.get('/admin', requireAdmin, async (req, res) => {
  const [pending] = await pool.query(
    `SELECT r.*, u.name AS user_name, u.student_no, e.name AS equipment_name, e.available_qty
     FROM rentals r JOIN users u ON u.id = r.user_id JOIN equipment e ON e.id = r.equipment_id
     WHERE r.status = 'requested' ORDER BY r.id`);
  const [rented] = await pool.query(
    `SELECT r.*, u.name AS user_name, u.student_no, e.name AS equipment_name,
            CASE WHEN r.due_date < CURDATE() THEN DATEDIFF(CURDATE(), r.due_date) ELSE 0 END AS overdue_days
     FROM rentals r JOIN users u ON u.id = r.user_id JOIN equipment e ON e.id = r.equipment_id
     WHERE r.status = 'rented' ORDER BY r.due_date`);
  const [ranking] = await pool.query(
    `SELECT e.name, COUNT(*) AS times, SUM(r.qty) AS total_qty
     FROM rentals r JOIN equipment e ON e.id = r.equipment_id
     WHERE r.status IN ('rented', 'returned')
     GROUP BY e.id, e.name ORDER BY times DESC, total_qty DESC LIMIT 5`);
  const [equipment] = await pool.query('SELECT * FROM equipment ORDER BY category, name');
  res.render('rental/admin', { pending, rented, ranking, equipment, error: req.query.error || null });
});

// 승인: 재고 차감 + 대여중 처리 (트랜잭션)
router.post('/admin/:id/approve', requireAdmin, async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.body.days) || 7, 1), 30);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[rental]] = await conn.query('SELECT * FROM rentals WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rental || rental.status !== 'requested') throw new Error('이미 처리된 신청이에요.');
    const [[eq]] = await conn.query('SELECT * FROM equipment WHERE id = ? FOR UPDATE', [rental.equipment_id]);
    if (eq.available_qty < rental.qty) throw new Error('재고가 부족해서 승인할 수 없어요.');
    await conn.query('UPDATE equipment SET available_qty = available_qty - ? WHERE id = ?', [rental.qty, eq.id]);
    await conn.query(
      `UPDATE rentals SET status = 'rented', approved_by = ?, approved_at = NOW(),
       due_date = DATE_ADD(CURDATE(), INTERVAL ? DAY) WHERE id = ?`,
      [req.session.user.id, days, rental.id]);
    await conn.commit();
    res.redirect('/rental/admin');
  } catch (e) {
    await conn.rollback();
    back(res, '/rental/admin', e.message);
  } finally {
    conn.release();
  }
});

// 거절
router.post('/admin/:id/reject', requireAdmin, async (req, res) => {
  await pool.query("UPDATE rentals SET status = 'rejected' WHERE id = ? AND status = 'requested'", [req.params.id]);
  res.redirect('/rental/admin');
});

// 반납: 재고 복구 (트랜잭션)
router.post('/admin/:id/return', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[rental]] = await conn.query('SELECT * FROM rentals WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rental || rental.status !== 'rented') throw new Error('대여중인 건이 아니에요.');
    await conn.query('UPDATE equipment SET available_qty = available_qty + ? WHERE id = ?',
      [rental.qty, rental.equipment_id]);
    await conn.query("UPDATE rentals SET status = 'returned', returned_at = NOW() WHERE id = ?", [rental.id]);
    await conn.commit();
    res.redirect('/rental/admin');
  } catch (e) {
    await conn.rollback();
    back(res, '/rental/admin', e.message);
  } finally {
    conn.release();
  }
});

// 장비 등록
router.post('/admin/equipment', requireAdmin, async (req, res) => {
  const { name, category, total_qty, description } = req.body;
  const total = Math.max(parseInt(total_qty) || 1, 1);
  await pool.query(
    'INSERT INTO equipment (name, category, total_qty, available_qty, description) VALUES (?, ?, ?, ?, ?)',
    [name, category, total, total, description || null]);
  res.redirect('/rental/admin');
});

// 장비 삭제 (대여 기록이 있으면 불가)
router.post('/admin/equipment/:id/delete', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM equipment WHERE id = ?', [req.params.id]);
    res.redirect('/rental/admin');
  } catch (e) {
    back(res, '/rental/admin', '대여 기록이 있는 장비는 삭제할 수 없어요.');
  }
});

module.exports = router;
