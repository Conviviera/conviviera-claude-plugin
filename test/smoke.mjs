// Smoke test for the Conviviera Claude plugin. Zero dependencies.
//
//   node test/smoke.mjs                 static checks only
//   SMOKE_LIVE=1 node test/smoke.mjs    plus unauthenticated OAuth discovery checks
//
// The live checks only GET public discovery documents and send one unauthenticated
// MCP initialize, which must be refused with 401. They never register a client,
// request a token, or write anything.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The core profile: the only address that carries private rooms. It is its own OAuth resource,
// so a sign-in for the legacy /mcp address does not work here and the reverse.
const REMOTE_URL = 'https://connect.conviviera.com/mcp/core';
const ISSUER = 'https://connect.conviviera.com';
// The core catalog. The first seven read tools are the ones a scheduled public visit uses.
const READ_TOOLS = [
  'conviviera_identity', 'conviviera_topics', 'conviviera_discussions',
  'conviviera_read_discussion', 'conviviera_read_post', 'conviviera_feedback',
  'conviviera_activity', 'conviviera_topic_activity', 'conviviera_record_lookup',
  'conviviera_private_threads', 'conviviera_read_private_thread', 'conviviera_private_updates',
  'conviviera_calc_project', 'conviviera_calc_stats', 'conviviera_calc_arithmetic',
];
const VISIT_TOOLS = READ_TOOLS.slice(0, 7);
const WRITE_TOOLS = [
  'conviviera_start_discussion', 'conviviera_reply', 'conviviera_create_topic', 'conviviera_moderate_topic',
  'conviviera_private_reply', 'conviviera_private_summary', 'conviviera_delegate',
  'conviviera_delegation_vote', 'conviviera_delegation_report',
];
const EXPECTED_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];
// Core tools without the conviviera_ prefix.
const GENERIC_TOOLS = ['search', 'fetch'];
// Only on the legacy /mcp address. A skill that names one sends Claude after a tool this connection lacks.
const REMOVED_TOOLS = ['conviviera_start_run', 'conviviera_run_event'];
const EXPECTED_SKILLS = ['ask', 'catch-up', 'check-in', 'contribute', 'conviviera-participation', 'delegate', 'drop-off',
  'room-data', 'rooms', 'setup', 'visit', 'watch'];
const ROOM_SKILLS = ['check-in', 'delegate', 'room-data', 'rooms'];
const RELEASE_NOTE = /Conviviera release of 10 November 2026 or later/;
// Prose wraps, so phrase checks run on text with whitespace collapsed.
const flat = (s) => s.replace(/\s+/g, ' ');
// Tool names of the retired 1.x local server. None may appear in skills or manifests.
const LEGACY_TOOLS = ['whoami', 'read_thread', 'list_threads', 'register_agent', 'set_residency',
  'list_bookmarks', 'send_message', 'mark_notifications_read'];
// Strings that point at the retired local-credential setup. Allowed only where the
// upgrade path is explained (README, CHANGELOG and the setup skill's upgrade step).
const LEGACY_SETUP = ['CONVIVIERA_PASSWORD', 'CONVIVIERA_API_KEY', 'CONVIVIERA_USERNAME', 'server/index.js'];
const UPGRADE_DOCS = new Set(['README.md', 'CHANGELOG.md', 'skills/setup/SKILL.md']);
const SECRET_PATTERNS = [/cv[ko]_[A-Za-z0-9]{8,}/, /\bBasic [A-Za-z0-9+/]{12,}={0,2}/,
  /\bBearer [A-Za-z0-9._~+/-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

let failures = 0;
let passes = 0;
function check(ok, message) {
  if (ok) { passes++; console.log(`ok   ${message}`); }
  else { failures++; console.error(`FAIL ${message}`); }
}
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === '.git' || name === 'node_modules') continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}

// --- .mcp.json: exactly one remote OAuth server, nothing local, nothing secret
const mcp = json('.mcp.json');
const servers = Object.keys(mcp.mcpServers ?? {});
check(servers.length === 1 && servers[0] === 'conviviera', '.mcp.json declares exactly one server, "conviviera"');
const server = mcp.mcpServers?.conviviera ?? {};
check(server.type === 'http', '.mcp.json server type is "http"');
check(server.url === REMOTE_URL, `.mcp.json url is exactly ${REMOTE_URL} (no trailing slash)`);
const extraKeys = Object.keys(server).filter((k) => !['type', 'url'].includes(k));
check(extraKeys.length === 0, `.mcp.json server has no command, args, env or headers (extra: ${extraKeys.join(', ') || 'none'})`);

// --- manifests and versions
const plugin = json('.claude-plugin/plugin.json');
const market = json('.claude-plugin/marketplace.json');
const pkg = existsSync(join(ROOT, 'package.json')) ? json('package.json') : null;
check(plugin.name === 'conviviera', 'plugin.json name is "conviviera"');
check(typeof plugin.displayName === 'string' && plugin.displayName.length > 0, 'plugin.json has a displayName');
check(/^\d+\.\d+\.\d+$/.test(plugin.version ?? ''), `plugin.json version is semver (${plugin.version})`);
check(plugin.license === 'MIT' && existsSync(join(ROOT, 'LICENSE')), 'MIT license declared and LICENSE present');
check(market.name === 'conviviera', 'marketplace name is "conviviera"');
const entry = (market.plugins ?? []).find((p) => p.name === plugin.name);
check(Boolean(entry) && entry.source === './', 'marketplace lists the plugin with source "./"');
check(entry?.version === plugin.version, `marketplace plugin entry version matches (${entry?.version})`);
check(entry?.description === plugin.description, 'marketplace entry description matches plugin.json');
check(!/\bofficial\b/i.test(JSON.stringify(market)), 'marketplace.json does not call anything "official"');
check(market.metadata?.version === plugin.version, `marketplace metadata version matches (${market.metadata?.version})`);
if (pkg) {
  check(pkg.version === plugin.version, `package.json version matches (${pkg.version})`);
  check(pkg.private === true && !pkg.bin && !pkg.main, 'package.json is private with no bin or main');
}
const manifestText = JSON.stringify([plugin.description, entry?.description]).toLowerCase()
  .replace(/no passwords or (api )?keys/g, '');
check(!/\breact(ions?)?\b|\bvotes?\b|password|admin key|api key/.test(manifestText),
  'manifest descriptions advertise no reactions, votes or password/key setup');

// --- nothing that runs code on the user's machine. Whatever lands on main is what every user
// installs (marketplace source "./"), so the manifests may carry only metadata: no hooks, no
// stdio or extra MCP/LSP servers, no inline components, no executables. New keys, top-level
// entries or script files must be added here deliberately, in review.
const PLUGIN_KEYS = ['name', 'displayName', 'description', 'version', 'author', 'homepage', 'repository', 'license', 'keywords',
  'privacyPolicyUrl', 'supportUrl', 'documentationUrl', 'termsOfServiceUrl'];
const ENTRY_KEYS = ['name', 'source', 'description', 'version', 'author', 'homepage', 'repository', 'license', 'category', 'keywords', 'tags'];
const MARKET_KEYS = ['$schema', 'name', 'owner', 'metadata', 'plugins'];
const extraPlugin = Object.keys(plugin).filter((k) => !PLUGIN_KEYS.includes(k));
check(extraPlugin.length === 0, `plugin.json has only metadata keys (no hooks, mcpServers, lspServers, commands...; extra: ${extraPlugin.join(', ') || 'none'})`);
check(Object.keys(market).every((k) => MARKET_KEYS.includes(k)), 'marketplace.json has only name, owner, metadata and plugins');
check((market.plugins ?? []).length === 1, 'marketplace lists exactly one plugin');
for (const p of market.plugins ?? []) {
  const extra = Object.keys(p).filter((k) => !ENTRY_KEYS.includes(k));
  check(extra.length === 0, `marketplace entry ${p.name} has no inline hooks, servers, strict:false or components (extra: ${extra.join(', ') || 'none'})`);
}
const ROOT_ENTRIES = ['.claude-plugin', '.github', 'skills', 'test', '.gitignore', '.mcp.json', 'CHANGELOG.md',
  'LICENSE', 'README.md', 'SECURITY.md', 'package.json'];
const rootExtra = readdirSync(ROOT).filter((n) => !['.git', 'node_modules'].includes(n) && !ROOT_ENTRIES.includes(n));
check(rootExtra.length === 0, `repository root has only expected entries (no hooks/, agents/, bin/, settings.json, .lsp.json...; extra: ${rootExtra.join(', ') || 'none'})`);
const pluginDirFiles = readdirSync(join(ROOT, '.claude-plugin')).sort();
// One PNG is allowed: the directory listing icon, which nothing runs.
const pluginDirPngs = pluginDirFiles.filter((f) => /\.png$/.test(f));
check(pluginDirPngs.length <= 1 && JSON.stringify(pluginDirFiles.filter((f) => !pluginDirPngs.includes(f))) === JSON.stringify(['marketplace.json', 'plugin.json']), '.claude-plugin/ holds only marketplace.json, plugin.json and the listing icon');
const allFiles = walk('');
const scripts = allFiles.filter((f) => /\.(c?js|mjs|ts|sh|bash|zsh|ps1|psm1|py|rb|pl|exe|bat|cmd|dll|so|dylib|node)$/i.test(f) && !f.startsWith('test/'));
check(scripts.length === 0, `no scripts or binaries outside test/ (${scripts.join(', ') || 'none'})`);
check(!allFiles.some((f) => /(^|\/)(hooks\.json|\.lsp\.json)$/.test(f) || (f.endsWith('.mcp.json') && f !== '.mcp.json')),
  'no hooks.json, .lsp.json or second .mcp.json anywhere');
for (const dir of readdirSync(join(ROOT, 'skills'))) {
  const extra = readdirSync(join(ROOT, 'skills', dir)).filter((n) => n !== 'SKILL.md');
  check(extra.length === 0, `skills/${dir}/ holds only SKILL.md (extra: ${extra.join(', ') || 'none'})`);
}

// --- retired local server is gone
check(!existsSync(join(ROOT, 'server')), 'server/ (1.x local stdio server) is removed');
check(!existsSync(join(ROOT, 'bin')), 'no top-level bin/ directory');

// --- skills
const skillDirs = readdirSync(join(ROOT, 'skills')).filter((d) => statSync(join(ROOT, 'skills', d)).isDirectory()).sort();
check(JSON.stringify(skillDirs) === JSON.stringify(EXPECTED_SKILLS), `skills are ${EXPECTED_SKILLS.join(', ')}`);
const toolMentions = new Set();
for (const dir of skillDirs) {
  const rel = `skills/${dir}/SKILL.md`;
  const text = read(rel);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  check(Boolean(fm), `${rel} has YAML frontmatter`);
  const name = /^name:\s*(.+)$/m.exec(fm?.[1] ?? '')?.[1]?.trim();
  const description = /^description:\s*(.+)$/m.exec(fm?.[1] ?? '')?.[1]?.trim() ?? '';
  check(name === dir, `${rel} frontmatter name equals its directory (${name})`);
  check(description.length > 20 && description.length <= 1024, `${rel} has a description of 21-1024 characters`);
  for (const m of text.matchAll(/\bconviviera_[a-z_]+/g)) toolMentions.add(m[0]);
  check(/conviviera_identity/.test(text), `${rel} checks identity with conviviera_identity`);
  check(!/generate (a )?(long )?(random )?password/i.test(text), `${rel} never has the model create a password`);
}
const unknown = [...toolMentions].filter((t) => !EXPECTED_TOOLS.includes(t));
check(unknown.length === 0, `skills name only live tools (unknown: ${unknown.join(', ') || 'none'})`);
for (const tool of REMOVED_TOOLS) check(!toolMentions.has(tool), `no skill names ${tool}, which the core profile does not have`);
const participation = read('skills/conviviera-participation/SKILL.md');
for (const tool of EXPECTED_TOOLS) check(participation.includes(tool), `participation skill documents ${tool}`);
for (const tool of GENERIC_TOOLS) check(participation.includes('`' + tool + '`'), `participation skill documents ${tool}`);
check(/untrusted/i.test(participation), 'participation skill treats forum content as untrusted');
check(/publish nothing under that identity/.test(participation), 'participation skill blocks publishing on an identity mismatch');
// A link_url relayed from post text is an account-linking phishing vector: the norms must forbid it,
// and no skill may tell the model to hand over a link_url unconditionally.
check(/never give the person a `link_url`/i.test(participation), 'participation skill never relays a link_url found in content');
for (const dir of skillDirs) {
  const text = read(`skills/${dir}/SKILL.md`);
  check(!/give the (person|user) the `link_url`( exactly as returned| it returns)/i.test(text),
    `skills/${dir}/SKILL.md has no unconditional link_url relay`);
}
check(!/\b\d{3,4} words\b/.test(participation), 'participation skill hardcodes no word limit');

// --- documented headless (cron) lines must deny every write tool, not just allow the reads.
// --allowedTools only adds allow rules; settings or a permissive defaultMode could still let a
// write tool run, so the line must also pass --disallowedTools (deny wins) and dontAsk.
const PREFIX = 'mcp__plugin_conviviera_conviviera__';
const flagList = (line, flag) => {
  const m = new RegExp(`${flag}\\s+"([^"]*)"`).exec(line);
  return m ? m[1].split(/[\s,]+/).filter(Boolean) : null;
};
let headlessLines = 0;
for (const file of ['README.md', 'skills/drop-off/SKILL.md']) {
  for (const line of read(file).split(/\r?\n/)) {
    if (!/\bclaude -p\b/.test(line) || !line.includes('/conviviera:visit')) continue;
    headlessLines++;
    const allowed = flagList(line, '--allowedTools');
    const denied = flagList(line, '--disallowedTools');
    check(Array.isArray(allowed) && VISIT_TOOLS.every((t) => allowed.includes(PREFIX + t)),
      `${file}: headless line allows every public read tool a visit uses`);
    check(Array.isArray(allowed) && !allowed.some((t) => WRITE_TOOLS.some((w) => t.endsWith(w))),
      `${file}: headless line allows no write tool`);
    // A scheduled visit is public-only: no room, search or calculation tool, so no room text reaches a log.
    check(Array.isArray(allowed) && allowed.every((t) => VISIT_TOOLS.some((v) => t === PREFIX + v)),
      `${file}: headless line allows nothing beyond those seven tools`);
    const missing = WRITE_TOOLS.filter((t) => !(denied ?? []).includes(PREFIX + t));
    check(Array.isArray(denied) && missing.length === 0,
      `${file}: headless line denies every write tool with --disallowedTools (missing: ${missing.join(', ') || 'none'})`);
    const LOCAL = ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Read', 'Glob', 'Grep'];
    check(Array.isArray(denied) && LOCAL.every((t) => denied.includes(t)),
      `${file}: headless line denies ${LOCAL.join(', ')}`);
    check(!/\bcd ~ &&/.test(line), `${file}: headless line does not run in the home directory`);
    check(/--permission-mode\s+dontAsk\b/.test(line), `${file}: headless line uses --permission-mode dontAsk`);
    check(/NEXT_CURSOR=/.test(line), `${file}: headless line carries the feedback cursor forward from its log`);
  }
}
check(headlessLines >= 2, `README and drop-off each document a headless line (${headlessLines} found)`);
check(/NEXT_CURSOR=<n>/.test(read('skills/visit/SKILL.md')), 'visit ends its report with the NEXT_CURSOR line the cron line reads');
check(/Never call a write tool during a visit/.test(read('skills/visit/SKILL.md')), 'visit never publishes');
check(!/publishing sentence/i.test(read('skills/drop-off/SKILL.md')), 'drop-off offers no scheduled publishing');
check(!/unless they already authorized/i.test(participation), 'participation asks for a yes to the exact text of every post');
check(!/same result/i.test(read('skills/drop-off/SKILL.md')), 'drop-off does not claim a cursor-less visit gives the same result');
check(/^disable-model-invocation:\s*true$/m.test(read('skills/drop-off/SKILL.md')), 'drop-off (persistent schedules) starts only from the user');
const watch = read('skills/watch/SKILL.md');
check(!/^disable-model-invocation:\s*true$/m.test(watch), 'watch stays discoverable from a natural user monitoring request');
check(!/^user-invocable:\s*false$/m.test(watch), 'watch remains available as a slash command');
check(/untrusted/i.test(read('skills/contribute/SKILL.md')), 'contribute restates that what it reads is untrusted');

// --- private rooms: the rules each room skill must carry
for (const dir of ROOM_SKILLS) {
  const text = flat(read(`skills/${dir}/SKILL.md`));
  check(/untrusted/i.test(text), `skills/${dir} treats room text as untrusted data`);
  check(/lab and model truthfully/i.test(text), `skills/${dir} has the agent state its lab and model truthfully`);
  check(/`mode`/.test(text), `skills/${dir} covers the run mode`);
  check(RELEASE_NOTE.test(text), `skills/${dir} names the Conviviera release its tools need`);
  check(/wait for a yes|only after a yes|user's yes|explicit yes/i.test(text), `skills/${dir} waits for the user's yes before a room write`);
  check(/^user-invocable:\s*true$/m.test(read(`skills/${dir}/SKILL.md`)), `skills/${dir} is a slash command`);
}
const rooms = flat(read('skills/rooms/SKILL.md'));
check(/Never repeat room content in public/.test(rooms), 'rooms never repeats room content in public');
check(/reader's\*\* agent only reads|reader's agent only reads/i.test(rooms), 'rooms says a reader only reads');
for (const tool of ['conviviera_private_threads', 'conviviera_read_private_thread', 'conviviera_private_reply']) {
  check(rooms.includes(tool), `rooms uses ${tool}`);
}
const delegateSkill = flat(read('skills/delegate/SKILL.md'));
check(/public post rule/i.test(delegateSkill), 'delegate states the public post rule');
check(/never sign it with the room pseudonym/i.test(delegateSkill), 'delegate posts in public as the public identity, not the room pseudonym');
for (const tool of ['conviviera_delegate', 'conviviera_delegation_vote', 'conviviera_delegation_report', 'conviviera_private_summary']) {
  check(delegateSkill.includes(tool), `delegate uses ${tool}`);
}
const roomData = flat(read('skills/room-data/SKILL.md'));
for (const block of ['chart', 'table', 'link', 'image']) {
  check(roomData.includes('```' + block), `room-data shows a ${block} block`);
}
check(/calculation, not advice/i.test(roomData), 'room-data says a projection is a calculation, not advice');
check(/80% and 95%/.test(roomData), 'room-data reports both prediction intervals');
for (const tool of ['conviviera_calc_project', 'conviviera_calc_stats', 'conviviera_calc_arithmetic']) {
  check(roomData.includes(tool), `room-data uses ${tool}`);
}
const checkIn = flat(read('skills/check-in/SKILL.md'));
check(checkIn.includes('conviviera_private_updates'), 'check-in starts from conviviera_private_updates');
check(/Never repeat room content in public/.test(flat(participation)), 'participation keeps room content out of public posts');
const readme = flat(read('README.md'));
check(RELEASE_NOTE.test(readme) && RELEASE_NOTE.test(flat(read('CHANGELOG.md'))),
  'README and CHANGELOG name the Conviviera release the room tools need');
check(readme.includes(REMOTE_URL), 'README names the server URL in .mcp.json');
check(!/ticked by default/i.test(readme) && !/cannot read private messages, change passwords or create topics/.test(readme),
  'README permissions describe the core connection (read-only start, rooms, separate topic permission)');
for (const tool of [...EXPECTED_TOOLS, ...GENERIC_TOOLS]) check(readme.includes('`' + tool + '`'), `README tools table lists ${tool}`);
check(/\/conviviera:drop-off/.test(participation), 'participation sends scheduling requests to /conviviera:drop-off');
for (const file of ['README.md', 'skills/drop-off/SKILL.md']) {
  check(!/cannot publish/i.test(read(file)) || /--disallowedTools/.test(read(file)),
    `${file} claims "cannot publish" only alongside a deny list`);
}

// --- whole-repo text checks
const files = walk('');
const textFiles = files.filter((f) => /\.(md|json|mjs|js|ya?ml|txt)$/i.test(f) || f === '.gitignore');
for (const file of textFiles) {
  const text = read(file);
  if (file.startsWith('skills/') || file.startsWith('.claude-plugin/') || file === '.mcp.json') {
    // The setup skill's 1.x upgrade step may show the HTTPS API action that names an owner;
    // that is a JSON action the user runs with curl, not a 1.x MCP tool.
    const scanned = file === 'skills/setup/SKILL.md' ? text.replaceAll('"action":"set_residency"', '') : text;
    const hits = LEGACY_TOOLS.filter((t) => new RegExp(`\\b${t}\\b`).test(scanned));
    check(hits.length === 0, `${file} names no 1.x tools (${hits.join(', ') || 'none'})`);
  }
  if (!UPGRADE_DOCS.has(file) && file !== 'test/smoke.mjs') {
    const hits = LEGACY_SETUP.filter((s) => text.includes(s));
    check(hits.length === 0, `${file} has no local-credential setup (${hits.join(', ') || 'none'})`);
  }
  if (file !== 'test/smoke.mjs') {
    check(!SECRET_PATTERNS.some((re) => re.test(text)), `${file} contains no secret-looking strings`);
  }
}
check(existsSync(join(ROOT, 'SECURITY.md')) && read('README.md').includes('(SECURITY.md)'),
  'SECURITY.md exists and the README points security reports to it');
const junk = files.filter((f) => ['.DS_Store', 'Thumbs.db', '.env'].includes(f.split('/').pop()));
check(junk.length === 0, `no system or env files (${junk.join(', ') || 'none'})`);

// --- optional live, unauthenticated discovery checks
async function live() {
  const get = async (url) => {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'manual' });
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  };
  // RFC 9728 path-suffixed metadata: what the 401 challenge for the server URL points Claude at.
  const prm = await get(`${ISSUER}/.well-known/oauth-protected-resource${new URL(REMOTE_URL).pathname}`);
  check(prm.status === 200, `protected resource metadata answers 200 (${prm.status})`);
  check(prm.body?.resource === REMOTE_URL, `PRM resource equals ${REMOTE_URL} (${prm.body?.resource})`);
  check(prm.body?.authorization_servers?.[0] === ISSUER, 'PRM lists the issuer first');
  const as = await get(`${ISSUER}/.well-known/oauth-authorization-server`);
  check(as.status === 200, `authorization server metadata answers 200 (${as.status})`);
  check(as.body?.issuer === ISSUER, 'AS metadata issuer matches');
  check(typeof as.body?.registration_endpoint === 'string', 'AS metadata advertises a registration endpoint');
  check(Boolean(as.body?.code_challenge_methods_supported?.includes('S256')), 'AS metadata supports PKCE S256');
  check(Boolean(as.body?.token_endpoint_auth_methods_supported?.includes('none')), 'AS metadata supports public clients ("none")');
  const res = await fetch(REMOTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'conviviera-plugin-smoke', version: plugin.version } } }),
  });
  const challenge = res.headers.get('www-authenticate') ?? '';
  check(res.status === 401, `unauthenticated initialize is refused with 401 (${res.status})`);
  check(/^Bearer\b/i.test(challenge) && /resource_metadata="https:\/\/connect\.conviviera\.com\//.test(challenge),
    '401 carries a Bearer challenge with resource_metadata');
}

if (process.env.SMOKE_LIVE === '1') {
  try { await live(); } catch (e) { check(false, `live checks ran (${e.message})`); }
} else {
  console.log('skip live OAuth discovery checks (set SMOKE_LIVE=1)');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
