/**
 * RadixTrie — a compressed prefix trie (Patricia trie) for autocomplete.
 *
 * Unlike a standard trie where each edge is a single character, a radix trie
 * merges chains of single-child nodes into edges with multi-character labels.
 * This dramatically reduces node count (typically 60–80% fewer nodes) and
 * makes serialization far more compact.
 *
 * Example: inserting "car", "card", "cart" produces:
 *   root --"car"--> node (entry: "car")
 *                     |--"d"--> leaf (entry: "card")
 *                     |--"t"--> leaf (entry: "cart")
 *
 * Instead of the standard trie's 5 nodes (c, a, r, d, t), we have 3.
 */

import type { TrieEntry } from './trie';

// ─── Types ──────────────────────────────────────────────────────────

export interface RadixEdge<T> {
  /** The multi-character edge label. */
  label: string;
  /** The child node at the end of this edge. */
  node: RadixNode<T>;
}

export interface RadixNode<T> {
  /**
   * Children keyed by the first character of the edge label.
   * This allows O(1) lookup when navigating the trie.
   */
  children: Map<string, RadixEdge<T>>;
  /** Entries stored at this node (non-empty if a word ends here). */
  entries: TrieEntry<T>[];
}

/** Stats about the trie, useful for compression reporting. */
export interface RadixTrieStats {
  /** Total number of inserted entries. */
  entryCount: number;
  /** Total number of nodes in the radix trie. */
  nodeCount: number;
  /** Total characters across all edge labels. */
  totalEdgeChars: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

function createRadixNode<T>(): RadixNode<T> {
  return { children: new Map(), entries: [] };
}

// ─── RadixTrie ──────────────────────────────────────────────────────

export class RadixTrie<T = undefined> {
  readonly root: RadixNode<T> = createRadixNode();
  private _size = 0;
  private _nodeCount = 1; // root counts as 1
  private caseSensitive: boolean;

  constructor(options?: { caseSensitive?: boolean }) {
    this.caseSensitive = options?.caseSensitive ?? false;
  }

  /** Insert a word with optional score and data. */
  insert(text: string, score = 0, data?: T): void {
    const entry: TrieEntry<T> = { text, score, data };
    const normalized = this.normalize(text);
    this.insertAt(this.root, normalized, 0, entry);
    this._size++;
  }

  private insertAt(node: RadixNode<T>, text: string, pos: number, entry: TrieEntry<T>): void {
    // Text exhausted — store entry at this node
    if (pos >= text.length) {
      node.entries.push(entry);
      return;
    }

    const ch = text[pos];
    const edge = node.children.get(ch);

    if (!edge) {
      // No matching edge — create a new leaf with the remaining text
      const leaf = createRadixNode<T>();
      leaf.entries.push(entry);
      node.children.set(ch, { label: text.slice(pos), node: leaf });
      this._nodeCount++;
      return;
    }

    // Find common prefix length between remaining text and edge label
    const label = edge.label;
    let j = 0;
    const maxJ = Math.min(label.length, text.length - pos);
    while (j < maxJ && label[j] === text[pos + j]) {
      j++;
    }

    if (j === label.length) {
      // Full edge match — continue inserting below the child
      this.insertAt(edge.node, text, pos + j, entry);
      return;
    }

    // Partial match — split the edge at position j
    // Before: node --label--> child
    // After:  node --label[:j]--> splitNode --label[j:]--> child
    //                                        --text[pos+j:]--> newLeaf (if text continues)
    const splitNode = createRadixNode<T>();
    this._nodeCount++;

    // Reattach the old child under splitNode
    splitNode.children.set(label[j], { label: label.slice(j), node: edge.node });

    // Replace the edge from parent to point to splitNode
    node.children.set(ch, { label: label.slice(0, j), node: splitNode });

    if (pos + j >= text.length) {
      // Insert text ends exactly at the split point
      splitNode.entries.push(entry);
    } else {
      // Text continues past the split — create a new leaf
      const newLeaf = createRadixNode<T>();
      newLeaf.entries.push(entry);
      splitNode.children.set(text[pos + j], { label: text.slice(pos + j), node: newLeaf });
      this._nodeCount++;
    }
  }

  /**
   * Find all entries whose text starts with the given prefix.
   * Results are sorted by score descending, then alphabetically.
   */
  search(prefix: string, limit = 10): TrieEntry<T>[] {
    const normalized = this.normalize(prefix);
    const node = this.findPrefixNode(normalized);
    if (!node) return [];

    const results: TrieEntry<T>[] = [];
    this.collectAll(node, results);

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.text.localeCompare(b.text);
    });

    return results.slice(0, limit);
  }

  /** Navigate to the node representing the given prefix, or null if no match. */
  private findPrefixNode(text: string): RadixNode<T> | null {
    let node = this.root;
    let pos = 0;

    while (pos < text.length) {
      const ch = text[pos];
      const edge = node.children.get(ch);
      if (!edge) return null;

      const label = edge.label;
      const remaining = text.length - pos;

      if (remaining <= label.length) {
        // Prefix may end inside this edge — check that the prefix matches
        for (let j = 0; j < remaining; j++) {
          if (label[j] !== text[pos + j]) return null;
        }
        // Prefix exhausted — everything below this child matches
        return edge.node;
      }

      // Remaining text is longer than the edge label — full match required
      for (let j = 0; j < label.length; j++) {
        if (label[j] !== text[pos + j]) return null;
      }

      node = edge.node;
      pos += label.length;
    }

    return node;
  }

  /** Collect all entries in the subtree rooted at the given node. */
  private collectAll(node: RadixNode<T>, results: TrieEntry<T>[]): void {
    results.push(...node.entries);
    for (const edge of node.children.values()) {
      this.collectAll(edge.node, results);
    }
  }

  /** Total number of inserted entries. */
  get size(): number {
    return this._size;
  }

  /** Total number of nodes (including root). */
  get nodeCount(): number {
    return this._nodeCount;
  }

  /** Get compression stats. */
  get stats(): RadixTrieStats {
    let totalEdgeChars = 0;
    const walk = (node: RadixNode<T>) => {
      for (const edge of node.children.values()) {
        totalEdgeChars += edge.label.length;
        walk(edge.node);
      }
    };
    walk(this.root);

    return {
      entryCount: this._size,
      nodeCount: this._nodeCount,
      totalEdgeChars,
    };
  }

  private normalize(text: string): string {
    return this.caseSensitive ? text : text.toLowerCase();
  }

  /** Build from a simple list of strings (all score 0). */
  static fromStrings(strings: string[], options?: { caseSensitive?: boolean }): RadixTrie {
    const trie = new RadixTrie(options);
    for (const s of strings) trie.insert(s);
    return trie;
  }

  /** Build from entries with scores. */
  static fromEntries<T>(
    entries: Array<{ text: string; score?: number; data?: T }>,
    options?: { caseSensitive?: boolean },
  ): RadixTrie<T> {
    const trie = new RadixTrie<T>(options);
    for (const e of entries) trie.insert(e.text, e.score ?? 0, e.data);
    return trie;
  }
}
