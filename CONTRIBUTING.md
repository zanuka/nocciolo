# Contributing to Nocciolo

Thanks for your interest in contributing. Nocciolo is being developed in public and we welcome thoughtful collaboration.

## Getting Started

1. Read the [README](./README.md) and [ROADMAP](./ROADMAP.md) to understand the current focus.
2. Read [docs/cli-architecture.md](./docs/cli-architecture.md) for CLI module boundaries, seed pipeline, and env/auth details.
3. Follow [docs/dev-workflow.md](./docs/dev-workflow.md) for the day-to-day build → seed → Hindsight loop.
4. Review [AGENTS.md](./AGENTS.md): it contains the project principles that apply to both human and AI contributors.
5. Look at open issues. Early-stage issues are the best place to start.

## Development Setup

```bash
git clone <repo-url>
cd nocciolo
pnpm install
pnpm build
pnpm test
pnpm nocciolo --help
```

Useful scripts: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm nocciolo <command>`.

To use bare `nocciolo` on your PATH from **any other local repo** (`cd` there first: `pnpm nocciolo` only works in this clone):

```bash
pnpm build
npm link
cd /path/to/your-project
nocciolo --help
nocciolo init
```

`npm link` needs no one-time setup. If you prefer pnpm, run `pnpm setup` once (creates `PNPM_HOME`), start a new shell, then `pnpm link --global`; otherwise pnpm fails with `ERR_PNPM_NO_GLOBAL_BIN_DIR`.

Unlink when done: `npm unlink -g @nocciolo-ai/cli` (or `pnpm unlink --global @nocciolo-ai/cli`). The global entry points at your clone, so after TypeScript changes `pnpm build` is enough: no re-link needed.

## How to Contribute

### Issues

- Search existing issues before opening a new one.
- Use clear titles and include reproduction steps or concrete examples when reporting bugs.
- For feature ideas, explain the problem you’re trying to solve and how it fits the current roadmap.

### Pull Requests

- Keep PRs focused. Small, reviewable changes are preferred over large ones.
- Update documentation (README, ROADMAP, AGENTS.md) when behavior or public surface changes.
- Prefer adding tests for core domain logic (extraction, bank templates, etc.) when practical.
- Follow the coding standards outlined in `AGENTS.md` and the Cursor rules.

### Commit Messages

Use clear, conventional messages:

```
feat: add bank template validation
fix: handle missing ADR directory gracefully
docs: clarify durable knowledge criteria
chore: update dependencies
```

## Code of Conduct

Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Questions

Open a discussion or issue. Early feedback on architecture and DX is especially valuable while the foundation is still forming.
