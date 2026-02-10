/**
 * Packed Radix Trie — compact serialization format for trie-powered autocomplete.
 *
 * Compresses a list of entries (text + score) into a packed string that:
 * - Is 2–3x smaller than equivalent JSON
 * - Gzips even better than JSON (structured format = more redundancy for gzip)
 * - Can be served as a static file, API response, or RSC prop
 * - Hydrates into a searchable RadixTrie on the client
 *
 * ## Format v2 (line-based)
 *
 * The packed trie has two sections separated by "---":
 *
 * ```
 * PTRIE:2:CI:S                      # Header: magic, version, flags, features
 * 0.95,0.90,0.85                    # Score table (DFS order) — omitted if no scores
 * ---
 * -|New >1|San >2|Los >3            # Node 0 (root): no entry, 3 children
 * !| York>4| Orleans>5| Delhi>6     # Node 1: terminal (!), 3 children
 * !| Francisco>7|Diego>8|Jose>9     # Node 2: terminal (!), 3 children
 * !                                 # Node 3: terminal, leaf
 * ```
 *
 * Key design: edge labels are stored in ORIGINAL CASE. Texts are reconstructed
 * by concatenating edge labels from root to terminal nodes. No separate text
 * section needed — the trie structure IS the data.
 */

import { RadixTrie } from './radix';
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
  const packer = new TriePacker(precision);

  for (let i = 0; i < entries.length; i++) {
    packer.insert(entries[i].text, entries[i].score ?? 0);
  }

  return packer.pack();
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

  const sections = packed.split('\n---\n');
  const nodeSection = sections[sections.length - 1];
  const nodeLines = nodeSection?.split('\n').filter((l) => l.length > 0) ?? [];

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
  /** Children keyed by normalized first character. */
  children: Map<string, { label: string; node: PackNode }>;
  /** Whether a word terminates at this node. */
  isTerminal: boolean;
  /** Score for the entry at this node (if terminal). */
  score: number;
}

function createPackNode(): PackNode {
  return { children: new Map(), isTerminal: false, score: 0 };
}

class TriePacker {
  private root = createPackNode();
  private precision: number;

  constructor(precision: number) {
    this.precision = precision;
  }

  /**
   * Insert a word. Edge labels preserve the original case from the
   * FIRST insertion that creates each edge. Lookup uses normalized
   * comparison so "New York" and "new york" share structure.
   */
  insert(text: string, score: number): void {
    this.insertAt(this.root, text, text.toLowerCase(), 0, score);
  }

  private insertAt(
    node: PackNode,
    original: string,
    normalized: string,
    pos: number,
    score: number,
  ): void {
    if (pos >= normalized.length) {
      node.isTerminal = true;
      node.score = score;
      return;
    }

    const ch = normalized[pos]; // normalized char for map key
    const edge = node.children.get(ch);

    if (!edge) {
      // No matching edge — create leaf with original-case label
      const leaf = createPackNode();
      leaf.isTerminal = true;
      leaf.score = score;
      node.children.set(ch, { label: original.slice(pos), node: leaf });
      return;
    }

    // Compare normalized versions to find common prefix
    const label = edge.label;
    const labelNorm = label.toLowerCase();
    let j = 0;
    const maxJ = Math.min(labelNorm.length, normalized.length - pos);
    while (j < maxJ && labelNorm[j] === normalized[pos + j]) {
      j++;
    }

    if (j === labelNorm.length) {
      // Full edge match — continue inserting
      this.insertAt(edge.node, original, normalized, pos + j, score);
      return;
    }

    // Partial match — split the edge
    const splitNode = createPackNode();

    // Reattach old child with the suffix of the old label
    const oldSuffix = label.slice(j);
    splitNode.children.set(oldSuffix[0].toLowerCase(), {
      label: oldSuffix,
      node: edge.node,
    });

    // Update parent edge to point to splitNode with the common prefix
    node.children.set(ch, { label: label.slice(0, j), node: splitNode });

    if (pos + j >= normalized.length) {
      // New word ends at the split point
      splitNode.isTerminal = true;
      splitNode.score = score;
    } else {
      // New word continues — create new leaf with original-case suffix
      const newLeaf = createPackNode();
      newLeaf.isTerminal = true;
      newLeaf.score = score;
      const newSuffix = original.slice(pos + j);
      splitNode.children.set(newSuffix[0].toLowerCase(), {
        label: newSuffix,
        node: newLeaf,
      });
    }
  }

  pack(): string {
    const lines: string[] = [];

    // Collect scores in DFS order to check if we need them
    const scores: number[] = [];
    const collectScores = (node: PackNode) => {
      if (node.isTerminal) scores.push(node.score);
      const sorted = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [, edge] of sorted) collectScores(edge.node);
    };
    collectScores(this.root);

    const hasScores = scores.some((s) => s !== 0);

    // Header
    const features = hasScores ? ':S' : '';
    lines.push(`PTRIE:2:CI${features}`);

    // Score table (only if needed)
    if (hasScores) {
      lines.push(scores.map((s) => s.toFixed(this.precision)).join(','));
    }

    // Section separator
    lines.push('---');

    // Node table (BFS order)
    const nodeOrder: PackNode[] = [];
    const nodeIndexMap = new Map<PackNode, number>();

    const queue: PackNode[] = [this.root];
    while (queue.length > 0) {
      const node = queue.shift()!;
      nodeIndexMap.set(node, nodeOrder.length);
      nodeOrder.push(node);

      const sorted = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [, edge] of sorted) {
        queue.push(edge.node);
      }
    }

    // Encode each node
    for (const node of nodeOrder) {
      let line = node.isTerminal ? '!' : '-';

      const sorted = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      for (const [, edge] of sorted) {
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
  if (sections.length < 2) {
    throw new Error(`Invalid packed trie: expected at least 2 sections, got ${sections.length}`);
  }

  // Parse header section (may include score line)
  const headerSection = sections[0];
  const headerLines = headerSection.split('\n');
  const header = headerLines[0];
  const headerParts = header.split(':');

  if (headerParts[0] !== 'PTRIE') {
    throw new Error(`Invalid packed trie: bad magic "${headerParts[0]}"`);
  }

  const version = parseInt(headerParts[1], 10);
  if (version !== 1 && version !== 2) {
    throw new Error(`Unsupported packed trie version: ${version}`);
  }

  const caseSensitive = headerParts[2] === 'CS';
  const hasScores = headerParts.includes('S');

  // v1: 3 sections (header+texts, scores, nodes)
  // v2: 2 sections (header+optional_scores, nodes)
  if (version === 1) {
    return parseV1(sections, caseSensitive);
  }

  // Parse scores (v2: second line of header section, if present)
  let scores: number[] = [];
  if (hasScores && headerLines.length > 1) {
    const scoreStr = headerLines[1].trim();
    if (scoreStr.length > 0) {
      scores = scoreStr.split(',').map(Number);
    }
  }

  // Node section (last section)
  const nodeSection = sections[sections.length - 1];
  const nodeLines = nodeSection.split('\n').filter((l) => l.length > 0);

  // Parse nodes
  interface ParsedNode {
    isTerminal: boolean;
    children: Array<{ label: string; childIndex: number }>;
  }

  const nodes: ParsedNode[] = [];
  for (const line of nodeLines) {
    const segments = splitUnescaped(line, '|');
    const marker = segments[0];
    const isTerminal = marker === '!';

    const children: Array<{ label: string; childIndex: number }> = [];
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const gtIdx = findUnescaped(seg, '>');
      if (gtIdx === -1) continue;
      const label = unescapeLabel(seg.slice(0, gtIdx));
      const childIndex = parseInt(seg.slice(gtIdx + 1), 36);
      children.push({ label, childIndex });
    }

    nodes.push({ isTerminal, children });
  }

  // Reconstruct entries by DFS traversal (collect texts from edge labels)
  const entries: Array<{ text: string; score: number }> = [];
  let scoreIdx = 0;

  const dfs = (nodeIdx: number, pathParts: string[]) => {
    const node = nodes[nodeIdx];
    if (node.isTerminal) {
      const text = pathParts.join('');
      const score = scoreIdx < scores.length ? scores[scoreIdx] : 0;
      entries.push({ text, score });
      scoreIdx++;
    }
    for (const child of node.children) {
      pathParts.push(child.label);
      dfs(child.childIndex, pathParts);
      pathParts.pop();
    }
  };

  if (nodes.length > 0) {
    dfs(0, []);
  }

  return { version, caseSensitive, entries };
}

/** Parse v1 format (backward compatibility). */
function parseV1(sections: string[], caseSensitive: boolean): ParsedTrie {
  if (sections.length !== 3) {
    throw new Error(`Invalid v1 packed trie: expected 3 sections, got ${sections.length}`);
  }

  const headerLines = sections[0].split('\n');
  const texts = headerLines.slice(1);

  const scoreStr = sections[1].trim();
  const scores = scoreStr.length > 0 ? scoreStr.split(',').map(Number) : [];

  const entries: Array<{ text: string; score: number }> = [];
  for (let i = 0; i < texts.length; i++) {
    entries.push({
      text: texts[i],
      score: i < scores.length ? scores[i] : 0,
    });
  }

  return { version: 1, caseSensitive, entries };
}

// ─── Escaping ───────────────────────────────────────────────────────

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
