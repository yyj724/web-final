const express = require('express');
const pool = require('../db');
const router = express.Router();

const PER_PAGE = 10;

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

async function getBoard(slug) {
  const [rows] = await pool.query('SELECT * FROM boards WHERE slug = ?', [slug]);
  return rows[0];
}

function canWrite(board, user) {
  if (!user) return false;
  return board.write_role === 'all' || user.role === 'admin';
}

// 목록 (검색 + 페이지네이션 + 공지 상단 고정)
router.get('/:slug', async (req, res) => {
  const board = await getBoard(req.params.slug);
  if (!board) return res.status(404).send('게시판이 없어요.');

  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const q = (req.query.q || '').trim();
  const like = '%' + q + '%';
  const where = q ? 'AND (p.title LIKE ? OR p.content LIKE ?)' : '';
  const params = q ? [board.id, like, like] : [board.id];

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM posts p WHERE p.board_id = ? ${where}`, params);

  const [posts] = await pool.query(
    `SELECT p.id, p.title, p.views, p.is_notice, p.created_at, u.name AS author,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
            (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS like_count
     FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.board_id = ? ${where}
     ORDER BY p.is_notice DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, PER_PAGE, (page - 1) * PER_PAGE]);

  res.render('boards/list', {
    board, posts, q, page,
    totalPages: Math.max(Math.ceil(total / PER_PAGE), 1),
    canWrite: canWrite(board, req.session.user),
  });
});

// 글쓰기 화면
router.get('/:slug/new', requireLogin, async (req, res) => {
  const board = await getBoard(req.params.slug);
  if (!board) return res.status(404).send('게시판이 없어요.');
  if (!canWrite(board, req.session.user)) return res.status(403).send('글쓰기 권한이 없어요.');
  res.render('boards/form', { board, post: null });
});

// 글쓰기 저장
router.post('/:slug', requireLogin, async (req, res) => {
  const board = await getBoard(req.params.slug);
  if (!board) return res.status(404).send('게시판이 없어요.');
  if (!canWrite(board, req.session.user)) return res.status(403).send('글쓰기 권한이 없어요.');

  const { title, content } = req.body;
  const isNotice = req.session.user.role === 'admin' && req.body.is_notice ? 1 : 0;
  const [r] = await pool.query(
    'INSERT INTO posts (board_id, user_id, title, content, is_notice) VALUES (?, ?, ?, ?, ?)',
    [board.id, req.session.user.id, title, content, isNotice]);
  res.redirect(`/boards/${board.slug}/${r.insertId}`);
});

// 상세 (조회수 증가, 댓글, 좋아요)
router.get('/:slug/:id', async (req, res) => {
  const board = await getBoard(req.params.slug);
  if (!board) return res.status(404).send('게시판이 없어요.');

  await pool.query('UPDATE posts SET views = views + 1 WHERE id = ? AND board_id = ?', [req.params.id, board.id]);
  const [rows] = await pool.query(
    `SELECT p.*, u.name AS author FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.id = ? AND p.board_id = ?`, [req.params.id, board.id]);
  const post = rows[0];
  if (!post) return res.status(404).send('글이 없어요.');

  const [comments] = await pool.query(
    `SELECT c.*, u.name AS author FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? ORDER BY c.id`, [post.id]);
  const [[{ likeCount }]] = await pool.query(
    'SELECT COUNT(*) AS likeCount FROM post_likes WHERE post_id = ?', [post.id]);
  let liked = false;
  if (req.session.user) {
    const [l] = await pool.query(
      'SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?', [post.id, req.session.user.id]);
    liked = l.length > 0;
  }
  res.render('boards/view', { board, post, comments, likeCount, liked });
});

// 수정 화면
router.get('/:slug/:id/edit', requireLogin, async (req, res) => {
  const board = await getBoard(req.params.slug);
  const [rows] = await pool.query('SELECT * FROM posts WHERE id = ? AND board_id = ?', [req.params.id, board.id]);
  const post = rows[0];
  if (!post) return res.status(404).send('글이 없어요.');
  if (post.user_id !== req.session.user.id && req.session.user.role !== 'admin')
    return res.status(403).send('수정 권한이 없어요.');
  res.render('boards/form', { board, post });
});

// 수정 저장
router.post('/:slug/:id/edit', requireLogin, async (req, res) => {
  const board = await getBoard(req.params.slug);
  const [rows] = await pool.query('SELECT * FROM posts WHERE id = ? AND board_id = ?', [req.params.id, board.id]);
  const post = rows[0];
  if (!post) return res.status(404).send('글이 없어요.');
  if (post.user_id !== req.session.user.id && req.session.user.role !== 'admin')
    return res.status(403).send('수정 권한이 없어요.');
  const isNotice = req.session.user.role === 'admin' && req.body.is_notice ? 1 : 0;
  await pool.query('UPDATE posts SET title = ?, content = ?, is_notice = ? WHERE id = ?',
    [req.body.title, req.body.content, isNotice, post.id]);
  res.redirect(`/boards/${board.slug}/${post.id}`);
});

// 삭제
router.post('/:slug/:id/delete', requireLogin, async (req, res) => {
  const board = await getBoard(req.params.slug);
  const [rows] = await pool.query('SELECT * FROM posts WHERE id = ? AND board_id = ?', [req.params.id, board.id]);
  const post = rows[0];
  if (!post) return res.status(404).send('글이 없어요.');
  if (post.user_id !== req.session.user.id && req.session.user.role !== 'admin')
    return res.status(403).send('삭제 권한이 없어요.');
  await pool.query('DELETE FROM posts WHERE id = ?', [post.id]);
  res.redirect(`/boards/${board.slug}`);
});

// 댓글 작성
router.post('/:slug/:id/comments', requireLogin, async (req, res) => {
  const content = (req.body.content || '').trim();
  if (content) {
    await pool.query('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)',
      [req.params.id, req.session.user.id, content]);
  }
  res.redirect(`/boards/${req.params.slug}/${req.params.id}`);
});

// 댓글 삭제
router.post('/:slug/:id/comments/:cid/delete', requireLogin, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM comments WHERE id = ? AND post_id = ?', [req.params.cid, req.params.id]);
  const c = rows[0];
  if (c && (c.user_id === req.session.user.id || req.session.user.role === 'admin')) {
    await pool.query('DELETE FROM comments WHERE id = ?', [c.id]);
  }
  res.redirect(`/boards/${req.params.slug}/${req.params.id}`);
});

// 좋아요 토글
router.post('/:slug/:id/like', requireLogin, async (req, res) => {
  const [exist] = await pool.query('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?',
    [req.params.id, req.session.user.id]);
  if (exist.length) {
    await pool.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
  } else {
    await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', [req.params.id, req.session.user.id]);
  }
  res.redirect(`/boards/${req.params.slug}/${req.params.id}`);
});

module.exports = router;
