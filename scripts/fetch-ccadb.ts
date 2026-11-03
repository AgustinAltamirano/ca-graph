// Downloads the CCADB "All Certificate Records" report (V4a: excludes CA
// certificates that expired more than five years ago) into data/raw/.
// Run with: npm run data:fetch

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CCADB_URL = "https://ccadb.my.salesforce-sites.com/ccadb/AllCertificateRecordsCSVFormatV4a";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "data/raw/ccadb-all-certificate-records-v4a.csv");

const res = await fetch(CCADB_URL);
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const body = Buffer.from(await res.arrayBuffer());
await mkdir(dirname(out), { recursive: true });
await writeFile(out, body);
console.log(`Saved ${(body.length / 1e6).toFixed(1)} MB to ${out}`);
