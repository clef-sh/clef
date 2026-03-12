# Contributing to Clef

## Getting Started

```bash
git clone https://github.com/clef-sh/clef.git
cd clef
npm install
```

## Before Opening a PR

- [ ] Tests written for all new behaviour
- [ ] All tests pass (`npm test`)
- [ ] Code formatted (`npm run format`)
- [ ] Lint passes (`npm run lint`)
- [ ] Commit messages follow Conventional Commits
- [ ] PR description explains what and why
- [ ] New public API or CLI behaviour is documented

### Test coverage

Clef uses a tiered coverage model — security-critical
modules carry a higher bar than the rest of the codebase.
Before opening a PR, run `npm run test:coverage` and
check that thresholds pass. See the
[testing guide](docs/contributing/testing.md#test-coverage-philosophy)
for the full rationale and per-tier expectations.

## Pull Request Guidelines

Keep PRs small and focused. Link every PR to an open issue. Write a useful description explaining
the approach. Respond to review comments promptly — PRs stale for two weeks without activity
may be closed.

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short description

Optional body explaining why, not what.

Closes #123
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`.

## Reporting Issues

**Bug reports** require: Clef version, OS, SOPS backend, triggering command, full error output,
expected vs actual behaviour.

**Feature requests** should describe the use case, not the implementation.

## Security Vulnerabilities

Do not open a public GitHub issue. Email `security@clef.sh`. We acknowledge within 48 hours and
resolve critical issues within 14 days.

## Intentionally unsupported features

Before opening a feature request, check
[Architecture & Design Decisions](./docs/contributing/architecture.md#design-decisions)
— some features are intentionally not supported and
the rationale is documented there.

Some features have been deliberately excluded. Please do not open issues or PRs for these:

- **Unencrypted namespaces.** Clef requires every namespace to be encrypted. There is no `encrypted: false` option. Non-sensitive configuration should live outside the Clef matrix. See [Core Concepts](/guide/concepts#design-decision-all-namespaces-are-encrypted) for the rationale.

If you believe one of these decisions should be reconsidered, open a discussion (not an issue) explaining the use case.

## Code of Conduct

[Contributor Covenant](https://www.contributor-covenant.org/). Reports to `conduct@clef.sh`.
