require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const pool = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 },
}));

// 모든 화면에서 쓸 공통 데이터 (로그인 사용자, 게시판 목록)
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  try {
    const [boards] = await pool.query('SELECT id, name, slug FROM boards ORDER BY sort_order');
    res.locals.boards = boards;
  } catch (e) {
    res.locals.boards = [];
  }
  next();
});

app.get('/', (req, res) => res.render('index'));
app.use('/', require('./routes/auth'));
app.use('/boards', require('./routes/boards'));

app.listen(process.env.PORT || 3000, () => {
  console.log('서버 실행: http://localhost:' + (process.env.PORT || 3000));
});
