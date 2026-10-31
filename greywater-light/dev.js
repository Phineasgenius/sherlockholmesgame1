// Optional local server:  node dev.js   (then open http://localhost:3000)
// Uses an in-memory store unless SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
const http = require('http'), fs = require('fs'), path = require('path');
const handler = require('./api/game.js');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  if (req.url.startsWith('/api/game')) {
    let raw = ''; req.on('data', c => raw += c);
    req.on('end', () => { try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; } handler(req, res); });
    return;
  }
  const f = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log('Hunt running on http://localhost:' + (process.env.PORT || 3000)));
