#!/usr/bin/env node

/**
 * triepack — CLI tool for packing autocomplete data into a compact radix trie.
 *
 * Usage:
 *   npx @tristanreid/react-trie-autocomplete pack --input data.json --output data.trie
 *   npx @tristanreid/react-trie-autocomplete pack --input words.txt --output words.trie
 *
 * Input formats:
 *   - .json: Array of strings, or array of { text, score? } objects
 *   - .csv:  Two columns: text,score (header optional)
 *   - .txt:  One entry per line (all scores 0)
 *
 * Output: A .trie file containing the packed radix trie string.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { packTrie, packStats } from './pack.js';

// ─── Argument parsing ───────────────────────────────────────────────

interface Args {
  input: string;
  output: string;
  precision: number;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { precision: 2, verbose: false };
  let i = 2; // skip node and script path

  // Skip 'pack' subcommand if present
  if (argv[i] === 'pack') i++;

  while (i < argv.length) {
    switch (argv[i]) {
      case '--input':
      case '-i':
        args.input = argv[++i];
        break;
      case '--output':
      case '-o':
        args.output = argv[++i];
        break;
      case '--precision':
      case '-p':
        args.precision = parseInt(argv[++i], 10);
        break;
      case '--verbose':
      case '-v':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        printUsage();
        process.exit(1);
    }
    i++;
  }

  if (!args.input) {
    console.error('Error: --input is required');
    printUsage();
    process.exit(1);
  }

  if (!args.output) {
    // Default output: same name with .trie extension
    const inputBase = args.input.replace(/\.[^.]+$/, '');
    args.output = inputBase + '.trie';
  }

  return args as Args;
}

function printUsage(): void {
  console.log(`
Usage: triepack [pack] --input <file> [--output <file>] [options]

Options:
  --input,  -i <file>    Input data file (required)
  --output, -o <file>    Output .trie file (default: <input>.trie)
  --precision, -p <n>    Score decimal precision (default: 2)
  --verbose, -v          Show detailed compression stats
  --help,   -h           Show this help

Input formats:
  .json    JSON array of strings, or array of { text, score? } objects
  .csv     Two columns: text,score (header row auto-detected)
  .txt     One entry per line (all scores default to 0)

Examples:
  triepack --input cities.json --output static/data/cities.trie
  triepack -i products.csv -o products.trie -v
  triepack -i words.txt -o words.trie
`);
}

// ─── Input parsing ──────────────────────────────────────────────────

interface Entry {
  text: string;
  score?: number;
}

function parseInput(filepath: string): Entry[] {
  const abs = resolve(filepath);
  const content = readFileSync(abs, 'utf-8');
  const ext = extname(filepath).toLowerCase();

  switch (ext) {
    case '.json':
      return parseJson(content);
    case '.csv':
      return parseCsv(content);
    case '.txt':
      return parseTxt(content);
    default:
      // Try JSON first, fall back to text
      try {
        return parseJson(content);
      } catch {
        return parseTxt(content);
      }
  }
}

function parseJson(content: string): Entry[] {
  const data = JSON.parse(content);
  if (!Array.isArray(data)) {
    throw new Error('JSON input must be an array');
  }

  return data.map((item: unknown) => {
    if (typeof item === 'string') {
      return { text: item };
    }
    if (typeof item === 'object' && item !== null && 'text' in item) {
      const obj = item as { text: string; score?: number };
      return { text: obj.text, score: obj.score };
    }
    throw new Error(`Invalid JSON entry: ${JSON.stringify(item)}`);
  });
}

function parseCsv(content: string): Entry[] {
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Detect header row
  const firstLine = lines[0];
  const hasHeader =
    firstLine.toLowerCase().includes('text') || firstLine.toLowerCase().includes('name');
  const startIdx = hasHeader ? 1 : 0;

  const entries: Entry[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted CSV fields
    let text: string;
    let scoreStr: string | undefined;

    if (line.startsWith('"')) {
      const endQuote = line.indexOf('"', 1);
      if (endQuote === -1) {
        text = line.slice(1);
      } else {
        text = line.slice(1, endQuote);
        const rest = line.slice(endQuote + 1);
        const comma = rest.indexOf(',');
        if (comma !== -1) {
          scoreStr = rest.slice(comma + 1).trim();
        }
      }
    } else {
      const comma = line.indexOf(',');
      if (comma === -1) {
        text = line;
      } else {
        text = line.slice(0, comma);
        scoreStr = line.slice(comma + 1).trim();
      }
    }

    const score = scoreStr ? parseFloat(scoreStr) : undefined;
    if (text.length > 0) {
      entries.push({ text, score: isNaN(score as number) ? undefined : score });
    }
  }

  return entries;
}

function parseTxt(content: string): Entry[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((text) => ({ text }));
}

// ─── Main ───────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv);
  const entries = parseInput(args.input);

  if (entries.length === 0) {
    console.error('Error: no entries found in input file');
    process.exit(1);
  }

  console.log(`Packing ${entries.length} entries from ${args.input}...`);

  const packed = packTrie(entries, { scorePrecision: args.precision });
  const outputPath = resolve(args.output);
  writeFileSync(outputPath, packed, 'utf-8');

  const stats = packStats(entries, { scorePrecision: args.precision });

  console.log(`\nOutput: ${outputPath}`);
  console.log(`Entries:    ${stats.entryCount.toLocaleString()}`);
  console.log(`Nodes:      ${stats.nodeCount.toLocaleString()}`);
  console.log(`Raw JSON:   ${formatBytes(stats.rawJsonBytes)}`);
  console.log(`Packed:     ${formatBytes(stats.packedBytes)}`);
  console.log(`Ratio:      ${(stats.ratio * 100).toFixed(1)}% of original`);
  console.log(`Savings:    ${formatBytes(stats.rawJsonBytes - stats.packedBytes)} (${((1 - stats.ratio) * 100).toFixed(1)}% smaller)`);

  if (args.verbose) {
    console.log(`\n--- Verbose stats ---`);
    console.log(`Score precision: ${args.precision} decimal places`);
    console.log(`Avg text length: ${(entries.reduce((s, e) => s + e.text.length, 0) / entries.length).toFixed(1)} chars`);
    console.log(`Packed size / entry: ${(stats.packedBytes / stats.entryCount).toFixed(1)} bytes`);
    console.log(`JSON size / entry:   ${(stats.rawJsonBytes / stats.entryCount).toFixed(1)} bytes`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main();
