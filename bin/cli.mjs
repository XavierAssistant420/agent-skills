#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join, resolve, basename } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const VERSION = '0.1.0';

const REGISTRY_URL = 'https://raw.githubusercontent.com/Mythic-Project/realms-agent-docs/main/registry.json';

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

// ── Helpers ──

function detectSkillsDir() {
  // Try common locations
  const candidates = [
    join(process.env.HOME || '', '.openclaw', 'workspace', 'skills'),
    join(process.env.HOME || '', '.openclaw', 'skills'),
    join(process.cwd(), 'skills'),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }

  // Default: create in openclaw workspace
  const defaultDir = candidates[0];
  return defaultDir;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

function parseSkillRef(ref) {
  // Formats:
  //   owner/repo/skill-name
  //   owner/repo (lists available skills)
  //   skill-name (searches registry)
  const parts = ref.split('/');
  if (parts.length === 3) {
    return { owner: parts[0], repo: parts[1], skill: parts[2] };
  }
  if (parts.length === 2) {
    return { owner: parts[0], repo: parts[1], skill: null };
  }
  return { owner: null, repo: null, skill: parts[0] };
}

async function downloadSkillFromGitHub(owner, repo, skillPath, destDir) {
  const tmp = join(tmpdir(), `agent-skills-${Date.now()}`);

  try {
    // Sparse checkout — only the skill directory
    execSync(`git clone --depth 1 --filter=blob:none --sparse https://github.com/${owner}/${repo}.git "${tmp}" 2>/dev/null`, { stdio: 'pipe' });
    execSync(`cd "${tmp}" && git sparse-checkout set "${skillPath}" 2>/dev/null`, { stdio: 'pipe' });

    const srcDir = join(tmp, skillPath);
    if (!existsSync(join(srcDir, 'SKILL.md'))) {
      throw new Error(`No SKILL.md found in ${owner}/${repo}/${skillPath}`);
    }

    // Read the skill name from SKILL.md frontmatter
    const skillMd = readFileSync(join(srcDir, 'SKILL.md'), 'utf8');
    const nameMatch = skillMd.match(/^name:\s*(.+)$/m);
    const skillName = nameMatch ? nameMatch[1].trim() : basename(skillPath);
    const targetDir = join(destDir, skillName);

    if (existsSync(targetDir)) {
      console.log(c('yellow', `  ↻ Updating ${skillName} (already exists)`));
      rmSync(targetDir, { recursive: true });
    }

    // Copy recursively
    copyDirSync(srcDir, targetDir);
    return skillName;
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
}

function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

async function listRepoSkills(owner, repo) {
  // Fetch repo tree to find directories with SKILL.md
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
  const tree = await fetchJson(url);
  const skills = [];

  for (const item of tree.tree) {
    if (item.path.endsWith('/SKILL.md') && item.path.split('/').length === 2) {
      const dir = item.path.split('/')[0];
      // Fetch SKILL.md to get name + description
      try {
        const raw = await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/main/${item.path}`);
        const nameMatch = raw.match(/^name:\s*(.+)$/m);
        const descMatch = raw.match(/^description:\s*(.+)$/m);
        skills.push({
          dir,
          name: nameMatch ? nameMatch[1].trim() : dir,
          description: descMatch ? descMatch[1].trim().slice(0, 100) : '',
        });
      } catch {
        skills.push({ dir, name: dir, description: '' });
      }
    }
  }
  return skills;
}

// ── Commands ──

async function cmdAdd(refs, options) {
  const destDir = options.path || detectSkillsDir();
  mkdirSync(destDir, { recursive: true });

  console.log(c('cyan', '\n⚡ agent-skills add\n'));

  for (const ref of refs) {
    const parsed = parseSkillRef(ref);

    if (parsed.owner && parsed.repo && parsed.skill) {
      // Direct: owner/repo/skill
      try {
        const name = await downloadSkillFromGitHub(parsed.owner, parsed.repo, parsed.skill, destDir);
        console.log(c('green', `  ✓ ${name}`) + c('dim', ` → ${destDir}/${name}/`));
      } catch (e) {
        console.error(c('red', `  ✗ ${ref}: ${e.message}`));
      }
    } else if (parsed.owner && parsed.repo) {
      // Repo: owner/repo — install all skills
      console.log(c('dim', `  Scanning ${parsed.owner}/${parsed.repo}...`));
      try {
        const skills = await listRepoSkills(parsed.owner, parsed.repo);
        if (skills.length === 0) {
          console.log(c('yellow', '  No skills found in repo'));
          continue;
        }
        for (const skill of skills) {
          try {
            const name = await downloadSkillFromGitHub(parsed.owner, parsed.repo, skill.dir, destDir);
            console.log(c('green', `  ✓ ${name}`) + c('dim', ` → ${destDir}/${name}/`));
          } catch (e) {
            console.error(c('red', `  ✗ ${skill.dir}: ${e.message}`));
          }
        }
      } catch (e) {
        console.error(c('red', `  ✗ ${ref}: ${e.message}`));
      }
    } else {
      // Short name: search registry
      try {
        const registry = await fetchJson(REGISTRY_URL);
        const entry = registry.skills?.[parsed.skill];
        if (!entry) {
          console.error(c('red', `  ✗ "${parsed.skill}" not found in registry. Use owner/repo/skill format.`));
          continue;
        }
        const name = await downloadSkillFromGitHub(entry.owner, entry.repo, entry.path, destDir);
        console.log(c('green', `  ✓ ${name}`) + c('dim', ` → ${destDir}/${name}/`));
      } catch {
        console.error(c('red', `  ✗ "${parsed.skill}" not found. Use owner/repo/skill format instead.`));
      }
    }
  }

  console.log(c('dim', `\n  Skills directory: ${destDir}\n`));
}

async function cmdList(options) {
  const destDir = options.path || detectSkillsDir();

  console.log(c('cyan', '\n⚡ Installed skills\n'));

  if (!existsSync(destDir)) {
    console.log(c('dim', '  No skills installed yet. Run: npx agent-skills add <owner/repo>\n'));
    return;
  }

  const entries = readdirSync(destDir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = join(destDir, entry.name, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    const content = readFileSync(skillMdPath, 'utf8');
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*(.+)$/m);
    const name = nameMatch ? nameMatch[1].trim() : entry.name;
    const desc = descMatch ? descMatch[1].trim().slice(0, 80) + '...' : '';

    console.log(`  ${c('green', name)}`);
    if (desc) console.log(`  ${c('dim', desc)}`);
    console.log();
    count++;
  }

  if (count === 0) {
    console.log(c('dim', '  No skills installed yet. Run: npx agent-skills add <owner/repo>\n'));
  } else {
    console.log(c('dim', `  ${count} skill${count !== 1 ? 's' : ''} in ${destDir}\n`));
  }
}

async function cmdRemove(names, options) {
  const destDir = options.path || detectSkillsDir();

  console.log(c('cyan', '\n⚡ agent-skills remove\n'));

  for (const name of names) {
    // Try exact match, then try with prefix
    const candidates = [name, `realms-${name}`];
    let removed = false;

    for (const candidate of candidates) {
      const targetDir = join(destDir, candidate);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true });
        console.log(c('green', `  ✓ Removed ${candidate}`));
        removed = true;
        break;
      }
    }

    if (!removed) {
      console.error(c('red', `  ✗ "${name}" not found in ${destDir}`));
    }
  }
  console.log();
}

async function cmdSearch(query) {
  console.log(c('cyan', '\n⚡ agent-skills search\n'));

  try {
    const registry = await fetchJson(REGISTRY_URL);
    const skills = registry.skills || {};
    const q = query.toLowerCase();
    const matches = Object.entries(skills).filter(([key, val]) =>
      key.includes(q) ||
      val.name?.toLowerCase().includes(q) ||
      val.description?.toLowerCase().includes(q) ||
      val.tags?.some(t => t.includes(q))
    );

    if (matches.length === 0) {
      console.log(c('dim', `  No skills matching "${query}"\n`));
      return;
    }

    for (const [key, val] of matches) {
      console.log(`  ${c('green', val.name || key)}`);
      console.log(`  ${c('dim', `npx agent-skills add ${val.owner}/${val.repo}/${val.path}`)}`);
      if (val.description) console.log(`  ${val.description.slice(0, 100)}`);
      console.log();
    }
  } catch {
    console.log(c('yellow', '  Registry not available. Use direct GitHub references:\n'));
    console.log(c('dim', '  npx agent-skills add Mythic-Project/realms-agent-docs/governance\n'));
  }
}

// ── CLI Entry ──

const args = process.argv.slice(2);
const command = args[0];

// Parse --path flag
const pathIdx = args.indexOf('--path');
const options = {};
if (pathIdx !== -1 && args[pathIdx + 1]) {
  options.path = resolve(args[pathIdx + 1]);
  args.splice(pathIdx, 2);
}

switch (command) {
  case 'add':
  case 'install':
  case 'i':
    if (args.length < 2) {
      console.log(`
${c('cyan', '⚡ agent-skills add')}

${c('bold', 'Usage:')}
  npx agent-skills add ${c('dim', '<owner/repo/skill>')}     Install one skill
  npx agent-skills add ${c('dim', '<owner/repo>')}            Install all skills from repo
  npx agent-skills add ${c('dim', '<name>')}                  Install from registry

${c('bold', 'Examples:')}
  npx agent-skills add Mythic-Project/realms-agent-docs/governance
  npx agent-skills add Mythic-Project/realms-agent-docs
  npx agent-skills add realms-governance

${c('bold', 'Options:')}
  --path ${c('dim', '<dir>')}    Custom skills directory
`);
      break;
    }
    await cmdAdd(args.slice(1).filter(a => !a.startsWith('--')), options);
    break;

  case 'list':
  case 'ls':
    await cmdList(options);
    break;

  case 'remove':
  case 'rm':
  case 'uninstall':
    if (args.length < 2) {
      console.log(`\n  Usage: npx agent-skills remove <skill-name>\n`);
      break;
    }
    await cmdRemove(args.slice(1).filter(a => !a.startsWith('--')), options);
    break;

  case 'search':
  case 'find':
    if (args.length < 2) {
      console.log(`\n  Usage: npx agent-skills search <query>\n`);
      break;
    }
    await cmdSearch(args[1]);
    break;

  case 'version':
  case '-v':
  case '--version':
    console.log(VERSION);
    break;

  default:
    console.log(`
${c('cyan', '⚡ agent-skills')} ${c('dim', `v${VERSION}`)}
${c('dim', 'Install AI agent skills from GitHub. Like shadcn, but for agents.')}

${c('bold', 'Commands:')}
  add ${c('dim', '<ref>')}       Install skills from GitHub
  list            Show installed skills
  remove ${c('dim', '<name>')}   Remove a skill
  search ${c('dim', '<query>')}  Search the registry

${c('bold', 'Quick start:')}
  npx agent-skills add Mythic-Project/realms-agent-docs

${c('bold', 'Install one skill:')}
  npx agent-skills add Mythic-Project/realms-agent-docs/governance

${c('dim', 'https://github.com/Mythic-Project/agent-skills')}
`);
}
