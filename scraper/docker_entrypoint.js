import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const PORT = 8080;
const HOST = '0.0.0.0';
const ROOT_DIR = process.cwd();
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const DATA_DIR = path.resolve(ROOT_DIR, 'src', 'data');
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();

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
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function sendMethodNotAllowed(res) {
  sendJson(res, 405, { success: false, error: 'Method Not Allowed' }, { Allow: 'POST' });
}

function getHeaderValue(value) {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function isAuthorized(req) {
  if (!ADMIN_TOKEN) return true;

  const headerToken = getHeaderValue(req.headers['x-admin-token']).trim();
  const authorization = getHeaderValue(req.headers.authorization).trim();
  const bearerToken = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';

  return headerToken === ADMIN_TOKEN || bearerToken === ADMIN_TOKEN;
}

function requireAdminPost(req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res);
    return false;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { success: false, error: 'Unauthorized' });
    return false;
  }

  return true;
}

function parseRequestPath(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    return decodeURIComponent(url.pathname);
  } catch {
    sendJson(res, 400, { error: 'Bad request path' });
    return null;
  }
}

function resolveInside(baseDir, relativePath) {
  const resolved = path.resolve(baseDir, relativePath);
  if (resolved === baseDir || resolved.startsWith(baseDir + path.sep)) {
    return resolved;
  }
  return null;
}

function serveFile(reqPath, res) {
  let filePath;
  const isDataRequest = reqPath.startsWith('/src/data/');

  if (isDataRequest) {
    filePath = resolveInside(DATA_DIR, reqPath.slice('/src/data/'.length));
    if (!filePath) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
  } else {
    const relativePath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
    filePath = resolveInside(DIST_DIR, relativePath);
    if (!filePath) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Fallback for client-side routing (SPA fallback)
  if (!fs.existsSync(filePath)) {
    if (isDataRequest) {
      sendJson(res, 404, { error: 'Data file not found' });
      return;
    }
    filePath = path.join(DIST_DIR, 'index.html');
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
}

// 1. Start a simple static server to host the compiled Vite 'dist' folder
const server = http.createServer((req, res) => {
  const reqPath = parseRequestPath(req, res);
  if (!reqPath) return;

  if (reqPath === '/api/status') {
    sendJson(res, 200, {
      crawling: isCrawling,
      updating: isUpdating,
      lastCrawlError,
      lastUpdateError,
    });
    return;
  }

  if (reqPath === '/api/crawl') {
    console.log(`[API] [${new Date().toLocaleString()}] Manual crawl request received.`);
    if (!requireAdminPost(req, res)) return;

    if (isCrawling) {
      sendJson(res, 200, { success: false, error: 'Crawler is already running.' });
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
      console.log('[API Output] Manual crawl completed successfully.');
      if (stdout) console.log(stdout);
      if (stderr) console.warn(stderr);
    });

    sendJson(res, 200, { success: true, message: 'Crawler started in the background.' });
    return;
  }

  if (reqPath === '/api/update') {
    console.log(`[API] [${new Date().toLocaleString()}] System update request received.`);
    if (!requireAdminPost(req, res)) return;

    if (isUpdating) {
      sendJson(res, 200, { success: false, error: 'System update is already running.' });
      return;
    }

    const runForcedUpdate = (httpRes) => {
      isUpdating = true;
      lastUpdateError = null;
      sendJson(httpRes, 200, {
        success: true,
        upToDate: false,
        message: 'Update started in the background.',
      });

      // Reset local changes to tracked files first, pull latest code, install dependencies, and rebuild the React app
      exec('git reset --hard HEAD && git pull && npm install && npm run build', (error, stdout, stderr) => {
        isUpdating = false;
        if (error) {
          console.error(`[API Error] Update failed: ${error.message}`);
          lastUpdateError = error.message;
          return;
        }
        console.log('[API Output] Update completed successfully.');
        if (stdout) console.log(stdout);
        if (stderr) console.warn(stderr);
      });
    };

    // Pre-check if local branch is already up to date with remote origin main
    exec('git fetch origin main && git rev-parse HEAD && git rev-parse origin/main', (err, stdout) => {
      if (err) {
        console.warn(`[API Update Warn] Pre-check failed: ${err.message}. Proceeding with forced update...`);
        runForcedUpdate(res);
        return;
      }

      const lines = stdout.trim().split('\n').map((line) => line.trim()).filter((line) => line.length === 40);
      if (lines.length >= 2) {
        const localHash = lines[lines.length - 2];
        const remoteHash = lines[lines.length - 1];
        console.log(`[API Update] Local version: ${localHash}, Remote version: ${remoteHash}`);
        if (localHash === remoteHash) {
          console.log('[API Update] Already up to date.');
          sendJson(res, 200, {
            success: true,
            upToDate: true,
            message: 'System is already up to date.',
          });
          return;
        }
      }

      // Hashes differ or parse failed: proceed with update
      runForcedUpdate(res);
    });
    return;
  }

  serveFile(reqPath, res);
});

server.listen(PORT, HOST, () => {
  console.log(`[Server] Dashboard is running at http://${HOST}:${PORT}`);
  if (ADMIN_TOKEN) {
    console.log('[Server] Admin token protection is enabled for mutation APIs.');
  }
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
    scheduleNextCrawl();
  }, msToNextRun);
}

scheduleNextCrawl();
