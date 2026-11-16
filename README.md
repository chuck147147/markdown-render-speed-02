# markdown-render-speed-02

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/chuck147147/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/chuck147147/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free Markdown-to-HTML parser in a single `parse.js`, written from scratch. Its `parse(markdown)` returns byte-identical output to marked 18.1.3 with default options (GFM on) — 720/720 on the practice set (CommonMark 0.31.2 + GFM 0.29 spec examples and 40 generated README documents) — while rendering roughly 40% faster than marked itself in local benchmarks.

## Run it

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

`main.ts` reads `cases.json` (an array of `{id, markdown}`) from `MAKEFUN_INPUT_DIR` (default `/input`), renders each case with `parse()` from `parse.js`, and writes the HTML strings, in order, to `html.json` in `MAKEFUN_OUTPUT_DIR` (default `/output`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=6qzky65m&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
