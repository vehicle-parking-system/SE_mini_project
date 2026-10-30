"""Generate traceable Markdown, HTML and PDF deliverables from Jest/Istanbul evidence.

Usage: python scripts/generate-part3-reports.py
Requires reportlab for PDFs. Never invents a result when evidence is missing.
"""
from pathlib import Path
import json, re, hashlib, html, platform, subprocess
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'
EV = DOCS / 'evidence'
IST = timezone(timedelta(hours=5, minutes=30))

def load(name):
    return json.loads((EV / name).read_text(encoding='utf-8-sig'))

unit = load('unit-results.json')
backend = load('backend-results.json')
acceptance = load('acceptance-results.json')
manifest = load('run-manifest.json')
scope = load('coverage-scope.json')
benchmark_log = (EV/'gate-benchmark.log').read_text(encoding='utf-8-sig') if (EV/'gate-benchmark.log').exists() else ''
benchmark_rows = re.findall(r'^(Entry|Payment|Webhook|Exit)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$', benchmark_log, re.M)
benchmark_failures = re.findall(r'(\d+) failed', benchmark_log)
benchmark_budget_failed = any(float(row[3]) > 3000 for row in benchmark_rows if row[0] in ['Entry','Exit']) or bool(benchmark_failures and int(benchmark_failures[-1]))
coverage = json.loads((DOCS/'coverage/coverage-summary.json').read_text(encoding='utf-8'))
detail = json.loads((DOCS/'coverage/coverage-final.json').read_text(encoding='utf-8'))
date = datetime.fromisoformat(manifest['generatedAt'].replace('Z','+00:00')).astimezone(IST).strftime('%d %B %Y, %H:%M IST')

def rel(p):
    p = str(p).replace('\\','/')
    for marker in ['/backend/', '/tests/', '/frontend/']:
        if marker in p:
            return marker[1:] + p.split(marker,1)[1]
    return p

def assertions(result):
    return [(rel(f['name']), a) for f in result['testResults'] for a in f.get('assertionResults', [])]

def counts(result):
    return f"{result['numPassedTests']} passed / {result['numFailedTests']} failed / {result['numPendingTests']} skipped / {result['numTotalTests']} total"

def table(head, rows):
    def cell(x): return str(x).replace('|','/').replace('\n',' ')
    return '\n'.join(['| '+' | '.join(head)+' |','|'+'|'.join(['---']*len(head))+'|'] + ['| '+' | '.join(map(cell,r))+' |' for r in rows])

by_case = {}
for f,a in assertions(acceptance):
    for case in re.findall(r'TC-[A-Za-z]+-\d+',a['title']):
        by_case.setdefault(case,[]).append((f,a))

def case_status(case):
    tests = by_case.get(case,[])
    if not tests: return 'NOT RUN'
    if any(a['status']=='failed' for _,a in tests): return 'FAIL'
    return 'PASS' if all(a['status']=='passed' for _,a in tests) else 'PARTIAL'

# IDs are retained from the project's Test Plan; extra cases are explicitly additions.
# title / action / oracle / implementation evidence, not fictional historical results.
DATA = '''TC-Entry-01|VPS-F-001|Capture entry|Submit ANPR car, booked QR car and MANUAL bike entries at the fixture entry gate.|Successful session with session ID, slot, entry time and ticket; session gate and supplied plate match.|tests/api/entry.test.js
TC-Entry-02|VPS-F-002|Nearest slot and concurrency|Enter a car with nearer/farther matching slots; race requests for the single-slot facility.|Nearest eligible slot; exactly one successful allocation; no duplicated occupied slot.|tests/api/entry.test.js
TC-Entry-03|VPS-F-003|Facility full|Fill the small facility then submit another car entry.|409; Facility Full display; no extra session and no OPEN command.|tests/api/entry.test.js
TC-Entry-04|VPS-F-004|Entry ticket|Enter a registered vehicle and scan its returned ticket.|Scanned ticket resolves to the same session ID, entry time and slot number.|tests/api/entry.test.js
TC-Exit-01|VPS-F-010|Fee boundaries|Enter at 10:00 with rate 40/hour; advance clock for 30, 60, 61 and 165 minutes; request exit quote.|Amounts follow started-hour rounding: 40, 40, 80, 120; fee calculated server-side.|tests/api/exit.test.js
TC-Exit-02|VPS-F-011|Payment before exit|Attempt unpaid exit; create pending payment; confirm via signed webhook; retry exit.|402 while unpaid/pending; barrier stays closed; confirmed full payment permits exit.|tests/api/exit.test.js
TC-Exit-03|VPS-F-012|Release slot|Pay, exit and measure time to read slot availability.|Slot AVAILABLE within 2 seconds of confirmed exit. Backend slotRelease tests separately verify reuse.|tests/api/exit.test.js; backend/test/slotRelease.api.test.js
TC-Exit-04|VPS-F-013|Receipt|Complete paid exit; retrieve returned receipt and session as attendant.|Receipt entry/exit times match the session; duration matches exit; amount follows the 125-minute fee.|tests/api/exit.test.js
TC-Res-01|VPS-F-020|Reserve an available slot|Reserve 14:00-16:00 as Driver; search the same window afterwards.|Reservation ID, slot ID, status and hold expiry returned; booked slot absent from search results.|tests/api/reservation.test.js
TC-Res-02|VPS-F-021|Search and boundaries|Search 14:00-16:00; insert overlap 15:00-17:00; search again and at 17:00; try past/closed windows.|Only free matching slots, nearest first; back-to-back allowed; invalid windows 422.|tests/api/slots.test.js
TC-Res-03|VPS-F-022|Grace expiry|Book a slot; advance test clock past its configured arrival grace; read availability.|Hold expires and slot returns to availability; status EXPIRED.|tests/api/reservation.test.js
TC-Res-04|VPS-F-023|Capacity and opening rules|Book outside facility opening hours and contend for the last slot.|422 outside hours; capacity never oversold (409 when unavailable).|tests/api/reservation.test.js
TC-Pay-01|VPS-F-030|Online and gate payments|Create driver ONLINE booking payment and attendant AT_GATE session payment; submit signed confirmations.|Payment records retain gateway references; only confirmed payments settle the target.|tests/api/payment.test.js
TC-Pay-02|VPS-F-031|Cancellation refund|Pay for a booking; cancel before or within the configured cutoff.|Full refund before cutoff; no refund after cutoff; refund transaction is recorded.|tests/api/payment.test.js
TC-Pay-03|VPS-F-032|Transaction history|Create confirmed payment and cancellation refund; read admin transactions.|At least two transaction records; every record has numeric amount and string status, gateway reference and creation time.|tests/api/payment.test.js
TC-Admin-01|VPS-F-040|Configuration|Create a facility/zone/slots; deactivate nearest fixture slot; enter a vehicle.|Configuration accepted; inactive slot skipped and A-03 allocated.|tests/api/admin.test.js
TC-Admin-02|VPS-F-041|Rate change|Admin sets hourly rate 60; enter afterwards; advance two hours; quote exit.|120 due; backend tests also verify existing sessions retain entry-time rate.|tests/api/admin.test.js
TC-Admin-03|VPS-F-042|Staff and override|Create attendant; login; enter manually; POST exit-gate override OPEN with SCANNER_FAILURE; read audit log.|ATTENDANT role; OPEN delivered; audit matches nested user.id, gate, action and reason.|tests/api/admin.test.js
TC-Admin-04|VPS-F-043|Report exports|Enter/pay/exit after 90 minutes at 40/hour; request revenue and all three CSV report types.|Revenue total 80; each CSV returns 200, text/csv content type and more than one row. Backend report tests separately check detailed aggregates.|tests/api/admin.test.js; backend/test/reports.api.test.js
TC-Sec-01|VPS-NF-003|Sensitive-data review|Exercise login, entry and malformed payment; inspect database and captured backend log.|No test passwords, JWTs or card numbers in logs; no raw PAN in database. Compliance certification remains outside this check.|tests/security/security.test.js
TC-Sec-02|VPS-SR-001|TLS enforcement|Run backend TLS listener/config tests; separately scan a deployed HTTPS endpoint with testssl.sh and ZAP.|Local listener accepts TLS 1.2/1.3 and refuses older versions when certificate tests execute; deployment scans still required.|backend/test/tls.test.js
TC-Sec-03|VPS-SR-002|Password hashes|Register accounts sharing a test password; inspect MongoDB records.|Salted bcrypt/argon2 hashes, different salts; no plaintext password.|tests/security/security.test.js
TC-Sec-04|VPS-SR-003|Role boundaries|Run Driver/Attendant/Admin endpoint matrix; alter JWT role; attempt self-registration as admin.|Only allowed roles authorized; forged JWT refused; self-registration remains DRIVER.|tests/security/security.test.js
TC-Sec-05|VPS-SR-004|Card data|Submit a sandbox token with a deliberately supplied test card number; inspect all DB collections.|Raw card data rejected/not stored; only gateway references persist.|tests/security/security.test.js
TC-Sec-06|VPS-SR-005|Lockout and throttling|Fail login 5 times; inspect audit/notifications; test parallel guesses, repeated locks, IP throttling and admin unlock.|423 locked; failures/alerts recorded; repeat duration increases; 429 for IP throttle; authorized unlock works.|tests/security/security.test.js
TC-OPS-01|VPS-NF-004|Archival and retention|Run archive integration tests with aged synthetic audit/access records; retrieve, tamper and expire archives.|Archive/retrieval integrity and one-year retention floor enforced for synthetic timestamps; elapsed-year operation not measured.|backend/test/archive.api.test.js
TC-Perf-01|VPS-NF-001|Gate response budget|Run local benchmark with 20 lanes, 3 cycles, 1000 historical stays; review per-step p90 and failures.|Entry and exit p90 <=3000 ms under this local workload; deployed 100-user JMeter run still required.|backend/scripts/bench-gate.js
TC-Perf-02|VPS-NF-005|Tenfold scale|On staging run JMeter at baseline 100 then 1000 concurrent users on representative topology; compare latency/error/throughput.|No correctness loss at 10x load; document actual topology and agreed acceptable performance.|tests/performance/vps-load.jmx
TC-UAT-01|STP-5|Driver usability and accessibility|In supported browsers register/login, find parking, book/pay, view ticket and receipt; use keyboard/screen reader.|Tasks understandable and operable; labels/focus/contrast verified by real users; record observed results.|Manual - NOT RUN
TC-UAT-02|STP-5|Staff and admin UI|Use Gate/Monitor/Facilities/Security/Reports with staff roles; test denied pages and print ticket/receipt.|UI follows authorized workflows; errors clear; output readable; obtain user feedback.|Manual - NOT RUN
TC-INT-01|STP-6|External integrations|On staging exercise real payment sandbox, notification delivery, printer/scanner and controller or vendor simulator.|Signed payment confirmation, actual delivery/printing/scanning and safe gate behavior observed.|External environment - NOT RUN
TC-OPS-02|VPS-NF-002|Monthly availability|Collect a complete month of reservation/payment monitoring including downtime; calculate uptime/total scheduled time.|At least 99.5% monthly availability supported by monitoring records.|Monitoring - NOT RUN'''
CASES = [line.split('|') for line in DATA.splitlines()]

GAPS = [
 ('TC-Perf-02 / VPS-NF-005','NOT RUN','Deployed 100-to-1000-user JMeter experiment and representative horizontal topology unavailable.'),
 ('TC-Perf-01 / VPS-NF-001','FAIL (local sample)' if benchmark_budget_failed else 'PARTIAL','Local entry/exit p90 exceeded 3000 ms; deployed baseline still unverified.' if benchmark_budget_failed else 'Local gate benchmark only; no deployed baseline JMeter result.'),
 ('TC-Sec-02 / VPS-SR-001','PARTIAL','Local TLS/config suite only; external testssl.sh and OWASP ZAP scan not executed.'),
 ('TC-OPS-02 / VPS-NF-002','NOT RUN','A full month of uptime observations is not available.'),
 ('TC-UAT-01 and TC-UAT-02','NOT RUN','Real-user acceptance, browser workflows, screen-reader, contrast and print review require execution.'),
 ('TC-INT-01','NOT RUN','Hardware, external gateway sandbox and actual email/SMS delivery not verified; current hooks use simulators/outbox.'),
 ('TC-Sec-01 / compliance','PARTIAL','Automated no-secret/PAN checks are evidence, not a regulatory compliance assessment.'),
]

def status_for(case):
    if case == 'TC-OPS-01':
        tests=[a for f,a in assertions(backend) if f.endswith('/archive.api.test.js')]
        return 'PASS (synthetic integration)' if tests and all(a['status']=='passed' for a in tests) else 'NOT VERIFIED'
    if case == 'TC-Perf-01' and benchmark_budget_failed: return 'FAIL - local response-time sample'
    if case in ('TC-Sec-02','TC-Perf-01'): return 'PARTIAL - local evidence only'
    return case_status(case)

common = f"Evidence generated: {date}. Baseline commit: {manifest['baselineRevision']}. Tests include the supplied working-tree changes.\n\n"
common += 'This is an automated local verification record. It is not UAT sign-off or deployment certification. Simulated business dates in November are test inputs; execution dates are not backdated.\n\n'

unit_rows=[]
for f in unit['testResults']:
    aa=f.get('assertionResults',[])
    unit_rows.append((rel(f['name']),sum(a['status']=='passed' for a in aa),sum(a['status']=='failed' for a in aa),sum(a['status'] not in ['passed','failed'] for a in aa)))
unit_md = '# Unit Test Report\n\n'+common
unit_md += '## Scope and method\n\nIsolated Jest checks cover input normalization/validation, RBAC policy lookup, and pure fee boundaries. These three suites do not need MongoDB or an HTTP server. Database/API tests are separately reported as integration checks.\n\n'
unit_md += f"Result: **{counts(unit)}**.\n\n"+table(['Suite','Passed','Failed','Skipped'],unit_rows)
unit_md += '\n\n## Boundary evidence\n\nPricing covers 0, 1, 30, 60, 61, 120 and 165 minutes; the minimum charge is one started hour. Duration rounding is checked at the half-minute boundary and for a negative elapsed value. Registration tests include invalid fields, duplicate normalized plates, weak passwords and optional vehicles.\n\n'
unit_md += '## Execution details\n\nSee evidence/unit-results.json for individual assertions and evidence/unit.log for console output. Reproduce using the isolated command in README.md. The full backend run repeats these assertions; do not add unit and full-backend totals as independent tests.\n'

system_md = '# System Validation Report\n\n'+common
system_md += f"## Executed scope\n\nExternal HTTP API/security acceptance: **{counts(acceptance)}** across {acceptance['numTotalTestSuites']} suites. Backend unit/integration/TLS combined: **{counts(backend)}** across {backend['numTotalTestSuites']} suites. The frontend production build is a compilation check, not a browser test.\n\n"
system_md += 'MongoDB is a real temporary local database process. Gates, payment confirmations and notifications use project simulators, signed test webhooks and a notification outbox. Reset hooks are enabled only in test mode.\n\n'
system_md += '## Local performance observation\n\nThe supplementary benchmark used 20 concurrent gate lanes, three cycles per lane, 1000 historical stays and 600 slots. It is a short single-instance local run, not the deployed 100/1000-user JMeter experiment.\n\n'
system_md += table(['Step','Samples','p50 ms','p90 ms','p99 ms'],benchmark_rows) if benchmark_rows else 'NOT RUN: no parseable benchmark output.'
system_md += '\n\nObserved failed cycles: '+(benchmark_failures[-1] if benchmark_failures else 'unknown')+'. Raw evidence: evidence/gate-benchmark.log.\n\n'
if benchmark_budget_failed:
    system_md += '**The local response-time budget was missed.** Zero failed cycles does not mean the latency requirement passed. This short local measurement is sensitive to machine contention and does not establish deployed capacity, but it must be investigated rather than replaced with a better sample. The benchmark program reports measurements and returns success for execution; its process exit code is not a performance-budget assertion.\n\n'
system_md += '## Requirement traceability\n\n'+table(['Case','Requirement','Outcome'],[(c[0],c[1],status_for(c[0])) for c in CASES])
system_md += '\n\n## Remaining Test Plan activities\n\n'+table(['Activity','Status','Reason / scope'],GAPS)
system_md += '\n\n## Recorded metrics\n\n'+table(['Measure','Observed value'],[
 ('Acceptance assertion execution',f"{acceptance['numPassedTests']+acceptance['numFailedTests']} / {acceptance['numTotalTests']}"),
 ('Acceptance pass rate',f"{100*acceptance['numPassedTests']/acceptance['numTotalTests']:.1f}% of recorded assertions"),
 ('Backend assertion execution',f"{backend['numPassedTests']+backend['numFailedTests']} / {backend['numTotalTests']}"),
 ('Catalog case groups passing locally',f"{sum(status_for(c[0]).startswith('PASS') for c in CASES)} / {len(CASES)}; partial and not-run groups retained"),
 ('Defect density / aging','Not computed: no consistent historical defect population or lifecycle dates supplied'),
 ])
system_md += '\n\n## Exit decision\n\n**Not ready for unconditional Test Plan sign-off.** Passing automated functional checks does not satisfy the plan requirement that every test case pass. Complete the pending external, performance, accessibility, UAT and monitoring checks before an authorized reviewer signs. No approval or signature is fabricated.\n'

def coverage_md(branch=False):
    metric = 'branches' if branch else 'lines'
    title = 'Branch Coverage Report' if branch else 'Code Coverage Report'
    body = '# '+title+'\n\n'+common
    body += '## Measurement\n\nJest uses Istanbul instrumentation during the complete backend run. The denominator includes every backend/src/**/*.js source file, including models, route handlers and startup code. Frontend source is not included. Coverage measures execution, not correctness or requirement acceptance.\n\n'
    body += f"The source-file audit reconciles the coverage map against all {scope['sourceFiles']} backend JavaScript files. Any unloaded file missing from the original Jest map receives an Istanbul zero-hit map, never assumed coverage. See evidence/coverage-scope.json for the original totals, added files and corrected totals. The Jest discovery roots were corrected after execution; a discovery-only check confirmed the identical recorded suite set for future runs.\n\n"
    body += table(['Metric','Covered','Total','Percent'],[(k,v['covered'],v['total'],str(v['pct'])+'%') for k,v in coverage['total'].items() if k in ['statements','branches','functions','lines']])
    body += '\n\n## Per-file '+('branch' if branch else 'code')+' coverage\n\n'
    if branch:
        body += table(['Source','Covered / total branches','Percent'],[(rel(k),f"{v['branches']['covered']} / {v['branches']['total']}",str(v['branches']['pct'])+'%') for k,v in sorted(coverage.items()) if k!='total'])
    else:
        body += table(['Source','Lines','Statements','Functions'],[(rel(k),str(v['lines']['pct'])+'%',str(v['statements']['pct'])+'%',str(v['functions']['pct'])+'%') for k,v in sorted(coverage.items()) if k!='total'])
    body += '\n\n## Interpretation and evidence\n\nNo numeric coverage target is specified in the Part-3 assignment; none is invented here. Startup code is included even though the instrumented Jest run does not launch server.js as the production entry point. The acceptance server is a separate, uninstrumented process; its executions are not silently added to this denominator.\n\nOpen coverage/index.html for navigable source detail. coverage/coverage-final.json stores per-location execution counts; coverage/coverage-summary.json stores these aggregates.\n'
    if branch:
        uncovered=[]
        for filename,d in sorted(detail.items()):
            for key, hits in d.get('b',{}).items():
                if any(n==0 for n in hits):
                    bm=d['branchMap'][key]
                    uncovered.append((rel(filename),bm.get('line',bm['loc']['start']['line']),bm['type'],','.join(str(i) for i,n in enumerate(hits) if n==0)))
        body+='\n## Uncovered branch locations\n\nBranch alternatives use zero-based Istanbul indexes. This is an improvement backlog, not a claim that an unexecuted alternative is defective.\n\n'+table(['Source','Line','Kind','Uncovered alternatives'],uncovered)
    return body

cases_md = '# Updated Test Case Document\n\n'+common
cases_md += '## Baseline and changes\n\nThe baseline is the linked Vehicle Parking System Test Plan v1.0 and existing automated scripts at the recorded source commit. The three attached TEST CASE PDFs are lecture references, not a prior project case document. Existing case IDs are preserved. Cases below describe the current sprint implementation; added manual cases are clearly identified.\n\n'
cases_md += 'Updates include explicit barrier override and audit assertions (TC-Admin-03), a corrected one-hour minimum in the fee test helper, current configuration/reporting/archival coverage, separate pure unit tests, lifecycle-safe test servers, and honest statuses for external checks. No undocumented sprint history is invented.\n\n'
cases_md += '## Shared setup and test data\n\nFor automated API cases, seed tests/helpers/fixture.js into the disposable instance and set the business clock to 2026-11-02 10:00 Asia/Kolkata. Use seeded Driver, second Driver, Attendant and Admin tokens. Main Facility opens 06:00-23:00 and has occupied A-01, free car slots A-02/A-03, and bike slot A-B1. Small Facility has one car slot. Car rate is 40/hour, bike rate 20/hour; arrival grace is 15 minutes and refund cutoff 60 minutes. Each case resets its data. Passwords and gateway tokens are dummy test inputs.\n\n'
cases_md += 'Preconditions: installed Node dependencies, isolated MongoDB, a test-mode API, synthetic identities, and the named role for each operation. Manual/external cases require staging, devices and/or actual reviewers. Positive, negative, equivalence-class, boundary and concurrency techniques follow the teaching references.\n\n'
for case,req,title,steps,expected,source in CASES:
    relevant=by_case.get(case,[])
    outcome=status_for(case)
    cases_md+=f'## {case} - {title}\n\nRequirement: {req}. Type: '+('Manual / external' if not relevant and case not in ['TC-OPS-01','TC-Sec-02','TC-Perf-01'] else 'Automated / supporting local check')+'.\n\n'
    cases_md+=f'Description and steps: {steps}\n\nExpected result: {expected}\n\nActual result: {outcome}.'
    if relevant: cases_md+=f' {len(relevant)} recorded assertion(s); see evidence/acceptance-results.json and the assertion register.'
    elif case=='TC-OPS-01': cases_md+=' See archive.api.test.js assertions in evidence/backend-results.json.'
    else: cases_md+=' See the System Validation Report for the unexecuted or partial scope.'
    cases_md+=f'\n\nScript / procedure: {source}. Comments: shared setup applies unless this procedure specifies staging or a manual reviewer.\n\n'
cases_md += '## Assertion register\n\nEvery executed acceptance assertion, including tests without a case ID, is listed with its observed status. This register preserves parameterized test names.\n\n'
cases_md += table(['Script','Assertion','Actual'],[(f,a['fullName'],a['status'].upper()) for f,a in assertions(acceptance)])

summary = '# Test Summary and Part-3 Checklist\n\n'+common
summary += table(['Deliverable','Result','Location'],[
 ('Updated test cases','Prepared with requirement IDs, steps, expected and actual results','Test_Cases_Updated.md'),
 ('Unit Test Report',counts(unit),'Unit_Test_Report.md'),
 ('System Validation Report',counts(acceptance)+'; outstanding checks explicit','System_Validation_Report.md'),
 ('Code Coverage Report',str(coverage['total']['lines']['pct'])+'% lines','Code_Coverage_Report.md'),
 ('Branch Coverage Report',str(coverage['total']['branches']['pct'])+'% branches','Branch_Coverage_Report.md'),
 ('Reports in repository docs/','Prepared locally; remote upload not performed','This folder'),
 ('All Test Plan testing','PARTIAL - external/manual checks remain','System_Validation_Report.md'),
 ('Optional Sprint 3','Conditional backlog recorded; no completion/sign-off claimed','Sprint_3_Backlog.md')])
summary += '\n\n## Validation limits\n\n'+table(['Activity','Status','Reason'],GAPS)
summary += '\n\n## Authenticity\n\nActual local evidence is dated '+date+'. The assignment asks for testing on November 2-6; these are early execution results and should be rerun in that window. The Test Plan dates UAT November 2-6. No report claims those future activities happened. Source provenance and file hashes are in evidence/provenance.json. GitHub connection reported pull=true and push=false during preparation, so the package is ready for upload but not uploaded.\n'
summary += '\n\n## Recorded command outcomes\n\n'+table(['Command group','Exit code'],[(c.get('label','setup error'),c.get('exitCode',c.get('error','unknown'))) for c in manifest['commands']])+'\n'

docs = {'Test_Cases_Updated':cases_md,'Unit_Test_Report':unit_md,'System_Validation_Report':system_md,
        'Code_Coverage_Report':coverage_md(),'Branch_Coverage_Report':coverage_md(True),'Test_Summary':summary}
docs['Sprint_3_Backlog'] = '# Conditional Sprint-3 Backlog\n\n'+common+'''## Purpose and schedule

The assignment allows November 2-6 for spillover development alongside testing. This is a conditional backlog, not evidence of completed sprint work. No new product features are inferred from the teaching slides.

'''+table(['Item','Work / completion evidence','Status'],[
 ('S3-01','Run supported-browser Driver, Attendant and Admin workflows; collect keyboard/screen-reader, contrast and print observations. Fix confirmed defects and rerun affected cases.','Pending real execution'),
 ('S3-02','Run deployed JMeter baseline/10x and testssl.sh/ZAP; triage findings rather than assume success.','Needs staging'),
 ('S3-03','Connect actual gateway sandbox, notification channel and devices where required; record observed outcomes.','Needs integrations'),
 ('S3-04','Collect monthly reservation/payment availability evidence; obtain responsible reviewer sign-off.','Needs observation and reviewer'),
 ('S3-05','Review uncovered branch locations; prioritize risk-based error and race paths. No arbitrary target is imposed.','Optional follow-up'),
 ('S3-06','Upload docs/ and source/test updates using an account with write access; rerun during November 2-6.','Remote upload pending')])+'\n\n## Completed preparation\n\nUpdated case descriptions and strengthened override checks; split isolated pricing tests; moved database test servers into setup hooks so skipped suites do not open listeners. These preparation changes are not backdated into Sprint 3.\n'

for name,text in docs.items():
    (DOCS/(name+'.md')).write_text(text+'\n',encoding='utf-8')

# Standalone readable HTML, generated using a deliberately small Markdown subset.
def inline(text):
    text=html.escape(text)
    text=re.sub(r'\*\*(.+?)\*\*',r'<strong>\1</strong>',text)
    return text

def blocks(text):
    lines=text.splitlines(); i=0
    while i<len(lines):
        line=lines[i].strip()
        if not line: i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                cells=[c.strip() for c in lines[i].strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?',c) for c in cells):rows.append(cells)
                i+=1
            yield 'table',rows;continue
        m=re.match(r'^(#{1,3}) (.*)',line)
        if m:yield 'h'+str(len(m[1])),m[2]
        else:yield 'p',line
        i+=1

CSS='body{font:16px/1.6 system-ui,sans-serif;color:#192b43;max-width:1150px;margin:40px auto;padding:0 30px}h1{color:#15354c;border-bottom:4px solid #168a8a;padding-bottom:18px}h2{margin-top:34px}table{border-collapse:collapse;width:100%;font-size:13px;margin:20px 0;table-layout:fixed;overflow-wrap:anywhere}td,th{border:1px solid #ccd7df;padding:9px;text-align:left;vertical-align:top}th{background:#15354c;color:white}tr:nth-child(even){background:#f1f6f8}a{color:#117777}nav a{display:block;padding:6px}'
for name,text in docs.items():
    body=[]
    for kind,value in blocks(text):
        if kind=='table':
            body.append('<table>'+''.join('<tr>'+''.join(f'<{"th" if j==0 else "td"}>{inline(c)}</{"th" if j==0 else "td"}>' for c in row)+'</tr>' for j,row in enumerate(value))+'</table>')
        else:body.append(f'<{kind}>{inline(value)}</{kind}>')
    (DOCS/(name+'.html')).write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+name.replace('_',' ')+'</title><style>'+CSS+'</style><body><a href="index.html">Deliverables index</a>'+''.join(body)+'</body></html>',encoding='utf-8')
(DOCS/'index.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>VPS Part-3</title><style>'+CSS+'</style><body><h1>Vehicle Parking System</h1><p>Part-3 testing deliverables</p><p>'+html.escape(date)+'</p><nav>'+''.join(f'<a href="{name}.html">{name.replace("_"," ")}</a>' for name in docs)+'<a href="coverage/index.html">Interactive backend coverage</a></nav><p>Local verification complete; manual and external checks remain. See System Validation Report.</p></body></html>',encoding='utf-8')

# Keep the familiar RTM up to date, with full-plan limitations retained.
rtm='# Requirements Traceability Matrix\n\n'+common+table(['Requirement','Test case','Actual status'],[(c[1],c[0],status_for(c[0])) for c in CASES])+'\n'
(DOCS/'Requirements_Traceability_Matrix.md').write_text(rtm,encoding='utf-8')
(ROOT/'tests/RTM.md').write_text(rtm,encoding='utf-8')

# Neatly wrapped, selectable-text PDFs, with repeated table headers and footers.
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyVPS',fontName='Helvetica',fontSize=9,leading=13,spaceAfter=9,textColor=colors.HexColor('#24364a'),splitLongWords=True))
styles.add(ParagraphStyle(name='CellVPS',parent=styles['BodyVPS'],fontSize=7.5,leading=10.2,spaceAfter=0))
styles['Heading1'].fontName='Helvetica-Bold';styles['Heading1'].fontSize=24;styles['Heading1'].leading=29;styles['Heading1'].textColor=colors.HexColor('#15354c');styles['Heading1'].spaceAfter=22
styles['Heading2'].fontSize=13;styles['Heading2'].leading=17;styles['Heading2'].spaceBefore=15;styles['Heading2'].spaceAfter=9;styles['Heading2'].textColor=colors.HexColor('#117b7b')
styles['Heading1'].keepWithNext=True
styles['Heading2'].keepWithNext=True
def pdf_inline(text):
    # ReportLab's base fonts support these symbols poorly; preserve readable ASCII.
    text=text.replace('\u2013','-').replace('\u2014','-').replace('\u2264','<=').replace('\u2192','->')
    return re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',html.escape(text))

pdf_dir=DOCS/'pdf';pdf_dir.mkdir(exist_ok=True)
def page_decor(canvas,doc):
    canvas.saveState();w,h=A4
    canvas.setStrokeColor(colors.HexColor('#168a8a'));canvas.setLineWidth(2);canvas.line(40,h-31,w-40,h-31)
    canvas.setFont('Helvetica',7);canvas.setFillColor(colors.HexColor('#536879'))
    canvas.drawString(40,h-23,'VEHICLE PARKING SYSTEM  /  PART-3 TESTING')
    canvas.drawString(40,23,'Local evidence | '+date)
    canvas.drawRightString(w-40,23,str(doc.page));canvas.restoreState()
for name,text in docs.items():
    flow=[]
    for kind,value in blocks(text):
        if kind=='table':
            n=len(value[0]); width=A4[0]-80
            if n==3: ratios=[0.32,0.33,0.35]
            elif n==4: ratios=[0.46,0.18,0.18,0.18]
            else: ratios=[1/n]*n
            if name=='Test_Cases_Updated' and n==3:ratios=[.22,.65,.13]
            if name=='Sprint_3_Backlog' and n==3:ratios=[.10,.70,.20]
            if name=='Branch_Coverage_Report' and n==4:ratios=[.48,.10,.20,.22]
            data=[[Paragraph(pdf_inline(c),styles['CellVPS']) for c in row] for row in value]
            t=Table(data,colWidths=[width*r for r in ratios],repeatRows=1,hAlign='LEFT')
            t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dcecef')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#f3f6f8')]),('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),.3,colors.HexColor('#cad6dd')),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
            flow.extend([t,Spacer(1,10)])
        else:
            flow.append(Paragraph(pdf_inline(value),styles['Heading1' if kind=='h1' else 'Heading2' if kind.startswith('h') else 'BodyVPS']))
    if name == 'Test_Cases_Updated':
        grouped=[]; current=None
        for item in flow:
            if isinstance(item,Paragraph) and item.style.name=='Heading2':
                if current is not None: grouped.append(KeepTogether(current));current=None
                if item.getPlainText().startswith('TC-'): current=[item]
                else: grouped.append(item)
            elif current is not None: current.append(item)
            else: grouped.append(item)
        if current is not None: grouped.append(KeepTogether(current))
        flow=grouped
    SimpleDocTemplate(str(pdf_dir/(name+'.pdf')),pagesize=A4,rightMargin=40,leftMargin=40,topMargin=48,bottomMargin=40,title=name.replace('_',' '),author='Vehicle Parking System - automated evidence').build(flow,onFirstPage=page_decor,onLaterPages=page_decor)

provenance={ 'generatedAt':manifest['generatedAt'],'executionTimezone':'Asia/Kolkata',
 'sourceRepository':'https://github.com/vehicle-parking-system/SE_mini_project', 'sourceRevision':manifest['baselineRevision'],
 'documentsRepository':'https://github.com/vehicle-parking-system/Docs','documentsRevision':'108de31a0c5cd39c9124d8cf69536c05a8eb2d28',
 'attachment':'D:/5th-sem/SE/attachments.zip','note':'Original references are read-only inputs; this package contains new reports, not copies of lecture slides.',
 'evidenceHashes':{p.relative_to(DOCS).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(EV.glob('*')) if p.is_file() and p.name!='provenance.json'},
 'workingSourceHashes':{p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for folder in ['backend/src','backend/test','tests/api','tests/security','tests/helpers','scripts'] for p in sorted((ROOT/folder).rglob('*')) if p.is_file() and '__pycache__' not in p.parts}}
for relative in ['backend/package.json','backend/package-lock.json','frontend/package.json','frontend/package-lock.json','tests/package.json','tests/package-lock.json','.github/workflows/ci.yml']:
    provenance['workingSourceHashes'][relative]=hashlib.sha256((ROOT/relative).read_bytes()).hexdigest()
(EV/'provenance.json').write_text(json.dumps(provenance,indent=2),encoding='utf-8')
print(f'Generated {len(docs)} Markdown/HTML/PDF reports, RTM and provenance.')
