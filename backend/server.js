const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/data/weather.db';
const WEATHER_SOURCE = process.env.WEATHER_SOURCE || 'http://100.118.177.49:4000/api/weather';
const POLL_INTERVAL = 5000;
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
setInterval(cleanOldReadings, 60 * 60 * 1000);

// --- Latest weather (kept in memory) ---

let latestWeather = null;

// --- Poll pi3 weather API ---

function fetchWeather() {
  return new Promise((resolve, reject) => {
    const req = http.get(WEATHER_SOURCE, { timeout: 5000 }, (res) => {
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
    latestWeather = w;
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
poll();

// --- Compute 30-minute windows ---

function getWindows() {
  const rows = db.prepare(`
    SELECT windspeedmph, windgustmph, winddir, ts
    FROM readings
    WHERE ts > datetime('now', '-24 hours')
    ORDER BY ts ASC
  `).all();

  if (!rows.length) return [];

  const windows = new Map();

  for (const row of rows) {
    const date = new Date(row.ts);
    const mins = date.getUTCMinutes();
    const bucket = mins < 30 ? 0 : 30;
    date.setUTCMinutes(bucket, 0, 0);
    const key = date.toISOString();

    if (!windows.has(key)) {
      windows.set(key, { window_start: key, readings: [] });
    }
    windows.get(key).readings.push(row);
  }

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

// --- Static file serving ---

const STATIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res, urlPath) {
  const filePath = urlPath === '/' ? path.join(STATIC_DIR, 'index.html') : path.join(STATIC_DIR, urlPath);

  // Prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>Not Found</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// --- HTTP server ---

const server = http.createServer((req, res) => {
  if (req.url === '/api/weather') {
    res.setHeader('Content-Type', 'application/json');
    if (latestWeather) {
      res.writeHead(200);
      res.end(JSON.stringify(latestWeather));
    } else {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'No data yet' }));
    }
    return;
  }

  if (req.url === '/api/windows') {
    res.setHeader('Content-Type', 'application/json');
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

  // Serve static files
  serveStatic(res, req.url);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wind dashboard running on port ${PORT}`);
});
