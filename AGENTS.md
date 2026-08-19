# AGENTS.md: Nocciolo

This file is the primary source of truth for any AI agent working on Nocciolo.

## Project Identity

Nocciolo is a **company brain config** utility.

It helps developers turn durable project knowledge (docs, ADRs, decisions, domain references) into structured memory banks: starting with Hindsight, so AI agents inherit shared context instead of rediscovering it every session.

We are building this in public as open source.

## Core Principles (non-negotiable)

1. **Durable over ephemeral**  
   Prefer knowledge that should outlive a single session, model, or tool. Do not treat chat history or temporary notes as first-class sources.

2. **Local control first**  
   Favor self-hostable, version-controlled, offline-capable designs. Avoid forced cloud dependencies.

3. **Amplify existing craft**  
   Nocciolo does not replace ADRs, architecture docs, or coding standards. It makes them usable by agents.

4. **CLI-first, progressive enhancement**  
   The primary interface is a fast, predictable CLI. UIs and advanced features come later.

5. **Hindsight-native initially**  
   First-class support is for Hindsight banks (mission, directives, retain/recall/reflect). Other providers come later and must not break the Hindsight path.

6. **Clear boundaries**  
   Keep knowledge curation, bank configuration, and agent integration concerns separated. Do not create a monolithic "do everything" agent system.

## Architecture Expectations

- TypeScript CLI (Node.js)
- Clean separation: scanner → extractor → bank template → seeder → integration emitters
- Config lives in `.nocciolo/` (or equivalent) and is version-controlled
- Prefer explicit configuration over magic
- Every retained fact should carry provenance (source file + optional commit)

## Coding Standards

- Prefer small, composable functions and clear module boundaries
- Strong typing: avoid `any` unless there is a documented reason
- CLI commands should be idempotent where practical and support `--dry-run`
- Errors should be actionable (tell the user what to do next)
- No silent failures on knowledge extraction

## When Working on Knowledge / Bank Features

- Treat project documentation as the source of truth
- Extraction should be conservative: better to miss something than to inject noise
- Bank missions and directives should reflect real project values, not generic AI filler
- Always consider how an agent will actually use the bank in a coding session

## Documentation & Public Development

- Keep the README and ROADMAP accurate
- Prefer updating living docs over leaving stale comments
- When adding a major capability, update the roadmap status

## What Agents Should Not Do

- Do not invent new architecture patterns without justification against existing ADRs/standards
- Do not expand scope into general agent orchestration, multi-agent frameworks, or product surfaces unless explicitly requested
- Do not add cloud-only or vendor-locked paths as the default
- Do not treat the bank as a dumping ground for every file in the repo

## Current Focus

See `ROADMAP.md`. Phase 4 is underway: Strumentario dogfood gaps are captured in `docs/phase-4-dogfood-gaps.md` (multi-repo MCP DX, bank template apply, shareable config / deployment profiles).

<!-- nocciolo:hindsight-bank -->

## Project memory bank (Hindsight)

Prefer the project Hindsight bank `nocciolo` for durable nocciolo context (architecture, decisions, standards, domain invariants).

- Recall via the Hindsight MCP tools (`recall`, `reflect`) before rediscovering the same facts from scattered docs.
- MCP endpoint (single-bank): `http://localhost:8888/mcp/nocciolo/`
- Treat repo docs and ADRs as source of truth; use the bank as the agent-facing memory of those sources.
- Do not dump secrets, credentials, or ephemeral chat into the bank.

<!-- /nocciolo:hindsight-bank -->
