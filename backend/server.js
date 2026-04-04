const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || '/data/weather.db';
const POLL_INTERVAL = 5000; // 5 seconds
const WINDOW_MINUTES = 30;
const PORT = 3000;

// --- Database setup ---

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    windspeedmph REAL,
    windgustmph REAL,
    winddir REAL,
    tempf REAL,
    received_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_readings_ts ON readings(ts);
`);

// Clean up readings older than 24 hours periodically
function cleanOldReadings() {
  db.prepare(`DELETE FROM readings WHERE ts < datetime('now', '-24 hours')`).run();
}
setInterval(cleanOldReadings, 60 * 60 * 1000); // every hour

// --- Poll pi3 weather API ---

function fetchWeather() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:80/api/weather', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const insertReading = db.prepare(`
  INSERT INTO readings (windspeedmph, windgustmph, winddir, tempf, received_at)
  VALUES (@windspeedmph, @windgustmph, @winddir, @tempf, @received_at)
`);

async function poll() {
  try {
    const w = await fetchWeather();
    insertReading.run({
      windspeedmph: parseFloat(w.windspeedmph) || null,
      windgustmph: parseFloat(w.windgustmph) || null,
      winddir: parseFloat(w.winddir) || null,
      tempf: parseFloat(w.tempf) || null,
      received_at: w.received_at || new Date().toISOString(),
    });
  } catch (err) {
    console.error('Poll failed:', err.message);
  }
}

setInterval(poll, POLL_INTERVAL);
poll(); // initial poll

// --- Compute 30-minute windows ---

function getWindows() {
  // Get readings from today (last 24h)
  const rows = db.prepare(`
    SELECT
      windspeedmph, windgustmph, winddir, ts
    FROM readings
    WHERE ts > datetime('now', '-24 hours')
    ORDER BY ts ASC
  `).all();

  if (!rows.length) return [];

  // Group into 30-minute buckets
  const windows = new Map();

  for (const row of rows) {
    const date = new Date(row.ts);
    // Round down to nearest 30-min boundary
    const mins = date.getUTCMinutes();
    const bucket = mins < 30 ? 0 : 30;
    date.setUTCMinutes(bucket, 0, 0);
    const key = date.toISOString();

    if (!windows.has(key)) {
      windows.set(key, {
        window_start: key,
        readings: [],
      });
    }
    windows.get(key).readings.push(row);
  }

  // Compute aggregates
  const result = [];
  for (const [, win] of windows) {
    const r = win.readings;
    const avgSpeed = r.reduce((s, x) => s + (x.windspeedmph || 0), 0) / r.length;
    const maxGust = Math.max(...r.map(x => x.windgustmph || 0));
    const avgDir = averageAngle(r.map(x => x.winddir).filter(d => d != null));

    const start = new Date(win.window_start);
    const end = new Date(start.getTime() + WINDOW_MINUTES * 60 * 1000);

    result.push({
      window_start: win.window_start,
      window_end: end.toISOString(),
      avg_windspeed_mph: Math.round(avgSpeed * 10) / 10,
      max_gust_mph: Math.round(maxGust * 10) / 10,
      avg_winddir: avgDir != null ? Math.round(avgDir) : null,
      reading_count: r.length,
    });
  }

  return result.sort((a, b) => a.window_start.localeCompare(b.window_start));
}

// Average angles correctly (vector mean)
function averageAngle(degrees) {
  if (!degrees.length) return null;
  let sinSum = 0, cosSum = 0;
  for (const d of degrees) {
    const rad = (d * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const avg = (Math.atan2(sinSum / degrees.length, cosSum / degrees.length) * 180) / Math.PI;
  return ((avg % 360) + 360) % 360;
}

// --- HTTP server ---

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/windows') {
    try {
      const windows = getWindows();
      res.writeHead(200);
      res.end(JSON.stringify(windows));
    } catch (err) {
      console.error('Windows error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Backend listening on 127.0.0.1:${PORT}`);
});
