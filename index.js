require('dotenv').config(); 

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const url = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = 'expense-tracker';
const JWT_SECRET = process.env.JWT_SECRET || 'yourSecretKey';

const app = express();
app.use(bodyParser.json());
app.use(cors());

let db;
let isDbReady = false;

// ====== CONNECT TO MONGODB ======
async function startServer() {
  try {
    const client = await MongoClient.connect(url);
    db = client.db(dbName);
    isDbReady = true;
    if (require.main === module) {
      app.listen(3000, () => {
        console.log('Server started on http://localhost:3000');
      });
    }
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
}
startServer();

// ====== DB READY CHECK MIDDLEWARE ======
app.use((req, res, next) => {
  if (!isDbReady) return res.status(503).json({ error: "Database not ready" });
  next();
});

// ====== AUTH MIDDLEWARE ======
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: "No token provided" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

// ====== REGISTER ======
app.post('/register', [
  body('username')
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 4 }).withMessage('Username must be at least 4 characters'),
  body('password')
    .isLength({ min: 4 }).withMessage('Password must be at least 4 characters')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array().map(e => e.msg) });

  const { username, password } = req.body;
  try {
    // เช็ค username ซ้ำ
    const exists = await db.collection('users').findOne({ username });
    if (exists) return res.status(400).json({ error: "Username already exists" });

    // Hash password ก่อนบันทึก
    const hash = await bcrypt.hash(password, 10);
    const result = await db.collection('users').insertOne({ username, password: hash });
    res.json({ id: result.insertedId, username });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ====== LOGIN (RETURN JWT TOKEN) ======
app.post('/login', [
  body('username').notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array().map(e => e.msg) });

  const { username, password } = req.body;
  try {
    const user = await db.collection('users').findOne({ username });
    if (!user) return res.status(401).json({ error: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid password" });

    // Sign JWT (user_id ฝังไว้ใน token)
    const token = jwt.sign({ user_id: user._id, username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====== ADD EXPENSE/INCOME (TOKEN REQUIRED) ======
app.post('/expense', authenticateToken, [
  body('type').isIn(['expense', 'income']).withMessage('type ต้องเป็น expense หรือ income'),
  body('amount').isFloat({ gt: 0 }).withMessage('amount ต้องเป็นตัวเลขมากกว่า 0'),
  body('date').isISO8601().withMessage('date ต้องเป็นวันที่แบบ yyyy-mm-dd'),
  body('description').notEmpty().withMessage('description ต้องไม่ว่าง')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array().map(e => e.msg) });

  const { type, amount, description, date } = req.body;
  try {
    const result = await db.collection('expenses').insertOne({
      user_id: new ObjectId(req.user.user_id), 
      type,
      amount,
      description,
      date
    });
    res.json({ id: result.insertedId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ====== GET ALL EXPENSES BY USER (TOKEN REQUIRED) ======
app.get('/expenses', authenticateToken, async (req, res) => {
  try {
    const expenses = await db.collection('expenses')
      .find({ user_id: new ObjectId(req.user.user_id) })
      .sort({ date: -1 })
      .toArray();
    res.json(expenses);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ====== UPDATE EXPENSE (TOKEN REQUIRED) ======
app.put('/expense/:id', authenticateToken, [
  body('type').isIn(['expense', 'income']).withMessage('type ต้องเป็น expense หรือ income'),
  body('amount').isFloat({ gt: 0 }).withMessage('amount ต้องเป็นตัวเลขมากกว่า 0'),
  body('date').isISO8601().withMessage('date ต้องเป็นวันที่แบบ yyyy-mm-dd'),
  body('description').notEmpty().withMessage('description ต้องไม่ว่าง')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(400).json({ errors: errors.array().map(e => e.msg) });

  const { type, amount, description, date } = req.body;
  try {
    const result = await db.collection('expenses').updateOne(
      { _id: new ObjectId(req.params.id), user_id: new ObjectId(req.user.user_id) },
      { $set: { type, amount, description, date } }
    );
    res.json({ updated: result.modifiedCount });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ====== DELETE EXPENSE (TOKEN REQUIRED) ======
app.delete('/expense/:id', authenticateToken, async (req, res) => {
  try {
    const result = await db.collection('expenses').deleteOne(
      { _id: new ObjectId(req.params.id), user_id: new ObjectId(req.user.user_id) }
    );
    res.json({ deleted: result.deletedCount });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ====== GET SUMMARY (TOKEN REQUIRED) ======
app.get('/summary', authenticateToken, async (req, res) => {
  try {
    const summary = await db.collection('expenses').aggregate([
      { $match: { user_id: new ObjectId(req.user.user_id) } },
      {
        $group: {
          _id: { $substr: ['$date', 0, 7] }, // "2025-09"
          total_income: {
            $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] }
          },
          total_expense: {
            $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] }
          }
        }
      }
    ]).toArray();
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
