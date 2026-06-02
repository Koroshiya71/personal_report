import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const PORT = 8080;
const HOST = '0.0.0.0';

// Global state for background tasks
let isCrawling = false;
let isUpdating = false;
let lastCrawlError = null;
let lastUpdateError = null;

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
  // Handle API request to query task status
  if (req.url === '/api/status') {
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      crawling: isCrawling,
      updating: isUpdating,
      lastCrawlError: lastCrawlError,
      lastUpdateError: lastUpdateError
    }));
    return;
  }

  // Handle API request to manually trigger crawl in the background
  if (req.url === '/api/crawl') {
    console.log(`[API] [${new Date().toLocaleString()}] Manual crawl request received.`);
    res.writeHead(200, { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });

    if (isCrawling) {
      res.end(JSON.stringify({ success: false, error: '爬虫任务已在后台运行中，请勿重复提交。' }));
      return;
    }

    isCrawling = true;
    lastCrawlError = null;

    exec('npm run crawl', (error, stdout, stderr) => {
      isCrawling = false;
      if (error) {
        console.error(`[API Error] Scraper run failed: ${error.message}`);
        lastCrawlError = error.message;
        return;
      }
      console.log(`[API Output] Manual crawl completed successfully.`);
    });

    res.end(JSON.stringify({ success: true, message: '爬虫已在后台启动。' }));
    return;
  }

  // Handle API request to trigger Git update and rebuild in the background
  if (req.url === '/api/update') {
    console.log(`[API] [${new Date().toLocaleString()}] System update request received.`);
    
    if (isUpdating) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: false, error: '系统更新已在后台运行中，请勿重复提交。' }));
      return;
    }

    const runForcedUpdate = (httpRes) => {
      isUpdating = true;
      lastUpdateError = null;
      httpRes.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      httpRes.end(JSON.stringify({ success: true, upToDate: false, message: '检测到新版本，系统已在后台启动更新并重新编译。' }));

      // Reset local changes to tracked files first, pull latest code, install dependencies, and rebuild the React app
      exec('git reset --hard HEAD && git pull && npm install && npm run build', (error, stdout, stderr) => {
        isUpdating = false;
        if (error) {
          console.error(`[API Error] Update failed: ${error.message}`);
          lastUpdateError = error.message;
          return;
        }
        console.log(`[API Output] Update completed successfully.`);
      });
    };

    // Pre-check if local branch is already up to date with remote origin main
    exec('git fetch origin main && git rev-parse HEAD && git rev-parse origin/main', (err, stdout, stderr) => {
      if (err) {
        console.warn(`[API Update Warn] Pre-check failed: ${err.message}. Proceeding with forced update...`);
        runForcedUpdate(res);
        return;
      }
      
      const lines = stdout.trim().split('\n').map(l => l.trim()).filter(l => l.length === 40);
      if (lines.length >= 2) {
        const localHash = lines[lines.length - 2];
        const remoteHash = lines[lines.length - 1];
        console.log(`[API Update] Local version: ${localHash}, Remote version: ${remoteHash}`);
        if (localHash === remoteHash) {
          console.log(`[API Update] Already up to date.`);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: true, upToDate: true, message: '系统已是最新版本，无需更新。' }));
          return;
        }
      }
      
      // Hashes differ or parse failed: proceed with update
      runForcedUpdate(res);
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
  if (isCrawling) {
    console.log(`[Scheduler] [${new Date().toLocaleString()}] Crawl already running. Skipping scheduled run.`);
    return;
  }
  console.log(`[Scheduler] [${new Date().toLocaleString()}] Starting crawl...`);
  isCrawling = true;
  exec('npm run crawl', (error, stdout, stderr) => {
    isCrawling = false;
    if (error) {
      console.error(`[Scheduler Error] Scraper run failed: ${error.message}`);
      lastCrawlError = error.message;
      return;
    }
    console.log(`[Scheduler Output] Scraper finished successfully:\n${stdout}`);
    if (stderr) {
      console.warn(`[Scheduler Warn Log]:\n${stderr}`);
    }
  });
}

// Run after a short delay on container startup to ensure network initialization
console.log('[Scheduler] Initializing startup crawl in 10 seconds...');
setTimeout(runCrawler, 10000);


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
