# my-skills

Personal Claude Code skills.

Each subdirectory is a self-contained skill (`SKILL.md` plus any supporting `references/`, `scripts/`, `templates/`).

## Skills

- **[twsp-migration](./twsp-migration/)** — port a Next.js source repo into a new rsbuild + React Router target repo, applying React 19, Tailwind 4, shadcn, and a new intl package along the way. Designed for ~12k-token sessions: state-machine dispatcher (`scripts/next.mjs`) drives a resumable, file-queued pipeline so each session does one tiny step and exits.
- **[lexical-migration](./lexical-migration/)** — migrate an in-house Lexical-based editor across version boundaries (typically for React 19 compatibility). Stocktakes the editor first (custom nodes, plugins, commands, themes, serialization), confirms the spec with the user, then runs a queue-driven port across nodes, plugins, and React 19 alignment. Same 12k-token, resumable architecture as `twsp-migration`; state lives under `./.lexm/`.

## Installing a skill locally

Symlink (or copy) any subdirectory into your `~/.claude/skills/` (or a project-local `.claude/skills/`):

```sh
ln -s "$(pwd)/twsp-migration" ~/.claude/skills/twsp-migration
```

Claude Code auto-discovers skills from these directories on session start.
