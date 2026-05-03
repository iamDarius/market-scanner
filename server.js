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

// ─── In-memory store ─────────────────────────────────────────────────────────

let store = {
  lastUpdated: null,
  scanning: false,
  scanStarted: null,
  data: null,
  error: null,
};

// ─── API Routes ───────────────────────────────────────────────────────────────

// POST /api/scan — market-scanner.js posts results here
app.post("/api/scan", (req, res) => {
  const { sectors, industries, stocks, emerging, breakouts, spy, meta } = req.body;

  if (!sectors || !Array.isArray(sectors)) {
    return res.status(400).json({ error: "Invalid payload: sectors array required" });
  }

  store.data = {
    sectors,
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

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Market Scanner UI`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  API:      http://localhost:${PORT}/api/scan  (POST)`);
  console.log(`  ─────────────────────────────────────\n`);
});
