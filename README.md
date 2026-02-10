# @tristanreid/react-trie-autocomplete

A fast, accessible autocomplete React component powered by a trie (prefix tree). Suggestions are instant — no network round-trip, no debouncing, just a trie lookup on every keystroke.

## Installation

```bash
npm install @tristanreid/react-trie-autocomplete
```

## Quick Start

```tsx
import { TrieAutocomplete } from '@tristanreid/react-trie-autocomplete';

function App() {
  return (
    <TrieAutocomplete
      items={['New York', 'New Orleans', 'New Delhi', 'Newark', 'Newport']}
      placeholder="Search cities..."
      onSelect={(entry) => console.log('Selected:', entry.text)}
    />
  );
}
```

Type "New" and all five cities appear instantly. Type "New Y" and only "New York" remains.

## Features

### Three ways to provide data

```tsx
// 1. Simple string array
<TrieAutocomplete items={['cat', 'car', 'card']} />

// 2. Entries with scores and data
<TrieAutocomplete
  entries={[
    { text: 'Python', score: 0.95, data: { id: 1 } },
    { text: 'JavaScript', score: 0.90, data: { id: 2 } },
    { text: 'TypeScript', score: 0.85, data: { id: 3 } },
  ]}
/>

// 3. Pre-built trie (for large datasets or sharing across components)
import { AutocompleteTrie } from '@tristanreid/react-trie-autocomplete';

const trie = AutocompleteTrie.fromStrings(hugeWordList);
<TrieAutocomplete trie={trie} />
```

### Keyboard navigation

- **Arrow Down/Up**: navigate suggestions
- **Enter**: select highlighted suggestion
- **Escape**: close dropdown

### Accessible

Implements the WAI-ARIA combobox pattern with `role="combobox"`, `aria-expanded`, `aria-autocomplete="list"`, and `aria-activedescendant`.

### Customizable rendering

```tsx
<TrieAutocomplete
  items={cities}
  renderSuggestion={(entry, query, isHighlighted) => (
    <li
      key={entry.text}
      style={{
        padding: '8px',
        background: isHighlighted ? '#eef' : 'white',
      }}
    >
      🏙️ {entry.text}
    </li>
  )}
/>
```

### Controlled and uncontrolled

```tsx
// Uncontrolled (manages its own state)
<TrieAutocomplete items={items} onSelect={handleSelect} />

// Controlled
const [value, setValue] = useState('');
<TrieAutocomplete
  items={items}
  value={value}
  onChange={setValue}
  onSelect={(entry) => setValue(entry.text)}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `string[]` | — | Simple string data source |
| `entries` | `Array<{text, score?, data?}>` | — | Scored data source |
| `trie` | `AutocompleteTrie` | — | Pre-built trie |
| `value` | `string` | — | Controlled input value |
| `defaultValue` | `string` | `''` | Initial value (uncontrolled) |
| `onChange` | `(value: string) => void` | — | Input change handler |
| `onSelect` | `(entry: TrieEntry) => void` | — | Selection handler |
| `placeholder` | `string` | `'Search...'` | Input placeholder |
| `maxSuggestions` | `number` | `8` | Max dropdown items |
| `minChars` | `number` | `1` | Min chars before searching |
| `renderSuggestion` | `function` | — | Custom suggestion renderer |
| `className` | `string` | — | Container CSS class |
| `inputClassName` | `string` | — | Input CSS class |
| `dropdownClassName` | `string` | — | Dropdown CSS class |
| `style` | `CSSProperties` | — | Container inline styles |
| `disabled` | `boolean` | `false` | Disable the input |
| `autoFocus` | `boolean` | `false` | Focus on mount |
| `id` | `string` | — | Input ID (for labels) |

## Performance

The trie is built once when data changes (via `useMemo`). Each keystroke triggers a trie prefix search, which is `O(prefix length)` — constant with respect to the dictionary size. A trie with 100,000 entries responds in microseconds.

The component re-renders only when the suggestion list changes, not on every keystroke of the underlying trie search.

## Why a trie?

Most autocomplete components use `Array.filter()` with `startsWith()` or `includes()`. This is O(N) per keystroke — fine for 100 items, slow for 100,000. A trie makes it O(L) where L is the prefix length, regardless of dictionary size.

## License

MIT
