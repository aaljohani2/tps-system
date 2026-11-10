# TPS — Public implementation status

This document is a public engineering overview, not a copy of internal operational logs. Device-specific acceptance evidence, institutional datasets, staff assignments, student counts, scenario identifiers, screenshots and backups are **not** maintained here.

## Implemented development components
- Authentication, role-based access control, audit records and approval boundaries
- Course, room, instructor and cohort data models
- CSV/XLSX import preview and validation
- Draft timetable scenarios with explicit uncovered demand
- Java Timefold integration, report/export pipelines and regression tests
- Optional local-only operational profile and encrypted database backup tooling

## Review boundaries
A successful source build or automated test is not a certification of production security, approval to process institutional personal data, or authorization to connect to an official student platform.

Detailed acceptance results must be retained in a private, access-controlled location and reviewed independently of the public repository. Changes to timetable policy, training modes, staff entitlements or operational databases require separately recorded local approval.

## Publication checklist
Before publishing future changes:
1. Use synthetic institutions, staff, cohorts and room identifiers in examples and tests.
2. Exclude operational spreadsheets, private email addresses, machine paths, real schedules and internal approval notes.
3. Check staged files, commits, PR descriptions, logs and downloadable CI artifacts for sensitive content.
4. Use privacy-preserving Git author email settings.
5. Do not treat deletion from the current tree as deletion from Git history.
