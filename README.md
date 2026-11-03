# CA Graph

An interactive graph of the Web PKI: the root and intermediate certificate
authorities disclosed to the [Common CA Database (CCADB)](https://www.ccadb.org/),
and how they chain to each other.

It is a modern take on the ICSI Certificate Notary's
[Tree of Trust](https://zeek.org/2012/12/the-tree-of-trust/) (2012), built from
scratch on CCADB data instead of passively observed traffic.

## What the graph shows

- **Nodes are CA keys**, not individual certificates. Certificates that share a
  Subject Key Identifier (cross-signs and re-issuances of the same CA) are merged
  into one node, so cross-signing shows up as a node with several parents.
- **Edges go from issuer to subject.** An edge whose certificates are all
  revoked is hidden unless "Show revoked" is on.
- **Diamonds are roots, circles are intermediates.** Size grows with the number
  of CA keys below a node.
- **Colour is the operator** (the "Subordinate CA Owner" if CCADB lists one,
  otherwise the "CA Owner"). The eight operators with the most CA keys get a
  colour; everyone else is grey. Click an operator in the legend to isolate it.
- **Default view:** CAs that can issue TLS certificates, are trusted by at least
  one of Mozilla, Chrome, Apple or Microsoft, and are not revoked.

Only certificates that had not expired on the data download date are included.

### Caveats

- CCADB only records what a CA can issue for (TLS, S/MIME, code signing) while
  it is trusted and not revoked. Untrusted and revoked CAs therefore only show
  up with "Used for: Anything".
- CCADB records a country per CA Owner, as free text. The build normalises the
  spellings and gives each CA its operator's country when the operator is also
  a CA Owner, and the CA Owner's country otherwise.
- Revocation reasons and dates only exist for intermediates, and CCADB lists no
  reason for some of them (the panel says "no reason given").
- Unlike the 2012 Tree of Trust, there is no count of end-entity (website)
  certificates per CA: CCADB does not track that.

## Development

Tested with Node.js 24.

```bash
npm install
npm run dev        # local server at http://localhost:5173
npm run build      # type-check and build into dist/
npm run preview    # serve dist/ locally
```

## Updating the data

The processed graph lives in `public/graph.json` and is committed to the repo.
To refresh it:

```bash
npm run data:fetch   # downloads the CCADB CSVs into data/raw/ (git-ignored)
npm run data:build   # writes public/graph.json (takes ~30 s for the layout)
```

The main source is CCADB's
[All Certificate Records, V4a](https://ccadb.my.salesforce-sites.com/ccadb/AllCertificateRecordsCSVFormatV4a),
which excludes CA certificates that expired more than five years ago. The
[revoked intermediate certificates report](https://ccadb.my.salesforce-sites.com/mozilla/PublicIntermediateCertsRevokedWithPEMCSV)
adds the revocation reason and date, joined by SHA-256 fingerprint. The layout
(ForceAtlas2) is seeded, so rebuilding the same CSVs gives the same picture.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds the site and publishes it on every push to
`main`. It does not touch the data. Before the first push, enable Pages in the
repository: **Settings → Pages → Source: GitHub Actions**.

## Project layout

```
scripts/fetch-ccadb.ts   download the CCADB CSV
scripts/build-graph.ts   CSV → graph.json (grouping, edges, layout)
src/types.ts             graph.json format, shared by the script and the page
src/main.ts              renderer (Sigma.js), filters, search, highlighting
src/panel.ts             detail panel
src/colors.ts            palette for the WebGL canvas
public/graph.json        processed data
```

## Data licence

`public/graph.json` is derived from CCADB's All Certificate Records and revoked
intermediate certificates reports.
CCADB makes its data available under the
[Community Data License Agreement – Permissive 2.0](https://cdla.dev/permissive-2-0/)
and asks for attribution to CCADB in derived works
([CCADB Data Usage Terms](https://www.ccadb.org/rootstores/usage)). The licence
text ships next to the data as `public/DATA-LICENSE.txt`, so it is published
with the site. This project is not affiliated with or endorsed by CCADB.

The code is separate from the data and is not covered by that licence.

## Credits

- Data: [Common CA Database (CCADB)](https://www.ccadb.org/resources),
  CDLA-Permissive-2.0.
- Rendering: [Sigma.js](https://www.sigmajs.org/) and
  [graphology](https://graphology.github.io/).
- Inspiration: the ICSI SSL Notary's Tree of Trust.
