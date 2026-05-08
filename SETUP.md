# Market Scanner - Setup Guide

A real-time market analysis dashboard that scans TradingView for top-performing sectors, industries, and stocks. Get actionable trading insights with breakout alerts and emerging leader detection.

## Features

- **Sector Analysis**: Real-time performance metrics (1W, 1M, 3M) with buy/sell signals
- **Industry Drilling**: Deep dive into top industries within each sector
- **Stock Scanner**: Track individual stocks with relative strength vs SPY
- **Emerging Leaders**: AI-detected stocks with high acceleration and volume
- **Breakout Candidates**: Stocks within 5% of 52-week highs with elevated volume
- **Historical Tracking**: Sector rotation analysis over time
- **Auto-Scanning**: Configurable scheduled scans every 15+ minutes
- **Desktop Alerts**: macOS notifications for breakout opportunities
- **Dark/Light Theme**: Toggle between modes
- **Responsive Design**: Works on desktop and mobile

## Quick Start

### Prerequisites
- Node.js 18+ ([download](https://nodejs.org))
- npm (comes with Node.js)

### Local Development (5 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Start the server (Terminal 1)
npm start
# → Runs on http://localhost:3000

# 3. Run the scanner once (Terminal 2)
npm run scan

# 4. Open browser
# → http://localhost:3000
```

**Or use npm scripts for continuous scanning:**
```bash
npm run scan:watch  # Auto-scan every 15 minutes
```

The dashboard will populate with live market data after the scanner completes.

### Continuous Scanning

For auto-scanning every 15 minutes:
```bash
node market-scanner.js --watch 15
```

## Project Structure

```
market-scanner/
├── server.js                 # Express server + API endpoints
├── market-scanner.js         # Data fetching + TradingView integration
├── public/
│   ├── index.html           # UI dashboard (all-in-one)
│   └── style.css            # (embedded in HTML)
├── scan-history.json        # Historical scan data
├── package.json
└── vercel.json              # Deployment config
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/scan` | POST | Receive scan results from market-scanner.js |
| `/api/data` | GET | Fetch latest scan data (UI polls every 3s) |
| `/api/status` | GET | Get scanner status + last run time |
| `/api/scan/run` | POST | Trigger manual scan from UI |
| `/api/scan/start` | POST | Mark scan as in-progress |
| `/api/scan/error` | POST | Report scan error |
| `/api/schedule` | POST | Change auto-scan interval |

## Deploy to Vercel

### Option 1: One-Click Deploy
```bash
npm install -g vercel
vercel
```

### Option 2: GitHub + Vercel
1. Push to GitHub
2. Connect repo to Vercel (vercel.com)
3. Auto-deploys on push

### Keep Vercel Data Fresh

Create `.github/workflows/scanner.yml` to run scanner every 15 min:

```yaml
name: Market Scanner

on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - name: Run scanner
        env:
          SCANNER_SERVER: ${{ secrets.VERCEL_URL }}
        run: node market-scanner.js
```

Then add your Vercel URL as a GitHub secret: `VERCEL_URL`

## Configuration

### Environment Variables

```bash
# market-scanner.js
SCANNER_SERVER=http://localhost:3000  # Server to POST results to

# server.js
PORT=3000  # Server port
```

### Auto-Scan Interval

Default: 15 minutes. Change via UI or API:
```bash
curl -X POST http://localhost:3000/api/schedule \
  -H "Content-Type: application/json" \
  -d '{"intervalMins": 30}'
```

## How It Works

1. **Scan Initiation**: User clicks "SCAN NOW" or auto-schedule triggers
2. **Data Fetch**: market-scanner.js queries TradingView API
   - SPY performance (1W, 1M, 3M)
   - Top sectors ranked by momentum
   - Industries within top sectors
   - Individual stocks + performance
   - Emerging leaders (acceleration-based)
   - Breakout candidates (5% from 52W high)
3. **Data POST**: Results POST to `/api/scan`
4. **Server Store**: Data saved to in-memory store + scan-history.json
5. **UI Poll**: Browser polls `/api/data` every 3s, renders on change

## Troubleshooting

**"Waiting for data" in UI?**
- Make sure server.js is running
- Run `node market-scanner.js` once to fetch data

**Scanner fails with ECONNREFUSED?**
- Check that `node server.js` is running first
- Verify SCANNER_SERVER env var points to correct server

**Vercel deployment has no data?**
- GitHub Actions workflow needs to be running
- Check workflow permissions in GitHub → Settings → Actions

**macOS alerts not working?**
- Requires macOS with osascript (built-in)
- Check System Preferences → Notifications

## Customization

### Change Scan Interval
Edit `server.js` line 254: `startScanSchedule(15)` → change 15 to desired minutes

### Modify Alert Threshold
Edit `server.js` line 94: `s.pctFromHigh <= 1` → change 1 to desired %

### Add More Sectors
Edit `market-scanner.js` line ~350: Modify `SCANNERS` array with more sector IDs

## Performance Notes

- Dashboard renders in <100ms
- API responses <50ms (in-memory)
- Scanner runtime: 3-5 seconds per scan
- Network: ~100 TradingView requests per scan
- Storage: ~5KB per scan history entry (keeps last 10)

## License

MIT - Use freely for personal trading analysis

## Support

Common issues? Check:
1. Node.js version: `node --version` (needs 18+)
2. Port availability: `lsof -i :3000`
3. Network: TradingView API accessibility
4. Logs: Check browser console + server logs
