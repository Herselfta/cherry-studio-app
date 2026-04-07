const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, 'mobile-sync-dev.log');
let requestCount = 0;

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      requestCount++;
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${body}\n`;
      fs.appendFileSync(logFile, logEntry);
      
      console.log(`[I.R.I.S. Sync Log #${requestCount}] Received packet.`);
      
      res.writeHead(200);
      res.end('Logged');
    });
  } else {
    res.writeHead(200);
    res.end(`App Sync Log Server running.\nLogs being written to: ${logFile}`);
  }
});

const PORT = 8099;
server.listen(PORT, () => {
  console.log(`[I.R.I.S.] App Sync Dev Log Server is listening on port ${PORT}...`);
  console.log(`[I.R.I.S.] Mobile app logs will be specifically routed and saved to: ${logFile}`);
  fs.appendFileSync(logFile, `\n\n--- [I.R.I.S.] Log Session Started: ${new Date().toISOString()} ---\n`);
});
