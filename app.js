require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
app.set('view engine', 'ejs');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

app.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM notes ORDER BY id DESC');
  res.render('index', { notes: rows });
});

app.listen(process.env.PORT, () => {
  console.log('서버 실행: http://localhost:' + process.env.PORT);
});
