// server.js
// PocketOption postback receiver for Render
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import { MongoClient } from 'mongodb';

// ----- ENV -----
const {
  PORT = 10000,
  MONGODB_URI,
  DB_NAME = 'pocketoption_bot',
  PO_POSTBACK_SECRET,
} = process.env;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set');
  process.exit(1);
}

if (!PO_POSTBACK_SECRET) {
  console.error('❌ PO_POSTBACK_SECRET is not set');
  process.exit(1);
}

// ----- DB -----
const client = new MongoClient(MONGODB_URI);
let db, colPostbacks, colUserStatus;

async function initDb() {
  await client.connect();
  db = client.db(DB_NAME);
  colPostbacks = db.collection('postbacks');
  colUserStatus = db.collection('user_status');
  
  // полезные индексы
  await colPostbacks.createIndex({ trader_id: 1, createdAt: -1 });
  await colUserStatus.createIndex({ trader_id: 1 }, { unique: true });
  
  console.log(`✅ Connected to MongoDB, db=${DB_NAME}`);
}

// ----- helpers -----
const asBool = (v) => v === true || v === 'true' || v === 1 || v === '1';

function pickEvent({ reg, conf, ftd, dep }) {
  if (asBool(ftd)) return 'ftd';
  if (asBool(dep)) return 'dep';
  if (asBool(conf)) return 'conf';
  if (asBool(reg)) return 'reg';
  return 'other';
}

// ----- APP -----
const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('tiny'));
app.use(bodyParser.json({ limit: '256kb' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Универсальный приёмник постбэков
app.all('/api/pocket/postback', async (req, res) => {
  try {
    const { secret } = req.query || {};
    
    if (secret !== PO_POSTBACK_SECRET) {
      return res.status(401).json({ ok: false, error: 'bad_secret' });
    }

    // поддержка JSON body и query string
    const b = (req.method === 'GET' ? req.query : (req.body || {}));
    
    const reg = asBool(b.reg);
    const conf = asBool(b.conf);
    const ftd = asBool(b.ftd);
    const dep = asBool(b.dep);
    const traderId = b.trader_id ? String(b.trader_id) : null;

    const doc = {
      click_id: b.click_id ?? null,
      site_id: b.site_id ?? null,
      trader_id: traderId,
      sumdep: b.sumdep ?? null,
      totaldep: b.totaldep ?? null,
      reg,
      conf,
      ftd,
      dep,
      a: b.a ?? null,
      ac: b.ac ?? null,
      event: pickEvent({ reg, conf, ftd, dep }),
      registered: reg || conf,  // регистрация = reg ИЛИ conf
      deposited: ftd || dep,    // депозит = ftd ИЛИ dep
      createdAt: new Date(),
      raw: { ...b, method: req.method },
    };

    await colPostbacks.insertOne(doc);
    console.log(`📥 Postback received: trader_id=${traderId}, event=${doc.event}, registered=${doc.registered}, deposited=${doc.deposited}`);

    // Агрегированный статус по трейдеру
    if (traderId) {
      // Сначала получаем текущий статус
      const currentStatus = await colUserStatus.findOne({ trader_id: traderId });
      
      const update = {
        $setOnInsert: { 
          trader_id: traderId, 
          createdAt: new Date() 
        },
        $set: {
          lastEventAt: doc.createdAt,
          lastEvent: doc.event
        }
      };

      // Обновляем флаги (раз установлены в true - остаются true навсегда)
      const wasRegistered = currentStatus?.registered || false;
      const wasDeposited = currentStatus?.deposited || false;
      
      update.$set.registered = wasRegistered || doc.registered;
      update.$set.deposited = wasDeposited || doc.deposited;

      await colUserStatus.updateOne(
        { trader_id: traderId }, 
        update, 
        { upsert: true }
      );

      console.log(`📊 Updated user_status: trader_id=${traderId}, registered=${update.$set.registered}, deposited=${update.$set.deposited}`);
    }

    return res.json({ ok: true, event: doc.event });
  } catch (err) {
    console.error('❌ Postback error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// Эндпоинт для проверки статуса (для дебага)
app.get('/api/pocket/status/:traderId', async (req, res) => {
  try {
    const { traderId } = req.params;
    const status = await colUserStatus.findOne({ trader_id: traderId });
    const postbacks = await colPostbacks
      .find({ trader_id: traderId })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    return res.json({
      ok: true,
      trader_id: traderId,
      status: status || null,
      recent_postbacks: postbacks,
    });
  } catch (err) {
    console.error('Status check error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// старт
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Postback server listening on :${PORT}`);
      console.log(`📍 Postback URL: http://localhost:${PORT}/api/pocket/postback?secret=${PO_POSTBACK_SECRET}`);
    });
  })
  .catch((e) => {
    console.error('❌ DB init failed:', e);
    process.exit(1);
  });
