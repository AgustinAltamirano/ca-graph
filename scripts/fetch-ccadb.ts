// Downloads the CCADB reports the graph is built from into data/raw/:
// - All Certificate Records (V4a: excludes CA certificates that expired more
//   than five years ago): every root and intermediate, with trust status.
// - Revoked intermediate certificates: adds the revocation reason and date,
//   which the first report does not include.
// Run with: npm run data:fetch

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPORTS = [
  {
    url: "https://ccadb.my.salesforce-sites.com/ccadb/AllCertificateRecordsCSVFormatV4a",
    file: "ccadb-all-certificate-records-v4a.csv",
  },
  {
    url: "https://ccadb.my.salesforce-sites.com/mozilla/PublicIntermediateCertsRevokedWithPEMCSV",
    file: "ccadb-revoked-intermediates.csv",
  },
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const { url, file } of REPORTS) {
  const out = resolve(root, "data/raw", file);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Download of ${url} failed: HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const body = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, body);
  console.log(`Saved ${(body.length / 1e6).toFixed(1)} MB to ${out}`);
}
