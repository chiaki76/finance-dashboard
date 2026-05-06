# 📈 金融分析儀表板

串接 Yahoo Finance 真實數據的股票分析網站。

## 功能

- 🔍 **股票查詢** — 搜尋美股、台股、ETF，查看即時報價與歷史走勢圖（1M/3M/6M/1Y）
- 📊 **波動性 & 夏普比率** — 多股比較年化波動性、報酬率、夏普比率
- 💼 **投資組合追蹤** — 新增持股，自動從 Yahoo Finance 更新現價計算損益

## 快速啟動

### 1. 安裝依賴

```bash
npm install
```

### 2. 啟動伺服器

```bash
npm start
```

### 3. 開啟瀏覽器

前往 → http://localhost:3000

---

## 開發模式（自動重啟）

```bash
npm run dev
```

---

## 支援的股票代碼格式

| 市場 | 格式 | 範例 |
|------|------|------|
| 美股 | 直接輸入 | `AAPL`, `MSFT`, `TSLA` |
| 台股 | 代碼 + .TW | `2330.TW`, `0050.TW` |
| 港股 | 代碼 + .HK | `0700.HK` |
| ETF | 直接輸入 | `SPY`, `QQQ` |

---

## API 端點

| 端點 | 說明 |
|------|------|
| `GET /api/quote/:ticker` | 取得股票即時報價 |
| `GET /api/history/:ticker?period=1mo` | 取得歷史股價（1mo/3mo/6mo/1y）|
| `GET /api/analysis?tickers=AAPL,MSFT&rf=4.5` | 波動性 & 夏普比率分析 |
| `POST /api/quotes` | 批次取得多支股票現價 |
| `GET /api/search?q=apple` | 搜尋股票代碼 |

---

## 技術架構

- **後端**：Node.js + Express + yahoo-finance2
- **前端**：純 HTML/CSS/JavaScript + Chart.js
- **數據來源**：Yahoo Finance（透過 yahoo-finance2 套件）
