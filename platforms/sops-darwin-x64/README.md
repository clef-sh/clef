# @clef-sh/sops-darwin-x64

Bundled [sops](https://github.com/getsops/sops) binary for **macOS x64 (Intel)**.

This package is an implementation detail of [Clef](https://github.com/clef-sh/clef) — a
git-native secrets management tool built on SOPS, a CNCF Sandbox project. You should not need
to install it directly.

## How it works

`@clef-sh/cli` declares this package as an `optionalDependency`. When you run `npm install` on
a macOS Intel machine, npm automatically installs this package and Clef resolves the bundled
binary at runtime — no separate sops installation required.

**Resolution order** used by Clef:

1. `CLEF_SOPS_PATH` environment variable — explicit override
2. This bundled package (if installed)
3. `sops` on system `PATH` — fallback

Run `clef doctor` to confirm which source is active.

## Versioning

This package is versioned by the **sops version** it contains, not the Clef version. A package
version of `3.12.2` means it bundles sops `v3.12.2`. Platform packages are published independently
of `@clef-sh/core` and `@clef-sh/cli`.

## License

The sops binary is copyright © its authors and is distributed under the
[Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/). The full license text
ships as `LICENSE.sops` inside the published npm package — both the binary and the license
are fetched from the upstream [SOPS](https://github.com/getsops/sops) release at publish time
and are not stored in the source repository. SOPS is a CNCF Sandbox project hosted at
`getsops/sops`. The packaging code in this repository is MIT licensed.

## Parent project

- Repository: https://github.com/clef-sh/clef
- Documentation: https://clef.sh
- CLI package: [@clef-sh/cli](https://www.npmjs.com/package/@clef-sh/cli)
