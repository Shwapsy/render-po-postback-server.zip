// server.js
// PocketOption postback receiver for Render
// Node >=18

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
  if (asBool(ftd)) return 'ftd';           // приоритет 1
  if (asBool(dep)) return 'dep';           // приоритет 2
  if (asBool(conf)) return 'conf';         // приоритет 3
  if (asBool(reg)) return 'reg';           // приоритет 4
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

// Универсальный приёмник постбэков (POST JSON предпочтительно; GET тоже примем)
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
      click_id:  b.click_id ?? null,
      site_id:   b.site_id ?? null,
      trader_id: traderId,
      sumdep:    b.sumdep ?? null,
      totaldep:  b.totaldep ?? null,

      reg, conf, ftd, dep,
      a: b.a ?? null,
      ac: b.ac ?? null,

      event: pickEvent({ reg, conf, ftd, dep }),
      registered: reg || conf,
      deposited:  ftd || dep,

      createdAt: new Date(),
      raw: { ...b, method: req.method },
    };

    await colPostbacks.insertOne(doc);

    // агрегированный статус по трейдеру (опционально)
    if (traderId) {
      const update = {
        $setOnInsert: { trader_id: traderId, createdAt: new Date() },
        $max: { lastEventAt: doc.createdAt },
      };
      // обогащаем флаги, если появились
      if (doc.registered) (update.$set ??= {}, update.$set.registered = true);
      if (doc.deposited)  (update.$set ??= {}, update.$set.deposited = true);
      await colUserStatus.updateOne({ trader_id: traderId }, update, { upsert: true });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('postback error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// старт
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Postback server listening on :${PORT}`);
    });
  })
  .catch((e) => {
    console.error('DB init failed', e);
    process.exit(1);
  });
