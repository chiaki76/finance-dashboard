const express = require('express');
const cors = require('cors');
const path = require('path');
 
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
 
app.listen(PORT, () => {
  console.log(`\n✅ 金融分析伺服器啟動成功！`);
  console.log(`🌐 請開啟瀏覽器前往：http://localhost:${PORT}\n`);
});
 