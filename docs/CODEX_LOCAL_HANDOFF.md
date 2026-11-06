# Codex — strictly bounded final handoff

You are Codex on the user's Windows computer. **Your only tasks are to install and test TPS System locally.** All development should already have been committed remotely by the primary engineering session.

## Hard limits

- Do not write to or modify GitHub remotely, commit, push, create branches or pull requests.
- Do not deploy on any server, cloud, shared network or internet-facing port.
- Do not change the source code or dependencies to make tests pass without explicit additional user instruction.
- Do not reset/clean the working tree, delete existing files or Docker volumes, or overwrite `.env`.
- Do not send user or trainee data to tests. Use synthetic datasets.
- Keep `Timefold Solver` as the only optimization engine; do not silently replace it with greedy.

## Actions on `H:\\tps_system`

1. Inspect current Git branch, uncommitted changes and `git status` before any remote fetch or checkout. If conflicts might overwrite changes, stop and report rather than destroying them.
2. Confirm Node 22+, npm, Java 21, Maven, Python/openpyxl, Docker Desktop and free loopback ports. Check Docker volume/data state without deleting anything.
3. If the development branch is already checked out and safe, install project dependencies and compile frontend/backend/Java.
4. With user's own secret `.env`, run local PostgreSQL migrations safely and `db:check`. Never display database passwords.
5. Run TypeScript and existing Node tests, Python importer/exporter tests, Maven JUnit, API integration against a separate synthetic database, Playwright browser tests, and basic endpoint checks.
6. Validate the full workflow: login → institution/college/department/term → import courses → instructors and rooms → demand/blocks → sections → Timefold → timetable/gaps → comparison → review/approve → CSV/XLSX.
7. Verify that a PostgreSQL container restart does not lose the synthetic scenario and repeat migrations idempotently.
8. Produce a written report with command, environment/version, test count, pass/fail/skip, errors and exact fixes **recommended but not performed**. Mark unsupported workflow steps as incomplete.

Only local installation and testing are authorized. A passing test in GitHub Actions does **not** replace Windows-specific verification.
