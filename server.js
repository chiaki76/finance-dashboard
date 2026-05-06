const express = require('express');
const cors = require('cors');
const yahooFinance = require('yahoo-finance2').default;
yahooFinance.suppressNotices(['yahooSurvey']);
yahooFinance.setGlobalConfig({ validation: { logErrors: false, logOptionsErrors: false } });
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── 股票基本資訊 + 現價 ───────────────────────────────────────────
app.get('/api/quote/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const quote = await yahooFinance.quote(ticker.toUpperCase());

    res.json({
      ticker: quote.symbol,
      name: quote.longName || quote.shortName || ticker,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChangePercent,
      changeAbs: quote.regularMarketChange,
      open: quote.regularMarketOpen,
      high: quote.regularMarketDayHigh,
      low: quote.regularMarketDayLow,
      volume: quote.regularMarketVolume,
      marketCap: quote.marketCap,
      pe: quote.trailingPE,
      eps: quote.epsTrailingTwelveMonths,
      week52High: quote.fiftyTwoWeekHigh,
      week52Low: quote.fiftyTwoWeekLow,
      currency: quote.currency,
      exchange: quote.fullExchangeName,
    });
  } catch (err) {
    res.status(400).json({ error: `找不到股票代碼：${req.params.ticker}`, detail: err.message });
  }
});

// ─── 歷史股價（用於走勢圖）────────────────────────────────────────
app.get('/api/history/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const { period = '1mo' } = req.query;

    const periodMap = {
      '1mo': { period1: daysAgo(30) },
      '3mo': { period1: daysAgo(90) },
      '6mo': { period1: daysAgo(180) },
      '1y':  { period1: daysAgo(365) },
    };

    const opts = periodMap[period] || periodMap['1mo'];
    const result = await yahooFinance.historical(ticker.toUpperCase(), {
      ...opts,
      interval: '1d',
    });

    const data = result.map(d => ({
      date: d.date.toISOString().split('T')[0],
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: '無法取得歷史數據', detail: err.message });
  }
});

// ─── 波動性 & 夏普比率分析 ────────────────────────────────────────
app.get('/api/analysis', async (req, res) => {
  try {
    const { tickers, rf = 4.5 } = req.query;
    const tickerList = tickers.split(',').map(t => t.trim().toUpperCase());
    const rfRate = parseFloat(rf) / 100;

    const results = await Promise.all(
      tickerList.map(async (ticker) => {
        try {
          const hist = await yahooFinance.historical(ticker, {
            period1: daysAgo(365),
            interval: '1d',
          });

          if (hist.length < 10) return null;

          const closes = hist.map(d => d.close);
          const returns = [];
          for (let i = 1; i < closes.length; i++) {
            returns.push((closes[i] - closes[i-1]) / closes[i-1]);
          }

          const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
          const annualReturn = meanReturn * 252;
          const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length;
          const dailyVol = Math.sqrt(variance);
          const annualVol = dailyVol * Math.sqrt(252);
          const sharpe = (annualReturn - rfRate) / annualVol;

          const quote = await yahooFinance.quote(ticker);

          return {
            ticker,
            name: quote.shortName || ticker,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChangePercent,
            annualReturn: (annualReturn * 100).toFixed(2),
            annualVol: (annualVol * 100).toFixed(2),
            sharpe: sharpe.toFixed(3),
          };
        } catch {
          return null;
        }
      })
    );

    res.json(results.filter(Boolean));
  } catch (err) {
    res.status(400).json({ error: '分析失敗', detail: err.message });
  }
});

// ─── 即時多股價格（投資組合用）───────────────────────────────────
app.post('/api/quotes', async (req, res) => {
  try {
    const { tickers } = req.body;
    const results = await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const q = await yahooFinance.quote(ticker.toUpperCase());
          return {
            ticker: q.symbol,
            name: q.shortName || ticker,
            price: q.regularMarketPrice,
            change: q.regularMarketChangePercent,
            currency: q.currency,
          };
        } catch {
          return { ticker, price: null, error: true };
        }
      })
    );
    res.json(results);
  } catch (err) {
    res.status(400).json({ error: '批次查詢失敗', detail: err.message });
  }
});

// ─── 搜尋股票代碼 ─────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    const result = await yahooFinance.search(q, { quotesCount: 6 });
    const quotes = result.quotes
      .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
      .map(r => ({
        ticker: r.symbol,
        name: r.longname || r.shortname || r.symbol,
        exchange: r.exchange,
        type: r.quoteType,
      }));
    res.json(quotes);
  } catch (err) {
    res.status(400).json({ error: '搜尋失敗', detail: err.message });
  }
});

// ─── Helper ───────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

app.listen(PORT, () => {
  console.log(`\n✅ 金融分析伺服器啟動成功！`);
  console.log(`🌐 請開啟瀏覽器前往：http://localhost:${PORT}\n`);
});
