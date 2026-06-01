import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const PORT = 8080;
const HOST = '0.0.0.0';

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 1. Start a simple static server to host the compiled Vite 'dist' folder
const server = http.createServer((req, res) => {
  // Handle API request to manually trigger crawl
  if (req.url === '/api/crawl') {
    console.log(`[API] [${new Date().toLocaleString()}] Manual crawl request received.`);
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    
    exec('npm run crawl', (error, stdout, stderr) => {
      if (error) {
        console.error(`[API Error] Scraper run failed: ${error.message}`);
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
      console.log(`[API Output] Manual crawl completed successfully.`);
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // Handle API request to trigger Git update and rebuild
  if (req.url === '/api/update') {
    console.log(`[API] [${new Date().toLocaleString()}] System update request received.`);
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    
    // Pull latest code, install dependencies, and rebuild the React app
    exec('git pull && npm install && npm run build', (error, stdout, stderr) => {
      if (error) {
        console.error(`[API Error] Update failed: ${error.message}`);
        res.end(JSON.stringify({ success: false, error: error.message }));
        return;
      }
      console.log(`[API Output] Update completed successfully.`);
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  let filePath;
  // Serve the dynamic data files directly from the src/data folder instead of dist
  if (req.url.startsWith('/src/data/')) {
    filePath = path.join(process.cwd(), req.url);
  } else {
    filePath = path.join(process.cwd(), 'dist', req.url === '/' ? 'index.html' : req.url);
  }
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Fallback for client-side routing (SPA fallback)
  if (!fs.existsSync(filePath)) {
    if (req.url.startsWith('/src/data/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Data file not found' }));
      return;
    }
    filePath = path.join(process.cwd(), 'dist', 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end('Server Error');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Server] Dashboard is running at http://${HOST}:${PORT}`);
});

// 2. Scheduler logic
function runCrawler() {
  console.log(`[Scheduler] [${new Date().toLocaleString()}] Starting crawl...`);
  exec('npm run crawl', (error, stdout, stderr) => {
    if (error) {
      console.error(`[Scheduler Error] Scraper run failed: ${error.message}`);
      return;
    }
    console.log(`[Scheduler Output] Scraper finished successfully:\n${stdout}`);
    if (stderr) {
      console.warn(`[Scheduler Warn Log]:\n${stderr}`);
    }
  });
}

// Run immediately on container startup to ensure fresh data
console.log('[Scheduler] Initializing startup crawl...');
runCrawler();

// Set up daily schedule loop at 9:00 AM local time
function scheduleNextCrawl() {
  const now = new Date();
  const nextRun = new Date();
  nextRun.setHours(9, 0, 0, 0);

  // If 9:00 AM is in the past for today, schedule it for tomorrow
  if (now.getTime() >= nextRun.getTime()) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  const msToNextRun = nextRun.getTime() - now.getTime();
  console.log(`[Scheduler] Next crawl scheduled for: ${nextRun.toLocaleString()} (${(msToNextRun / 1000 / 60 / 60).toFixed(2)} hours from now).`);

  setTimeout(() => {
    runCrawler();
    scheduleNextCrawl(); // Schedule the next day
  }, msToNextRun);
}

scheduleNextCrawl();
