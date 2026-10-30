// Include every backend source file, even if Jest never loaded it. Never credit
// executions from the separate acceptance process to the instrumented Jest run.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const modules = path.join(root, 'backend/node_modules');
const { createCoverageMap } = require(path.join(modules, 'istanbul-lib-coverage'));
const { createInstrumenter } = require(path.join(modules, 'istanbul-lib-instrument'));
const { createContext } = require(path.join(modules, 'istanbul-lib-report'));
const reports = require(path.join(modules, 'istanbul-reports'));
const coverageDir = path.join(root, 'docs/coverage');
const map = createCoverageMap(JSON.parse(fs.readFileSync(path.join(coverageDir, 'coverage-final.json'), 'utf8')));
const before = map.getCoverageSummary().toJSON();
const added = [];
function walk(dir) {
 return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : e.name.endsWith('.js') ? [path.join(dir,e.name)] : []);
}
const sources = walk(path.join(root, 'backend/src'));
for (const file of sources) {
 if (map.files().includes(file)) continue;
 const instrumenter = createInstrumenter();
 instrumenter.instrumentSync(fs.readFileSync(file, 'utf8'), file);
 map.addFileCoverage(instrumenter.lastFileCoverage());
 added.push(path.relative(root,file).split(path.sep).join('/'));
}
const context = createContext({ dir: coverageDir, coverageMap: map, sourceFinder: file => fs.readFileSync(file,'utf8') });
for (const name of ['json','json-summary','html']) reports.create(name).execute(context);
fs.writeFileSync(path.join(root,'docs/evidence/coverage-scope.json'), JSON.stringify({
 generatedAt:new Date().toISOString(),sourceFiles:sources.length,reportedFiles:map.files().length,
 addedZeroHitFiles:added, before, after:map.getCoverageSummary().toJSON(),
 method:'Istanbul zero-hit instrumentation for source files absent from the Jest coverage map. No unobserved execution is credited.'
},null,2));
if (sources.length !== map.files().length) throw new Error('Coverage scope mismatch');
console.log('Coverage scope: '+sources.length+' source files; added zero-hit maps for '+added.length+' unloaded files.');
