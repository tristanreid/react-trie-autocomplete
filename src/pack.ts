/**
 * Packed Radix Trie — compact serialization format for trie-powered autocomplete.
 *
 * Compresses a list of entries (text + score) into a packed string that:
 * - Is 2–3x smaller than raw JSON after gzip
 * - Can be served as a static file, API response, or RSC prop
 * - Hydrates into a searchable RadixTrie on the client
 *
 * ## Format (line-based, three sections separated by "---")
 *
 * ```
 * PTRIE:1:CI                         # Header: magic, version, flags (CI/CS)
 * New York                           # Entry texts, one per line
 * New Orleans
 * ...
 * ---                                # Section separator
 * 0.95,0.9,0.88                      # Scores, comma-separated
 * ---                                # Section separator
 * -|new >1|san >2|los >3             # Node 0 (root): no entries, 3 children
 * 0|york>4| orleans>5| delhi>6       # Node 1: entry #0, 3 children
 * 1,2| francisco>7|diego>8|jose>9    # Node 2: entries #1,#2, 3 children
 * 3                                  # Node 3: entry #3, leaf
 * ```
 *
 * Edge labels in the node section are normalized (lowercase for CI mode).
 * Original-case texts are stored in section 1 for display.
 */

import { RadixTrie, type RadixNode, type RadixEdge } from './radix';
import type { TrieEntry } from './trie';

// ─── Public API ─────────────────────────────────────────────────────

export interface PackOptions {
  /** Precision for score encoding (decimal places). Default 2. */
  scorePrecision?: number;
}

export interface PackStats {
  /** Number of entries packed. */
  entryCount: number;
  /** Number of radix nodes. */
  nodeCount: number;
  /** Raw size of packed string in bytes (UTF-8). */
  packedBytes: number;
  /** Estimated raw JSON size for comparison. */
  rawJsonBytes: number;
  /** Compression ratio (packed / raw). */
  ratio: number;
}

/**
 * Pack entries into a compact radix trie string.
 *
 * @param entries - Array of { text, score? } objects
 * @param options - Packing options
 * @returns The packed trie string
 */
export function packTrie(
  entries: Array<{ text: string; score?: number }>,
  options?: PackOptions,
): string {
  const precision = options?.scorePrecision ?? 2;

  // Build a packing trie (preserves original order for entry indexing)
  const packer = new TriePacker(precision);
  for (let i = 0; i < entries.length; i++) {
    packer.insert(entries[i].text, entries[i].score ?? 0, i);
  }

  return packer.pack(entries);
}

/**
 * Unpack a packed trie string into a searchable RadixTrie.
 *
 * @param packed - The packed trie string from packTrie()
 * @returns A RadixTrie ready for prefix search
 */
export function unpackTrie<T = undefined>(packed: string): RadixTrie<T> {
  const parsed = parse(packed);
  const trie = new RadixTrie<T>({ caseSensitive: parsed.caseSensitive });

  for (const entry of parsed.entries) {
    trie.insert(entry.text, entry.score);
  }

  return trie;
}

/**
 * Get compression stats for a set of entries.
 */
export function packStats(
  entries: Array<{ text: string; score?: number }>,
  options?: PackOptions,
): PackStats {
  const packed = packTrie(entries, options);
  const packedBytes = new TextEncoder().encode(packed).length;
  const rawJson = JSON.stringify(entries);
  const rawJsonBytes = new TextEncoder().encode(rawJson).length;

  // Count nodes by counting lines in node section
  const sections = packed.split('\n---\n');
  const nodeLines = sections[2]?.split('\n').filter((l) => l.length > 0) ?? [];

  return {
    entryCount: entries.length,
    nodeCount: nodeLines.length,
    packedBytes,
    rawJsonBytes,
    ratio: packedBytes / rawJsonBytes,
  };
}

// ─── Packing ────────────────────────────────────────────────────────

interface PackNode {
  children: Map<string, { label: string; node: PackNode }>;
  entryIndices: number[]; // indices into the entries array
}

function createPackNode(): PackNode {
  return { children: new Map(), entryIndices: [] };
}

class TriePacker {
  private root = createPackNode();
  private precision: number;

  constructor(precision: number) {
    this.precision = precision;
  }

  insert(text: string, score: number, entryIndex: number): void {
    const normalized = text.toLowerCase();
    this.insertAt(this.root, normalized, 0, entryIndex);
  }

  private insertAt(node: PackNode, text: string, pos: number, entryIndex: number): void {
    if (pos >= text.length) {
      node.entryIndices.push(entryIndex);
      return;
    }

    const ch = text[pos];
    const edge = node.children.get(ch);

    if (!edge) {
      const leaf = createPackNode();
      leaf.entryIndices.push(entryIndex);
      node.children.set(ch, { label: text.slice(pos), node: leaf });
      return;
    }

    const label = edge.label;
    let j = 0;
    const maxJ = Math.min(label.length, text.length - pos);
    while (j < maxJ && label[j] === text[pos + j]) {
      j++;
    }

    if (j === label.length) {
      this.insertAt(edge.node, text, pos + j, entryIndex);
      return;
    }

    // Split
    const splitNode = createPackNode();
    splitNode.children.set(label[j], { label: label.slice(j), node: edge.node });
    node.children.set(ch, { label: label.slice(0, j), node: splitNode });

    if (pos + j >= text.length) {
      splitNode.entryIndices.push(entryIndex);
    } else {
      const newLeaf = createPackNode();
      newLeaf.entryIndices.push(entryIndex);
      splitNode.children.set(text[pos + j], { label: text.slice(pos + j), node: newLeaf });
    }
  }

  pack(entries: Array<{ text: string; score?: number }>): string {
    const lines: string[] = [];

    // Section 1: Header + entry texts
    lines.push('PTRIE:1:CI');
    for (const entry of entries) {
      lines.push(entry.text);
    }

    // Section separator
    lines.push('---');

    // Section 2: Scores
    const scores = entries.map((e) => (e.score ?? 0).toFixed(this.precision));
    lines.push(scores.join(','));

    // Section separator
    lines.push('---');

    // Section 3: Node table (BFS order)
    const nodeOrder: PackNode[] = [];
    const nodeIndexMap = new Map<PackNode, number>();

    // BFS to assign indices
    const queue: PackNode[] = [this.root];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const idx = nodeOrder.length;
      nodeOrder.push(node);
      nodeIndexMap.set(node, idx);

      // Sort children by first character for deterministic output
      const sortedChildren = [...node.children.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      for (const [, edge] of sortedChildren) {
        queue.push(edge.node);
      }
    }

    // Encode each node
    for (const node of nodeOrder) {
      let line = '';

      // Entry indices
      if (node.entryIndices.length > 0) {
        line += node.entryIndices.join(',');
      } else {
        line += '-';
      }

      // Children
      const sortedChildren = [...node.children.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      );
      for (const [, edge] of sortedChildren) {
        const childIdx = nodeIndexMap.get(edge.node)!;
        line += '|' + escapeLabel(edge.label) + '>' + childIdx.toString(36);
      }

      lines.push(line);
    }

    return lines.join('\n');
  }
}

// ─── Unpacking ──────────────────────────────────────────────────────

interface ParsedTrie {
  version: number;
  caseSensitive: boolean;
  entries: Array<{ text: string; score: number }>;
}

function parse(packed: string): ParsedTrie {
  const sections = packed.split('\n---\n');
  if (sections.length !== 3) {
    throw new Error(`Invalid packed trie: expected 3 sections, got ${sections.length}`);
  }

  // Section 1: Header + texts
  const headerLines = sections[0].split('\n');
  const header = headerLines[0];
  const headerParts = header.split(':');

  if (headerParts[0] !== 'PTRIE') {
    throw new Error(`Invalid packed trie: bad magic "${headerParts[0]}"`);
  }

  const version = parseInt(headerParts[1], 10);
  if (version !== 1) {
    throw new Error(`Unsupported packed trie version: ${version}`);
  }

  const caseSensitive = headerParts[2] === 'CS';
  const texts = headerLines.slice(1);

  // Section 2: Scores
  const scoreStr = sections[1].trim();
  const scores = scoreStr.length > 0 ? scoreStr.split(',').map(Number) : [];

  // Section 3: Nodes
  const nodeLines = sections[2].split('\n').filter((l) => l.length > 0);

  // Parse nodes
  const nodes: Array<{
    entryIndices: number[];
    children: Array<{ label: string; childIndex: number }>;
  }> = [];

  for (const line of nodeLines) {
    const node: { entryIndices: number[]; children: Array<{ label: string; childIndex: number }> } =
      { entryIndices: [], children: [] };

    // Split into segments by unescaped |
    const segments = splitUnescaped(line, '|');

    // First segment is entry indices
    const entryPart = segments[0];
    if (entryPart !== '-') {
      node.entryIndices = entryPart.split(',').map(Number);
    }

    // Remaining segments are children: label>childIndex
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const gtIdx = findUnescaped(seg, '>');
      if (gtIdx === -1) continue;

      const label = unescapeLabel(seg.slice(0, gtIdx));
      const childIndex = parseInt(seg.slice(gtIdx + 1), 36);
      node.children.push({ label, childIndex });
    }

    nodes.push(node);
  }

  // Build entries from texts and scores
  const entries: Array<{ text: string; score: number }> = [];
  for (let i = 0; i < texts.length; i++) {
    entries.push({
      text: texts[i],
      score: i < scores.length ? scores[i] : 0,
    });
  }

  return { version, caseSensitive, entries };
}

// ─── Escaping ───────────────────────────────────────────────────────

/** Escape special characters in edge labels: |, >, \, newline */
function escapeLabel(label: string): string {
  let result = '';
  for (const ch of label) {
    switch (ch) {
      case '|':
        result += '\\|';
        break;
      case '>':
        result += '\\>';
        break;
      case '\\':
        result += '\\\\';
        break;
      case '\n':
        result += '\\n';
        break;
      default:
        result += ch;
    }
  }
  return result;
}

/** Unescape a label string. */
function unescapeLabel(label: string): string {
  let result = '';
  let i = 0;
  while (i < label.length) {
    if (label[i] === '\\' && i + 1 < label.length) {
      const next = label[i + 1];
      switch (next) {
        case '|':
        case '>':
        case '\\':
          result += next;
          break;
        case 'n':
          result += '\n';
          break;
        default:
          result += '\\' + next;
      }
      i += 2;
    } else {
      result += label[i];
      i++;
    }
  }
  return result;
}

/** Split a string by an unescaped delimiter. */
function splitUnescaped(str: string, delim: string): string[] {
  const parts: string[] = [];
  let current = '';
  let i = 0;

  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) {
      current += str[i] + str[i + 1];
      i += 2;
    } else if (str[i] === delim) {
      parts.push(current);
      current = '';
      i++;
    } else {
      current += str[i];
      i++;
    }
  }
  parts.push(current);
  return parts;
}

/** Find the index of an unescaped character. */
function findUnescaped(str: string, ch: string): number {
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) {
      i += 2;
    } else if (str[i] === ch) {
      return i;
    } else {
      i++;
    }
  }
  return -1;
}
