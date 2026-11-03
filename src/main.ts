import Graph from "graphology";
import Sigma, { DEFAULT_CAMERA_STATE } from "sigma";
import { layerFill, sdfCircle, sdfDiamond } from "sigma/rendering";
import { SERIES_COUNT, currentTheme, onThemeChange, type Theme } from "./colors.ts";
import { renderPanel } from "./panel.ts";
import type { GraphData } from "./types.ts";
import "./style.css";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const res = await fetch(`${import.meta.env.BASE_URL}graph.json`);
const data: GraphData = await res.json();
const { nodes, edges, owners } = data;

// ---------------------------------------------------------------------------
// Indexes

const parents = nodes.map(() => [] as number[]);
const children = nodes.map(() => [] as number[]);
for (const [s, t] of edges) {
  parents[t].push(s);
  children[s].push(t);
}

// Colour follows the operator. The eight operators with the most CA keys get
// a series colour (fixed for the session, so filters never repaint); every
// other operator is grey.
const ownerSize = new Map<number, number>();
for (const n of nodes) ownerSize.set(n.o, (ownerSize.get(n.o) ?? 0) + 1);
const topOwners = [...ownerSize.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, SERIES_COUNT)
  .map(([o]) => o);
const ownerSlot = new Map(topOwners.map((o, i) => [o, i]));

// ---------------------------------------------------------------------------
// State

const state = {
  use: 1,
  store: 15,
  showRevoked: false,
  country: "",
  focusOwner: null as number | null,
  selected: null as number | null,
};
let theme: Theme = currentTheme();

const visible = new Uint8Array(nodes.length);
/** Nodes that pass every filter except the country one (for the country counts). */
const passesBase = (n: (typeof nodes)[number]) =>
  (n.u & state.use) !== 0 && (state.store === 0 || (n.s & state.store) !== 0) && (state.showRevoked || !n.rv);

function computeVisibility() {
  nodes.forEach((n, i) => {
    visible[i] = Number(passesBase(n) && (!state.country || n.cc === state.country));
  });
}

/** Nodes and edges to emphasise: the chain to the roots and, when selected, the subtree. */
let focus: { nodes: Set<number>; edges: Set<string> } | null = null;

function walk(start: number, next: number[][], up: boolean, out: { nodes: Set<number>; edges: Set<string> }) {
  const stack = [start];
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of next[n]) {
      if (!visible[m]) continue;
      const key = up ? `${m}-${n}` : `${n}-${m}`;
      if (!state.showRevoked && revokedEdge.has(key)) continue;
      out.edges.add(key);
      if (!out.nodes.has(m)) {
        out.nodes.add(m);
        stack.push(m);
      }
    }
  }
}

function computeFocus() {
  const target = state.selected;
  if (target !== null && visible[target]) {
    const f = { nodes: new Set([target]), edges: new Set<string>() };
    walk(target, parents, true, f);
    walk(target, children, false, f);
    focus = f;
  } else if (state.focusOwner !== null) {
    const f = { nodes: new Set<number>(), edges: new Set<string>() };
    nodes.forEach((n, i) => n.o === state.focusOwner && f.nodes.add(i));
    for (const [s, t] of edges) if (f.nodes.has(s) && f.nodes.has(t)) f.edges.add(`${s}-${t}`);
    focus = f;
  } else {
    focus = null;
  }
}

const revokedEdge = new Set(edges.filter((e) => e[2]).map(([s, t]) => `${s}-${t}`));

// ---------------------------------------------------------------------------
// Graph + renderer

const graph = new Graph({ type: "directed" });
nodes.forEach((n, i) => {
  graph.addNode(String(i), {
    label: n.l,
    x: n.x,
    y: -n.y,
    size: (n.r ? 3.5 : 2) + 1.8 * Math.log2(1 + n.d),
  });
});
for (const [s, t] of edges) graph.addEdgeWithKey(`${s}-${t}`, String(s), String(t), { size: 0.6 });

const colorOf = (i: number) => {
  const slot = ownerSlot.get(nodes[i].o);
  return slot === undefined ? theme.other : theme.series[slot];
};

const container = $("#graph");
const renderer = new Sigma(graph, container, {
  primitives: {
    nodes: { shapes: [sdfCircle(), sdfDiamond()], layers: [layerFill()] },
  },
  settings: {
    labelRenderedSizeThreshold: 11,
    labelGridCellSize: 160,
    labelDensity: 0.25,
    hideEdgesOnMove: false,
    minCameraRatio: 0.02,
    maxCameraRatio: 4,
  },
  nodeReducer: (key, _data) => {
    const i = Number(key);
    if (!visible[i]) return { visibility: "hidden" };
    const out: Partial<typeof _data> = {
      color: colorOf(i),
      shape: nodes[i].r ? "diamond" : "circle",
      labelColor: theme.label,
      backdropColor: theme.backdrop,
    };
    if (focus) {
      if (focus.nodes.has(i)) {
        out.zIndex = 2;
        if (i === state.selected || nodes[i].r) out.labelVisibility = "visible";
      } else {
        out.opacity = 0.12;
        out.labelVisibility = "hidden";
        out.zIndex = 0;
      }
    }
    if (i === state.selected) {
      out.labelVisibility = "visible";
      out.backdropVisibility = "visible";
      out.zIndex = 3;
    }
    return out;
  },
  edgeReducer: (key, _data) => {
    const [s, t] = key.split("-").map(Number);
    if (!visible[s] || !visible[t] || (!state.showRevoked && revokedEdge.has(key))) return { visibility: "hidden" };
    if (focus) {
      if (focus.edges.has(key)) return { color: theme.edgeStrong, size: 1.4, zIndex: 2 };
      return { color: theme.edge, opacity: 0.1 };
    }
    return { color: theme.edge };
  },
});

// ---------------------------------------------------------------------------
// UI

const panel = $<HTMLElement>("#panel");
const search = $<HTMLInputElement>("#search");
const suggestions = $<HTMLUListElement>("#suggestions");
const legend = $<HTMLUListElement>("#legend-owners");

function refresh() {
  computeFocus();
  renderer.refresh();
}

function applyFilters() {
  computeVisibility();
  if (state.selected !== null && !visible[state.selected]) select(null);
  updateStats();
  updateHint();
  renderCountries();
  renderLegend();
  refresh();
}

// Country options list only the countries with CAs under the other filters
// (plus the selected one), alphabetically, with their count.
const countrySelect = $<HTMLSelectElement>("#filter-country");
function renderCountries() {
  const counts = new Map<string, number>();
  let total = 0;
  for (const n of nodes) {
    if (!passesBase(n)) continue;
    total++;
    counts.set(n.cc, (counts.get(n.cc) ?? 0) + 1);
  }
  if (state.country && !counts.has(state.country)) counts.set(state.country, 0);
  const option = (value: string, label: string, count: number) =>
    `<option value="${escapeHtml(value)}">${escapeHtml(label)} (${count.toLocaleString("en")})</option>`;
  countrySelect.innerHTML =
    option("", "Any country", total) +
    [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([c, k]) => option(c, c || "Unknown", k))
      .join("");
  countrySelect.value = state.country;
}

function select(i: number | null, moveCamera = false) {
  state.selected = i;
  if (i === null) {
    panel.hidden = true;
  } else {
    renderPanel(panel, i, { data, parents, children, onSelect: (j) => select(j, true), onClose: () => select(null) });
    if (moveCamera) {
      const d = renderer.getNodeDisplayData(String(i));
      if (d) renderer.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(renderer.getCamera().ratio, 0.3) }, { duration: 500 });
    }
  }
  refresh();
}

// CCADB only records what a CA can issue for (TLS, S/MIME, code signing) when
// it is trusted and not revoked, so those CAs only show up under "Anything".
function updateHint() {
  $("#hint").hidden = !((state.showRevoked || state.store === 0) && state.use !== 15);
}

function updateStats() {
  let n = 0;
  let r = 0;
  nodes.forEach((node, i) => {
    if (visible[i]) {
      n++;
      r += node.r;
    }
  });
  $("#stats").textContent = `Showing ${n.toLocaleString("en")} CAs: ${r.toLocaleString("en")} roots, ${(n - r).toLocaleString("en")} intermediates`;
}

let othersExpanded = false;

function renderLegend() {
  const counts = new Map<number, number>();
  nodes.forEach((n, i) => visible[i] && counts.set(n.o, (counts.get(n.o) ?? 0) + 1));
  // Operators without a colour of their own, biggest first. Only those with
  // visible CAs are listed (plus the focused one, so it can be cleared).
  const others = [...ownerSize.keys()]
    .filter((o) => !ownerSlot.has(o) && ((counts.get(o) ?? 0) > 0 || o === state.focusOwner))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || owners[a].localeCompare(owners[b]));
  const otherCount = others.reduce((a, o) => a + (counts.get(o) ?? 0), 0);
  const ownerButton = (o: number, color: string) =>
    `<li><button type="button" data-owner="${o}" aria-pressed="${state.focusOwner === o}">
      <span class="swatch" style="background:${color}"></span>${escapeHtml(owners[o])}
      <span class="count">${(counts.get(o) ?? 0).toLocaleString("en")}</span></button></li>`;

  legend.classList.toggle("filtered", state.focusOwner !== null);
  legend.innerHTML =
    topOwners.map((o, slot) => ownerButton(o, theme.series[slot])).join("") +
    `<li><button type="button" id="legend-others" aria-expanded="${othersExpanded}" aria-controls="legend-others-list">
      <span class="swatch" style="background:${theme.other}"></span>Other operators (${others.length})
      <span class="chevron" aria-hidden="true">${othersExpanded ? "▾" : "▸"}</span>
      <span class="count">${otherCount.toLocaleString("en")}</span></button>
      <ul id="legend-others-list" class="legend-others"${othersExpanded ? "" : " hidden"}>
        ${othersExpanded ? others.map((o) => ownerButton(o, theme.other)).join("") : ""}
      </ul></li>`;
  $("#legend-others").addEventListener("click", () => {
    othersExpanded = !othersExpanded;
    renderLegend();
    $<HTMLButtonElement>("#legend-others").focus();
  });
  legend.querySelectorAll<HTMLButtonElement>("button[data-owner]").forEach((b) =>
    b.addEventListener("click", () => {
      const o = Number(b.dataset.owner);
      state.focusOwner = state.focusOwner === o ? null : o;
      if (state.focusOwner !== null) {
        // Isolating an operator replaces the current selection.
        select(null);
        renderer.getCamera().animate(DEFAULT_CAMERA_STATE, { duration: 500 });
      }
      renderLegend();
      refresh();
    }),
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Search over visible nodes, by CA name or operator. Some operators are better
// known by their brand than by the legal name CCADB uses.
const BRANDS: Record<string, string> = {
  "Internet Security Research Group": "Let's Encrypt",
  "Google Trust Services LLC": "GTS",
  "Amazon Trust Services": "AWS",
};
const searchIndex = nodes.map((n) =>
  [n.l, owners[n.o], owners[n.co], BRANDS[owners[n.o]] ?? "", BRANDS[owners[n.co]] ?? ""].join("\n").toLowerCase(),
);
let activeSuggestion = -1;
let currentMatches: number[] = [];

function updateSuggestions() {
  const q = search.value.trim().toLowerCase();
  currentMatches = [];
  if (q.length >= 2) {
    for (let i = 0; i < nodes.length && currentMatches.length < 200; i++) {
      if (visible[i] && searchIndex[i].includes(q)) currentMatches.push(i);
    }
    currentMatches.sort((a, b) => {
      const pa = nodes[a].l.toLowerCase().startsWith(q) ? 0 : 1;
      const pb = nodes[b].l.toLowerCase().startsWith(q) ? 0 : 1;
      return pa - pb || nodes[b].r - nodes[a].r || nodes[b].d - nodes[a].d;
    });
    currentMatches = currentMatches.slice(0, 12);
  }
  activeSuggestion = currentMatches.length ? 0 : -1;
  suggestions.innerHTML = currentMatches.length
    ? currentMatches
        .map(
          (i, k) =>
            `<li role="option" data-node="${i}" aria-selected="${k === activeSuggestion}">${escapeHtml(nodes[i].l)}<span class="owner">${nodes[i].r ? "Root · " : ""}${escapeHtml(owners[nodes[i].o])}</span></li>`,
        )
        .join("")
    : q.length >= 2
      ? `<li class="muted" aria-disabled="true">No visible CA matches</li>`
      : "";
  suggestions.hidden = q.length < 2;
}

function pickSuggestion(i: number) {
  suggestions.hidden = true;
  search.value = nodes[i].l;
  select(i, true);
}

search.addEventListener("input", updateSuggestions);
search.addEventListener("focus", updateSuggestions);
search.addEventListener("blur", () => setTimeout(() => (suggestions.hidden = true), 150));
search.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!currentMatches.length) return;
    activeSuggestion = (activeSuggestion + (e.key === "ArrowDown" ? 1 : -1) + currentMatches.length) % currentMatches.length;
    suggestions.querySelectorAll("li").forEach((li, k) => li.setAttribute("aria-selected", String(k === activeSuggestion)));
  } else if (e.key === "Enter" && activeSuggestion >= 0) {
    pickSuggestion(currentMatches[activeSuggestion]);
  } else if (e.key === "Escape") {
    suggestions.hidden = true;
  }
});
suggestions.addEventListener("mousedown", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-node]");
  if (li) pickSuggestion(Number(li.dataset.node));
});

countrySelect.addEventListener("change", () => {
  state.country = countrySelect.value;
  applyFilters();
});
$<HTMLSelectElement>("#filter-use").addEventListener("change", (e) => {
  state.use = Number((e.target as HTMLSelectElement).value);
  applyFilters();
});
$<HTMLSelectElement>("#filter-store").addEventListener("change", (e) => {
  state.store = Number((e.target as HTMLSelectElement).value);
  applyFilters();
});
$<HTMLInputElement>("#filter-revoked").addEventListener("change", (e) => {
  state.showRevoked = (e.target as HTMLInputElement).checked;
  applyFilters();
});

renderer.on("clickNode", ({ node }) => select(Number(node)));
renderer.on("clickStage", () => select(null));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.activeElement !== search) select(null);
});

onThemeChange((t) => {
  theme = t;
  renderLegend();
  refresh();
});

$("#footer").innerHTML =
  `Data: <a href="https://www.ccadb.org/resources" target="_blank" rel="noopener">CCADB</a> All Certificate Records, downloaded ${data.meta.dataDate}, ` +
  `licensed under <a href="${import.meta.env.BASE_URL}DATA-LICENSE.txt" target="_blank" rel="noopener">CDLA-Permissive-2.0</a> ` +
  `(${data.meta.certificates.toLocaleString("en")} unexpired CA certificates grouped into ${nodes.length.toLocaleString("en")} keys). ` +
  `Inspired by the ICSI Notary's <a href="https://zeek.org/2012/12/the-tree-of-trust/" target="_blank" rel="noopener">Tree of Trust</a> (2012).`;

applyFilters();
$("#loading").remove();
