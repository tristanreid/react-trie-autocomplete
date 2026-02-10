// React component
export { TrieAutocomplete } from './Autocomplete';
export type { TrieAutocompleteProps, TrieLoadStats } from './Autocomplete';

// Standard trie (character-per-node)
export { AutocompleteTrie } from './trie';
export type { TrieEntry } from './trie';

// Radix trie (compressed, multi-character edges)
export { RadixTrie } from './radix';
export type { RadixNode, RadixEdge, RadixTrieStats } from './radix';

// Pack/unpack (also available via '@tristanreid/react-trie-autocomplete/pack')
export { packTrie, unpackTrie, packStats } from './pack';
export type { PackOptions, PackStats } from './pack';
