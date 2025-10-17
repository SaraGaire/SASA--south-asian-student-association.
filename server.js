
import 'dotenv/config';
import fs from 'fs';
import https from 'https';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';
import fetch from 'node-fetch';

const app = express();

/* ---------- Config ---------- */
const PORT = process.env.PORT || 5050;
const ORIGIN = process.env.CORS_ORIGIN || '*';
const APPLE_ENABLED = process.env.APPLE_PAY_ENABLED === 'true';

app.set('trust proxy', 1);

/* ---------- Security & Middleware ---------- */
app.use(helmet({
  crossOriginResourcePolicy: false, // allow images/fonts if needed
}));
app.use(cors({ origin: ORIGIN, credentials: false }));
app.use(express.json({ limit: '256kb' }));
app.use(morgan('tiny'));

const limiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

/* ---------- In-memory stores (demo) ---------- */
const store = {
  contacts: [],
  payments: [
    { name: 'Priya N.', method: 'QR', amount: 15, ts: Date.now() - 25 * 60_000 },
    { name: 'Aman S.', method: 'Apple Pay', amount: 15, ts: Date.now() - 55 * 60_000 },
    { name: 'Neha R.', method: 'Bank Transfer', amount: 20, ts: Date.now() - 90 * 60_000 },
  ],
};

/* ---------- Validation Schemas ---------- */
const contactSchema = Joi.object({
  name: Joi.string().min(2).max(80).required(),
  email: Joi.string().email().max(120).required(),
  message: Joi.string().min(5).max(2000).required(),
});

const paymentSchema = Joi.object({
  fullName: Joi.string().min(2).max(80).required(),
  method: Joi.string().valid('QR', 'Apple Pay', 'Bank Transfer').required(),
  amount: Joi.number().min(1).max(5000).required()
});

/* ---------- SSE (Server-Sent Events) ---------- */
const sseClients = new Set();

/** Send an event to all clients */
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

app.get('/api/payments/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': ORIGIN,
  });
  res.write(`event: hello\ndata: "connected"\n\n`);
  sseClients.add(res);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

/* ---------- Routes ---------- */

// Health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, applePayEnabled: APPLE_ENABLED });
});

// Contact
app.post('/api/contact', (req, res) => {
  const { error, value } = contactSchema.validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({ ok: false, errors: error.details.map(d => d.message) });

  const entry = { ...value, ts: Date.now() };
  store.contacts.push(entry);
  res.json({ ok: true, message: 'Thanks for reaching out!' });
});

// Payments — create confirmation
app.post('/api/payments', (req, res) => {
  const { error, value } = paymentSchema.validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({ ok: false, errors: error.details.map(d => d.message) });

  const entry = {
    name: value.fullName,
    method: value.method,
    amount: value.amount,
    ts: Date.now(),
  };
  store.payments.push(entry);

  // push to live stream
  broadcast('payment', entry);

  res.json({ ok: true, payment: entry });
});

// Payments — list recent
app.get('/api/payments', (req, res) => {
  const limit = Math.min(Number(req.query.limit || 25), 200);
  const recent = [...store.payments].sort((a, b) => b.ts - a.ts).slice(0, limit);
  res.json({ ok: true, payments: recent });
});

/* ---------- Apple Pay merchant validation (optional) ---------- */
/**
 * This endpoint PROXIES the Apple Pay merchant validation request.
 * Only enable in production with a valid merchant ID, domain, and certificate.
 * The frontend should POST { validationURL } from ApplePaySession.onvalidatemerchant.
 */
app.post('/api/apple-pay/validate-session', async (req, res) => {
  if (!APPLE_ENABLED) {
    return res.status(501).json({ ok: false, error: 'Apple Pay validation disabled on this server.' });
  }

  const validationURL = req.body?.validationURL;
  if (!validationURL) return res.status(400).json({ ok: false, error: 'Missing validationURL' });

  try {
    const {
      MERCHANT_ID,
      MERCHANT_DOMAIN,
      MERCHANT_DISPLAY_NAME,
      MERCHANT_CERT_PATH,
    } = process.env;

    if (!MERCHANT_ID || !MERCHANT_DOMAIN || !MERCHANT_DISPLAY_NAME || !MERCHANT_CERT_PATH) {
      return res.status(500).json({ ok: false, error: 'Merchant config missing.' });
    }

    const cert = fs.readFileSync(MERCHANT_CERT_PATH); // PEM containing cert + private key
    const agent = new https.Agent({
      cert,
      key: cert,
    });

    const payload = {
      merchantIdentifier: MERCHANT_ID,
      displayName: MERCHANT_DISPLAY_NAME,
      initiative: 'web',
      initiativeContext: MERCHANT_DOMAIN,
    };

    const appleRes = await fetch(validationURL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      agent,
    });

    if (!appleRes.ok) {
      const text = await appleRes.text();
      return res.status(appleRes.status).json({ ok: false, error: text || 'Apple error' });
    }

    const session = await appleRes.json();
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Validation request failed.' });
  }
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`SASA backend listening on http://localhost:${PORT}`);
});
