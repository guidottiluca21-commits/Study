import { describe, it, expect } from 'vitest';
import { decideRun, romeLocalToUtc, romeParts, weekStartRome } from '../src/core/schedule';

const iso = (d: Date) => d.toISOString();

describe('06:00 Europe/Rome in UTC (ora legale e solare)', () => {
  it('estate (CEST, UTC+2): lunedì 12 ottobre 2026 -> 04:00Z', () => {
    expect(iso(romeLocalToUtc('2026-10-12', 6))).toBe('2026-10-12T04:00:00.000Z');
  });
  it('inverno (CET, UTC+1): lunedì 11 gennaio 2027 -> 05:00Z', () => {
    expect(iso(romeLocalToUtc('2027-01-11', 6))).toBe('2027-01-11T05:00:00.000Z');
  });
  it('lunedì dopo il passaggio all\'ora solare (25 ottobre 2026) -> 05:00Z', () => {
    expect(iso(romeLocalToUtc('2026-10-26', 6))).toBe('2026-10-26T05:00:00.000Z');
  });
  it('lunedì dopo il passaggio all\'ora legale (29 marzo 2026) -> 04:00Z', () => {
    expect(iso(romeLocalToUtc('2026-03-30', 6))).toBe('2026-03-30T04:00:00.000Z');
  });
  it('inizio settimana: domenica sera e lunedì mattina nello stesso fuso', () => {
    expect(weekStartRome(new Date('2026-10-12T04:00:00Z'))).toBe('2026-10-12');
    expect(weekStartRome(new Date('2026-10-18T21:59:00Z'))).toBe('2026-10-12'); // dom 23:59 CEST
    expect(weekStartRome(new Date('2026-10-18T22:00:00Z'))).toBe('2026-10-19'); // lun 00:00 CEST
  });
  it('romeParts restituisce ora locale corretta', () => {
    const p = romeParts(new Date('2026-10-12T03:15:00Z'));
    expect([p.hh, p.mm, p.weekday]).toEqual([5, 15, 0]);
  });
});

describe('decisione di esecuzione con DUE cron (03:15Z e 04:15Z)', () => {
  it('estate: il cron delle 03:15Z (05:15 locali) parte e attende fino alle 06:00', () => {
    const d = decideRun(new Date('2026-10-12T03:15:00Z'));
    expect(d.run).toBe(true);
    expect(d.waitMs).toBe(45 * 60_000);
    expect(d.weekStart).toBe('2026-10-12');
  });
  it('estate: il cron delle 04:15Z (06:15 locali) parte subito senza attesa (copertura se il primo è saltato)', () => {
    const d = decideRun(new Date('2026-10-12T04:15:00Z'));
    expect(d.run).toBe(true);
    expect(d.waitMs).toBe(0);
    expect(d.late).toBe(false);
  });
  it('inverno: il cron delle 03:15Z (04:15 locali) NON parte; quello delle 04:15Z (05:15 locali) sì', () => {
    expect(decideRun(new Date('2027-01-11T03:15:00Z')).run).toBe(false);
    const d = decideRun(new Date('2027-01-11T04:15:00Z'));
    expect(d.run).toBe(true);
    expect(d.waitMs).toBe(45 * 60_000);
  });
  it('ritardo di GitHub: avvio alle 06:40 locali è "late" ma parte; dopo le 12:00 no', () => {
    const late = decideRun(new Date('2026-10-12T04:40:00Z'));
    expect(late.run).toBe(true);
    expect(late.late).toBe(true);
    expect(decideRun(new Date('2026-10-12T10:30:00Z')).run).toBe(false); // 12:30 locali
  });
  it('non parte negli altri giorni, salvo force', () => {
    expect(decideRun(new Date('2026-10-13T03:15:00Z')).run).toBe(false);
    expect(decideRun(new Date('2026-10-13T03:15:00Z'), { force: true }).run).toBe(true);
  });
});
