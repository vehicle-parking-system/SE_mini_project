# Conditional Sprint-3 Backlog

Evidence generated: 30 October 2026, 23:31 IST. Baseline commit: 9ea6b597a8d51b4070b80182b056575b8c183aeb. Tests include the supplied working-tree changes.

This is an automated local verification record. It is not UAT sign-off or deployment certification. Simulated business dates in November are test inputs; execution dates are not backdated.

## Purpose and schedule

The assignment allows November 2-6 for spillover development alongside testing. This is a conditional backlog, not evidence of completed sprint work. No new product features are inferred from the teaching slides.

| Item | Work / completion evidence | Status |
|---|---|---|
| S3-01 | Run supported-browser Driver, Attendant and Admin workflows; collect keyboard/screen-reader, contrast and print observations. Fix confirmed defects and rerun affected cases. | Pending real execution |
| S3-02 | Run deployed JMeter baseline/10x and testssl.sh/ZAP; triage findings rather than assume success. | Needs staging |
| S3-03 | Connect actual gateway sandbox, notification channel and devices where required; record observed outcomes. | Needs integrations |
| S3-04 | Collect monthly reservation/payment availability evidence; obtain responsible reviewer sign-off. | Needs observation and reviewer |
| S3-05 | Review uncovered branch locations; prioritize risk-based error and race paths. No arbitrary target is imposed. | Optional follow-up |
| S3-06 | Upload docs/ and source/test updates using an account with write access; rerun during November 2-6. | Remote upload pending |

## Completed preparation

Updated case descriptions and strengthened override checks; split isolated pricing tests; moved database test servers into setup hooks so skipped suites do not open listeners. These preparation changes are not backdated into Sprint 3.

