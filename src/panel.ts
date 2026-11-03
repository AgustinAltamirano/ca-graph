// Detail panel for a selected CA.

import { STORE_NAMES, USE, type GraphData, type GraphNode } from "./types.ts";

const USE_LABELS: [number, string][] = [
  [USE.TLS, "TLS"],
  [USE.SMIME, "S/MIME"],
  [USE.CODE, "Code signing"],
  [USE.OTHER, "Not recorded"],
];

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const MAX_LINKS = 40;

export interface PanelContext {
  data: GraphData;
  parents: number[][];
  children: number[][];
  onSelect: (index: number) => void;
  onClose: () => void;
}

export function renderPanel(el: HTMLElement, index: number, ctx: PanelContext) {
  const { data, parents, children } = ctx;
  const n = data.nodes[index];
  const operator = data.owners[n.o];
  const caOwner = data.owners[n.co];

  const storeBadges = STORE_NAMES.map((name, i) => {
    const ok = (n.s & (1 << i)) !== 0;
    return `<span class="badge ${ok ? "good" : ""}">${ok ? "✓" : "✕"} ${name}</span>`;
  }).join("");

  const uses = USE_LABELS.filter(([bit]) => n.u & bit)
    .map(([, l]) => l)
    .join(", ");

  el.innerHTML = `
    <div class="panel-head">
      <h2>${esc(n.l)}</h2>
      <button class="close" type="button" aria-label="Close details">×</button>
    </div>
    <div class="badges">
      <span class="badge">${n.r ? "Root CA" : "Intermediate CA"}</span>
      ${n.rv ? '<span class="badge bad">Revoked</span>' : ""}
    </div>
    <div class="badges" aria-label="Trusted by">${storeBadges}</div>
    <dl class="facts">
      <dt>Operator</dt><dd>${esc(operator)}</dd>
      ${caOwner !== operator ? `<dt>CA Owner</dt><dd>${esc(caOwner)}</dd>` : ""}
      ${n.cc ? `<dt>Country</dt><dd>${esc(n.cc)}</dd>` : ""}
      <dt>Used for</dt><dd>${esc(uses)}</dd>
      <dt>CAs below</dt><dd>${n.d.toLocaleString("en")}</dd>
    </dl>
    ${linkList("Issued by", parents[index], data.nodes)}
    ${linkList("Issues", children[index], data.nodes)}
    <h3>Certificates (${n.c.length})</h3>
    ${n.c.map(certCard).join("")}
  `;

  el.querySelector(".close")!.addEventListener("click", ctx.onClose);
  el.querySelectorAll<HTMLButtonElement>("button[data-node]").forEach((b) =>
    b.addEventListener("click", () => ctx.onSelect(Number(b.dataset.node))),
  );
  el.hidden = false;
  el.scrollTop = 0;
}

function linkList(title: string, list: number[], nodes: GraphNode[]) {
  if (!list.length) return "";
  const sorted = [...list].sort((a, b) => nodes[b].d - nodes[a].d || nodes[a].l.localeCompare(nodes[b].l));
  const items = sorted
    .slice(0, MAX_LINKS)
    .map(
      (i) =>
        `<li><span class="swatch ${nodes[i].r ? "diamond" : "circle"}"></span><button type="button" data-node="${i}">${esc(nodes[i].l)}</button></li>`,
    )
    .join("");
  const more = sorted.length > MAX_LINKS ? `<li class="muted">and ${sorted.length - MAX_LINKS} more</li>` : "";
  return `<h3>${title} (${list.length})</h3><ul class="links">${items}${more}</ul>`;
}

function certCard(c: GraphData["nodes"][number]["c"][number]) {
  const statuses = STORE_NAMES.map((name, i) => `${name}: ${esc(c.st[i] || "—")}`).join(" · ");
  return `
    <div class="cert">
      <div class="cert-name">${esc(c.n)}</div>
      <dl class="facts">
        <dt>Valid</dt><dd>${c.f} → ${c.t}</dd>
        ${c.p ? `<dt>Signed by</dt><dd>${esc(c.pn)}</dd>` : ""}
        ${c.rv ? `<dt>Revocation</dt><dd>${esc(c.rv)}</dd>` : ""}
        ${c.tc ? "<dt>Constraints</dt><dd>Technically constrained</dd>" : ""}
        <dt>Status</dt><dd>${statuses}</dd>
        <dt>SHA-256</dt><dd class="fingerprint"><a href="https://crt.sh/?q=${c.h}" target="_blank" rel="noopener">${c.h}</a></dd>
      </dl>
    </div>`;
}
