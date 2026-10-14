/** Carica categorie e curriculum condivisi da data/*.json (senza sovrascrivere le modifiche degli admin). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const readJson = <T>(f: string) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8')) as T;

export interface SeedStats { categories: number; topics: number; items: number }

export async function seedCatalog(db: Db): Promise<SeedStats> {
  const cats = readJson<any[]>('categories.json');
  const cur = readJson<{ topics: any[]; items: any[] }>('curriculum.json');
  return db.tx(async (q) => {
    for (const c of cats) {
      // le categorie esistenti non vengono toccate: possono essere state modificate da un amministratore
      await q.query(
        `insert into public.categories (id, group_key, name_it, name_en, description, pubmed_query, keywords, sort_order, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
        [c.id, c.group_key, c.name_it, c.name_en, c.description ?? null, c.pubmed_query, c.keywords, c.sort_order, c.active],
      );
    }
    for (const t of cur.topics) {
      await q.query(
        `insert into public.core_topics (id, category_id, title_it, title_en, sort_order, active)
         values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
        [t.id, t.category_id, t.title_it, t.title_en, t.sort_order, t.active],
      );
    }
    for (const it of cur.items) {
      await q.query(
        `insert into public.core_items (id, topic_id, position, pmid, doi, title, authors, journal, pub_year, item_type, rationale,
                                        prerequisites, objectives, reading_minutes, editorial_status, verification, verified_at, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (id) do update set
           pmid = excluded.pmid, doi = excluded.doi, title = excluded.title, authors = excluded.authors,
           journal = excluded.journal, pub_year = excluded.pub_year, verification = excluded.verification,
           verified_at = excluded.verified_at
           -- rationale/objectives/prerequisites NON vengono sovrascritti (possibile revisione editoriale)`,
        [it.id, it.topic_id, it.position, it.pmid, it.doi, it.title, it.authors, it.journal, it.pub_year, it.item_type, it.rationale,
         it.prerequisites, it.objectives, it.reading_minutes, it.editorial_status, it.verification, it.verified_at, it.active],
      );
    }
    return { categories: cats.length, topics: cur.topics.length, items: cur.items.length };
  });
}
