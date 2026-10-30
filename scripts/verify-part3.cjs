// Run only against a disposable MongoDB: the suites intentionally reset fixture databases.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'docs', 'evidence');
const mongo = new URL(process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/vps_part3');
if (!process.argv.includes('--disposable-db') || !['localhost', '127.0.0.1', '[::1]'].includes(mongo.hostname)
    || !mongo.pathname.startsWith('/vps_part3')) {
  throw new Error('Use --disposable-db and a dedicated loopback MongoDB with a vps_part3 database. Backend suites also reset vps_backend_* databases on that instance.');
}
fs.mkdirSync(evidence, { recursive: true });
const environment = { ...process.env, NODE_ENV: 'test', MONGO_URL: mongo.toString(),
  JWT_SECRET: 'part3_local_test_only', PAYMENT_WEBHOOK_SECRET: 'part3_webhook_test_only',
  PAYMENT_SANDBOX_AUTOCONFIRM: 'false', PORT: process.env.PART3_PORT || '4028' };
const commands = [];
const resume = process.argv.includes('--resume-after-backend');
let previousAttempt;
if (resume) {
 const previous = JSON.parse(fs.readFileSync(path.join(evidence, 'run-manifest.json'), 'utf8'));
 for (const label of ['unit', 'backend-tests']) {
  const result = JSON.parse(fs.readFileSync(path.join(evidence, label === 'unit' ? 'unit-results.json' : 'backend-results.json'), 'utf8'));
  const command = previous.commands.find(c => c.label === label && c.exitCode === 0);
  if (!command || result.numFailedTests || !result.numPassedTests) throw new Error('Cannot resume: successful ' + label + ' evidence is missing');
  commands.push(command);
 }
 previousAttempt = { generatedAt: previous.generatedAt, success: previous.success, errors: previous.commands.filter(c => c.error) };
}
function run(label, dir, args, extra = {}) {
  const started = new Date().toISOString();
  const log = fs.openSync(path.join(evidence, label + '.log'), 'w');
  console.log('Running ' + label);
  const result = cp.spawnSync(process.execPath, args, { cwd: path.join(root, dir), env: { ...environment, ...extra }, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  commands.push({ label, dir, args, started, finished: new Date().toISOString(), exitCode: result.status, error: result.error?.message });
  return result.status === 0;
}
(async () => {
 let server, serverLog;
 let success = true;
 try {
  if (!resume) {
  success = run('unit', 'backend', ['node_modules/jest/bin/jest.js', '--runInBand', '--runTestsByPath',
   'test/validation.test.js', 'test/permissions.test.js', 'test/pricing.test.js', '--json', '--outputFile=../docs/evidence/unit-results.json'], { MONGO_URL: '' }) && success;
  success = run('backend-tests', 'backend', ['node_modules/jest/bin/jest.js', '--runInBand', '--coverage', '--collectCoverageFrom=src/**/*.js',
   '--coverageDirectory=../docs/coverage', '--coverageReporters=json-summary', '--coverageReporters=json', '--coverageReporters=html',
   '--coverageReporters=text', '--json', '--outputFile=../docs/evidence/backend-results.json']) && success;
  }
  success = run('coverage-scope', '', ['scripts/complete-coverage.cjs']) && success;
  const benchMongo = new URL(mongo);
  benchMongo.pathname += '_bench';
  success = run('gate-benchmark', 'backend', ['scripts/bench-gate.js', '20', '3', '1000'], { MONGO_URL: benchMongo.toString() }) && success;
  serverLog = fs.openSync(path.join(evidence, 'backend.log'), 'w');
  server = cp.spawn(process.execPath, ['src/server.js'], { cwd: path.join(root, 'backend'), env: environment, stdio: ['ignore', serverLog, serverLog], windowsHide: true });
  const api = 'http://127.0.0.1:' + environment.PORT;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
   try { if ((await fetch(api + '/api/health')).ok) { ready = true; break; } } catch {}
   await new Promise(r => setTimeout(r, 500));
  }
  if (!ready) throw new Error('API did not start; see docs/evidence/backend.log');
  success = run('acceptance', 'tests', ['node_modules/jest/bin/jest.js', '--runInBand', '--json', '--outputFile=../docs/evidence/acceptance-results.json'],
   { API_URL: api, BACKEND_LOG: path.join(evidence, 'backend.log') }) && success;
  success = run('frontend-build', 'frontend', ['node_modules/vite/bin/vite.js', 'build'], { NODE_ENV: 'production' }) && success;
 } catch (e) { success = false; commands.push({ error: e.message }); console.error(e.message); }
 finally {
  if (server) { server.kill(); await new Promise(r => server.once('exit', r)); }
  if (serverLog !== undefined) fs.closeSync(serverLog);
  const revision = cp.spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
  fs.writeFileSync(path.join(evidence, 'run-manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
   node: process.version, platform: process.platform, arch: process.arch, baselineRevision: revision,
   scope: 'Local automated verification; working-tree changes included. Not UAT or deployment certification.',
   commands, previousAttempt, success }, null, 2));
 }
 process.exitCode = success ? 0 : 1;
})();
