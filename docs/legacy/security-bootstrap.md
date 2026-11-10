# Security and data governance — bootstrap

## Current risk boundary
- This version has **no account system or access controls**. `server.ts` binds to `127.0.0.1` by default. **Do not expose the API to LAN, internet, reverse proxy or cloud service.**
- Only synthetic examples should be committed. Never commit identifiable trainees' names, national IDs, grades, passwords, institutional tokens or real attendance schedules.
- `.gitignore` excludes spreadsheet/PDF/CSV and `private-data/` by default, so raw schedule exports are less likely to be committed accidentally. This is not a substitute for secret scanning.
- CSV/XLSX ingestion is not present. Future imports must validate schemas, protect against Excel formula injection on export, scan for private fields, and set file-size limits.
- Avoid automatic publication to Rayat or any external system. Approved scenarios must be separately authorized and auditable.

## Release gate before deployment
1. Authentication (organizational SSO if available), organization/dept-scoped RBAC and audit trails.
2. Persistent database with migrations, backups, tenancy isolation and retention policy.
3. CSRF/host checks, strict input schemas, rate limiting, TLS, CSP, security headers and signed tokens/secrets management.
4. Dependency lock file and reproducible CI; audit and software bill of materials.
5. Automated abuse tests, load tests, accessibility/RTL tests and security review.
6. Confidential data approval and official external integration agreement.
7. Distinct preview → review → approve → publish workflow with human signoff.
