# agent-skills

Install AI agent skills from GitHub. Like [shadcn/ui](https://ui.shadcn.com), but for agents.

No dependencies. No runtime. Just copies skill files into your agent's directory.

## Quick Start

```bash
# Install all Realms skills
npx agent-skills add Mythic-Project/realms-agent-docs

# Install one specific skill
npx agent-skills add Mythic-Project/realms-agent-docs/governance

# List installed skills
npx agent-skills list

# Remove a skill
npx agent-skills remove realms-governance
```

## How It Works

Skills are directories with a `SKILL.md` file and optional `references/`, `scripts/`, and `assets/` folders. They follow the [AgentSkills](https://github.com/openclaw/openclaw) spec — compatible with OpenClaw and any agent framework that supports it.

```
skill-name/
├── SKILL.md              # Instructions for the agent (when/how to use)
└── references/           # Detailed docs loaded on demand
    ├── api.md
    └── workflows.md
```

The CLI pulls these from GitHub and copies them into your skills directory. That's it. No build step, no lock files, no version conflicts.

## Commands

### `add <ref>`

Install skills from any GitHub repo.

```bash
# From a specific repo and skill
npx agent-skills add owner/repo/skill-name

# All skills from a repo
npx agent-skills add owner/repo

# From the registry (short name)
npx agent-skills add realms-governance
```

### `list`

Show installed skills with their descriptions.

```bash
npx agent-skills list
```

### `remove <name>`

Remove an installed skill.

```bash
npx agent-skills remove realms-governance
```

### `search <query>`

Search the skill registry.

```bash
npx agent-skills search dao
```

## Options

```bash
--path <dir>    Custom skills directory (default: ~/.openclaw/workspace/skills/)
```

## Publishing Skills

Any GitHub repo can be a skill source. Just follow the structure:

```
your-repo/
├── skill-one/
│   ├── SKILL.md          # Required: name + description in YAML frontmatter
│   └── references/       # Optional: detailed docs
└── skill-two/
    ├── SKILL.md
    └── scripts/           # Optional: executable code
```

The `SKILL.md` frontmatter defines the skill:

```yaml
---
name: my-skill
description: What it does and when to use it. This is how agents discover your skill.
---

# Instructions here...
```

Then anyone can install it:

```bash
npx agent-skills add your-username/your-repo/skill-one
```

## Why?

Every protocol wants AI agents using their product. Skills are the distribution channel. Jupiter wants agents swapping through them, Kamino wants agents depositing there. This gives them a standard way to ship agent integrations.

## License

MIT
