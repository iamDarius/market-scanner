#!/usr/bin/env node

/**
 * Market Leader Scanner
 * Scans TradingView for top sectors → industries → stocks
 * Posts results to the UI server at http://localhost:3000
 *
 * Usage:
 *   node market-scanner.js              # run once
 *   node market-scanner.js --watch 15   # run every 15 minutes
 */

const TV_STOCK_URL = "https://scanner.tradingview.com/america/scan";
const UI_SERVER = process.env.SCANNER_SERVER || "http://localhost:3000";

const args = process.argv.slice(2);
const watchMode = args.includes("--watch");
const watchInterval = parseInt(args[args.indexOf("--watch") + 1]) || 15; // minutes

// ─── Helpers ────────────────────────────────────────────────────────────────

function pct(val) {
  if (val == null) return "  N/A  ";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(2)}%`;
}

function colorPerf(val) {
  if (val == null) return "\x1b[90m  N/A  \x1b[0m";
  const formatted = pct(val);
  if (val >= 5) return `\x1b[92m${formatted}\x1b[0m`;
  if (val >= 0) return `\x1b[32m${formatted}\x1b[0m`;
  if (val >= -5) return `\x1b[31m${formatted}\x1b[0m`;
  return `\x1b[91m${formatted}\x1b[0m`;
}

function log(msg) {
  console.log(`  \x1b[90m[${new Date().toLocaleTimeString()}]\x1b[0m ${msg}`);
}

// ─── Post to server ──────────────────────────────────────────────────────────

async function notifyServer(endpoint, body = {}) {
  try {
    await fetch(`${UI_SERVER}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // server may not be running, that's ok
  }
}

async function postResults(payload) {
  try {
    const res = await fetch(`${UI_SERVER}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      log(`\x1b[32mPosted to UI → ${UI_SERVER}\x1b[0m`);
    }
  } catch {
    log(`\x1b[33mUI server not running — data not posted\x1b[0m`);
  }
}

// ─── API ────────────────────────────────────────────────────────────────────

const TV_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Origin: "https://www.tradingview.com",
  Referer: "https://www.tradingview.com/",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

async function tvFetch(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: TV_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TradingView API error ${res.status} at ${url}`);
  const json = await res.json();
  if (process.env.DEBUG) console.log(`  [debug] ${url} → ${json.data?.length ?? 0} rows`);
  return json;
}

// Fetch all stocks once, then aggregate by sector using market-cap weighting
// to match TradingView's sector page numbers as closely as possible
async function getSectors(topN = 6) {
  const fields = ["name", "sector", "market_cap_basic", "Perf.W", "Perf.1M", "Perf.3M"];

  const json = await tvFetch(TV_STOCK_URL, {
    columns: fields,
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    options: { lang: "en" },
    range: [0, 1500],
    filter: [
      { left: "market_cap_basic", operation: "greater", right: 100000000 },
      { left: "is_primary", operation: "equal", right: true },
    ],
  });

  if (!json.data?.length) throw new Error("No stock data returned from TradingView");

  // Market-cap weighted aggregation per sector
  const map = {};
  for (const row of json.data) {
    const [, sector, cap, perfW, perf1M, perf3M] = row.d;
    if (!sector || cap == null) continue;
    if (!map[sector]) map[sector] = { capW: 0, capM: 0, capQ: 0, totalCap: 0, capTotal: 0 };
    const m = map[sector];
    m.totalCap += cap;
    if (perfW != null) {
      m.capW += perfW * cap;
      m.capTotal += cap;
    }
    if (perf1M != null) m.capM += perf1M * cap;
    if (perf3M != null) m.capQ += perf3M * cap;
  }

  const calcScore = (w, m, q) => (w || 0) * 0.2 + (m || 0) * 0.35 + (q || 0) * 0.45;

  return Object.entries(map)
    .map(([name, d]) => {
      const perfW = d.totalCap ? d.capW / d.totalCap : null;
      const perf1M = d.totalCap ? d.capM / d.totalCap : null;
      const perf3M = d.totalCap ? d.capQ / d.totalCap : null;
      return { name, perfW, perf1M, perf3M, marketCap: d.totalCap, score: calcScore(perfW, perf1M, perf3M) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// Fetch all stocks in a sector, aggregate by industry (market-cap weighted)
async function getIndustries(sectorName, topN = 5) {
  const fields = ["name", "industry", "market_cap_basic", "Perf.W", "Perf.1M", "Perf.3M"];

  const json = await tvFetch(TV_STOCK_URL, {
    columns: fields,
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    options: { lang: "en" },
    range: [0, 500],
    filter: [
      { left: "sector", operation: "equal", right: sectorName },
      { left: "market_cap_basic", operation: "greater", right: 50000000 },
      { left: "is_primary", operation: "equal", right: true },
    ],
  });

  const map = {};
  for (const row of json.data || []) {
    const [, industry, cap, perfW, perf1M, perf3M] = row.d;
    if (!industry || cap == null) continue;
    if (!map[industry]) map[industry] = { capW: 0, capM: 0, capQ: 0, totalCap: 0 };
    const m = map[industry];
    m.totalCap += cap;
    if (perfW != null) m.capW += perfW * cap;
    if (perf1M != null) m.capM += perf1M * cap;
    if (perf3M != null) m.capQ += perf3M * cap;
  }

  const calcScore = (w, m, q) => (w || 0) * 0.2 + (m || 0) * 0.35 + (q || 0) * 0.45;

  return Object.entries(map)
    .map(([name, d]) => {
      const perfW = d.totalCap ? d.capW / d.totalCap : null;
      const perf1M = d.totalCap ? d.capM / d.totalCap : null;
      const perf3M = d.totalCap ? d.capQ / d.totalCap : null;
      return {
        name,
        sector: sectorName,
        perfW,
        perf1M,
        perf3M,
        marketCap: d.totalCap,
        score: calcScore(perfW, perf1M, perf3M),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// Fetch top individual stocks within a sector + industry
async function getTopStocks(sectorName, industryName, topN = 5) {
  const fields = [
    "name",
    "description",
    "sector",
    "industry",
    "Perf.W",
    "Perf.1M",
    "Perf.3M",
    "market_cap_basic",
    "relative_volume_10d_calc",
  ];

  const json = await tvFetch(TV_STOCK_URL, {
    columns: fields,
    sort: { sortBy: "Perf.3M", sortOrder: "desc" },
    options: { lang: "en" },
    range: [0, 20],
    filter: [
      { left: "sector", operation: "equal", right: sectorName },
      { left: "industry", operation: "equal", right: industryName },
      { left: "market_cap_basic", operation: "greater", right: 300000000 },
      { left: "is_primary", operation: "equal", right: true },
    ],
  });

  return (json.data || []).slice(0, topN).map((row) => {
    const [ticker, description, sector, industry, perfW, perf1M, perf3M, marketCap, relVol] = row.d;
    return { ticker, description, sector, industry, perfW, perf1M, perf3M, marketCap, relVol };
  });
}

// ─── SPY benchmark ───────────────────────────────────────────────────────────

async function getSPYPerformance() {
  const json = await tvFetch(TV_STOCK_URL, {
    columns: ["name", "Perf.W", "Perf.1M", "Perf.3M"],
    filter: [{ left: "name", operation: "equal", right: "SPY" }],
    range: [0, 1],
  });
  const row = json.data?.[0];
  if (!row) return { perfW: 0, perf1M: 0, perf3M: 0 };
  const [, perfW, perf1M, perf3M] = row.d;
  return { perfW: perfW ?? 0, perf1M: perf1M ?? 0, perf3M: perf3M ?? 0 };
}

// ─── Emerging leaders ────────────────────────────────────────────────────────
//
// Criteria — stocks showing early accumulation before a big move:
//   1. Price near 52W high but not extended (within 5–25% of high)
//   2. 1M perf accelerating vs 3M (short > long = momentum building)
//   3. Relative volume elevated (institutions accumulating)
//   4. Recent week positive (early buyers stepping in)
//   5. Mid-cap bias ($500M–$20B) — big enough to be legit, small enough to move
//   6. In a leading sector (passed in from sector scan)

async function getEmergingLeaders(leadingSectorNames, topN = 15) {
  const fields = [
    "name",
    "description",
    "sector",
    "industry",
    "Perf.W",
    "Perf.1M",
    "Perf.3M",
    "High.6M",
    "close",
    "market_cap_basic",
    "relative_volume_10d_calc",
    "average_volume_10d_calc",
    "RSI",
    "price_52_week_high",
  ];

  // TradingView doesn't support string arrays in filters — run one request
  // per sector and merge. This guarantees sector filtering works correctly.
  const allRows = [];
  for (const sector of leadingSectorNames) {
    const json = await tvFetch(TV_STOCK_URL, {
      columns: fields,
      sort: { sortBy: "relative_volume_10d_calc", sortOrder: "desc" },
      options: { lang: "en" },
      range: [0, 150],
      filter: [
        { left: "sector", operation: "equal", right: sector },
        { left: "market_cap_basic", operation: "greater", right: 300000000 },
        { left: "market_cap_basic", operation: "less", right: 30000000000 },
        { left: "Perf.W", operation: "greater", right: 0 },
        { left: "Perf.1M", operation: "greater", right: 0 },
        { left: "Perf.3M", operation: "less", right: 60 },
        { left: "relative_volume_10d_calc", operation: "greater", right: 1.2 },
        { left: "average_volume_10d_calc", operation: "greater", right: 200000 },
        { left: "is_primary", operation: "equal", right: true },
      ],
    });
    allRows.push(...(json.data || []));
  }

  const results = allRows
    .map((row) => {
      const [
        ticker,
        description,
        sector,
        industry,
        perfW,
        perf1M,
        perf3M,
        high6M,
        close,
        marketCap,
        relVol,
        avgVol,
        rsi,
        high52W,
      ] = row.d;

      const pctFromHigh = high6M && close ? ((high6M - close) / high6M) * 100 : null;
      const accel = perf1M != null && perf3M != null ? perf1M - perf3M / 3 : null;
      const proximityScore = pctFromHigh != null && pctFromHigh >= 3 && pctFromHigh <= 25 ? 30 : 0;

      const emergingScore =
        (perfW || 0) * 1.5 + (perf1M || 0) * 1.2 + (accel || 0) * 2.0 + (relVol || 0) * 5 + proximityScore;

      return {
        ticker,
        description,
        sector,
        industry,
        perfW,
        perf1M,
        perf3M,
        marketCap,
        relVol,
        rsi,
        pctFromHigh: pctFromHigh != null ? parseFloat(pctFromHigh.toFixed(1)) : null,
        accel: accel != null ? parseFloat(accel.toFixed(2)) : null,
        emergingScore: parseFloat(emergingScore.toFixed(1)),
        signal: accel > 5 && relVol > 1.5 ? "strong" : accel > 2 ? "building" : "watch",
      };
    })
    .filter((s) => s.ticker && s.emergingScore > 0)
    .sort((a, b) => b.emergingScore - a.emergingScore)
    .slice(0, topN);

  return results;
}

// ─── Breakout candidates ─────────────────────────────────────────────────────
//
// Stocks within 0–5% of 52-week high with elevated volume — the "basing near
// highs" setup. Price has proven buyers at this level; elevated volume signals
// institutional accumulation before the next leg up.

async function getBreakoutCandidates(leadingSectorNames, topN = 20) {
  const fields = [
    "name", "description", "sector", "industry",
    "Perf.W", "Perf.1M", "Perf.3M",
    "price_52_week_high", "close",
    "market_cap_basic", "relative_volume_10d_calc", "RSI",
  ];

  const allRows = [];
  for (const sector of leadingSectorNames) {
    const json = await tvFetch(TV_STOCK_URL, {
      columns: fields,
      sort: { sortBy: "relative_volume_10d_calc", sortOrder: "desc" },
      options: { lang: "en" },
      range: [0, 200],
      filter: [
        { left: "sector", operation: "equal", right: sector },
        { left: "market_cap_basic", operation: "greater", right: 300000000 },
        { left: "Perf.3M", operation: "greater", right: 5 },
        { left: "Perf.W", operation: "greater", right: 0 },
        { left: "relative_volume_10d_calc", operation: "greater", right: 1.2 },
        { left: "is_primary", operation: "equal", right: true },
      ],
    });
    allRows.push(...(json.data || []));
  }

  const seen = new Set();
  return allRows
    .map((row) => {
      const [ticker, description, sector, industry, perfW, perf1M, perf3M, high52W, close, marketCap, relVol, rsi] = row.d;
      if (!ticker || !high52W || !close || high52W <= 0) return null;
      const pctFromHigh = ((high52W - close) / high52W) * 100;
      if (pctFromHigh < 0 || pctFromHigh > 5) return null;
      if (seen.has(ticker)) return null;
      seen.add(ticker);
      return {
        ticker, description, sector, industry,
        perfW, perf1M, perf3M, marketCap, relVol, rsi,
        pctFromHigh: parseFloat(pctFromHigh.toFixed(1)),
        high52W, close,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.pctFromHigh - b.pctFromHigh)
    .slice(0, topN);
}

function printSectors(sectors) {
  console.log(`\n  \x1b[1m\x1b[36m${"─".repeat(65)}\x1b[0m`);
  console.log(`  \x1b[1mTop Sectors\x1b[0m`);
  console.log(`  \x1b[90m${"Name".padEnd(28)} ${"1W".padStart(8)} ${"1M".padStart(8)} ${"3M".padStart(8)}\x1b[0m`);
  sectors.forEach((s, i) => {
    const rank = `\x1b[33m${String(i + 1).padStart(2)}.\x1b[0m`;
    console.log(
      `  ${rank} ${s.name.padEnd(26)} ${colorPerf(s.perfW).padEnd(18)} ${colorPerf(s.perf1M).padEnd(18)} ${colorPerf(
        s.perf3M
      )}`
    );
  });
}

function printIndustries(industries) {
  if (!industries.length) return;
  console.log(`\n  \x1b[90m  Industries:\x1b[0m`);
  industries.slice(0, 3).forEach((ind) => {
    console.log(`  \x1b[90m    · ${ind.name.padEnd(32)} ${colorPerf(ind.perf3M)} (3M)\x1b[0m`);
  });
}

// ─── Main scan ───────────────────────────────────────────────────────────────

async function runScan() {
  console.log(`\n  \x1b[1m\x1b[36mMarket Scanner\x1b[0m  \x1b[90m${new Date().toLocaleString()}\x1b[0m\n`);

  await notifyServer("/api/scan/start");

  try {
    log("Fetching SPY benchmark...");
    const spy = await getSPYPerformance();
    log(`SPY: ${pct(spy.perfW)} (1W) · ${pct(spy.perf1M)} (1M) · ${pct(spy.perf3M)} (3M)`);

    // Step 1: Pull sector performance directly from TradingView's sector endpoint
    log("Fetching sector performance...");
    const sectors = await getSectors(6);
    printSectors(sectors);

    const allIndustries = [];
    const allTopStocks = [];

    // Step 2: Drill into top 4 sectors for industry breakdown
    const TOP_SECTORS_TO_DRILL = 4;
    for (const sector of sectors.slice(0, TOP_SECTORS_TO_DRILL)) {
      log(`Fetching industries for ${sector.name}...`);
      const industries = await getIndustries(sector.name, 5);
      allIndustries.push(...industries);
      printIndustries(industries);

      // Step 3: Top stocks from top 2 industries per sector
      for (const industry of industries.slice(0, 2)) {
        const stocks = await getTopStocks(sector.name, industry.name, 5);
        allTopStocks.push(...stocks);
      }
    }

    // Add relative strength vs SPY to all top stocks
    allTopStocks.forEach((s) => {
      s.rs = s.perf3M != null ? parseFloat((s.perf3M - spy.perf3M).toFixed(2)) : null;
    });

    // Step 4: Emerging leaders — acceleration + volume surge in leading sectors
    log("Scanning for emerging leaders...");
    const leadingSectorNames = sectors.slice(0, 4).map((s) => s.name);
    const emerging = await getEmergingLeaders(leadingSectorNames, 15);
    log(`Found ${emerging.length} emerging leaders`);
    emerging.forEach((s) => {
      s.rs = s.perf3M != null ? parseFloat((s.perf3M - spy.perf3M).toFixed(2)) : null;
    });
    if (emerging.length) {
      console.log(`\n  \x1b[1mEmerging Leaders\x1b[0m`);
      emerging.slice(0, 5).forEach((s, i) => {
        const rank = `\x1b[35m${String(i + 1).padStart(2)}.\x1b[0m`;
        console.log(
          `  ${rank} \x1b[1m${s.ticker.padEnd(7)}\x1b[0m ${(s.description || "").slice(0, 24).padEnd(26)} ${colorPerf(
            s.perf1M
          ).padEnd(18)} accel:${s.accel > 0 ? "\x1b[92m" : "\x1b[91m"}+${s.accel}\x1b[0m  rvol:${s.relVol?.toFixed(1)}x`
        );
      });
    }

    // Step 5: Breakout candidates — near 52W high with elevated volume
    log("Scanning for breakout candidates...");
    const breakouts = await getBreakoutCandidates(leadingSectorNames, 20);
    breakouts.forEach((s) => {
      s.rs = s.perf3M != null ? parseFloat((s.perf3M - spy.perf3M).toFixed(2)) : null;
    });
    log(`Found ${breakouts.length} breakout candidates`);
    if (breakouts.length) {
      console.log(`\n  \x1b[1mBreakout Candidates\x1b[0m`);
      breakouts.slice(0, 5).forEach((s, i) => {
        const rank = `\x1b[36m${String(i + 1).padStart(2)}.\x1b[0m`;
        console.log(
          `  ${rank} \x1b[1m${s.ticker.padEnd(7)}\x1b[0m ${(s.description || "").slice(0, 24).padEnd(26)} ${colorPerf(s.perf3M).padEnd(18)} ${s.pctFromHigh.toFixed(1)}% from high  rvol:${s.relVol?.toFixed(1)}x`
        );
      });
    }

    const payload = {
      sectors,
      industries: allIndustries,
      stocks: allTopStocks,
      emerging,
      breakouts,
      spy,
      meta: {
        scannedAt: new Date().toISOString(),
        sectorsCount: sectors.length,
        industriesCount: allIndustries.length,
        stocksCount: allTopStocks.length,
        emergingCount: emerging.length,
        breakoutsCount: breakouts.length,
      },
    };

    await postResults(payload);

    console.log(
      `\n  \x1b[32m✓ Scan complete\x1b[0m  \x1b[90m${sectors.length} sectors · ${allIndustries.length} industries · ${allTopStocks.length} stocks · ${emerging.length} emerging · ${breakouts.length} breakouts\x1b[0m\n`
    );

    return payload;
  } catch (err) {
    await notifyServer("/api/scan/error", { message: err.message });
    throw err;
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  try {
    await runScan();

    if (watchMode) {
      console.log(`  \x1b[90mWatch mode: next scan in ${watchInterval} minutes\x1b[0m\n`);
      setInterval(async () => {
        try {
          await runScan();
          console.log(`  \x1b[90mNext scan in ${watchInterval} minutes\x1b[0m\n`);
        } catch (err) {
          console.error(`\n  \x1b[31mScan error: ${err.message}\x1b[0m\n`);
        }
      }, watchInterval * 60 * 1000);
    }
  } catch (err) {
    console.error(`\n  \x1b[31mError: ${err.message}\x1b[0m\n`);
    process.exit(1);
  }
}

main();
