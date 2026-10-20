'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 10000
});
let schemaReady;

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '12mb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
pool.on('error', (error) => console.error('Food menu database pool error:', error));

function ensureDatabase() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not configured.');
    error.status = 503;
    return Promise.reject(error);
  }
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS food_menu_items (
        id TEXT PRIMARY KEY,
        service_date DATE NOT NULL,
        item JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

function asyncRoute(handler) {
  return function wrappedRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function normalizeItem(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Each menu item must be an object.' };
  }
  const { id, date, period, name } = input;
  if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) {
    return { error: 'Menu item ID is invalid.' };
  }
  if (!validDate(date)) return { error: 'Menu item date must use YYYY-MM-DD.' };
  if (!['Breakfast', 'Lunch & Dinner'].includes(period)) {
    return { error: 'Meal must be Breakfast or Lunch & Dinner.' };
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 100) {
    return { error: 'Dish name is required and must be 100 characters or fewer.' };
  }

  const stringFields = ['category', 'description', 'coworkerCost', 'contractorCost'];
  const limits = { category: 50, description: 500, coworkerCost: 40, contractorCost: 40 };
  for (const field of stringFields) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > limits[field])) {
      return { error: `${field} must be text of ${limits[field]} characters or fewer.` };
    }
  }
  for (const field of ['healthy', 'oneDaySpecial']) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') {
      return { error: `${field} must be a boolean.` };
    }
  }
  if (input.photo !== undefined && input.photo !== '') {
    if (typeof input.photo !== 'string' || input.photo.length > 2_800_000 ||
        !/^data:image\/(?:jpeg|png|webp|gif);base64,[a-z\d+/]+=*$/i.test(input.photo)) {
      return { error: 'Photo must be a JPEG, PNG, WebP, or GIF image no larger than 2 MB.' };
    }
  }
  if (input.ingredients !== undefined && !Array.isArray(input.ingredients)) {
    return { error: 'Ingredients must be a list.' };
  }
  const ingredients = input.ingredients || [];
  if (ingredients.length > 100) return { error: 'A menu item may have at most 100 ingredients.' };
  for (const ingredient of ingredients) {
    if (!ingredient || typeof ingredient.name !== 'string' || !ingredient.name.trim() || ingredient.name.length > 80 ||
        ['coworkerCost', 'contractorCost'].some((field) => ingredient[field] !== undefined &&
          (typeof ingredient[field] !== 'string' || ingredient[field].length > 30)) ||
        (ingredient.available !== undefined && typeof ingredient.available !== 'boolean')) {
      return { error: 'Each ingredient needs a valid name and optional text prices.' };
    }
  }

  const value = {
    id,
    date,
    period,
    name: name.trim(),
    category: input.category || 'Main dish',
    description: input.description || '',
    coworkerCost: input.coworkerCost || '',
    contractorCost: input.contractorCost || '',
    healthy: Boolean(input.healthy),
    oneDaySpecial: Boolean(input.oneDaySpecial),
    ingredients: ingredients.map((ingredient) => ({
      name: ingredient.name.trim(),
      coworkerCost: ingredient.coworkerCost || '',
      contractorCost: ingredient.contractorCost || '',
      available: ingredient.available !== false
    }))
  };
  if (input.photo !== undefined) value.photo = input.photo;
  return { value };
}

function publicItem(row) {
  const date = row.service_date instanceof Date
    ? row.service_date.toISOString().slice(0, 10)
    : String(row.service_date).slice(0, 10);
  const { photo, ...item } = row.item;
  return {
    ...item,
    id: row.id,
    date,
    photoUrl: photo ? `/api/menu-items/${encodeURIComponent(row.id)}/photo` : ''
  };
}

function requireEditor(req, res, next) {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token || !process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'Editor sign-in is required.' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'dc-food-menu'
    });
    if (payload.role !== 'editor') return res.status(403).json({ error: 'Editor access is required.' });
    req.editor = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Editor session expired. Sign in again.' });
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' }
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const configuredPin = process.env.ADMIN_PIN;
  const secret = process.env.JWT_SECRET;
  if (!configuredPin || !secret) {
    return res.status(503).json({ error: 'Editor sign-in is not configured on the server.' });
  }
  const providedPin = req.body && typeof req.body.pin === 'string' ? req.body.pin : '';
  const expected = crypto.createHash('sha256').update(configuredPin).digest();
  const actual = crypto.createHash('sha256').update(providedPin).digest();
  if (!crypto.timingSafeEqual(expected, actual)) {
    return res.status(401).json({ error: 'Incorrect editor PIN.' });
  }
  const token = jwt.sign({ role: 'editor' }, secret, { expiresIn: '12h', issuer: 'dc-food-menu' });
  return res.json({ token, expiresIn: 43200 });
});

app.get('/api/health', asyncRoute(async (req, res) => {
  await ensureDatabase();
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
}));

app.get('/api/menu-items', asyncRoute(async (req, res) => {
  const { from, to } = req.query;
  if (!validDate(from) || !validDate(to) || from >= to) {
    return res.status(400).json({ error: 'Provide a valid date range using from and to (YYYY-MM-DD, with to exclusive).' });
  }
  const rangeDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (rangeDays > 62) return res.status(400).json({ error: 'Date range may not exceed 62 days.' });
  await ensureDatabase();
  const result = await pool.query(
    'SELECT id, service_date, item FROM food_menu_items WHERE service_date >= $1 AND service_date < $2 ORDER BY service_date, item->>\'period\', item->>\'name\'',
    [from, to]
  );
  res.json({ items: result.rows.map(publicItem) });
}));

app.post('/api/menu-items/bulk', requireEditor, asyncRoute(async (req, res) => {
  const items = req.body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 500) {
    return res.status(400).json({ error: 'Import between 1 and 500 menu items at a time.' });
  }
  const normalized = items.map(normalizeItem);
  const invalid = normalized.find((item) => item.error);
  if (invalid) return res.status(400).json({ error: invalid.error });
  normalized.forEach((entry) => {
    if (entry.value.photo === undefined) entry.value.photo = '';
  });
  await ensureDatabase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const entry of normalized) {
      const item = entry.value;
      await client.query(
        `INSERT INTO food_menu_items (id, service_date, item)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET service_date = EXCLUDED.service_date, item = EXCLUDED.item, updated_at = NOW()`,
        [item.id, item.date, JSON.stringify(item)]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json({ imported: normalized.length });
}));

app.post('/api/menu-items', requireEditor, asyncRoute(async (req, res) => {
  const normalized = normalizeItem(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const item = normalized.value;
  if (item.photo === undefined) item.photo = '';
  await ensureDatabase();
  const result = await pool.query(
    'INSERT INTO food_menu_items (id, service_date, item) VALUES ($1, $2, $3::jsonb) RETURNING id, service_date, item',
    [item.id, item.date, JSON.stringify(item)]
  );
  res.status(201).json({ item: publicItem(result.rows[0]) });
}));

app.put('/api/menu-items/:id', requireEditor, asyncRoute(async (req, res) => {
  const normalized = normalizeItem({ ...req.body, id: req.params.id });
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const item = normalized.value;
  await ensureDatabase();
  const result = await pool.query(
    `UPDATE food_menu_items
     SET service_date = $2,
         item = CASE WHEN $3::jsonb ? 'photo' THEN $3::jsonb
                     ELSE $3::jsonb || jsonb_build_object('photo', COALESCE(item->>'photo', '')) END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, service_date, item`,
    [item.id, item.date, JSON.stringify(item)]
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Menu item was not found.' });
  res.json({ item: publicItem(result.rows[0]) });
}));

app.get('/api/menu-items/:id/photo', asyncRoute(async (req, res) => {
  await ensureDatabase();
  const result = await pool.query('SELECT item->>\'photo\' AS photo FROM food_menu_items WHERE id = $1', [req.params.id]);
  if (!result.rowCount || !result.rows[0].photo) return res.status(404).json({ error: 'Menu photo was not found.' });
  const match = result.rows[0].photo.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z\d+/]+=*)$/i);
  if (!match) return res.status(500).json({ error: 'Stored menu photo is invalid.' });
  res.set('Content-Type', match[1]);
  res.set('Cache-Control', 'public, max-age=60');
  res.send(Buffer.from(match[2], 'base64'));
}));

app.delete('/api/menu-items/:id', requireEditor, asyncRoute(async (req, res) => {
  await ensureDatabase();
  const result = await pool.query('DELETE FROM food_menu_items WHERE id = $1', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Menu item was not found.' });
  res.status(204).end();
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/calendar.css', (req, res) => res.sendFile(path.join(__dirname, 'calendar.css')));
app.get('/calendar.js', (req, res) => res.sendFile(path.join(__dirname, 'calendar.js')));
app.get('/menu-template.csv', (req, res) => res.sendFile(path.join(__dirname, 'menu-template.csv')));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must contain valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request is too large.' });
  }
  if (error.status === 503) {
    return res.status(503).json({ error: error.message });
  }
  console.error('Food menu request failed:', error);
  return res.status(500).json({ error: 'The menu service could not complete the request.' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 5000;
  app.listen(port, () => console.log(`DC Food Menu is listening on port ${port}`));
}

module.exports = app;
module.exports.normalizeItem = normalizeItem;
module.exports.validDate = validDate;
