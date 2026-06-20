/**
 * Express-сервер для Telegram Mini App турагентства
 * Принимает заявку, отправляет её в чат менеджеров
 *
 * Env vars:
 *   BOT_TOKEN        — токен бота (@BotFather)
 *   MANAGER_CHAT_ID  — id группы менеджеров (напр. -1001234567890)
 *   PORT             — порт (по умолчанию 3000)
 *   WEBAPP_ORIGIN    — origin фронтенда для CORS (напр. https://yoursite.com)
 */

const express    = require('express');
require('dotenv').config();
const fetch      = require('node-fetch');
const bodyParser = require('body-parser');
const path       = require('path');
const fs         = require('fs/promises');
const crypto     = require('crypto');

const app = express();

/* ── Env ── */
const BOT_TOKEN       = process.env.BOT_TOKEN;
const MANAGER_CHAT_ID = process.env.MANAGER_CHAT_ID;
const PORT            = process.env.PORT || 3000;
const WEBAPP_ORIGIN   = process.env.WEBAPP_ORIGIN || '*';
const REQUIRE_TELEGRAM_AUTH = process.env.REQUIRE_TELEGRAM_AUTH !== 'false';
const TELEGRAM_AUTH_MAX_AGE_SECONDS = Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS || 86400);
const DATA_DIR        = path.join(__dirname, '..', 'data');
const LEADS_FILE      = path.join(DATA_DIR, 'leads.jsonl');

if (!BOT_TOKEN || !MANAGER_CHAT_ID) {
  console.warn(
    '[warn] BOT_TOKEN и/или MANAGER_CHAT_ID не заданы.\n' +
    '       Сервер запустится, но сообщения в Telegram не отправятся.'
  );
}

/* ── Middleware ── */
app.use(bodyParser.json({ limit: '50kb' }));

// CORS — разрешаем запросы из Telegram WebApp
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', WEBAPP_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Статика — отдаём webapp/ из той же директории
app.use(express.static(path.join(__dirname, '..', 'webapp')));

/* ── Helpers ── */
function esc(text) {
  if (!text) return '—';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatLead(lead) {
  const companion = lead.need_companion ? 'Да' : 'Нет';
  const prefs     = lead.need_companion && lead.companion_preferences
    ? `\n  └ Пожелания: ${esc(lead.companion_preferences)}`
    : '';
  const username  = lead.username ? `@${esc(lead.username)}` : '—';

  return (
    `✈️ <b>Новая заявка на тур</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Имя:</b> ${esc(lead.name)}\n` +
    `🛫 <b>Город вылета:</b> ${esc(lead.departure_city)}\n` +
    `🌍 <b>Направление:</b> ${esc(lead.destination)}\n` +
    `📅 <b>Даты:</b> ${esc(lead.start_date)} — ${esc(lead.end_date)}\n` +
    `💰 <b>Бюджет / чел.:</b> ${esc(lead.budget)}\n` +
    `👥 <b>Туристов:</b> ${esc(lead.tourists_count)}\n` +
    `🤝 <b>Попутчик:</b> ${companion}${prefs}\n` +
    `📞 <b>Телефон:</b> ${esc(lead.phone)}\n` +
    `💬 <b>Telegram:</b> ${username}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🕐 ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Irkutsk' })}`
  );
}

function verifyTelegramInitData(initData) {
  if (!BOT_TOKEN) return false;
  if (!initData || typeof initData !== 'string') return false;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;

  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) return false;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(calculatedHash, 'hex'), Buffer.from(hash, 'hex'));
  } catch (_err) {
    return false;
  }
}

async function saveLead(lead, meta = {}) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const record = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    status: 'new',
    lead,
    meta
  };
  await fs.appendFile(LEADS_FILE, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

async function sendToTelegram(text) {
  if (!BOT_TOKEN || !MANAGER_CHAT_ID) {
    throw new Error('BOT_TOKEN or MANAGER_CHAT_ID is not configured');
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    MANAGER_CHAT_ID,
      text,
      parse_mode: 'HTML'
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
  return res.json();
}

/* ── Validation ── */
function validateLead(lead) {
  if (!lead || typeof lead !== 'object' || Array.isArray(lead)) return ['invalid request body'];

  const required = ['name', 'departure_city', 'destination', 'start_date', 'end_date', 'budget', 'tourists_count', 'phone'];
  const missing  = required.filter(k => !lead[k]);
  const errors = [...missing.map(field => `${field} is required`)];

  if (lead.name && String(lead.name).trim().length < 2) errors.push('name is too short');
  if (lead.phone && String(lead.phone).replace(/\D/g, '').length < 10) errors.push('phone is invalid');
  if (lead.start_date && lead.end_date && String(lead.end_date) <= String(lead.start_date)) {
    errors.push('end_date must be after start_date');
  }
  for (const field of ['name', 'departure_city', 'destination', 'budget', 'phone', 'username']) {
    if (lead[field] && String(lead[field]).length > 120) errors.push(`${field} is too long`);
  }
  if (lead.companion_preferences && String(lead.companion_preferences).length > 1000) {
    errors.push('companion_preferences is too long');
  }

  return errors;
}

/* ── Routes ── */
app.post('/api/lead', async (req, res) => {
  const lead = req.body;

  if (REQUIRE_TELEGRAM_AUTH) {
    const initData = req.get('X-Telegram-Init-Data');
    if (!verifyTelegramInitData(initData)) {
      return res.status(401).json({ status: 'error', message: 'Invalid Telegram initData' });
    }
  }

  const errors = validateLead(lead);
  if (errors.length) {
    return res.status(400).json({ status: 'error', message: errors.join(', ') });
  }

  let savedLead;
  try {
    savedLead = await saveLead(lead, {
      telegram_user: req.get('X-Telegram-Init-Data') ? 'verified' : 'not_checked',
      ip: req.ip
    });
  } catch (err) {
    console.error('[lead] Ошибка сохранения заявки:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Не удалось сохранить заявку. Попробуйте позже.'
    });
  }

  try {
    await sendToTelegram(formatLead(lead));
    console.log(`[lead] ${new Date().toISOString()} | ${lead.name} | ${lead.destination} | ${lead.phone}`);
    return res.json({ status: 'ok', id: savedLead.id });
  } catch (err) {
    console.error('[lead] Ошибка отправки в Telegram:', err.message);
    return res.status(502).json({
      status: 'error',
      message: 'Заявка сохранена, но не отправлена менеджерам. Свяжитесь с нами напрямую или попробуйте позже.',
      warning: 'saved_but_tg_failed'
    });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

/* ── Start ── */
app.listen(PORT, () => {
  console.log(`[server] Запущен на порту ${PORT}`);
  console.log(`[server] BOT_TOKEN: ${BOT_TOKEN ? '✓ задан' : '✗ не задан'}`);
  console.log(`[server] MANAGER_CHAT_ID: ${MANAGER_CHAT_ID ? '✓ задан' : '✗ не задан'}`);
});
