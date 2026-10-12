#!/usr/bin/env node
// RocketLauncher CLI: installs one Claude Code component from the RocketLauncher library.
// Zero dependencies, Node 18+ (global fetch). Library: github.com/marnixGeerkens/rocketlauncher-claude-code
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const RAW =
  process.env.ROCKETLAUNCHER_RAW ??
  "https://raw.githubusercontent.com/marnixGeerkens/rocketlauncher-claude-code/main";
const TYPES = {
  skill: "skills",
  agent: "agents",
  command: "commands",
  hook: "hooks",
  setting: "settings",
  mcp: "mcps",
};

const HELP = `RocketLauncher · install Claude Code components

  npx github:marnixGeerkens/rocketlauncher-cli add <type> <path> [--global]

  type   skill | agent | command | hook | setting | mcp
  path   the item path from rocketlauncher.ai/claude-code

  --global  install in ~/.claude instead of this project (not for mcp)

Example:
  npx github:marnixGeerkens/rocketlauncher-cli add skill creative-design/game-development/2d-games`;

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

/** add <type> <path>, or the older --<type> <path> / --<type>=<path> form. */
function parseArgs(argv) {
  const global = argv.includes("--global");
  const args = argv.filter((a) => a !== "--global");
  if (args[0] === "add") return { type: args[1], item: args[2], global };
  const flag = args.find((a) => /^--(\w+)(=.*)?$/.test(a));
  if (flag) {
    const [, type, eq] = /^--(\w+)(?:=(.*))?$/.exec(flag);
    return { type, item: eq ?? args[args.indexOf(flag) + 1], global };
  }
  return {};
}

async function get(url, as = "text") {
  const res = await fetch(url);
  if (!res.ok) fail(`Download failed (${res.status}): ${url}`);
  return as === "json" ? res.json() : Buffer.from(await res.arrayBuffer());
}

/** A file path from the manifest may never leave its target folder. */
function safeJoin(root, rel) {
  const target = path.resolve(root, rel);
  if (!target.startsWith(path.resolve(root) + path.sep)) fail(`Unsafe path: ${rel}`);
  return target;
}

async function save(target, data) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
  console.log(`  + ${path.relative(process.cwd(), target) || target}`);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    fail(`${file} is not valid JSON, fix it first.`);
  }
}

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Objects merge, arrays keep every distinct entry, values from the component win. */
function merge(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (isObject(v) && isObject(into[k])) merge(into[k], v);
    else if (Array.isArray(v) && Array.isArray(into[k])) {
      const seen = new Set(into[k].map((x) => JSON.stringify(x)));
      for (const x of v) if (!seen.has(JSON.stringify(x))) into[k].push(x);
    } else into[k] = v;
  }
  return into;
}

async function main() {
  const { type: rawType, item, global } = parseArgs(process.argv.slice(2));
  if (!rawType || !item) {
    console.log(HELP);
    process.exit(rawType ? 1 : 0);
  }
  const type = rawType.toLowerCase().replace(/s$/, "");
  const dir = TYPES[type];
  if (!dir) fail(`Unknown type "${rawType}". Use: ${Object.keys(TYPES).join(", ")}.`);
  if (global && type === "mcp") fail("MCP servers install per project. Run it without --global.");

  const manifest = await get(`${RAW}/manifest/${dir}.json`, "json");
  const wanted = item.replace(/^\/+|\/+$/g, "");
  const key = [wanted, `${wanted}.md`, `${wanted}.json`].find((k) => manifest[k]);
  if (!key) fail(`No ${type} "${wanted}" in the library. Browse rocketlauncher.ai/claude-code`);
  const files = manifest[key];

  const root = global ? homedir() : process.cwd();
  const claude = path.join(root, ".claude");
  const download = (f) => get(`${RAW}/components/${dir}/${f}`);
  console.log(`\n  RocketLauncher · installing ${type} ${key}\n`);

  if (type === "skill") {
    const target = path.join(claude, "skills", path.posix.basename(key));
    for (const f of files) await save(safeJoin(target, f.slice(key.length + 1)), await download(f));
  } else if (type === "agent" || type === "command") {
    for (const f of files)
      await save(safeJoin(path.join(claude, dir), path.posix.basename(f)), await download(f));
  } else {
    const main = JSON.parse((await download(key)).toString("utf8"));
    const extra = files.filter((f) => f !== key);
    if (type === "mcp") {
      // Library metadata stays out of the real config.
      const servers = Object.fromEntries(
        Object.entries(main.mcpServers ?? {}).map(([name, { description, ...server }]) => [name, server]),
      );
      const file = path.join(root, ".mcp.json");
      const current = await readJson(file);
      await save(file, JSON.stringify(merge(current, { mcpServers: servers }), null, 2) + "\n");
    } else {
      const { description, supportingFiles, tags, ...config } = main;
      const file = path.join(claude, "settings.json");
      const current = await readJson(file);
      await save(file, JSON.stringify(merge(current, type === "hook" ? { hooks: config.hooks } : config), null, 2) + "\n");
      const base = path.posix.dirname(key);
      for (const f of extra) {
        const rel = type === "hook" ? path.posix.relative(base, f) : path.posix.basename(f);
        const into = path.join(claude, type === "hook" ? "hooks" : "scripts");
        await save(safeJoin(into, rel), await download(f));
      }
    }
  }
  console.log(`\n  ✓ Done. Restart Claude Code to load it.\n  More free components: https://rocketlauncher.ai/claude-code\n`);
}

main().catch((e) => fail(e.message));
