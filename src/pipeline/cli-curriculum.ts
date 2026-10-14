import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PubmedClient } from '../core/pubmed-client.ts';
import { verifyItem, type CurriculumSourceItem, type VerifiedItem } from '../core/curriculum-verify.ts';

const ROOT = join(import.meta.dirname, '..', '..');

export async function verifyCurriculumCli(): Promise<void> {
  const src = JSON.parse(readFileSync(join(ROOT, 'data', 'curriculum.source.json'), 'utf8')) as { topics: unknown[]; items: CurriculumSourceItem[] };
  const client = new PubmedClient({ email: process.env.NCBI_EMAIL, apiKey: process.env.NCBI_API_KEY, onLog: (m) => console.warn(m) });
  const out: VerifiedItem[] = [];
  let i = 0;
  for (const it of src.items) {
    const v = await verifyItem(client, it, new Date());
    out.push(v);
    console.log(`${String(++i).padStart(3)}/${src.items.length} ${v.verification.padEnd(10)} ${v.id}${v.verification_note ? '  — ' + v.verification_note : ''}`);
  }
  writeFileSync(join(ROOT, 'data', 'curriculum.json'), JSON.stringify({ topics: src.topics, items: out }, null, 1) + '\n');
  const c = (s: string) => out.filter((x) => x.verification === s).length;
  console.log(`\nVerificati: ${c('verified')}  Mismatch: ${c('mismatch')}  Non trovati: ${c('unverified')}  (richieste PubMed: ${client.stats.requests}, retry: ${client.stats.retries})`);
}
