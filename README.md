# @tristanreid/react-trie-autocomplete

A fast, accessible autocomplete React component powered by a trie (prefix tree). Suggestions are instant — no network round-trip, no debouncing, just a trie lookup on every keystroke.

**v0.2.0** adds a **packed radix trie** format: compress your data 2–3x smaller than JSON, serve it as a static file or API response, and hydrate it on the client with the `src` or `packed` prop.

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

### Six ways to provide data

```tsx
// 1. Simple string array
<TrieAutocomplete items={['cat', 'car', 'card']} />

// 2. Entries with scores and data
<TrieAutocomplete
  entries={[
    { text: 'Python', score: 0.95, data: { id: 1 } },
    { text: 'JavaScript', score: 0.90, data: { id: 2 } },
  ]}
/>

// 3. Pre-built trie
import { AutocompleteTrie } from '@tristanreid/react-trie-autocomplete';
const trie = AutocompleteTrie.fromStrings(hugeWordList);
<TrieAutocomplete trie={trie} />

// 4. Packed trie from URL (fetched and hydrated)
<TrieAutocomplete src="/data/cities.trie" />

// 5. Packed trie string (for SSR / React Server Components)
<TrieAutocomplete packed={packedTrieString} />

// 6. RadixTrie (compressed, built directly)
import { RadixTrie } from '@tristanreid/react-trie-autocomplete';
const radix = RadixTrie.fromEntries(entries);
<TrieAutocomplete trie={radix} />
```

### Packed radix trie (new in v0.2.0)

Compress your autocomplete data for efficient transfer:

```typescript
import { packTrie, unpackTrie } from '@tristanreid/react-trie-autocomplete/pack';

// Pack (server / build time)
const packed = packTrie([
  { text: 'New York', score: 0.95 },
  { text: 'New Orleans', score: 0.90 },
  // ...thousands more
]);
// → compact string, ~35% smaller than JSON (even more after gzip)

// Unpack (client)
const trie = unpackTrie(packed);
trie.search('new');
// → [{ text: 'New York', score: 0.95 }, ...]
```

#### CLI: pack at build time

```bash
npx triepack --input cities.json --output static/data/cities.trie --verbose
```

#### API route serving

```typescript
// Express
import { createTrieHandler } from '@tristanreid/react-trie-autocomplete/server';
app.get('/api/cities.trie', createTrieHandler(cityData));

// Next.js App Router / Cloudflare Workers / Deno
import { createTrieResponse } from '@tristanreid/react-trie-autocomplete/server';
export async function GET() {
  return createTrieResponse(cityData);
}
```

#### React Server Component pattern

```tsx
// Server Component — packs on the server
import { packTrie } from '@tristanreid/react-trie-autocomplete/pack';

export default async function Page() {
  const cities = await db.query('SELECT name, pop FROM cities');
  const packed = packTrie(cities.map(c => ({ text: c.name, score: c.pop })));
  return <CitySearch packed={packed} />;
}
```

```tsx
// Client Component — hydrates instantly
'use client';
import { TrieAutocomplete } from '@tristanreid/react-trie-autocomplete';

export function CitySearch({ packed }: { packed: string }) {
  return <TrieAutocomplete packed={packed} placeholder="Search cities..." />;
}
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
    <li key={entry.text} style={{
      padding: '8px',
      background: isHighlighted ? '#eef' : 'white',
    }}>
      {entry.text}
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
| `src` | `string` | — | URL to fetch a packed trie from |
| `packed` | `string` | — | Pre-packed trie string (SSR/RSC) |
| `value` | `string` | — | Controlled input value |
| `defaultValue` | `string` | `''` | Initial value (uncontrolled) |
| `onChange` | `(value: string) => void` | — | Input change handler |
| `onSelect` | `(entry: TrieEntry) => void` | — | Selection handler |
| `placeholder` | `string` | `'Search...'` | Input placeholder |
| `maxSuggestions` | `number` | `8` | Max dropdown items |
| `minChars` | `number` | `1` | Min chars before searching |
| `renderSuggestion` | `function` | — | Custom suggestion renderer |
| `loading` | `ReactNode` | — | Loading indicator (while fetching `src`) |
| `onLoad` | `(stats) => void` | — | Called when packed trie finishes loading |
| `className` | `string` | — | Container CSS class |
| `inputClassName` | `string` | — | Input CSS class |
| `dropdownClassName` | `string` | — | Dropdown CSS class |
| `style` | `CSSProperties` | — | Container inline styles |
| `disabled` | `boolean` | `false` | Disable the input |
| `autoFocus` | `boolean` | `false` | Focus on mount |
| `id` | `string` | — | Input ID (for labels) |

## Exports

```typescript
// Main entry — React component + all trie classes
import { TrieAutocomplete, AutocompleteTrie, RadixTrie, packTrie, unpackTrie } from '@tristanreid/react-trie-autocomplete';

// Pack/unpack only (no React dependency — safe for server)
import { packTrie, unpackTrie, packStats } from '@tristanreid/react-trie-autocomplete/pack';

// Server utilities (no React dependency)
import { createTrieHandler, createTrieResponse } from '@tristanreid/react-trie-autocomplete/server';
```

## Performance

The trie is built once when data changes (via `useMemo`). Each keystroke triggers a trie prefix search, which is `O(prefix length)` — constant with respect to the dictionary size. A trie with 100,000 entries responds in microseconds.

The `RadixTrie` uses 60–80% fewer nodes than a standard trie through path compression (merging single-child chains into multi-character edges), making it both smaller in memory and faster to serialize.

## License

MIT
