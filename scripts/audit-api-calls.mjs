/**
 * Cross-checks every API call written in the web app against the routes the running API publishes
 * (/api/openapi.json). Fails if the frontend calls a method+path the backend does not have.
 *   node scripts/audit-api-calls.mjs            (API must be running on :4000)
 * It checks that routes EXIST with the right HTTP method. Request/response shapes and permissions are
 * covered by the API tests and the browser tests, not by this script.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const API = process.env.API_URL ?? "http://localhost:4000";
const spec = await (await fetch(`${API}/api/openapi.json`)).json();
const routes = Object.entries(spec.paths).flatMap(([p, ms]) => Object.keys(ms).filter((m) => ["get", "post", "put", "patch", "delete"].includes(m)).map((m) => ({ method: m.toUpperCase(), re: new RegExp("^" + p.replace(/\{[^}]+\}/g, "[^/]+") + "$"), path: p })));

const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && files.push(p); } })("apps/web/src");

const calls = [];
const re = /\b(?:api|request)\s*\.\s*(get|post|patch|put|del)\s*(?:<[^()]*?>)?\s*\(\s*([`"'])((?:\\.|(?!\2).)*)\2/gs;
const fetchRe = /\b(?:fetch|EventSource)\s*\(\s*([`"'])(\/api\/(?:\\.|(?!\1).)*)\1/gs;
const hrefRe = /(?:href|action)\s*=\s*\{?\s*([`"'])(\/api\/(?:\\.|(?!\1).)*)\1/gs;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const line = (i) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(re)) calls.push({ file: f, line: line(m.index), method: m[1] === "del" ? "DELETE" : m[1].toUpperCase(), raw: m[3] });
  for (const m of src.matchAll(fetchRe)) calls.push({ file: f, line: line(m.index), method: "GET", raw: m[2] });
  for (const m of src.matchAll(hrefRe)) calls.push({ file: f, line: line(m.index), method: "GET", raw: m[2] });
}
// helpers that build URLs from a const (exportUrl, labels etc.)
// "${...}" right after a path segment is a query-string helper (qs(...), ?x=y); after "/" it is a path parameter.
const norm = (raw) => {
  const cut = raw.search(/(?<!\/)\$\{/);
  const base = cut >= 0 ? raw.slice(0, cut) : raw;
  return base.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, "X").split("?")[0].replace(/\/+$/, "");
};
let bad = 0, ok = 0;
const seen = new Set();
for (const c of calls) {
  if (!c.raw.startsWith("/api") && !c.raw.startsWith("`/api")) continue;
  const path = norm(c.raw);
  const hit = routes.find((r) => r.method === c.method && r.re.test(path));
  const key = `${c.method} ${path}`;
  if (hit) { ok++; seen.add(`${hit.method} ${hit.path}`); }
  else { bad++; console.log(`✗ ${c.file}:${c.line}  ${c.method} ${c.raw}  → no such route`); }
}
const unused = routes.filter((r) => !seen.has(`${r.method} ${r.path}`)).map((r) => `${r.method} ${r.path}`);
console.log(`\n${ok} frontend calls match a backend route; ${bad} do not.`);
console.log(`Backend routes the web app never calls directly (${unused.length}): ${unused.join(", ")}`);
process.exit(bad ? 1 : 0);
