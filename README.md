# makefun-csv-reader-speed

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/cemplon11/makefun-csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/cemplon11/makefun-csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A fast, dependency-free drop-in for csv-reader 1.0.0: `run(input)` returns,
for `{text, header}`, exactly the `{columns, rows, errors}` csv-reader
returns — including its broken-row policy (BOM drop, LF/CRLF record ends,
stray CRs, quoted fields with `""` escapes, CRLF/lone CR inside quotes read
as LF, quote junk, unterminated quotes re-read as unquoted, short/long row
padding and cutting with errors in order met).

How it is fast: a record holding no quote and no stray CR is taken whole
with one slice + `split(',')`; other records are read field by field,
jumping between delimiters with one regex scan per field instead of walking
character by character. On the practice set it parses in ~0.16 s where
csv-reader 1.0.0 takes ~0.46 s on the same machine.

## Layout

- `solve.js` — the parser: `export function run(input)`.
- `main.ts` — the driver the harness runs: reads every case from
  `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.

## License

MIT — see [LICENSE](LICENSE).
