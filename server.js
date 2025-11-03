import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import morgan from 'morgan';
import cors from 'cors';
import { User } from './models.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('tiny'));

const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI;
const SECRET = process.env.PO_POSTBACK_SECRET || 'change-me';
const ACCEPT_A = (process.env.PO_ACCEPT_AFFILIATES || '').split(',').map(s=>s.trim()).filter(Boolean);
const ACCEPT_AC = (process.env.PO_ACCEPT_CAMPAIGNS || '').split(',').map(s=>s.trim()).filter(Boolean);

if (!MONGODB_URI) { console.error('MONGODB_URI missing'); process.exit(1); }

await mongoose.connect(MONGODB_URI);
console.log('Connected to MongoDB');

app.get('/', (_req, res) => res.send('PocketOption postback server OK'));
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.all('/api/pocket/postback', async (req, res) => {
  try {
    if ((req.query.secret || req.body?.secret) !== SECRET) {
      return res.status(403).json({ ok: false, error: 'bad_secret' });
    }
    const payload = { ...(req.method === 'GET' ? req.query : req.body) };
    if (ACCEPT_A.length && !ACCEPT_A.includes(String(payload.a || ''))) {
      return res.status(202).json({ ok: true, ignored: 'affiliate' });
    }
    if (ACCEPT_AC.length && !ACCEPT_AC.includes(String(payload.ac || ''))) {
      return res.status(202).json({ ok: true, ignored: 'campaign' });
    }
    const trader_id = String(payload.trader_id || '').trim();
    if (!trader_id) return res.status(400).json({ ok: false, error: 'missing_trader_id' });

    const reg  = String(payload.reg || 'false') === 'true';
    const conf = String(payload.conf || 'false') === 'true';
    const ftd  = String(payload.ftd || 'false') === 'true';
    const dep  = String(payload.dep || 'false') === 'true';
    const sumdep = Number(payload.sumdep || 0) || 0;
    const totaldep = Number(payload.totaldep || 0) || 0;

    const update = {
      $setOnInsert: { trader_id },
      $set: {
        lastEvent: ftd ? 'ftd' : (dep ? 'dep' : (conf ? 'conf' : (reg ? 'reg' : 'unknown'))),
        lastPostbackAt: new Date(),
        lastRaw: payload
      }
    };
    if (reg) update.$set.registeredByLink = true;
    if (conf) update.$set.emailConfirmed = true;
    if (ftd || dep) update.$set.hasDeposit = true;
    if (ftd && !update.$set.ftdAt) update.$set.ftdAt = new Date();
    if (sumdep) update.$set.lastDepositAmount = sumdep;
    if (totaldep) update.$set.totalDeposits = totaldep;

    await User.updateOne({ trader_id }, update, { upsert: true });
    return res.json({ ok: true });
  } catch (e) {
    console.error('postback error:', e);
    return res.status(500).json({ ok: false, error: 'internal' });
  }
});

app.listen(PORT, () => console.log(`Listening on :${PORT}`));
