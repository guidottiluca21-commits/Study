import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, newUser } from './helpers/db';
import { pgliteDb } from '../src/pipeline/db';
import { seedCatalog } from '../src/pipeline/seed';
import { pickCoreItem } from '../src/core/curriculum';
import { titleSimilarity, queryTokens } from '../src/core/curriculum-verify';
import type { CoreItem, CoreProgressRow, CoreTopic, UserPrefs } from '../src/core/types';

const root = join(import.meta.dirname, '..');
const cur = JSON.parse(readFileSync(join(root, 'data', 'curriculum.json'), 'utf8')) as { topics: any[]; items: any[] };
const cats = JSON.parse(readFileSync(join(root, 'data', 'categories.json'), 'utf8')) as any[];

describe('integrità dei dati del curriculum', () => {
  const requiredTopics = [
    'resp-vent', 'ards', 'shock-hemodynamics', 'sepsis', 'fluids-vasopressors', 'aki-crrt', 'nutrition', 'sedation-delirium',
    'neurocritical', 'icu-infections', 'weaning-recovery', 'anesthetic-pharmacology', 'airway', 'regional', 'cv-thoracic',
    'obstetric-pediatric', 'perioperative', 'transfusion-hemostasis', 'critical-appraisal',
  ];
  it('contiene tutti gli argomenti richiesti dal progetto', () => {
    const ids = cur.topics.map((t) => t.id);
    for (const r of requiredTopics) expect(ids, r).toContain(r);
  });
  it('ogni argomento ha almeno 3 letture verificate (articoli fondamentali, linee guida o revisioni)', () => {
    for (const t of cur.topics) {
      const n = cur.items.filter((i) => i.topic_id === t.id && i.verification === 'verified').length;
      expect(n, t.id).toBeGreaterThanOrEqual(3);
    }
  });
  it('id univoci, prerequisiti esistenti e senza cicli, categorie esistenti', () => {
    const ids = new Set(cur.items.map((i) => i.id));
    expect(ids.size).toBe(cur.items.length);
    const catIds = new Set(cats.map((c) => c.id));
    for (const t of cur.topics) expect(catIds.has(t.category_id), t.id).toBe(true);
    const byId = new Map(cur.items.map((i) => [i.id, i]));
    for (const i of cur.items) {
      for (const p of i.prerequisites) expect(byId.has(p), `${i.id}→${p}`).toBe(true);
      // niente cicli: si risale i prerequisiti fino a esaurimento
      const seen = new Set<string>();
      const stack = [...i.prerequisites];
      while (stack.length) {
        const x = stack.pop()!;
        expect(x, `ciclo su ${i.id}`).not.toBe(i.id);
        if (seen.has(x)) continue;
        seen.add(x);
        stack.push(...byId.get(x)!.prerequisites);
      }
    }
  });
  it('nessun articolo verificato senza PMID letto da PubMed; nessun PMID senza verifica', () => {
    for (const i of cur.items) {
      if (i.verification === 'verified') {
        expect(i.pmid, i.id).toMatch(/^\d+$/);
        expect(i.verified_at, i.id).toBeTruthy();
        // le linee guida di task force possono non avere autori individuali in PubMed: non si inventano
        if (i.item_type !== 'guideline') expect(i.authors.length, i.id).toBeGreaterThan(0);
        expect(i.pub_year, i.id).toBeGreaterThan(1990);
      } else {
        expect(i.pmid, i.id).toBeNull();
      }
    }
    const pmids = cur.items.filter((i) => i.pmid).map((i) => i.pmid);
    expect(new Set(pmids).size).toBe(pmids.length); // nessun duplicato
  });
  it('il contenuto editoriale è dichiarato come bozza non ancora rivista', () => {
    for (const i of cur.items) expect(i.editorial_status).toBe('draft_unreviewed');
  });
  it('ogni articolo ha motivazione, obiettivi di apprendimento e tempo stimato', () => {
    for (const i of cur.items) {
      expect(i.rationale.length, i.id).toBeGreaterThan(30);
      expect(i.objectives.length, i.id).toBeGreaterThanOrEqual(2);
      expect(i.reading_minutes, i.id).toBeGreaterThanOrEqual(15);
    }
  });
  it('categorie: almeno quelle richieste, con query e parole chiave', () => {
    expect(cats.length).toBeGreaterThanOrEqual(27);
    for (const c of cats) {
      expect(c.pubmed_query.length, c.id).toBeGreaterThan(20);
      expect(c.keywords.length, c.id).toBeGreaterThan(2);
    }
  });
});

describe('utilità di verifica', () => {
  it('somiglianza dei titoli e token di query senza parole ignorate da PubMed', () => {
    const s = titleSimilarity('Time to treatment and mortality during mandated emergency care for sepsis', 'Time to Treatment and Mortality during Mandated Emergency Care for Sepsis');
    expect(s.containment).toBe(1);
    expect(queryTokens('Ventilator-induced lung injury')).toEqual(['ventilator', 'induced', 'lung', 'injury']);
    expect(queryTokens('during the care')).toEqual(['care']);
  });
});

describe('curriculum nel database: persistenza e continuità per utente', () => {
  let db: PGlite;
  let topics: CoreTopic[];
  let items: CoreItem[];
  beforeAll(async () => {
    db = await createDb();
    await seedCatalog(pgliteDb(db));
    topics = (await db.query<CoreTopic>(`select id, category_id, title_it, title_en, sort_order, active from public.core_topics`)).rows;
    items = (await db.query<CoreItem>(`select * from public.core_items`)).rows;
  });

  it('il seed è idempotente e non sovrascrive le modifiche degli amministratori', async () => {
    await db.query(`update public.categories set name_it = 'Rinominata' where id = 'sepsis'`);
    await db.query(`update public.core_items set rationale = 'Rivista da un clinico', editorial_status = 'reviewed' where id = 'sp-ssc2021'`);
    const stats = await seedCatalog(pgliteDb(db));
    expect(stats.items).toBe(cur.items.length);
    expect((await db.query<any>(`select count(*)::int n from public.core_items`)).rows[0].n).toBe(cur.items.length);
    expect((await db.query<any>(`select name_it from public.categories where id='sepsis'`)).rows[0].name_it).toBe('Rinominata');
    expect((await db.query<any>(`select rationale from public.core_items where id='sp-ssc2021'`)).rows[0].rationale).toBe('Rivista da un clinico');
  });

  it('simulazione di 12 settimane: nessuna ripetizione, prerequisiti rispettati, argomenti alternati', async () => {
    const prefs: UserPrefs = { topics: { sepsis: 5, ards: 4, airway: 3 }, study_types: [], max_weekly_reads: 6, weekly_minutes: 120, rest_days: [], core_enabled: true, core_topic_ids: [] };
    const progress: CoreProgressRow[] = [];
    const picked: string[] = [];
    const topicsSeen: string[] = [];
    for (let w = 0; w < 12; w++) {
      const p = pickCoreItem({ topics, items, progress, prefs, today: '2026-10-12' });
      expect(p, `settimana ${w}`).not.toBeNull();
      expect(picked).not.toContain(p!.item.id); // mai lo stesso articolo
      // prerequisiti completati
      for (const pre of p!.item.prerequisites) expect(progress.find((x) => x.item_id === pre && x.status === 'completed'), `${p!.item.id} richiede ${pre}`).toBeTruthy();
      picked.push(p!.item.id);
      topicsSeen.push(p!.topic.id);
      progress.push({ item_id: p!.item.id, status: 'completed', next_review_at: null });
    }
    expect(new Set(topicsSeen).size).toBeGreaterThanOrEqual(3);
    // gli argomenti a priorità più alta compaiono prima/più spesso
    expect(topicsSeen.slice(0, 4)).toContain('sepsis');
  });

  it('due utenti con interessi diversi seguono percorsi diversi sullo stesso curriculum condiviso', async () => {
    const base = { study_types: [], max_weekly_reads: 6, weekly_minutes: 120, rest_days: [], core_enabled: true, core_topic_ids: [] };
    const a = pickCoreItem({ topics, items, progress: [], prefs: { ...base, topics: { sepsis: 5 } }, today: '2026-10-12' })!;
    const b = pickCoreItem({ topics, items, progress: [], prefs: { ...base, topics: { airway: 5 } }, today: '2026-10-12' })!;
    expect(a.topic.id).toBe('sepsis');
    expect(b.topic.id).toBe('airway');
  });

  it('il progresso individuale è nel DB e separato dal curriculum condiviso', async () => {
    const u = await newUser(db, 'core@example.org');
    await db.query(`insert into public.user_core_progress (user_id, item_id, status) values ($1,'ards-arma','completed')`, [u]);
    const n = (await db.query<any>(`select count(*)::int n from public.core_items`)).rows[0].n;
    expect(n).toBe(cur.items.length); // il curriculum non cambia con il progresso
    const rows = (await db.query<any>(`select item_id from public.user_core_progress where user_id=$1`, [u])).rows;
    expect(rows).toEqual([{ item_id: 'ards-arma' }]);
  });
});
