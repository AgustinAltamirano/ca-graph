// Turns the CCADB CSV into public/graph.json: one node per CA key, one edge per
// issuer -> subject link, with a precomputed ForceAtlas2 layout.
// Run with: npm run data:build

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import { STORE, USE, type CertRecord, type GraphData, type GraphEdge, type GraphNode } from "../src/types.ts";

const CCADB_URL = "https://ccadb.my.salesforce-sites.com/ccadb/AllCertificateRecordsCSVFormatV4a";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = resolve(root, "data/raw/ccadb-all-certificate-records-v4a.csv");
const revokedPath = resolve(root, "data/raw/ccadb-revoked-intermediates.csv");
const outPath = resolve(root, "public/graph.json");

type Row = Record<string, string>;

const rows: Row[] = parse(readFileSync(csvPath), { columns: true, bom: true, skip_empty_lines: true });
const dataDate = statSync(csvPath).mtime.toISOString().slice(0, 10);

// CCADB dates look like "2038.01.13".
const isoDate = (d: string) => d.replaceAll(".", "-");

// Revocation reason and date come from a second report (revoked intermediates),
// keyed by SHA-256. Its reasons look like "(2) cACompromise", dates "2026 Oct 18".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const revocations = new Map<string, { rr?: string; rd?: string }>();
if (existsSync(revokedPath)) {
  const revokedRows: Row[] = parse(readFileSync(revokedPath), { columns: true, bom: true, skip_empty_lines: true });
  for (const r of revokedRows) {
    const reason = r["RFC 5280 Revocation Reason Code"].replace(/^\(\d+\)\s*/, "").trim();
    const m = r["Date of Revocation"].match(/^(\d{4}) (\w{3}) (\d{1,2})$/);
    const date = m ? `${m[1]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
    revocations.set(r["SHA-256 Fingerprint"].toUpperCase(), {
      ...(reason && { rr: reason }),
      ...(date && { rd: date }),
    });
  }
  console.log(`${revokedRows.length} records in the revoked intermediates report`);
} else {
  console.warn(`${revokedPath} not found: revocation reasons will be missing (run npm run data:fetch)`);
}

// Keep certificates that are still within their validity period on the data date.
// Revoked ones stay in (flagged) so the page can show them on demand.
const live = rows.filter((r) => isoDate(r["Valid To (GMT)"]) >= dataDate);
console.log(`${rows.length} records in CSV, ${live.length} not expired as of ${dataDate}`);

const TRUSTED = new Set(["Trusted", "Included"]);
const STORE_COLUMNS = ["Mozilla Status", "Chrome Status", "Apple Status", "Microsoft Status"] as const;
const STORE_BITS = [STORE.MOZILLA, STORE.CHROME, STORE.APPLE, STORE.MICROSOFT];

const keyOf = (r: Row) => r["Subject Key Identifier"] || `sha:${r["SHA-256 Fingerprint"]}`;
const isRevoked = (r: Row) => r["Revocation Status"] === "Revoked" || r["Revocation Status"] === "Parent Cert Revoked";
const operatorOf = (r: Row) => r["Subordinate CA Owner"] || r["CA Owner"];

// Group certificates by key.
const groups = new Map<string, Row[]>();
for (const r of live) {
  const k = keyOf(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push(r);
}

const owners: string[] = [];
const ownerIndex = new Map<string, number>();
const ownerId = (name: string) => {
  if (!ownerIndex.has(name)) {
    ownerIndex.set(name, owners.length);
    owners.push(name);
  }
  return ownerIndex.get(name)!;
};

// CCADB's "Country" is free text and belongs to the CA Owner, not to the
// certificate. Normalise the spellings, then give each node the country of its
// operator (the "Subordinate CA Owner" when that is also a CA Owner), falling
// back to the CA Owner's.
const COUNTRY_ALIASES: Record<string, string> = {
  "United States of America": "United States",
  USA: "United States",
  US: "United States",
  "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
  SPAIN: "Spain",
  "España": "Spain",
  Polska: "Poland",
  Brasil: "Brazil",
  "中国": "China",
  NL: "Netherlands",
  UAE: "United Arab Emirates",
  "Taiwan (Republic of China)": "Taiwan",
  "Taiwan, Republic of China": "Taiwan",
  "Republic of Korea (South Korea)": "South Korea",
  "Hong Kong Special Administrative Region of the People's Republic of China": "Hong Kong",
};
const normCountry = (c: string) => COUNTRY_ALIASES[c.trim()] ?? c.trim();
const ownerCountry = new Map<string, string>();
for (const r of rows) if (r["Country"]) ownerCountry.set(r["CA Owner"], normCountry(r["Country"]));
const countryOf = (r: Row) => ownerCountry.get(operatorOf(r)) ?? normCountry(r["Country"]);

const mostCommon = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
};

// Build nodes.
const nodes: GraphNode[] = [];
const nodeIndex = new Map<string, number>();
for (const [key, certs] of groups) {
  // Prefer the non-revoked certificates for descriptive fields.
  const active = certs.filter((c) => !isRevoked(c));
  const pick = active.length ? active : certs;

  let u = 0;
  let s = 0;
  for (const c of certs) {
    if (c["TLS Capable"] === "True") u |= USE.TLS;
    if (c["S/MIME Capable"] === "True") u |= USE.SMIME;
    if (c["Code Signing Capable"] === "True") u |= USE.CODE;
  }
  if (!u) u = USE.OTHER;
  for (const c of pick) STORE_COLUMNS.forEach((col, i) => TRUSTED.has(c[col]) && (s |= STORE_BITS[i]));

  const c: CertRecord[] = certs
    .map((r) => ({
      n: r["Certificate Name"],
      h: r["SHA-256 Fingerprint"],
      p: r["Parent SHA-256 Fingerprint"],
      pn: r["Parent Certificate Name"],
      f: isoDate(r["Valid From (GMT)"]),
      t: isoDate(r["Valid To (GMT)"]),
      rv: r["Revocation Status"],
      ...revocations.get(r["SHA-256 Fingerprint"].toUpperCase()),
      tc: r["Technically Constrained"] === "true",
      st: STORE_COLUMNS.map((col) => r[col]) as CertRecord["st"],
    }))
    .sort((a, b) => b.f.localeCompare(a.f));

  nodeIndex.set(key, nodes.length);
  nodes.push({
    id: key,
    l: mostCommon(pick.map((r) => r["Certificate Name"])),
    o: ownerId(mostCommon(pick.map(operatorOf))),
    co: ownerId(mostCommon(pick.map((r) => r["CA Owner"]))),
    cc: mostCommon(pick.map(countryOf)),
    r: certs.some((r) => r["Certificate Record Type"] === "Root Certificate") ? 1 : 0,
    x: 0,
    y: 0,
    d: 0,
    u,
    s,
    rv: active.length ? 0 : 1,
    c,
  });
}

// Build edges: issuer key -> subject key. A link is "revoked" only if every
// certificate that creates it is revoked.
const shaToKey = new Map(live.map((r) => [r["SHA-256 Fingerprint"], keyOf(r)]));
const links = new Map<string, { s: number; t: number; allRevoked: boolean }>();
let missingParent = 0;
for (const r of live) {
  if (r["Certificate Record Type"] === "Root Certificate") continue;
  const parentKey = shaToKey.get(r["Parent SHA-256 Fingerprint"]);
  if (!parentKey) {
    missingParent++;
    continue;
  }
  const s = nodeIndex.get(parentKey)!;
  const t = nodeIndex.get(keyOf(r))!;
  if (s === t) continue; // re-issued self-signed variants of the same key
  const id = `${s}>${t}`;
  const prev = links.get(id);
  const revoked = isRevoked(r);
  if (prev) prev.allRevoked &&= revoked;
  else links.set(id, { s, t, allRevoked: revoked });
}
const edges: GraphEdge[] = [...links.values()].map((l) => [l.s, l.t, l.allRevoked ? 1 : 0]);
console.log(`${nodes.length} nodes (CA keys), ${edges.length} edges, ${missingParent} certificates with an expired or unlisted parent`);

// Store trust (node.s) comes straight from CCADB, which already derives
// "Trusted" for intermediates from their chain to an included root.
const children = nodes.map(() => [] as number[]);
for (const [s, t, rv] of edges) if (!rv) children[s].push(t);

// Descendant count (distinct CA keys reachable through non-revoked links).
for (let i = 0; i < nodes.length; i++) {
  const seen = new Set<number>();
  const stack = [...children[i]];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === i || seen.has(n)) continue;
    seen.add(n);
    stack.push(...children[n]);
  }
  nodes[i].d = seen.size;
}

// Layout. Seeded random start so rebuilding gives the same picture.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const g = new Graph({ type: "directed", multi: false });
nodes.forEach((n, i) => g.addNode(i, { x: rand() * 1000, y: rand() * 1000, size: 1 + Math.sqrt(n.d) }));
for (const [s, t] of edges) g.mergeEdge(s, t);

const t0 = Date.now();
forceAtlas2.assign(g, {
  iterations: 1500,
  settings: {
    ...forceAtlas2.inferSettings(g),
    barnesHutOptimize: true,
    linLogMode: false,
    gravity: 0.5,
    scalingRatio: 4,
    adjustSizes: false,
  },
});
noverlap.assign(g, { maxIterations: 200, settings: { margin: 1, ratio: 1.2 } });
console.log(`Layout computed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const round = (v: number) => Math.round(v * 10) / 10;
g.forEachNode((k, a) => {
  nodes[Number(k)].x = round(a.x);
  nodes[Number(k)].y = round(a.y);
});

const data: GraphData = {
  meta: {
    source: "CCADB — All Certificate Records (V4a)",
    sourceUrl: CCADB_URL,
    dataDate,
    builtAt: new Date().toISOString(),
    certificates: live.length,
    roots: live.filter((r) => r["Certificate Record Type"] === "Root Certificate").length,
    intermediates: live.filter((r) => r["Certificate Record Type"] !== "Root Certificate").length,
  },
  owners,
  nodes,
  edges,
};
const json = JSON.stringify(data);
writeFileSync(outPath, json);
console.log(`Wrote ${outPath} (${(json.length / 1e6).toFixed(2)} MB)`);
