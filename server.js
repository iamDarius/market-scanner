/**
 * Market Scanner UI — Express Server
 *
 * Endpoints:
 *   POST /api/scan       — receive full scan results from market-scanner.js
 *   GET  /api/data       — fetch latest scan data (for UI polling)
 *   GET  /api/status     — scanner status / last run time
 *
 * Usage:
 *   node server.js
 *   Then open http://localhost:3000
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { spawn, exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Set permissive CSP for local dev
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;"
  );
  next();
});

// Serve static files from public/
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Fallback: always serve index.html for any unmatched GET
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

// ─── Scan history ────────────────────────────────────────────────────────────

const HISTORY_FILE = path.join(__dirname, "scan-history.json");
const MAX_HISTORY = 10;

let scanHistory = [];
try {
  if (fs.existsSync(HISTORY_FILE)) {
    scanHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  }
} catch {
  scanHistory = [];
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(scanHistory));
  } catch (err) {
    console.error(`[history] Save failed: ${err.message}`);
  }
}

function computeSectorTrends(newSectors) {
  if (!scanHistory.length) return newSectors;
  const prev = scanHistory[scanHistory.length - 1].sectors || [];
  const prevRank = Object.fromEntries(prev.map((s, i) => [s.name, i]));
  return newSectors.map((s, i) => {
    const p = prevRank[s.name];
    return { ...s, rankChange: p != null ? p - i : null };
  });
}

// ─── Breakout alerts ─────────────────────────────────────────────────────────

const alertedTickers = new Set();

function sendNotification(title, message) {
  const t = title.replace(/['"\\]/g, " ");
  const m = message.replace(/['"\\]/g, " ");
  exec(`osascript -e 'display notification "${m}" with title "${t}"'`, () => {});
}

function checkBreakoutAlerts(breakouts) {
  if (!breakouts || !breakouts.length) return;
  const currentTickers = new Set(breakouts.map((s) => s.ticker));
  for (const t of alertedTickers) {
    if (!currentTickers.has(t)) alertedTickers.delete(t);
  }
  for (const s of breakouts) {
    if (s.pctFromHigh != null && s.pctFromHigh <= 1 && !alertedTickers.has(s.ticker)) {
      alertedTickers.add(s.ticker);
      sendNotification(
        `Breakout: ${s.ticker}`,
        `${(s.description || s.ticker).slice(0, 40)} — ${s.pctFromHigh.toFixed(1)}% from 52W high`
      );
      console.log(`[alert] ${s.ticker} within ${s.pctFromHigh}% of 52W high`);
    }
  }
}

// ─── In-memory store ─────────────────────────────────────────────────────────

// ─── Auto-scan schedule ──────────────────────────────────────────────────────

let scanTimer = null;

function spawnScanner() {
  if (store.scanning) return false;
  const scannerPath = path.join(__dirname, "market-scanner.js");
  const child = spawn(process.execPath, [scannerPath], { detached: false, stdio: "inherit" });
  child.on("error", (err) => {
    console.error(`[scanner] ${err.message}`);
    store.scanning = false;
    store.error = err.message;
  });
  return true;
}

function startScanSchedule(intervalMins) {
  if (scanTimer) clearInterval(scanTimer);
  store.scanIntervalMins = intervalMins;
  const ms = intervalMins * 60 * 1000;
  store.nextScanAt = new Date(Date.now() + ms).toISOString();
  scanTimer = setInterval(() => {
    console.log(`[schedule] Auto-scan triggered (every ${intervalMins}m)`);
    spawnScanner();
    store.nextScanAt = new Date(Date.now() + ms).toISOString();
  }, ms);
  console.log(`  Schedule:  auto-scan every ${intervalMins} minutes`);
}

// ─── In-memory store ─────────────────────────────────────────────────────────

let store = {
  lastUpdated: null,
  scanning: false,
  scanStarted: null,
  data: null,
  error: null,
  nextScanAt: null,
  scanIntervalMins: 15,
};

// ─── API Routes ───────────────────────────────────────────────────────────────

// POST /api/scan — market-scanner.js posts results here
app.post("/api/scan", (req, res) => {
  const { sectors, industries, stocks, emerging, breakouts, spy, meta } = req.body;

  if (!sectors || !Array.isArray(sectors)) {
    return res.status(400).json({ error: "Invalid payload: sectors array required" });
  }

  const enrichedSectors = computeSectorTrends(sectors);
  checkBreakoutAlerts(breakouts);

  scanHistory.push({
    scannedAt: new Date().toISOString(),
    sectors: sectors.map((s) => ({ name: s.name, score: s.score })),
  });
  if (scanHistory.length > MAX_HISTORY) scanHistory.shift();
  saveHistory();

  store.data = {
    sectors: enrichedSectors,
    industries: industries || [],
    stocks: stocks || [],
    emerging: emerging || [],
    breakouts: breakouts || [],
    spy: spy || null,
    meta: meta || {},
  };
  store.lastUpdated = new Date().toISOString();
  store.scanning = false;
  store.error = null;

  console.log(
    `[${new Date().toLocaleTimeString()}] Scan data received — ${sectors.length} sectors, ${
      (industries || []).length
    } industries, ${(stocks || []).length} stocks, ${(emerging || []).length} emerging`
  );
  res.json({ ok: true, received: store.lastUpdated });
});

// POST /api/scan/start — mark scan as in-progress
app.post("/api/scan/start", (req, res) => {
  store.scanning = true;
  store.scanStarted = new Date().toISOString();
  store.error = null;
  console.log(`[${new Date().toLocaleTimeString()}] Scan started`);
  res.json({ ok: true });
});

// POST /api/scan/error — report scan error
app.post("/api/scan/error", (req, res) => {
  store.scanning = false;
  store.error = req.body.message || "Unknown error";
  console.error(`[${new Date().toLocaleTimeString()}] Scan error: ${store.error}`);
  res.json({ ok: true });
});

// GET /api/data — UI polls this
app.get("/api/data", (req, res) => {
  res.json({
    lastUpdated: store.lastUpdated,
    scanning: store.scanning,
    scanStarted: store.scanStarted,
    error: store.error,
    data: store.data,
    history: scanHistory.map((h) => ({ scannedAt: h.scannedAt, sectors: h.sectors })),
    nextScanAt: store.nextScanAt,
    scanIntervalMins: store.scanIntervalMins,
  });
});

// GET /api/status
app.get("/api/status", (req, res) => {
  res.json({
    lastUpdated: store.lastUpdated,
    scanning: store.scanning,
    error: store.error,
    hasData: !!store.data,
  });
});

// POST /api/scan/run — trigger scanner from UI
app.post("/api/scan/run", (req, res) => {
  if (!spawnScanner()) return res.status(409).json({ error: "Scan already in progress" });
  res.json({ ok: true });
});

// POST /api/schedule — change auto-scan interval
app.post("/api/schedule", (req, res) => {
  const mins = parseInt(req.body.intervalMins);
  if (!mins || mins < 1 || mins > 1440) {
    return res.status(400).json({ error: "intervalMins must be 1–1440" });
  }
  startScanSchedule(mins);
  res.json({ ok: true, intervalMins: mins, nextScanAt: store.nextScanAt });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Market Scanner UI`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  API:      http://localhost:${PORT}/api/scan  (POST)`);
  console.log(`  ─────────────────────────────────────`);
  startScanSchedule(15);
  console.log();
});
