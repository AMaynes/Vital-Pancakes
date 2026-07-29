# File Converter Source

This directory contains a modified browser build of
[p2r3/convert](https://github.com/p2r3/convert) at commit
`2fc71437b83defdd693cb86a54d953314b91dd43`, distributed under GPL-2.0.

The complete upstream source is available at:

`https://github.com/p2r3/convert/tree/2fc71437b83defdd693cb86a54d953314b91dd43`

The modified source files used for this build are included in `source/`.
Changes add the byte-for-byte round-trip control, exact byte comparison, result
reporting, timing guidance, and local integration styling.

The production build uses Vite with `--base=./`. Large engine URLs in generated
JavaScript are rewritten from `/convert/` or local emitted binaries to
`https://p2r3.github.io/convert/`, preserving upstream lazy loading without
duplicating approximately 250 MB of WebAssembly assets in Vital Pancakes.
