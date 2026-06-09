import fs from 'node:fs';

const checks = [];

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assertIncludes(name, content, needle) {
  checks.push(name);
  if (!content.includes(needle)) {
    throw new Error(`${name}: expected to find "${needle}"`);
  }
}

function assertOrder(name, content, first, second) {
  checks.push(name);
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);
  if (firstIndex === -1 || secondIndex === -1 || firstIndex >= secondIndex) {
    throw new Error(`${name}: expected "${first}" before "${second}"`);
  }
}

const app = read('src/App.tsx');
const server = read('scraper/docker_entrypoint.js');
const scraper = read('scraper/index.ts');

assertIncludes('feedback GET endpoint exists', server, "if (req.method === 'GET')");
assertOrder('feedback GET is handled before POST-only guard', server, "if (req.method === 'GET')", 'if (!requireAdminPost(req, res)) return;');
assertIncludes('read_later is accepted by API', server, "'read_later'");
assertIncludes('frontend fetches feedback collection', app, "fetch('/api/feedback'");
assertIncludes('frontend handles stale backend 405', app, '后端还不支持读取收藏夹');
assertIncludes('favorites tab exists', app, "activeTab === 'favorites'");
assertIncludes('read later tab exists', app, "activeTab === 'read_later'");
assertIncludes('read later feedback button exists', app, "sendFeedback('read_later'");
assertIncludes('scraper tolerates read_later feedback', scraper, "'read_later'");

console.log(`Smoke checks passed (${checks.length} checks).`);
