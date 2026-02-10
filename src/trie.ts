/**
 * Lightweight prefix trie for autocomplete suggestions.
 *
 * Supports:
 * - Prefix search: find all words starting with a given prefix
 * - Ranked results: each word has an optional score for ordering
 * - Case-insensitive matching
 */

export interface TrieEntry<T = undefined> {
  /** The complete word/phrase */
  text: string;
  /** Optional score for ranking (higher = better). Default 0. */
  score: number;
  /** Optional associated data */
  data?: T;
}

interface TrieNode<T> {
  children: Map<string, TrieNode<T>>;
  entries: TrieEntry<T>[];
}

function createNode<T>(): TrieNode<T> {
  return { children: new Map(), entries: [] };
}

export class AutocompleteTrie<T = undefined> {
  private root = createNode<T>();
  private _size = 0;
  private caseSensitive: boolean;

  constructor(options?: { caseSensitive?: boolean }) {
    this.caseSensitive = options?.caseSensitive ?? false;
  }

  /** Insert a word with optional score and data. */
  insert(text: string, score = 0, data?: T): void {
    const entry: TrieEntry<T> = { text, score, data };
    const normalized = this.normalize(text);
    let node = this.root;

    for (const char of normalized) {
      if (!node.children.has(char)) {
        node.children.set(char, createNode<T>());
      }
      node = node.children.get(char)!;
    }
    node.entries.push(entry);
    this._size++;
  }

  /**
   * Find all entries whose text starts with the given prefix.
   * Results are sorted by score descending, then alphabetically.
   */
  search(prefix: string, limit = 10): TrieEntry<T>[] {
    const normalized = this.normalize(prefix);
    let node = this.root;

    for (const char of normalized) {
      if (!node.children.has(char)) return [];
      node = node.children.get(char)!;
    }

    // Collect all entries in the subtree
    const results: TrieEntry<T>[] = [];
    const collect = (n: TrieNode<T>) => {
      results.push(...n.entries);
      for (const child of n.children.values()) collect(child);
    };
    collect(node);

    // Sort by score descending, then alphabetically
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.text.localeCompare(b.text);
    });

    return results.slice(0, limit);
  }

  get size(): number {
    return this._size;
  }

  private normalize(text: string): string {
    return this.caseSensitive ? text : text.toLowerCase();
  }

  /** Build from a simple list of strings (all score 0). */
  static fromStrings(strings: string[], options?: { caseSensitive?: boolean }): AutocompleteTrie {
    const trie = new AutocompleteTrie(options);
    for (const s of strings) trie.insert(s);
    return trie;
  }

  /** Build from entries with scores. */
  static fromEntries<T>(
    entries: Array<{ text: string; score?: number; data?: T }>,
    options?: { caseSensitive?: boolean },
  ): AutocompleteTrie<T> {
    const trie = new AutocompleteTrie<T>(options);
    for (const e of entries) trie.insert(e.text, e.score ?? 0, e.data);
    return trie;
  }
}
