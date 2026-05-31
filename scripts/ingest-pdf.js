import fs from 'fs';
import pdf from 'pdf-parse';
import { ingestDocument } from '../src/rag.js';

const pdfPath = process.argv[2];

if (!pdfPath) {
  console.error('Usage: node scripts/ingest-pdf.js path/to/file.pdf');
  process.exit(1);
}

if (!fs.existsSync(pdfPath)) {
  console.error(`PDF not found: ${pdfPath}`);
  process.exit(1);
}

console.log(`[PDF] Reading ${pdfPath}`);

const buffer = fs.readFileSync(pdfPath);
const data = await pdf(buffer);

const text = data.text?.trim();

if (!text) {
  console.error('[PDF] No text extracted. This PDF may be scanned/image-only.');
  process.exit(1);
}

console.log(`[PDF] Extracted ${text.length} characters`);

const ids = await ingestDocument(text, {
  source: pdfPath,
  type: 'pdf',
  pages: data.numpages,
});

console.log(`[PDF] Ingested ${ids.length} chunks into Supabase`);
