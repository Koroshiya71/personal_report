import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec, execFile } from 'child_process';

const PORT = 8080;
const HOST = '0.0.0.0';
const ROOT_DIR = process.cwd();
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const DATA_DIR = path.resolve(ROOT_DIR, 'src', 'data');
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();
const ENABLE_SELF_UPDATE = (process.env.ENABLE_SELF_UPDATE || '').trim().toLowerCase() === 'true';
const FEEDBACK_PATH = path.resolve(DATA_DIR, 'feedback.json');

// Global state for background tasks
let isCrawling = false;
let isUpdating = false;
let lastCrawlError = null;
let lastUpdateError = null;
let lastCrawlStartedAt = null;
let lastCrawlFinishedAt = null;
let lastUpdateStartedAt = null;
let lastUpdateFinishedAt = null;
let lastUpdateUpToDate = null;

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
  if (!ADMIN_TOKEN) return false;

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

  if (!ADMIN_TOKEN) {
    sendJson(res, 503, {
      success: false,
      error: 'Mutation APIs are disabled until ADMIN_TOKEN is configured.',
    });
    return false;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { success: false, error: 'Unauthorized' });
    return false;
  }

  return true;
}

function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function loadFeedback() {
  try {
    if (!fs.existsSync(FEEDBACK_PATH)) {
      return { entries: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8'));
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function saveFeedback(feedback) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const entries = feedback.entries.slice(-500);
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify({ entries }, null, 2), 'utf-8');
}

function runFile(command, args = []) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: ROOT_DIR, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function getDirtyPaths(statusOutput) {
  return statusOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, ''));
}

async function restoreGeneratedLockfileIfSafe() {
  const statusResult = await runFile('git', ['status', '--porcelain']);
  const dirtyPaths = getDirtyPaths(statusResult.stdout);
  if (dirtyPaths.length === 1 && dirtyPaths[0] === 'package-lock.json') {
    console.warn('[API Update] package-lock.json has local generated changes. Restoring it before self-update.');
    await runFile('git', ['restore', '--', 'package-lock.json']);
  }
}

async function runSafeSelfUpdate() {
  const branchResult = await runFile('git', ['branch', '--show-current']);
  const currentBranch = branchResult.stdout.trim();
  if (currentBranch !== 'main') {
    throw new Error(`Self-update is only allowed on main. Current branch: ${currentBranch || 'unknown'}`);
  }

  await restoreGeneratedLockfileIfSafe();

  const statusResult = await runFile('git', ['status', '--porcelain']);
  if (statusResult.stdout.trim()) {
    throw new Error('Working tree is not clean. Commit or discard local changes before self-update.');
  }

  await runFile('git', ['fetch', 'origin', 'main']);
  const localResult = await runFile('git', ['rev-parse', 'HEAD']);
  const remoteResult = await runFile('git', ['rev-parse', 'origin/main']);
  const localHash = localResult.stdout.trim();
  const remoteHash = remoteResult.stdout.trim();

  if (localHash === remoteHash) {
    return { upToDate: true, localHash, remoteHash };
  }

  const ancestorResult = await runFile('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'])
    .then(() => true)
    .catch(() => false);
  if (!ancestorResult) {
    throw new Error('Remote main is not a fast-forward from local HEAD. Manual update required.');
  }

  await runFile('git', ['merge', '--ff-only', 'origin/main']);
  await runFile('npm', ['ci']);
  await runFile('npm', ['run', 'build']);

  return { upToDate: false, localHash, remoteHash };
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
const server = http.createServer(async (req, res) => {
  const reqPath = parseRequestPath(req, res);
  if (!reqPath) return;

  if (reqPath === '/api/status') {
    sendJson(res, 200, {
      crawling: isCrawling,
      updating: isUpdating,
      lastCrawlError,
      lastUpdateError,
      lastCrawlStartedAt,
      lastCrawlFinishedAt,
      lastUpdateStartedAt,
      lastUpdateFinishedAt,
      lastUpdateUpToDate,
      adminTokenConfigured: Boolean(ADMIN_TOKEN),
      selfUpdateEnabled: ENABLE_SELF_UPDATE,
    });
    return;
  }

  if (reqPath === '/api/feedback') {
    if (req.method === 'GET') {
      if (!isAuthorized(req)) {
        sendJson(res, ADMIN_TOKEN ? 401 : 503, {
          success: false,
          error: ADMIN_TOKEN ? 'Unauthorized' : 'Mutation APIs are disabled until ADMIN_TOKEN is configured.',
        });
        return;
      }

      const feedback = loadFeedback();
      sendJson(res, 200, { success: true, entries: feedback.entries.slice().reverse() });
      return;
    }

    if (req.method === 'DELETE') {
      if (!isAuthorized(req)) {
        sendJson(res, ADMIN_TOKEN ? 401 : 503, {
          success: false,
          error: ADMIN_TOKEN ? 'Unauthorized' : 'Mutation APIs are disabled until ADMIN_TOKEN is configured.',
        });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const type = typeof body.type === 'string' ? body.type : '';
        const itemTitle = typeof body.itemTitle === 'string' ? body.itemTitle.trim() : '';
        const itemCategory = typeof body.itemCategory === 'string' ? body.itemCategory.trim() : '';
        const removableTypes = new Set(['favorite', 'read_later']);

        if (!removableTypes.has(type) || !itemTitle) {
          sendJson(res, 400, { success: false, error: 'Invalid feedback delete payload.' });
          return;
        }

        const feedback = loadFeedback();
        const originalCount = feedback.entries.length;
        feedback.entries = feedback.entries.filter((entry) => {
          return !(
            entry.type === type &&
            entry.itemTitle === itemTitle &&
            (!itemCategory || entry.itemCategory === itemCategory)
          );
        });
        saveFeedback(feedback);
        sendJson(res, 200, {
          success: true,
          removed: originalCount - feedback.entries.length,
          total: feedback.entries.length,
        });
      } catch (error) {
        sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : 'Invalid request.' });
      }
      return;
    }

    if (!requireAdminPost(req, res)) return;

    try {
      const body = await readJsonBody(req);
      const type = typeof body.type === 'string' ? body.type : '';
      const itemTitle = typeof body.itemTitle === 'string' ? body.itemTitle.trim() : '';
      const itemCategory = typeof body.itemCategory === 'string' ? body.itemCategory.trim() : '';
      const itemLink = typeof body.itemLink === 'string' ? body.itemLink.trim() : '';
      const allowedTypes = new Set(['favorite', 'dislike', 'more_like_this', 'read_later']);

      if (!allowedTypes.has(type) || !itemTitle) {
        sendJson(res, 400, { success: false, error: 'Invalid feedback payload.' });
        return;
      }

      const feedback = loadFeedback();
      feedback.entries.push({
        type,
        itemTitle,
        itemCategory,
        itemLink,
        createdAt: new Date().toISOString(),
      });
      saveFeedback(feedback);
      sendJson(res, 200, { success: true, total: feedback.entries.length });
    } catch (error) {
      sendJson(res, 400, { success: false, error: error instanceof Error ? error.message : 'Invalid request.' });
    }
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
    lastCrawlStartedAt = new Date().toISOString();
    lastCrawlFinishedAt = null;

    exec('npm run crawl', (error, stdout, stderr) => {
      isCrawling = false;
      lastCrawlFinishedAt = new Date().toISOString();
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

    if (!ENABLE_SELF_UPDATE) {
      sendJson(res, 403, {
        success: false,
        error: 'Self-update is disabled. Set ENABLE_SELF_UPDATE=true to allow /api/update.',
      });
      return;
    }

    if (isUpdating) {
      sendJson(res, 200, { success: false, error: 'System update is already running.' });
      return;
    }

    isUpdating = true;
    lastUpdateError = null;
    lastUpdateStartedAt = new Date().toISOString();
    lastUpdateFinishedAt = null;
    lastUpdateUpToDate = null;
    sendJson(res, 200, {
      success: true,
      upToDate: false,
      message: 'Safe self-update started in the background.',
    });

    runSafeSelfUpdate()
      .then((result) => {
        lastUpdateUpToDate = result.upToDate;
        console.log(result.upToDate ? '[API Update] Already up to date.' : '[API Update] Update completed successfully.');
        if (!result.upToDate) {
          console.log('[API Update] Restarting server process to load updated backend and static assets.');
          setTimeout(() => {
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 3000);
          }, 1000);
        }
      })
      .catch((error) => {
        console.error(`[API Error] Update failed: ${error.message}`);
        lastUpdateError = error.message;
      })
      .finally(() => {
        isUpdating = false;
        lastUpdateFinishedAt = new Date().toISOString();
      });
    return;
  }

  serveFile(reqPath, res);
});

server.listen(PORT, HOST, () => {
  console.log(`[Server] Dashboard is running at http://${HOST}:${PORT}`);
  if (ADMIN_TOKEN) {
    console.log('[Server] Admin token protection is enabled for mutation APIs.');
  } else {
    console.warn('[Server] ADMIN_TOKEN is not configured. Mutation APIs are disabled.');
  }
  if (ENABLE_SELF_UPDATE) {
    console.log('[Server] Safe self-update is enabled.');
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
  lastCrawlStartedAt = new Date().toISOString();
  lastCrawlFinishedAt = null;
  exec('npm run crawl', (error, stdout, stderr) => {
    isCrawling = false;
    lastCrawlFinishedAt = new Date().toISOString();
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
