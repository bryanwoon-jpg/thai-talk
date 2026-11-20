// Checks js/content.js and sw.js before a release. Run: node scripts/validate.mjs
// Exits with code 1 if anything would break the game.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('js/content.js', root), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src + '\n;this.TUTORS = TUTORS; this.SCENES = SCENES; this.HUH = HUH;', ctx);
const { TUTORS, SCENES } = ctx;

const errors = [], warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const THAI = /[฀-๿]/;
const FEMININE = /(ค่ะ|คะ|ดิฉัน)/;
const isLine = a => Array.isArray(a) && a.length === 3 && a.every(x => typeof x === 'string' && x.trim());

const tutorIds = new Set(TUTORS.map(t => t.id));
const seen = new Set();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });

SCENES.forEach((sc, si) => {
  const w = sc.id || `scene #${si}`;
  if (!/^[a-z]+\d+$/.test(sc.id || '')) err(w, 'id must look like "noi3" (tutor id + number)');
  if (seen.has(sc.id)) err(w, 'duplicate id'); seen.add(sc.id);
  if (!tutorIds.has(sc.tutor)) err(w, `unknown tutor "${sc.tutor}"`);
  for (const k of ['emoji', 'title', 'desc', 'intro']) if (!sc[k] || typeof sc[k] !== 'string') err(w, `missing ${k}`);
  if (sc.added !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(sc.added) || sc.added > today)) err(w, 'added must be YYYY-MM-DD and not in the future');
  if (!isLine(sc.outro) || !THAI.test(sc.outro[0])) err(w, 'outro must be [thai, romanization, english]');
  if (!Array.isArray(sc.turns) || sc.turns.length < 5 || sc.turns.length > 9) err(w, 'needs 5 to 9 turns');
  (sc.turns || []).forEach((t, ti) => {
    const wt = `${w} turn ${ti + 1}`;
    if (!isLine(t.t)) return err(wt, 'tutor line must be [thai, romanization, english]');
    if (!THAI.test(t.t[0])) err(wt, 'tutor line has no Thai script');
    if (THAI.test(t.t[1])) err(wt, 'romanization contains Thai script');
    if (!Array.isArray(t.c) || t.c.length !== 3) return err(wt, 'needs exactly 3 replies');
    const scores = t.c.map(c => c[3]).sort().join(',');
    if (scores !== '0,1,2') err(wt, 'replies must score 2 (natural), 1 (okay) and 0 (wrong), one each');
    t.c.forEach((c, ci) => {
      const wc = `${wt} reply ${ci + 1}`;
      if (!isLine(c.slice(0, 3))) return err(wc, 'reply must start [thai, romanization, english, score]');
      if (!THAI.test(c[0])) err(wc, 'reply has no Thai script');
      if (THAI.test(c[1])) err(wc, 'romanization contains Thai script');
      if (c[3] < 2 && !(typeof c[4] === 'string' && c[4].trim())) err(wc, 'okay and wrong replies need a note');
      if (c[3] > 0 && FEMININE.test(c[0])) err(wc, 'learner replies must use khráp (male speaker), found a feminine particle');
    });
    const best = t.c.find(c => c[3] === 2);
    if (best){
      if (best[1].split(/\s+/).filter(Boolean).length < 2) err(wt, 'natural reply needs at least 2 words for tiles mode');
      if (!/ครับ/.test(best[0]) && !/\{N/.test(best[0])) warn(wt, 'natural reply has no ครับ (fine if intended)');
    }
  });
});

const sw = readFileSync(new URL('sw.js', root), 'utf8');
const ver = (sw.match(/CACHE_VERSION = '([^']+)'/) || [])[1];
if (!ver) err('sw.js', 'CACHE_VERSION not found');

warnings.forEach(m => console.log('warn  ' + m));
errors.forEach(m => console.log('ERROR ' + m));
console.log(`${SCENES.length} lessons, ${TUTORS.length} tutors, cache ${ver}: ${errors.length ? errors.length + ' error(s)' : 'OK'}`);
process.exit(errors.length ? 1 : 0);
