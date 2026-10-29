## Requirements Traceability Matrix

Automated tests: **44 passed, 0 failed, 6 not run**

| Requirement | Description | Test case | Tests | Status |
|---|---|---|---:|---|
| VPS-F-001 | Capture vehicle entry | TC-Entry-01 | 1 | PASS |
| VPS-F-002 | Auto slot allocation | TC-Entry-02 | 2 | PASS |
| VPS-F-003 | Facility Full rejection | TC-Entry-03 | 1 | PASS |
| VPS-F-004 | Entry ticket | TC-Entry-04 | 1 | PASS |
| VPS-F-010 | Fee calculation | TC-Exit-01 | 4 | PASS |
| VPS-F-011 | Verify payment before exit | TC-Exit-02 | 1 | PASS |
| VPS-F-012 | Slot release on exit | TC-Exit-03 | 1 | PASS |
| VPS-F-013 | Receipt generation | TC-Exit-04 | 1 | PASS |
| VPS-F-020 | Online slot reservation | TC-Res-01 | 1 | PASS |
| VPS-F-021 | Slot search | TC-Res-02 | 2 | PASS |
| VPS-F-022 | Grace-period hold | TC-Res-03 | 1 | PASS |
| VPS-F-023 | Capacity / operating-hours rules | TC-Res-04 | 1 | PASS |
| VPS-F-030 | Online and at-gate payment | TC-Pay-01 | 2 | PASS |
| VPS-F-031 | Refunds | TC-Pay-02 | 1 | PASS |
| VPS-F-032 | Transaction logging | TC-Pay-03 | 1 | PASS |
| VPS-F-040 | Lot / zone / slot configuration | TC-Admin-01 | 1 | PARTIAL / NOT RUN |
| VPS-F-041 | Pricing rules | TC-Admin-02 | 1 | PARTIAL / NOT RUN |
| VPS-F-042 | Attendant accounts and manual override | TC-Admin-03 | 1 | PARTIAL / NOT RUN |
| VPS-F-043 | Reports | TC-Admin-04 | 1 | PARTIAL / NOT RUN |
| VPS-NF-001 | Response time <= 3 s (p90) | TC-Perf-01 | 0 | Nightly (JMeter) |
| VPS-NF-002 | 99.5% availability | Ops uptime reports | 0 | Manual |
| VPS-NF-003 | Data protection | TC-Sec-01 | 2 | PARTIAL / NOT RUN |
| VPS-NF-004 | Log retention >= 1 year | TC-OPS-01 | 0 | Manual |
| VPS-NF-005 | 10x scalability | TC-Perf-02 | 0 | Nightly (JMeter) |
| VPS-SR-001 | TLS 1.2+ | TC-Sec-02 | 0 | Nightly (testssl.sh) |
| VPS-SR-002 | Password hashing | TC-Sec-03 | 1 | PASS |
| VPS-SR-003 | RBAC | TC-Sec-04 | 4 | PASS |
| VPS-SR-004 | Tokenized card data | TC-Sec-05 | 1 | PASS |
| VPS-SR-005 | Account lockout | TC-Sec-06 | 6 | PASS |
