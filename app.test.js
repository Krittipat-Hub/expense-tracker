const request = require('supertest');
const app = require('./index');
const { MongoClient } = require('mongodb');

let db, client;

beforeAll(async () => {
  client = await MongoClient.connect('mongodb://localhost:27017');
  db = client.db('expense-tracker');
  await db.collection('users').deleteMany({ username: /^unittest_/ });
});

afterAll(async () => {
  await db.collection('users').deleteMany({ username: /^unittest_/ });
  await client.close(); // ปิด connection db หลังจบทุกเทสต์
});


describe('API tests', () => {
  it('Register new user', async () => {
    const username = 'unittest_' + Date.now();
    const res = await request(app)
      .post('/register')
      .send({ username, password: 'pass1234' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('username', username);
  });
});
