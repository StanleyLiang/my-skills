# my-skills

Personal Claude Code skills, packaged as a local Claude Code plugin marketplace.

The repo is both a marketplace (`stanley-liang-skills`) and a single plugin of the same name. Skills appear in the Claude Code skill list as:

- `stanley-liang-skills:twsp-migration`
- `stanley-liang-skills:lexical-migration`

## Skills

- **[twsp-migration](./skills/twsp-migration/)** — port a Next.js source repo into a new rsbuild + React Router target repo, applying React 19, Tailwind 4, shadcn, and a new intl package along the way. Designed for ~12k-token sessions: state-machine dispatcher (`scripts/next.mjs`) drives a resumable, file-queued pipeline so each session does one tiny step and exits.
- **[lexical-migration](./skills/lexical-migration/)** — migrate an in-house Lexical-based editor across version boundaries (typically for React 19 compatibility). Audits the editor first (custom nodes, plugins, commands, themes, serialization), confirms the spec with the user, then runs a queue-driven port across nodes, plugins, and React 19 alignment. Same 12k-token, resumable architecture as `twsp-migration`; state lives under `./.lexm/`.

## Installing locally

From inside a Claude Code session:

```sh
# Add this repo as a marketplace (run once)
/plugin marketplace add StanleyLiang/my-skills
# or from a local clone:
/plugin marketplace add /path/to/my-skills

# Install the plugin
/plugin install stanley-liang-skills@stanley-liang-skills
```

After install, the skills are auto-discovered and available as `stanley-liang-skills:twsp-migration` and `stanley-liang-skills:lexical-migration`.
