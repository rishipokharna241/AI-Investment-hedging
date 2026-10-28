const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const rootDir = __dirname;
const port = process.env.PORT || 8000;
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

async function fetchYahooQuote(symbol) {
  const url = new URL(`${YAHOO_CHART}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('interval', '1m');
  url.searchParams.set('range', '1d');

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Yahoo request failed with ${res.status}`);
  }

  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta || !Number.isFinite(meta.regularMarketPrice)) {
    throw new Error('Yahoo response did not include a valid price');
  }

  const previousClose = meta.chartPreviousClose || meta.regularMarketPrice;
  const change = meta.regularMarketPrice - previousClose;
  const chPct = previousClose ? (change / previousClose) * 100 : 0;

  return {
    ok: true,
    price: meta.regularMarketPrice,
    change,
    chPct,
    high: meta.regularMarketDayHigh || meta.regularMarketPrice * 1.005,
    low: meta.regularMarketDayLow || meta.regularMarketPrice * 0.995,
    open: meta.regularMarketOpen || meta.regularMarketPrice,
    prevClose: previousClose,
  };
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(payload));
}

function serveStaticFile(res, urlPath) {
  const safePath = path.normalize(urlPath).replace(/^\/+/, '');
  const filePath = path.join(rootDir, safePath || 'index.html');

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.ico': 'image/x-icon',
    };

    const isHtmlOrJsOrCss = ['.html', '.js', '.css'].includes(ext);
    res.writeHead(200, {
      'Content-Type': types[ext] || 'text/plain; charset=utf-8',
      'Cache-Control': isHtmlOrJsOrCss ? 'no-store' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/api/quote') {
    const symbol = requestUrl.searchParams.get('symbol');
    if (!symbol) {
      sendJson(res, 400, { ok: false, error: 'Missing symbol query parameter' });
      return;
    }

    try {
      const decodedSymbol = decodeURIComponent(symbol);
      const payload = await fetchYahooQuote(decodedSymbol);
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 502, { ok: false, error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, status: 'ok' });
    return;
  }

  if (requestUrl.pathname === '/') {
    serveStaticFile(res, '/index.html');
    return;
  }

  serveStaticFile(res, requestUrl.pathname);
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
