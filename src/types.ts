// Shape of public/graph.json. Shared by scripts/build-graph.ts and the frontend.
// Keys are short on purpose: the file holds several thousand nodes.

/** Bitmask of what a CA is capable of issuing for. */
export const USE = { TLS: 1, SMIME: 2, CODE: 4, OTHER: 8 } as const;

/** Bitmask of the root programs that trust a CA (directly or through a parent). */
export const STORE = { MOZILLA: 1, CHROME: 2, APPLE: 4, MICROSOFT: 8 } as const;

export const STORE_NAMES = ["Mozilla", "Chrome", "Apple", "Microsoft"] as const;

/** One CCADB certificate record. Several certificates can share a key (one node). */
export interface CertRecord {
  /** Certificate name as listed in CCADB */
  n: string;
  /** SHA-256 fingerprint (uppercase hex) */
  h: string;
  /** Parent certificate SHA-256, empty for roots */
  p: string;
  /** Parent certificate name, empty for roots */
  pn: string;
  /** Valid from / to, YYYY-MM-DD */
  f: string;
  t: string;
  /** Revocation status: "", "Not Revoked", "Revoked", "Parent Cert Revoked" */
  rv: string;
  /** Technically constrained */
  tc: boolean;
  /** Status in [Mozilla, Chrome, Apple, Microsoft], as written by CCADB */
  st: [string, string, string, string];
}

export interface GraphNode {
  /** Node key: Subject Key Identifier (base64) or "sha:<fingerprint>" when missing */
  id: string;
  /** Display label (most common certificate name for this key) */
  l: string;
  /** Index into owners[]: the operator (Subordinate CA Owner, else CA Owner) */
  o: number;
  /** Index into owners[]: the CA Owner that answers to the root programs */
  co: number;
  /** Operator's country (CCADB reports it per CA Owner), normalised */
  cc: string;
  /** 1 if at least one certificate for this key is a root */
  r: 0 | 1;
  /** Layout position */
  x: number;
  y: number;
  /** Number of CA keys below this one (through non-revoked certificates) */
  d: number;
  /** USE bitmask */
  u: number;
  /** STORE bitmask */
  s: number;
  /** 1 if every certificate for this key is revoked */
  rv: 0 | 1;
  /** Certificates for this key */
  c: CertRecord[];
}

/** [source node index (issuer), target node index (subject), 1 if every certificate on this link is revoked] */
export type GraphEdge = [number, number, 0 | 1];

export interface GraphData {
  meta: {
    source: string;
    sourceUrl: string;
    /** Date the CSV was downloaded, YYYY-MM-DD */
    dataDate: string;
    builtAt: string;
    certificates: number;
    roots: number;
    intermediates: number;
  };
  owners: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}
