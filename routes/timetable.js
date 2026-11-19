const express = require('express');
const pool = require('../db');
const T = require('../lib/timetable');
const router = express.Router();

router.use((req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
});

const back = (res, path, msg) => res.redirect(path + '?error=' + encodeURIComponent(msg));

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 내 시간표 + 내 그룹
router.get('/', async (req, res) => {
  const uid = req.session.user.id;
  const [entries] = await pool.query(
    'SELECT * FROM timetable_entries WHERE user_id = ? ORDER BY day_of_week, start_time', [uid]);
  const [groups] = await pool.query(
    `SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
     FROM meeting_groups g JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = ? ORDER BY g.id DESC`, [uid]);
  res.render('timetable/index', {
    entries, groups, grid: T.buildMyGrid(entries),
    days: T.DAYS, slotLabel: T.slotLabel, error: req.query.error || null,
  });
});

// 수업 추가 (범위·겹침 검사)
router.post('/entries', async (req, res) => {
  const uid = req.session.user.id;
  const day = parseInt(req.body.day_of_week);
  const { start_time, end_time } = req.body;
  const course = (req.body.course_name || '').trim();
  const room = (req.body.room || '').trim() || null;

  if (!(day >= 1 && day <= 5) || !course || !start_time || !end_time)
    return back(res, '/timetable', '요일, 시간, 과목명을 모두 입력해 주세요.');
  const s = T.toMin(start_time), e = T.toMin(end_time);
  if (s >= e) return back(res, '/timetable', '종료 시간은 시작 시간보다 늦어야 해요.');
  if (s < T.DAY_START || e > T.DAY_END)
    return back(res, '/timetable', `${T.toStr(T.DAY_START)}~${T.toStr(T.DAY_END)} 사이로 입력해 주세요.`);

  const [[ov]] = await pool.query(
    `SELECT COUNT(*) AS n FROM timetable_entries
     WHERE user_id = ? AND day_of_week = ? AND start_time < ? AND end_time > ?`,
    [uid, day, end_time, start_time]);
  if (ov.n > 0) return back(res, '/timetable', '이미 같은 시간대에 등록된 수업이 있어요.');

  await pool.query(
    `INSERT INTO timetable_entries (user_id, day_of_week, start_time, end_time, course_name, room)
     VALUES (?, ?, ?, ?, ?, ?)`, [uid, day, start_time, end_time, course, room]);
  res.redirect('/timetable');
});

router.post('/entries/:id/delete', async (req, res) => {
  await pool.query('DELETE FROM timetable_entries WHERE id = ? AND user_id = ?',
    [req.params.id, req.session.user.id]);
  res.redirect('/timetable');
});

// 그룹 만들기 (초대 코드 자동 생성)
router.post('/groups', async (req, res) => {
  const uid = req.session.user.id;
  const name = (req.body.name || '').trim();
  if (!name) return back(res, '/timetable', '그룹 이름을 입력해 주세요.');
  let gid = null;
  for (let i = 0; i < 5 && !gid; i++) {
    try {
      const [r] = await pool.query(
        'INSERT INTO meeting_groups (name, owner_id, invite_code) VALUES (?, ?, ?)', [name, uid, genCode()]);
      gid = r.insertId;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }
  }
  if (!gid) return back(res, '/timetable', '그룹을 만들지 못했어요. 다시 시도해 주세요.');
  await pool.query('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [gid, uid]);
  res.redirect('/timetable/groups/' + gid);
});

// 초대 코드로 참여
router.post('/groups/join', async (req, res) => {
  const code = (req.body.invite_code || '').trim().toUpperCase();
  const [rows] = await pool.query('SELECT * FROM meeting_groups WHERE invite_code = ?', [code]);
  if (!rows[0]) return back(res, '/timetable', '초대 코드가 올바르지 않아요.');
  await pool.query('INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)',
    [rows[0].id, req.session.user.id]);
  res.redirect('/timetable/groups/' + rows[0].id);
});

// 그룹 상세 + 공통 공강 계산
router.get('/groups/:id', async (req, res) => {
  const uid = req.session.user.id;
  const [g] = await pool.query('SELECT * FROM meeting_groups WHERE id = ?', [req.params.id]);
  const group = g[0];
  if (!group) return res.status(404).send('그룹이 없어요.');
  const [m] = await pool.query('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [group.id, uid]);
  if (!m.length) return res.status(403).send('그룹원만 볼 수 있어요.');

  const [members] = await pool.query(
    `SELECT u.id, u.name, u.student_no,
            (SELECT COUNT(*) FROM timetable_entries t WHERE t.user_id = u.id) AS entry_count
     FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ? ORDER BY gm.joined_at`, [group.id]);
  const memberIds = members.map((x) => x.id);
  const [entries] = await pool.query(
    'SELECT user_id, day_of_week, start_time, end_time FROM timetable_entries WHERE user_id IN (?)', [memberIds]);

  const allowed = [30, 60, 90, 120];
  let minMinutes = parseInt(req.query.min) || 60;
  if (!allowed.includes(minMinutes)) minMinutes = 60;

  const result = T.computeGroup(memberIds, entries, minMinutes / T.SLOT);
  res.render('timetable/group', {
    group, members, isOwner: group.owner_id === uid,
    noTimetable: members.filter((x) => x.entry_count === 0),
    minMinutes, allowed, total: members.length,
    busyCount: result.busyCount, inRun: result.inRun, runs: result.runs, best: result.best,
    days: T.DAYS, slotLabel: T.slotLabel, fmtMin: T.fmtMin, SLOT_COUNT: T.SLOT_COUNT,
  });
});

// 그룹 나가기 (그룹장은 불가)
router.post('/groups/:id/leave', async (req, res) => {
  const [g] = await pool.query('SELECT * FROM meeting_groups WHERE id = ?', [req.params.id]);
  if (g[0] && g[0].owner_id !== req.session.user.id) {
    await pool.query('DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.session.user.id]);
  }
  res.redirect('/timetable');
});

// 그룹 삭제 (그룹장만)
router.post('/groups/:id/delete', async (req, res) => {
  await pool.query('DELETE FROM meeting_groups WHERE id = ? AND owner_id = ?',
    [req.params.id, req.session.user.id]);
  res.redirect('/timetable');
});

module.exports = router;
