# @clef-sh/sops-win32-x64

Bundled [sops](https://github.com/getsops/sops) binary for **Windows x64**.

This package is an implementation detail of [Clef](https://github.com/clef-sh/clef) — a
git-native secrets management tool built on Mozilla SOPS. You should not need to install it
directly.

## How it works

`@clef-sh/cli` declares this package as an `optionalDependency`. When you run `npm install` on
a Windows x64 machine, npm automatically installs this package and Clef resolves the bundled
binary at runtime — no separate sops installation required.

> **Note:** Clef on Windows is supported only via WSL (Windows Subsystem for Linux). Native
> Windows has a known limitation where Node.js cannot reliably forward Unix signals to child
> processes, which affects `clef exec`. Use the `linux-x64` or `linux-arm64` package inside WSL.

**Resolution order** used by Clef:

1. `CLEF_SOPS_PATH` environment variable — explicit override
2. This bundled package (if installed)
3. `sops` on system `PATH` — fallback

Run `clef doctor` to confirm which source is active.

## Versioning

This package is versioned by the **sops version** it contains, not the Clef version. A package
version of `3.9.4` means it bundles sops `v3.9.4`. Platform packages are published independently
of `@clef-sh/core` and `@clef-sh/cli`.

## License

The sops binary is © Mozilla and contributors, distributed under the
[Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/) (see `LICENSE.sops`).
The packaging code in this repository is MIT licensed.

## Parent project

- Repository: https://github.com/clef-sh/clef
- Documentation: https://clef.sh
- CLI package: [@clef-sh/cli](https://www.npmjs.com/package/@clef-sh/cli)
