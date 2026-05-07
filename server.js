const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let cachedCrumb = null;
let cachedCookie = null;

async function getCrumb() {
  if (cachedCrumb && cachedCookie) return { crumb: cachedCrumb, cookie: cachedCookie };
  const res = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*' },
    redirect: 'follow',
  });
  const cookieHeader = res.headers.get('set-cookie') || '';
  cachedCookie = cookieHeader.split(';')[0];
  cachedCrumb = await res.text();
  return { crumb: cachedCrumb, cookie: cachedCookie };
}

async function yahooFetch(url) {
  const { crumb, cookie } = await getCrumb();
  const separator = url.includes('?') ? '&' : '?';
  const fullUrl = `${url}${separator}crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(fullUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json', 'Cookie': cookie || '' },
  });
  if (!res.ok) throw new Error(`Yahoo Finance 回應錯誤: ${res.status}`);
  return res.json();
}

app.get('/api/quote/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const data = await yahooFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.toUpperCase())}?interval=1d&range=1d`);
    const meta = data.chart.result[0].meta;
    res.json({
      ticker: meta.symbol, name: meta.longName || meta.shortName || ticker,
      price: meta.regularMarketPrice,
      change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100),
      changeAbs: meta.regularMarketPrice - meta.chartPreviousClose,
      open: meta.regularMarketOpen || meta.chartPreviousClose,
      high: meta.regularMarketDayHigh || meta.regularMarketPrice,
      low: meta.regularMarketDayLow || meta.regularMarketPrice,
      volume: meta.regularMarketVolume, marketCap: null, pe: null,
      week52High: meta.fiftyTwoWeekHigh, week52Low: meta.fiftyTwoWeekLow,
      currency: meta.currency, exchange: meta.exchangeName,
    });
  } catch (err) {
    cachedCrumb = null; cachedCookie = null;
    res.status(400).json({ error: `找不到股票代碼：${req.params.ticker}`, detail: err.message });
  }
});

app.get('/api/history/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const { period = '1mo' } = req.query;
    const rangeMap = { '1mo': '1mo', '3mo': '3mo', '6mo': '6mo', '1y': '1y' };
    const range = rangeMap[period] || '1mo';
    const data = await yahooFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.toUpperCase())}?interval=1d&range=${range}`);
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const history = timestamps.map((ts, i) => ({ date: new Date(ts * 1000).toISOString().split('T')[0], close: closes[i] })).filter(d => d.close != null);
    res.json(history);
  } catch (err) {
    cachedCrumb = null; cachedCookie = null;
    res.status(400).json({ error: '無法取得歷史數據', detail: err.message });
  }
});

app.get('/api/analysis', async (req, res) => {
  try {
    const { tickers, rf = 4.5 } = req.query;
    const tickerList = tickers.split(',').map(t => t.trim().toUpperCase());
    const rfRate = parseFloat(rf) / 100;
    const results = await Promise.all(tickerList.map(async (ticker) => {
      try {
        const data = await yahooFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`);
        const result = data.chart.result[0];
        const closes = result.indicators.quote[0].close.filter(c => c != null);
        const meta = result.meta;
        if (closes.length < 10) return null;
        const returns = [];
        for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i-1]) / closes[i-1]);
        const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const annualReturn = meanReturn * 252;
        const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length;
        const annualVol = Math.sqrt(variance) * Math.sqrt(252);
        const sharpe = (annualReturn - rfRate) / annualVol;
        return { ticker, name: meta.longName || meta.shortName || ticker, price: meta.regularMarketPrice, change: ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100).toFixed(2), annualReturn: (annualReturn * 100).toFixed(2), annualVol: (annualVol * 100).toFixed(2), sharpe: sharpe.toFixed(3) };
      } catch { return null; }
    }));
    res.json(results.filter(Boolean));
  } catch (err) {
    cachedCrumb = null; cachedCookie = null;
    res.status(400).json({ error: '分析失敗', detail: err.message });
  }
});

app.post('/api/quotes', async (req, res) => {
  try {
    const { tickers } = req.body;
    const results = await Promise.all(tickers.map(async (ticker) => {
      try {
        const data = await yahooFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.toUpperCase())}?interval=1d&range=1d`);
        const meta = data.chart.result[0].meta;
        return { ticker: meta.symbol, name: meta.longName || meta.shortName || ticker, price: meta.regularMarketPrice, currency: meta.currency };
      } catch { return { ticker, price: null, error: true }; }
    }));
    res.json(results);
  } catch (err) {
    res.status(400).json({ error: '批次查詢失敗', detail: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    const data = await yahooFetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`);
    const quotes = (data.quotes || []).filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF').map(r => ({ ticker: r.symbol, name: r.longname || r.shortname || r.symbol, exchange: r.exchange, type: r.quoteType }));
    res.json(quotes);
  } catch (err) {
    res.status(400).json({ error: '搜尋失敗', detail: err.message });
  }
});

// ─── 最佳投資組合：解析 CSV/Excel + 最佳化 ───────────────
app.post('/api/optimize', upload.single('file'), async (req, res) => {
  try {
    const { rf = 4.5, minStocks = 15, maxStocks = 25 } = req.body;
    const rfRate = parseFloat(rf) / 100;
    const file = req.file;
    if (!file) return res.status(400).json({ error: '請上傳檔案' });

    // Parse CSV
    const text = file.buffer.toString('utf-8');
    const lines = text.trim().split(/\r?\n/);
    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
    
    const tickerIdx = header.findIndex(h => h.includes('ticker') || h.includes('symbol') || h.includes('代碼'));
    const targetIdx = header.findIndex(h => h.includes('target') || h.includes('目標'));
    const brokerIdx = header.findIndex(h => h.includes('broker') || h.includes('券商'));

    if (tickerIdx === -1 || targetIdx === -1) {
      return res.status(400).json({ error: '找不到必要欄位，請確認 CSV 包含 ticker 和 target_price 欄位' });
    }

    // Parse rows - aggregate multiple brokers by average target
    const stockMap = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      if (!cols[tickerIdx]) continue;
      const ticker = cols[tickerIdx].toUpperCase();
      const target = parseFloat(cols[targetIdx]);
      const broker = brokerIdx >= 0 ? cols[brokerIdx] : 'Unknown';
      if (!ticker || isNaN(target)) continue;
      if (!stockMap[ticker]) stockMap[ticker] = { ticker, targets: [], brokers: [] };
      stockMap[ticker].targets.push(target);
      stockMap[ticker].brokers.push(broker);
    }

    const stocks = Object.values(stockMap).map(s => ({
      ticker: s.ticker,
      avgTarget: s.targets.reduce((a, b) => a + b, 0) / s.targets.length,
      brokerCount: s.targets.length,
      brokers: [...new Set(s.brokers)].join(', '),
    }));

    if (stocks.length < 3) return res.status(400).json({ error: '至少需要 3 支股票' });

    // Fetch current prices + 1yr history for all stocks
    const enriched = await Promise.all(stocks.map(async (s) => {
      try {
        const data = await yahooFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.ticker)}?interval=1d&range=1y`);
        const result = data.chart.result[0];
        const closes = result.indicators.quote[0].close.filter(c => c != null);
        const meta = result.meta;
        if (closes.length < 30) return null;

        const curPrice = meta.regularMarketPrice;
        const upside = ((s.avgTarget - curPrice) / curPrice) * 100;

        const returns = [];
        for (let i = 1; i < closes.length; i++) returns.push((closes[i] - closes[i-1]) / closes[i-1]);
        const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
        const annRet = meanRet * 252;
        const variance = returns.reduce((a, b) => a + Math.pow(b - meanRet, 2), 0) / returns.length;
        const annVol = Math.sqrt(variance * 252);

        return {
          ticker: s.ticker,
          name: meta.longName || meta.shortName || s.ticker,
          curPrice,
          avgTarget: s.avgTarget,
          upside: upside.toFixed(2),
          brokerCount: s.brokerCount,
          brokers: s.brokers,
          annRet,
          annVol,
          returns,
          sharpe: (annRet - rfRate) / annVol,
        };
      } catch { return null; }
    }));

    const valid = enriched.filter(Boolean).filter(s => s.annVol > 0);
    if (valid.length < 3) return res.status(400).json({ error: '有效股票數量不足，請確認代碼正確' });

    // Markowitz optimization - Monte Carlo simulation
    const n = valid.length;
    const maxN = Math.min(parseInt(maxStocks), n);
    const minN = Math.min(parseInt(minStocks), n);

    // Build covariance matrix
    const minLen = Math.min(...valid.map(s => s.returns.length));
    const retMatrix = valid.map(s => s.returns.slice(-minLen));

    function covMatrix() {
      const means = retMatrix.map(r => r.reduce((a, b) => a + b, 0) / r.length);
      const cov = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => {
          let s = 0;
          for (let k = 0; k < minLen; k++) s += (retMatrix[i][k] - means[i]) * (retMatrix[j][k] - means[j]);
          return s / (minLen - 1);
        })
      );
      return cov;
    }

    const cov = covMatrix();

    // Monte Carlo: 5000 random portfolios
    let bestSharpe = -Infinity, bestPortfolio = null;
    const iterations = 5000;

    for (let iter = 0; iter < iterations; iter++) {
      // Random select k stocks
      const k = minN + Math.floor(Math.random() * (maxN - minN + 1));
      const indices = [];
      const pool = [...Array(n).keys()];
      for (let i = 0; i < k; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        indices.push(pool.splice(idx, 1)[0]);
      }

      // Random weights
      const raw = indices.map(() => Math.random());
      const sum = raw.reduce((a, b) => a + b, 0);
      const weights = raw.map(w => w / sum);

      // Portfolio return & vol
      const pRet = weights.reduce((acc, w, i) => acc + w * valid[indices[i]].annRet, 0);
      let pVar = 0;
      for (let i = 0; i < weights.length; i++)
        for (let j = 0; j < weights.length; j++)
          pVar += weights[i] * weights[j] * cov[indices[i]][indices[j]];
      const pVol = Math.sqrt(pVar * 252);
      const pSharpe = (pRet - rfRate) / pVol;

      if (pSharpe > bestSharpe) {
        bestSharpe = pSharpe;
        bestPortfolio = { indices, weights, pRet, pVol, pSharpe };
      }
    }

    // Build result
    const selected = bestPortfolio.indices.map((idx, i) => ({
      ...valid[idx],
      weight: (bestPortfolio.weights[i] * 100).toFixed(2),
      returns: undefined,
    }));

    // Win rate: % of stocks where current price < target
    const winRate = (selected.filter(s => parseFloat(s.upside) > 0).length / selected.length * 100).toFixed(1);

    res.json({
      portfolio: selected,
      stats: {
        expectedReturn: (bestPortfolio.pRet * 100).toFixed(2),
        expectedVol: (bestPortfolio.pVol * 100).toFixed(2),
        sharpe: bestSharpe.toFixed(3),
        winRate,
        stockCount: selected.length,
      }
    });

  } catch (err) {
    res.status(500).json({ error: '最佳化失敗', detail: err.message });
  }
});


// ─── 相關係數 & VaR 分析 ──────────────────────────────────
app.post('/api/correlation', async (req, res) => {
  try {
    const { tickers, weights } = req.body;
    if (!tickers || tickers.length < 2) return res.status(400).json({ error: '至少需要 2 支股票' });

    const histData = await Promise.all(tickers.map(async (ticker) => {
      try {
        const data = await yahooFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`);
        const result = data.chart.result[0];
        const closes = result.indicators.quote[0].close;
        const timestamps = result.timestamp;
        const daily = timestamps.map((ts, i) => ({ date: new Date(ts * 1000).toISOString().split('T')[0], close: closes[i] })).filter(d => d.close != null);
        const returns = [];
        for (let i = 1; i < daily.length; i++) returns.push((daily[i].close - daily[i-1].close) / daily[i-1].close);
        return { ticker, returns, lastPrice: result.meta.regularMarketPrice };
      } catch { return null; }
    }));

    const valid = histData.filter(Boolean);
    if (valid.length < 2) return res.status(400).json({ error: '無法取得足夠股票數據' });

    const n = valid.length;
    const minLen = Math.min(...valid.map(v => v.returns.length));
    const aligned = valid.map(v => v.returns.slice(-minLen));

    const stats = aligned.map(rets => {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rets.length;
      const std = Math.sqrt(variance);
      const annVol = std * Math.sqrt(252) * 100;
      const z95 = 1.645, z99 = 2.326;
      return {
        mean, std, annVol,
        varDaily95: ((mean - z95 * std) * 100).toFixed(2),
        varDaily99: ((mean - z99 * std) * 100).toFixed(2),
        varMonthly95: ((mean * 21 - z95 * std * Math.sqrt(21)) * 100).toFixed(2),
        varMonthly99: ((mean * 21 - z99 * std * Math.sqrt(21)) * 100).toFixed(2),
      };
    });

    const corrMatrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 1;
        let cov = 0;
        for (let k = 0; k < minLen; k++) cov += (aligned[i][k] - stats[i].mean) * (aligned[j][k] - stats[j].mean);
        cov /= minLen;
        return parseFloat((cov / (stats[i].std * stats[j].std)).toFixed(4));
      })
    );

    let portfolioVaR = null;
    if (weights && weights.length === n) {
      const w = weights.map(x => parseFloat(x) / 100);
      const portMean = w.reduce((acc, wi, i) => acc + wi * stats[i].mean, 0);
      let portVar = 0;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          portVar += w[i] * w[j] * corrMatrix[i][j] * stats[i].std * stats[j].std;
      const portStd = Math.sqrt(portVar);
      const z95 = 1.645, z99 = 2.326;
      portfolioVaR = {
        daily95: ((portMean - z95 * portStd) * 100).toFixed(2),
        daily99: ((portMean - z99 * portStd) * 100).toFixed(2),
        monthly95: ((portMean * 21 - z95 * portStd * Math.sqrt(21)) * 100).toFixed(2),
        monthly99: ((portMean * 21 - z99 * portStd * Math.sqrt(21)) * 100).toFixed(2),
        annVol: (portStd * Math.sqrt(252) * 100).toFixed(2),
      };
    }

    res.json({
      tickers: valid.map(v => v.ticker),
      corrMatrix,
      stockStats: valid.map((v, i) => ({
        ticker: v.ticker,
        annVol: parseFloat(stats[i].annVol).toFixed(2),
        varDaily95: stats[i].varDaily95,
        varDaily99: stats[i].varDaily99,
        varMonthly95: stats[i].varMonthly95,
        varMonthly99: stats[i].varMonthly99,
      })),
      portfolioVaR,
    });
  } catch (err) {
    cachedCrumb = null; cachedCookie = null;
    res.status(500).json({ error: '相關係數計算失敗', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ 金融分析伺服器啟動成功！`);
  console.log(`🌐 請開啟瀏覽器前往：http://localhost:${PORT}\n`);
});