# Contribution guide

1. Open an issue describing a planning rule, its administrative source and whether it is **hard / soft / configurable**.
2. Add at least one acceptance test for any changed capacity, instructor load, pairing or timetable rule.
3. Keep `contactHours` and `creditedLoad` distinct. Never force full coverage by over-assigning a trainer or placing an unsuitable room.
4. Keep Arabic UI RTL. Use English identifiers for stable API enums; add Arabic labels at the presentation layer.
5. Do not commit real trainee records or production keys. Never publish Rayat schedules from this prototype.
6. Open a Pull Request; CI and review required prior to merge.

Local check: `npm install && npm test && npm run demo`.
