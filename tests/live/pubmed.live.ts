import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PubmedClient } from '../../src/core/pubmed-client.ts';
import { buildCategoryTerm } from '../../src/core/pubmed.ts';

// Richiede rete verso eutils.ncbi.nlm.nih.gov. In questo sandbox: NODE_USE_ENV_PROXY=1.
describe('PubMed reale', () => {
  it('ogni categoria restituisce risultati e record parsabili', async () => {
    const cats = JSON.parse(readFileSync('data/categories.json', 'utf8')) as { id: string; pubmed_query: string }[];
    const c = new PubmedClient({});
    const sample = cats.slice(0, 3);
    for (const cat of sample) {
      const res = await c.search(buildCategoryTerm(cat), { from: new Date('2025-01-01'), to: new Date() }, 5);
      expect(res.length, cat.id).toBeGreaterThan(0);
      const arts = await c.fetchArticles(res.slice(0, 2));
      expect(arts[0]?.title.length).toBeGreaterThan(5);
    }
  });
});
