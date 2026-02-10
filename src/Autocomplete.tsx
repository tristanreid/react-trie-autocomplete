/**
 * TrieAutocomplete — a fast, accessible autocomplete React component
 * backed by a trie (prefix tree).
 *
 * Features:
 * - Instant prefix search (no network round-trip for suggestions)
 * - Keyboard navigation (arrow keys, Enter, Escape)
 * - Accessible (ARIA combobox pattern)
 * - Customizable rendering (suggestion items, highlight matching prefix)
 * - Lightweight — trie is built once, searches are O(prefix length)
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
  type CSSProperties,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { AutocompleteTrie, type TrieEntry } from './trie';
import { unpackTrie } from './pack';
import type { RadixTrie } from './radix';

// ─── Types ──────────────────────────────────────────────────────────

/** Stats emitted when a packed trie is loaded. */
export interface TrieLoadStats {
  /** Number of entries in the trie. */
  entries: number;
  /** Number of radix nodes. */
  nodes: number;
  /** Size of the packed data in bytes. */
  bytes: number;
}

/** A searchable trie interface (both AutocompleteTrie and RadixTrie satisfy this). */
interface Searchable<T> {
  search(prefix: string, limit?: number): TrieEntry<T>[];
  readonly size: number;
}

export interface TrieAutocompleteProps<T = undefined> {
  /**
   * Data source. Provide ONE of:
   * - `items`: array of strings (simplest)
   * - `entries`: array of { text, score?, data? } objects
   * - `trie`: a pre-built AutocompleteTrie instance
   * - `src`: URL to a packed trie file (fetched and hydrated)
   * - `packed`: a pre-packed trie string (for SSR / React Server Components)
   */
  items?: string[];
  entries?: Array<{ text: string; score?: number; data?: T }>;
  trie?: AutocompleteTrie<T>;
  /** URL to fetch a packed trie from. Triggers async fetch-and-hydrate. */
  src?: string;
  /** Pre-packed trie string (from packTrie()). For SSR / React Server Components. */
  packed?: string;

  /** Controlled value. */
  value?: string;
  /** Default value (uncontrolled). */
  defaultValue?: string;
  /** Called when the input value changes. */
  onChange?: (value: string) => void;
  /** Called when a suggestion is selected. */
  onSelect?: (entry: TrieEntry<T>) => void;

  /** Placeholder text. Default "Search..." */
  placeholder?: string;
  /** Maximum suggestions to show. Default 8. */
  maxSuggestions?: number;
  /** Minimum characters before showing suggestions. Default 1. */
  minChars?: number;

  /** Custom suggestion renderer. */
  renderSuggestion?: (entry: TrieEntry<T>, query: string, isHighlighted: boolean) => ReactNode;

  /** Custom loading indicator (shown while fetching packed trie from `src`). */
  loading?: ReactNode;
  /** Called when a packed trie (from `src` or `packed`) finishes loading. */
  onLoad?: (stats: TrieLoadStats) => void;

  /** CSS class for the container. */
  className?: string;
  /** CSS class for the input. */
  inputClassName?: string;
  /** CSS class for the dropdown. */
  dropdownClassName?: string;
  /** Inline styles for the container. */
  style?: CSSProperties;

  /** Whether the input is disabled. */
  disabled?: boolean;
  /** Autofocus on mount. */
  autoFocus?: boolean;
  /** ID for the input element (for labels). */
  id?: string;
}

// ─── Default styles ─────────────────────────────────────────────────

const defaultStyles = {
  container: {
    position: 'relative' as const,
    width: '100%',
  },
  input: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    fontSize: '1rem',
    border: '1.5px solid #d0d8e4',
    borderRadius: '6px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '4px',
    background: '#fff',
    border: '1.5px solid #d0d8e4',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    zIndex: 1000,
    maxHeight: '300px',
    overflowY: 'auto' as const,
    listStyle: 'none',
    padding: '4px 0',
    margin: 0,
  },
  suggestion: {
    padding: '0.5rem 0.75rem',
    cursor: 'pointer',
    fontSize: '0.95rem',
    transition: 'background 0.1s',
  },
  suggestionHighlighted: {
    background: '#f0f4f8',
  },
  matchBold: {
    fontWeight: 700 as const,
  },
  noMatch: {
    padding: '0.5rem 0.75rem',
    color: '#8899aa',
    fontStyle: 'italic' as const,
    fontSize: '0.9rem',
  },
};

// ─── Component ──────────────────────────────────────────────────────

export function TrieAutocomplete<T = undefined>(props: TrieAutocompleteProps<T>) {
  const {
    items,
    entries,
    trie: externalTrie,
    src,
    packed,
    value: controlledValue,
    defaultValue = '',
    onChange,
    onSelect,
    placeholder = 'Search...',
    maxSuggestions = 8,
    minChars = 1,
    renderSuggestion,
    loading: loadingIndicator,
    onLoad,
    className,
    inputClassName,
    dropdownClassName,
    style,
    disabled = false,
    autoFocus = false,
    id,
  } = props;

  // ─── Packed trie from `packed` prop (synchronous) ───
  const packedTrie = useMemo(() => {
    if (!packed) return null;
    return unpackTrie<T>(packed);
  }, [packed]);

  // ─── Packed trie from `src` prop (async fetch) ───
  const [fetchedTrie, setFetchedTrie] = useState<RadixTrie<T> | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!src) {
      setFetchedTrie(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch trie: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        const trie = unpackTrie<T>(text);
        setFetchedTrie(trie);
        onLoad?.({
          entries: trie.size,
          nodes: trie.nodeCount,
          bytes: new TextEncoder().encode(text).length,
        });
      })
      .catch((err) => {
        if (!cancelled) console.error('TrieAutocomplete: failed to load packed trie', err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify onLoad for synchronous packed prop
  useEffect(() => {
    if (packedTrie && packed) {
      onLoad?.({
        entries: packedTrie.size,
        nodes: packedTrie.nodeCount,
        bytes: new TextEncoder().encode(packed).length,
      });
    }
  }, [packedTrie]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build trie from data — priority: src > packed > trie > entries > items
  const trie: Searchable<T> = useMemo(() => {
    if (fetchedTrie) return fetchedTrie;
    if (packedTrie) return packedTrie;
    if (externalTrie) return externalTrie;
    if (entries) return AutocompleteTrie.fromEntries<T>(entries);
    if (items) return AutocompleteTrie.fromStrings(items) as unknown as Searchable<T>;
    return new AutocompleteTrie<T>();
  }, [fetchedTrie, packedTrie, externalTrie, entries, items]);

  // State
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const inputValue = isControlled ? controlledValue : internalValue;

  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [suggestions, setSuggestions] = useState<TrieEntry<T>[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const listId = `trie-autocomplete-list-${id || 'default'}`;

  // Update suggestions when value changes
  useEffect(() => {
    if (inputValue.length >= minChars) {
      const results = trie.search(inputValue, maxSuggestions);
      setSuggestions(results);
      setHighlightIndex(-1);
    } else {
      setSuggestions([]);
    }
  }, [inputValue, trie, maxSuggestions, minChars]);

  // Handlers
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (!isControlled) setInternalValue(val);
      onChange?.(val);
      setIsOpen(true);
    },
    [isControlled, onChange],
  );

  const selectEntry = useCallback(
    (entry: TrieEntry<T>) => {
      if (!isControlled) setInternalValue(entry.text);
      onChange?.(entry.text);
      onSelect?.(entry);
      setIsOpen(false);
      setHighlightIndex(-1);
    },
    [isControlled, onChange, onSelect],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || suggestions.length === 0) {
        if (e.key === 'ArrowDown' && suggestions.length > 0) {
          setIsOpen(true);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1,
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
            selectEntry(suggestions[highlightIndex]);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          setHighlightIndex(-1);
          break;
      }
    },
    [isOpen, suggestions, highlightIndex, selectEntry],
  );

  const handleFocus = useCallback(() => {
    if (inputValue.length >= minChars && suggestions.length > 0) {
      setIsOpen(true);
    }
  }, [inputValue, minChars, suggestions]);

  const handleBlur = useCallback(() => {
    // Delay to allow click on suggestion to register
    setTimeout(() => setIsOpen(false), 150);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const items = listRef.current.children;
      if (items[highlightIndex]) {
        (items[highlightIndex] as HTMLElement).scrollIntoView({
          block: 'nearest',
        });
      }
    }
  }, [highlightIndex]);

  // Default suggestion renderer: bold the matching prefix
  const defaultRenderSuggestion = (
    entry: TrieEntry<T>,
    query: string,
    isHighlighted: boolean,
  ): ReactNode => {
    const text = entry.text;
    const lower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    const matchIdx = lower.indexOf(queryLower);

    return (
      <li
        key={entry.text}
        role="option"
        aria-selected={isHighlighted}
        style={{
          ...defaultStyles.suggestion,
          ...(isHighlighted ? defaultStyles.suggestionHighlighted : {}),
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          selectEntry(entry);
        }}
        onMouseEnter={() => setHighlightIndex(suggestions.indexOf(entry))}
      >
        {matchIdx >= 0 ? (
          <>
            {text.slice(0, matchIdx)}
            <span style={defaultStyles.matchBold}>
              {text.slice(matchIdx, matchIdx + query.length)}
            </span>
            {text.slice(matchIdx + query.length)}
          </>
        ) : (
          text
        )}
        {entry.score > 0 && (
          <span style={{ float: 'right', color: '#8899aa', fontSize: '0.8rem' }}>
            {entry.score.toFixed(1)}
          </span>
        )}
      </li>
    );
  };

  const render = renderSuggestion ?? defaultRenderSuggestion;
  const showDropdown = isOpen && inputValue.length >= minChars;

  // Show loading indicator while fetching from src
  if (isLoading && loadingIndicator) {
    return (
      <div className={className} style={{ ...defaultStyles.container, ...style }}>
        {loadingIndicator}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ ...defaultStyles.container, ...style }}
    >
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showDropdown && suggestions.length > 0}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={
          highlightIndex >= 0 ? `${listId}-${highlightIndex}` : undefined
        }
        className={inputClassName}
        style={inputClassName ? undefined : defaultStyles.input}
        value={inputValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
      />

      {showDropdown && suggestions.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className={dropdownClassName}
          style={dropdownClassName ? undefined : defaultStyles.dropdown}
        >
          {suggestions.map((entry, i) =>
            render(entry, inputValue, i === highlightIndex),
          )}
        </ul>
      )}
    </div>
  );
}
