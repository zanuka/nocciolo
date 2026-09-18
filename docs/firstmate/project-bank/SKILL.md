# project-bank

On-demand Firstmate skill, not an always-on persona. First mate does not write product code.

## When to use

Before spawning a crewmate on a project that has a Hindsight bank registered
in `$FM_HOME/.nocciolo/projects.json` (or `~/.nocciolo/projects.json`).

## What it does

1. Resolve the project's absolute path against the captain registry to find
   its `bankId` and `hindsightBaseUrl`.
2. Append a bank card to the ship brief:
   - Bank id
   - Captain MCP URL: `<hindsightBaseUrl>/mcp/<bankId>/`
   - Three suggested `recall` queries seeded from the project's durable docs
3. Nothing else. The crewmate recalls from the bank; it does not seed or
   store, and this skill does not tell it to enable Hindsight MCP.

## What it must never do

- Never retain from chat. Never mine transcripts.
- Never call this "promote": it is a recall-only bank card.
- Never treat `/stow` as "run store" (those are unrelated: disk prefs vs.
  bank writes).
- Never write fleet MCP config into the product repo.

## When durable project markdown changes

The captain runs `nocciolo store --dry-run` in the durable clone (never in a
worktree), reviews the known/new/changed/unchanged buckets, then retains only
after picking files. This skill does not do that step; it only reads the
registry to build the bank card.

## Install

This is a repo copy for reference. To install it for real, run from the
product repo:

```bash
nocciolo mcp --harness firstmate --write-firstmate
```

This writes `$FM_HOME/.agents/skills/project-bank/SKILL.md` and records this
project's `bankId` + `hindsightBaseUrl` in `$FM_HOME/.nocciolo/projects.json`
(fallback `~/.nocciolo/projects.json` when `$FM_HOME` is unset). When
`$FM_HOME` is not set, the command prints these install steps instead of
writing anything.
