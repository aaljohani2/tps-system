# Contribution guide

1. Open an issue describing a planning rule, its administrative source and whether it is **hard / soft / configurable**.
2. Add at least one acceptance test for any changed capacity, instructor load, pairing or timetable rule.
3. Keep `contactHours` and `creditedLoad` distinct. Never force full coverage by over-assigning a trainer or placing an unsuitable room.
4. Keep Arabic UI RTL. Use English identifiers for stable API enums; add Arabic labels at the presentation layer.
5. Do not commit real trainee records or production keys. Never publish Rayat schedules from this prototype.
6. Open a Pull Request; CI and review required prior to merge.

Local check: `npm install && npm test && npm run demo`.

## v0.2 integration verification

- Node 22: `npm test`
- Python 3.12 + openpyxl: `PYTHONPATH=scripts python -m unittest discover -s scripts -p 'test_*.py' -v`
- Java 21 + Maven 3.9.11+: `mvn -B -ntp -f solver/pom.xml clean verify package`
- Do not claim Timefold runtime passes until Java CI is green, and do not merge on red/unknown CI.
- No real student identifiers or confidential college exports in commits or screenshots.
