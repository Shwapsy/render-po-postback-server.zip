import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import bodyParser from 'body-parser';
import { MongoClient } from 'mongodb';

const {
  MONGODB_URI,
  MONGODB_DB = 'pocketoption_bot',
  MONGODB_COLLECTION = 'postbacks',
  PO_POSTBACK_SECRET,
  PORT = 10000,
} = process.env;

if (!MONGODB_URI) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

const client = new MongoClient(MONGODB_URI);
let col;
async function initDb() {
  await client.connect();
  const db = client.db(MONGODB_DB);
  col = db.collection(MONGODB_COLLECTION);
  await col.createIndex({ trader_id: 1 });
  await col.createIndex({ click_id: 1 });
  await col.createIndex({ createdAt: -1 });
  console.log('Connected to MongoDB. Using', `${MONGODB_DB}.${MONGODB_COLLECTION}`);
}
initDb().catch(err => {
  console.error('Failed to connect MongoDB', err);
  process.exit(1);
});

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}
function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'po-postback-server', db: `${MONGODB_DB}.${MONGODB_COLLECTION}` });
});

app.all('/api/pocket/postback', async (req, res) => {
  try {
    const payload = req.method === 'GET' ? req.query : req.body;
    if (PO_POSTBACK_SECRET) {
      const provided = payload.secret || req.query?.secret;
      if (provided !== PO_POSTBACK_SECRET) {
        return res.status(401).json({ ok: false, error: 'bad_secret' });
      }
    }

    const doc = {
      click_id: payload.click_id || payload.clickId || null,
      site_id: payload.site_id || payload.siteId || null,
      trader_id: payload.trader_id || payload.traderId || null,
      sumdep: toNum(payload.sumdep),
      totaldep: toNum(payload.totaldep),
      reg: toBool(payload.reg),
      conf: toBool(payload.conf),
      ftd: toBool(payload.ftd),
      dep: toBool(payload.dep),
      a: payload.a ?? null,
      ac: payload.ac ?? null,
      event: 'unknown',
      createdAt: new Date(),
      raw: payload,
    };
    if (doc.reg) doc.event = 'reg';
    else if (doc.conf) doc.event = 'conf';
    else if (doc.ftd) doc.event = 'ftd';
    else if (doc.dep) doc.event = 'dep';

    const result = await col.insertOne(doc);
    return res.json({ ok: true, id: result.insertedId });
  } catch (err) {
    console.error('postback_error', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

const server = app.listen(Number(PORT), () => {
  console.log(`Listening on http://0.0.0.0:${PORT}`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
