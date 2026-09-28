# CLAUDE.md

@AGENTS.md

Everything that governs work in this repo is in `AGENTS.md`, imported above, and
in `ARCHITECTURE.md`. This file holds only what is specific to Claude Code.

## Read these, in this order

1. `AGENTS.md` — the rules. Imported automatically, so you already have it.
2. `ARCHITECTURE.md` — what is actually built. Not what the feature names imply.
3. `DECISIONS.md` — why things are the way they are. Check here before arguing
   with a design choice; most have been settled once already, with reasons.
4. `TEST_PLAN.md` — the invariants, and the gaps that are known and accepted.
5. `docs/handoff.md` — the state of play and what is currently open.

`README.md` has the commands, environment setup and common failures.

## The verifier subagent

`.claude/agents/verifier.md`. Launch it with the Task tool after implementing
anything substantial, once `npm test` already passes — see the loop in
`AGENTS.md`. It assumes your implementation is wrong and checks each acceptance
criterion independently.

Give it the acceptance criteria explicitly. Without them it has to guess what
you were trying to do from the diff, which is exactly the thing you should not
make it guess.

It is committed to the repo on purpose (`.gitignore` re-includes
`.claude/agents/` while ignoring the rest of `.claude/`), because what to
distrust about work in *this* codebase is project knowledge, not machine setup.

## Skills

Feature work here has historically gone through the superpowers spec → plan
flow, which is why `docs/superpowers/{specs,plans}/` exists and is worth
reading. Those documents record reordering decisions and explicit non-goals, so
a missing feature is often deferred rather than forgotten.

## Security hooks (Prismor)

This workspace is *intended* to run under
[Prismor](https://github.com/PrismorSec/prismor) — runtime hooks watching tool
calls for destructive commands, secret leaks, supply-chain risk and prompt
injection. Written as an intention rather than a fact on purpose: **the hooks
live on the machine, not in the repo**, so a fresh clone has none until someone
sets them up.

**Check, don't assume** — `prismor status` reports what is actually active. As of
2026-09-25 on the original machine:

- **observe mode: it logs, it does not block.** "Protected" would overstate it.
  Switch with `prismor setup --mode enforce --recommended`, but only after
  reading a few days of findings — enforcement failing unexpectedly mid-task is a
  bad first encounter with a tool you are meant to trust.
- **cloaking not installed**, so secrets are *not* being masked. That is the
  feature that substitutes real secrets at execution time so they never reach
  model context; its install step fails without `jq`. Fix with `brew install jq`,
  then re-run setup. (There are no secrets in this repo anyway — see
  `SECURITY.md` — so the exposure here is theoretical.)

The setup used, which keeps everything local — no hosted judge, not enrolled, no
reading of past transcripts:

```
prismor setup --non-interactive --mode observe --scope project \
  --agents claude --cloak --no-backfill ~/leather-nest
```

Setup also installs a skill at `.claude/skills/immunity-agent/`. That path is
gitignored, so it exists only where setup has run — don't expect it in a clone.

## One habit worth keeping

The comments in this codebase carry measured results, including things that were
tried and did not work — a convex decomposition that changed nothing, a hairline
stroke that made a file open blank, a `semi-gloss` finish that never existed.
They are there to stop the next agent rediscovering a dead end at real cost.

When you make one of them wrong, fix the comment in the same change. When you are
tempted to undo one, find the measurement first.
