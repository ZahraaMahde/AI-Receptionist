#!/usr/bin/env node

/**
 * Ingest documents into the Supabase knowledge base
 * 
 * Usage:
 *   node scripts/ingest.js --file ./data/company-info.txt
 *   node scripts/ingest.js --text "Your company info here..."
 *   node scripts/ingest.js --dir ./data/  (ingests all .txt and .md files)
 *   echo "Some text" | node scripts/ingest.js --stdin
 */

import fs from 'fs';
import path from 'path';
import { ingestDocument } from '../src/rag.js';

const args = process.argv.slice(2);

function printUsage() {
  console.log(`
AI Receptionist — Document Ingestion Tool

Usage:
  node scripts/ingest.js --file <path>       Ingest a single file
  node scripts/ingest.js --dir <path>        Ingest all .txt/.md files in directory
  node scripts/ingest.js --text "content"    Ingest inline text
  node scripts/ingest.js --stdin             Read from stdin

Options:
  --category <name>     Category tag for metadata (e.g., "faq", "hours", "services")
  --source <name>       Source tag for metadata

Examples:
  node scripts/ingest.js --file ./data/faq.txt --category faq
  node scripts/ingest.js --dir ./data/ --source "company-docs"
  node scripts/ingest.js --text "We are open Mon-Fri 9am-5pm" --category hours
  `);
}

async function main() {
  if (args.length === 0 || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const category = getArg('--category') || 'general';
  const source = getArg('--source') || 'manual';
  const metadata = { category, source, ingested_at: new Date().toISOString() };

  if (args.includes('--file')) {
    const filePath = getArg('--file');
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    const text = fs.readFileSync(filePath, 'utf-8');
    console.log(`Ingesting file: ${filePath} (${text.length} chars)`);
    const ids = await ingestDocument(text, { ...metadata, filename: path.basename(filePath) });
    console.log(`Done! Ingested ${ids.length} chunks.`);

  } else if (args.includes('--dir')) {
    const dirPath = getArg('--dir');
    if (!dirPath || !fs.existsSync(dirPath)) {
      console.error(`Directory not found: ${dirPath}`);
      process.exit(1);
    }
    const files = fs.readdirSync(dirPath).filter(f => /\.(txt|md)$/i.test(f));
    console.log(`Found ${files.length} files to ingest`);

    let totalChunks = 0;
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const text = fs.readFileSync(filePath, 'utf-8');
      console.log(`\nIngesting: ${file} (${text.length} chars)`);
      const ids = await ingestDocument(text, { ...metadata, filename: file });
      totalChunks += ids.length;
      console.log(`  → ${ids.length} chunks`);
    }
    console.log(`\nDone! Ingested ${totalChunks} total chunks from ${files.length} files.`);

  } else if (args.includes('--text')) {
    const text = getArg('--text');
    if (!text) {
      console.error('No text provided');
      process.exit(1);
    }
    console.log(`Ingesting inline text (${text.length} chars)`);
    const ids = await ingestDocument(text, metadata);
    console.log(`Done! Ingested ${ids.length} chunks.`);

  } else if (args.includes('--stdin')) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf-8');
    console.log(`Ingesting stdin (${text.length} chars)`);
    const ids = await ingestDocument(text, metadata);
    console.log(`Done! Ingested ${ids.length} chunks.`);

  } else {
    printUsage();
    process.exit(1);
  }
}

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
