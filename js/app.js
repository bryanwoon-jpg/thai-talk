/* Thai Talk: game logic. Content lives in content.js. */
(function(){
"use strict";

/* ---------- helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const shuffle = a => { a = a.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const today = () => new Date().toLocaleDateString('en-CA');
const addDays = (d, n) => { const x = new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toLocaleDateString('en-CA'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tutorById = id => TUTORS.find(t => t.id === id);
const sceneById = id => SCENES.find(s => s.id === id);
/* A lesson counts as new for 3 days after its "added" date, until you've played it. */
const isNewScene = sc => !!sc.added && !S.scenes[sc.id] && (Date.parse(today()) - Date.parse(sc.added)) / 864e5 <= 2;

/* ---------- state ---------- */
const LS_KEY = 'thaitalk.v1';
const DEFAULTS = { v:1, name:'Bryan', nameTh:'ไบรอัน', rate:0.85, autoplay:true, showEn:true, sfx:true,
  xp:0, tutorXp:{}, scenes:{}, streak:{count:0,last:null}, phrases:{}, updatedAt:0 };
let S = load();
function load(){
  try { const raw = localStorage.getItem(LS_KEY); if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw)); } catch(e){}
  return JSON.parse(JSON.stringify(DEFAULTS));
}
let cloud = { db:null, ref:null, writing:false, pending:false, timer:null, status:'local' };
function save(){
  S.updatedAt = Date.now();
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch(e){}
  queueCloud();
}
function queueCloud(){
  if (!cloud.ref) return;
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(pushCloud, 1500);
}
async function pushCloud(){
  if (!cloud.ref) return;
  if (cloud.writing){ cloud.pending = true; return; }
  cloud.writing = true;
  try { await cloud.ref.set({ state: JSON.stringify(S), updatedAt: S.updatedAt }); cloud.status = 'synced'; }
  catch(e){ if (e && e.code === 'invalid_argument') { cloud.ref = null; cloud.status = 'local'; } }
  cloud.writing = false;
  if (cloud.pending){ cloud.pending = false; pushCloud(); }
  if (current === 'settings') renderSettings();
}
async function initCloud(){
  try {
    if (!window.claude || !window.claude.use) return;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return;
    const id = await user.id();
    if (!id) return;
    cloud.db = db;
    cloud.ref = db.doc('data/users/' + id + '/progress');
    const snap = await cloud.ref.get();
    const d = snap.exists ? snap.data() : null;
    if (d && d.state && (d.updatedAt||0) > (S.updatedAt||0)){
      const remote = JSON.parse(d.state);
      if (scene) { pendingRemote = remote; }
      else { S = Object.assign({}, DEFAULTS, remote); try{localStorage.setItem(LS_KEY, JSON.stringify(S));}catch(e){} refresh(); }
      cloud.status = 'synced';
    } else if (S.updatedAt) { pushCloud(); }
    else cloud.status = 'synced';
    if (current === 'settings') renderSettings();
  } catch(e){ cloud.ref = null; }
}
let pendingRemote = null;

/* ---------- name fill ---------- */
const fill = s => s.replace(/\{NT\}/g, S.nameTh || S.name).replace(/\{N\}/g, S.name || 'Bryan');
const line = arr => ({ th: fill(arr[0]), ro: fill(arr[1]), en: fill(arr[2]) });

/* ---------- levels ---------- */
const LEVELS = [0, 80, 200, 400, 700, 1100];
function levelOf(xp){ let l = 1; for (let i=1;i<LEVELS.length;i++) if (xp >= LEVELS[i]) l = i+1; return l; }
function levelProgress(xp){
  const l = levelOf(xp); const lo = LEVELS[l-1]; const hi = LEVELS[l] ?? (lo + 500);
  return { l, pct: Math.min(100, Math.round((xp-lo)/(hi-lo)*100)), toNext: hi - xp };
}

/* ---------- streak ---------- */
function bumpStreak(){
  const t = today(); const st = S.streak;
  if (st.last === t) return false;
  st.count = (st.last === addDays(t,-1)) ? st.count + 1 : 1;
  st.last = t; return true;
}
function liveStreak(){
  const st = S.streak; const t = today();
  return (st.last === t || st.last === addDays(t,-1)) ? st.count : 0;
}

/* ---------- phrasebook (Leitner) ---------- */
const INTERVALS = [0, 1, 3, 7, 14, 30];
function phraseText(pid){
  const [sid, ti, kind] = pid.split(':');
  const sc = sceneById(sid); if (!sc) return null;
  if (kind === 'o') return line(sc.outro);
  const turn = sc.turns[+ti]; if (!turn) return null;
  if (kind === 't') return line(turn.t);
  const best = turn.c.find(c => c[3] === 2);
  return line(best);
}
function addPhrase(pid){
  if (!S.phrases[pid]) { S.phrases[pid] = { box:0, due: addDays(today(), 1), seen: Date.now() }; return true; }
  return false;
}
function dueList(){ const t = today(); return Object.keys(S.phrases).filter(k => S.phrases[k].due <= t && phraseText(k)); }

/* ---------- audio: speech ---------- */
let thaiVoice = null, ttsCap = null, speakingBtn = null;
function pickVoice(){
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  thaiVoice = vs.find(v => /^th(-|_|$)/i.test(v.lang) && /google/i.test(v.name)) || vs.find(v => /^th(-|_|$)/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window){ pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function canSpeak(){ return !!thaiVoice || !!ttsCap; }
function markSpeaking(btn, on){
  if (speakingBtn && speakingBtn !== btn) speakingBtn.classList.remove('speaking');
  speakingBtn = on ? btn : null;
  if (btn) btn.classList.toggle('speaking', on);
}
function speak(text, btn){
  return new Promise(resolve => {
    if (thaiVoice && 'speechSynthesis' in window){
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.voice = thaiVoice; u.lang = thaiVoice.lang || 'th-TH'; u.rate = S.rate;
        markSpeaking(btn, true);
        const done = () => { markSpeaking(btn, false); resolve(); };
        u.onend = done; u.onerror = done;
        speechSynthesis.speak(u);
        setTimeout(done, 9000);
      } catch(e){ resolve(); }
      return;
    }
    if (ttsCap){
      markSpeaking(btn, true);
      const r = Math.max(0.7, Math.min(1.5, S.rate));
      ttsCap.speak(text, { language:'th', rate:r }).catch(()=>{}).finally(() => { markSpeaking(btn, false); resolve(); });
      return;
    }
    resolve();
  });
}

/* ---------- audio: sfx ---------- */
let actx = null;
function blip(kind){
  if (!S.sfx) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'good' ? [660, 880] : kind === 'meh' ? [520, 600] : kind === 'win' ? [523, 659, 784, 1046] : [220, 170];
    notes.forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === 'bad' ? 'square' : 'triangle'; o.frequency.value = f;
      const t0 = actx.currentTime + i*0.09;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(kind==='bad'?0.05:0.12, t0+0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0+0.22);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0+0.25);
    });
  } catch(e){}
  if (kind === 'bad') try { navigator.vibrate && navigator.vibrate(60); } catch(e){}
}

/* ---------- dictation ---------- */
let dict = null, dictWired = false, dictH = null;
const stripTone = s => s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z]/g,'');
const normTh = s => s.replace(/[\s\.,!?ๆ]/g,'');
function bigrams(s){ const m = new Map(); for (let i=0;i<s.length-1;i++){ const b=s.slice(i,i+2); m.set(b,(m.get(b)||0)+1);} return m; }
function dice(a, b){
  if (!a || !b) return 0; if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b); let inter = 0;
  A.forEach((n,k) => { if (B.has(k)) inter += Math.min(n, B.get(k)); });
  return 2*inter / (a.length-1 + b.length-1);
}
function matchScore(heard, l){
  const h = heard.trim(); if (!h) return 0;
  const isThai = /[฀-๿]/.test(h);
  return isThai ? dice(normTh(h), normTh(l.th)) : Math.max(dice(stripTone(h), stripTone(l.ro)), dice(stripTone(h), stripTone(l.en)) * 0.6);
}


/* Native speech recognition (installed app / normal browser). Same shape as the
   Claude dictation capability so the lesson code can use either. */
function makeNativeDict(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  let rec = null, cbP = null, cbF = null, cbS = null, stopResolve = null;
  return {
    start(){
      return new Promise((resolve, reject) => {
        try {
          rec = new SR();
          rec.lang = 'th-TH'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
          rec.onstart = () => { cbS && cbS({ state:'listening' }); resolve(); };
          rec.onresult = e => {
            for (let i = e.resultIndex; i < e.results.length; i++){
              const t = e.results[i][0].transcript;
              if (e.results[i].isFinal) cbF && cbF({ text:t }); else cbP && cbP({ text:t });
            }
          };
          rec.onerror = e => {
            const code = (e.error === 'not-allowed' || e.error === 'service-not-allowed') ? 'not_granted' : e.error;
            reject({ code });
          };
          rec.onend = () => { cbS && cbS({ state:'idle', reason:'stopped' }); if (stopResolve){ stopResolve(); stopResolve = null; } };
          rec.start();
        } catch(err){ reject({ code:'unavailable' }); }
      });
    },
    stop(){ return new Promise(res => { if (!rec){ res(); return; } stopResolve = res; try { rec.stop(); } catch(e){ res(); } }); },
    onPartial(f){ cbP = f; }, onFinal(f){ cbF = f; }, onState(f){ cbS = f; }
  };
}

/* ---------- UI chrome ---------- */
function drawLights(){
  const svg = $('#lightsSvg'); const cols = ['#ffb627','#ef3e36','#2ec4b6','#ff5c8a','#ffd36e'];
  let s = '<path d="M0 4 Q 50 18 100 6 T 200 6 T 300 6 T 400 4" stroke="rgba(255,255,255,.25)" stroke-width="1" fill="none"/>';
  for (let i=0;i<20;i++){ const x = 10 + i*20; const y = 8 + Math.sin(i*0.8)*3 + 4; const c = cols[i%cols.length];
    s += `<circle class="bulb" style="animation-delay:${(i%5)*0.4}s" cx="${x}" cy="${y}" r="3.2" fill="${c}"/><circle cx="${x}" cy="${y}" r="7" fill="${c}" opacity=".18"/>`; }
  svg.innerHTML = s;
}
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.remove('show'), 1600); }
function confirmSheet(title, text, okLabel, onOk){
  const sh = $('#sheet'); sh.innerHTML = '';
  sh.append(el('h3', null, title), el('p', null, text));
  const row = el('div','lbtns'); const no = el('button','btn ghost','Cancel'); const yes = el('button','btn pink', okLabel);
  no.onclick = closeModal; yes.onclick = () => { closeModal(); onOk(); };
  row.append(no, yes); sh.append(row); $('#modal').classList.add('show');
}
function closeModal(){ $('#modal').classList.remove('show'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
function burst(){
  const b = $('#burst'); b.innerHTML = ''; const em = ['⭐','🏮','🌶️','✨','🥭','🎉'];
  for (let i=0;i<26;i++){ const s = el('span', null, em[i%em.length]);
    s.style.left = (45 + Math.random()*10) + '%';
    s.style.setProperty('--dx', (Math.random()*320-160)+'px'); s.style.setProperty('--dy', (-120 - Math.random()*260)+'px'); s.style.setProperty('--rot', (Math.random()*540-270)+'deg');
    b.append(s); }
  setTimeout(()=> b.innerHTML = '', 1600);
}
function starsHtml(n){ const w = el('span','stars'); for (let i=0;i<3;i++){ const s = el('span', i<n?'on':'', '★'); w.append(s);} return w; }

/* ---------- navigation ---------- */
let current = 'home';
function go(view, opts){
  current = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('#v-' + view).classList.add('active');
  const inScene = view === 'scene';
  $('#topbar').style.display = inScene ? 'none' : '';
  $('#app').classList.toggle('hide-nav', inScene || view === 'review' || view === 'result');
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.go === view || (view === 'tutor' && b.dataset.go === 'home')));
  if (view === 'home') renderHome();
  if (view === 'tutor') renderTutor(opts);
  if (view === 'book') renderBook();
  if (view === 'settings') renderSettings();
  const v = $('#v-' + view); if (v && !inScene) v.scrollTop = 0;
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => go(b.dataset.go));
function refreshHeader(){
  $('#hStreak').textContent = liveStreak(); $('#hXp').textContent = S.xp;
  const d = dueList().length; const nb = $('#navDue'); nb.hidden = d === 0; nb.textContent = d > 99 ? '99+' : d;
}
function refresh(){ refreshHeader(); if (current === 'home') renderHome(); else if (current === 'book') renderBook(); else if (current === 'settings') renderSettings(); }

/* ---------- HOME ---------- */
function renderHome(){
  refreshHeader();
  const v = $('#v-home'); v.innerHTML = '';
  const hero = el('div','hero');
  hero.append(el('div','hi','sà-wàt-dii khráp, ' + (S.name || 'friend') + '!'), el('div','hi-th','สวัสดีครับ ' + (S.nameTh || '')));
  const row = el('div','row');
  const st1 = el('div','stat'); st1.append(el('div','n','🔥 ' + liveStreak()), el('div','l', liveStreak() === 1 ? 'day streak' : 'day streak'));
  const totalStars = SCENES.reduce((a,s)=> a + ((S.scenes[s.id]||{}).stars||0), 0);
  const st2 = el('div','stat'); st2.append(el('div','n','★ ' + totalStars + '/' + SCENES.length*3), el('div','l','stars earned'));
  const st3 = el('div','stat'); st3.append(el('div','n', Object.keys(S.phrases).length), el('div','l','phrases'));
  row.append(st1, st2, st3); hero.append(row); v.append(hero);

  const due = dueList().length;
  const rc = el('button','review-cta'); const ic = el('div','ic','📒'); const tx = el('div');
  tx.append(el('div','t','Phrasebook review'), el('div','d', due ? 'Keep your phrases fresh' : (Object.keys(S.phrases).length ? 'All caught up. Nice!' : 'Play a lesson to collect phrases')));
  rc.append(ic, tx, el('span','badge' + (due ? '' : ' zero'), due ? due + ' due' : '0'));
  rc.onclick = () => due ? startReview(false) : go('book');
  v.append(rc);
  const ic2 = installCard(); if (ic2) v.append(ic2);

  const fresh = SCENES.filter(isNewScene).sort((a,b) => (b.added||'').localeCompare(a.added||''));
  if (fresh.length){
    const sc = fresh[0]; const t = tutorById(sc.tutor);
    const nc = el('button','review-cta new-cta'); const ic3 = el('div','ic', sc.emoji); const tx3 = el('div');
    tx3.append(el('div','t','New lesson: ' + sc.title), el('div','d', 'with ' + t.name + ' · ' + sc.desc));
    nc.append(ic3, tx3, el('span','badge new', fresh.length > 1 ? fresh.length + ' new' : 'NEW'));
    nc.onclick = () => go('tutor', sc.tutor);
    v.append(nc);
  }
  v.append(el('h2', null, 'Find your Thai tutor'));
  v.append(el('div','sub','Native speakers, real-life conversations. Tap a tutor to book a lesson.'));
  TUTORS.forEach(t => v.append(tutorCard(t)));
}
function tutorCard(t){
  const xp = S.tutorXp[t.id] || 0; const lp = levelProgress(xp);
  const card = el('div','tcard');
  const av = el('div','avatar', t.emoji); av.style.background = t.color + '33'; av.style.boxShadow = 'inset 0 0 0 2px ' + t.color + '88'; av.append(el('span','dot'));
  const info = el('div','tinfo');
  const nm = el('div','tname'); nm.append(document.createTextNode(t.name), el('span','th', t.th));
  const meta = el('div','tmeta'); meta.append(el('span','rating','★ ' + t.rating), el('span', null, t.lessons + ' lessons'), el('span','tag', t.topic));
  if (SCENES.some(sc => sc.tutor === t.id && isNewScene(sc))) meta.append(el('span','tag newtag','✨ New lesson'));
  const lvl = el('div','lvl'); const bar = el('div','bar'); const fillb = el('i'); fillb.style.width = lp.pct + '%'; bar.append(fillb);
  const cap = el('div','cap'); const myScenes = SCENES.filter(s=>s.tutor===t.id); const stars = myScenes.reduce((a,s)=>a+((S.scenes[s.id]||{}).stars||0),0);
  cap.append(el('span', null, 'Level ' + lp.l + ' · ' + xp + ' XP'), el('span', null, '★ ' + stars + '/' + myScenes.length*3));
  lvl.append(bar, cap);
  const book = el('button','book','Book a lesson');
  book.onclick = () => go('tutor', t.id);
  info.append(nm, el('div','trole', t.role), meta, lvl, book);
  card.append(av, info);
  return card;
}

/* ---------- TUTOR PROFILE ---------- */
let currentTutor = null;
function renderTutor(id){
  if (id) currentTutor = id;
  const t = tutorById(currentTutor); const v = $('#v-tutor'); v.innerHTML = '';
  const back = el('button','back','‹ All tutors'); back.onclick = () => go('home'); v.append(back);
  const p = el('div','profile');
  const av = el('div','avatar', t.emoji); av.style.background = t.color + '33'; av.style.boxShadow = 'inset 0 0 0 3px ' + t.color + 'aa'; av.append(el('span','dot'));
  const nm = el('div','tname'); nm.append(document.createTextNode(t.name), el('span','th', t.th));
  p.append(av, nm, el('div','trole', t.role + ' · Native Thai speaker'), el('div','bio', t.bio));
  const xp = S.tutorXp[t.id] || 0; const lp = levelProgress(xp);
  const ps = el('div','pstats');
  [['★ '+t.rating,'rating'],['Lv '+lp.l,'your level'],[xp,'XP with '+t.name.replace("P'","")]].forEach(([a,b]) => { const d = el('div'); d.append(el('b',null,a), el('span',null,b)); ps.append(d); });
  p.append(ps);
  const lvl = el('div','lvl'); const bar = el('div','bar'); const fb = el('i'); fb.style.width = lp.pct + '%'; bar.append(fb);
  const cap = el('div','cap'); cap.append(el('span',null,'Level ' + lp.l), el('span',null, lp.toNext > 0 ? lp.toNext + ' XP to level ' + (lp.l+1) : 'Max level'));
  lvl.append(bar, cap); p.append(lvl);
  v.append(p);
  v.append(el('h2', null, 'Lessons'));
  const mine = SCENES.filter(s => s.tutor === t.id);
  mine.forEach((sc, i) => {
    const rec = S.scenes[sc.id]; const prev = i > 0 ? S.scenes[mine[i-1].id] : true;
    const locked = !prev && !sc.added; // daily lessons (with an added date) are always open
    const card = el('div','lesson' + (locked ? ' locked' : ''));
    const lt = el('div','lt'); const tx = el('div'); tx.style.flex = '1';
    const ln = el('div','ln', sc.title); if (isNewScene(sc)) ln.append(el('span','pill-new','NEW'));
    tx.append(ln, el('div','ld', locked ? 'Finish "' + mine[i-1].title + '" to unlock.' : sc.desc));
    lt.append(el('div','le', locked ? '🔒' : sc.emoji), tx, starsHtml(rec ? rec.stars : 0));
    card.append(lt);
    if (!locked){
      const btns = el('div','lbtns');
      const a = el('button','btn primary', rec ? 'Replay' : 'Start lesson');
      a.onclick = () => startScene(sc.id, 'choice');
      btns.append(a);
      if (rec){
        const b = el('button','btn pink'); b.append(document.createTextNode('Tiles '), el('small', null, '×1.5 XP'));
        b.onclick = () => startScene(sc.id, 'tiles');
        btns.append(b);
      }
      card.append(btns);
      if (!rec){ const n = el('div','ld','Tiles mode (build replies word by word) unlocks after your first run.'); n.style.marginTop = '8px'; card.append(n); }
    }
    v.append(card);
  });
}

/* ---------- SCENE ENGINE ---------- */
let scene = null;
function startScene(id, mode){
  const sc = sceneById(id); const t = tutorById(sc.tutor);
  scene = { sc, t, mode, i:0, score:0, max: sc.turns.length*2, xp:0, newPhrases:0, attempts:0, locked:false, showEnAll:false };
  // prime audio on this tap (iOS)
  try { if ('speechSynthesis' in window && thaiVoice){ const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } } catch(e){}
  if (S.sfx) try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume && actx.resume(); } catch(e){}
  go('scene');
  $('#chat').innerHTML = ''; $('#panel').innerHTML = '';
  $('#sEnAll').classList.remove('on');
  updateProg();
  const intro = el('div','sceneintro', sc.emoji + '  ' + sc.title + (mode === 'tiles' ? '  ·  Tiles mode' : ''));
  intro.append(el('div', null, sc.intro));
  $('#chat').append(intro);
  nextTurn();
}
function updateProg(){ $('#sProg').style.width = (scene.i / scene.sc.turns.length * 100) + '%'; }
function scrollChat(){ const c = $('#chat'); requestAnimationFrame(() => c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' })); }
function bubble(who, l, opts={}){
  const m = el('div','msg' + (who === 'me' ? ' me' : '') + (opts.meh ? ' meh' : ''));
  if (who !== 'me'){ const a = el('div','mav', scene.t.emoji); a.style.background = scene.t.color + '33'; m.append(a); }
  const b = el('div','bubble' + ((scene.showEnAll || opts.showEn) ? ' show-en' : ''));
  b.append(el('div','ro', l.ro), el('div','th', l.th), el('div','en', l.en));
  const row = el('div','brow');
  if (canSpeak()){ const sp = el('button','mini','🔊'); sp.setAttribute('aria-label','Play audio'); sp.onclick = e => { e.stopPropagation(); speak(l.th, sp); }; row.append(sp); b._sp = sp; }
  const en = el('button','mini','EN'); en.setAttribute('aria-label','Show English'); en.onclick = e => { e.stopPropagation(); b.classList.toggle('show-en'); };
  row.append(en); b.append(row);
  b.onclick = () => b.classList.toggle('show-en');
  m.append(b); $('#chat').append(m); scrollChat();
  return b;
}
async function tutorSays(l, pid){
  const ty = el('div','msg'); const a = el('div','mav', scene.t.emoji); a.style.background = scene.t.color + '33';
  const tb = el('div','bubble typing'); tb.append(el('i'), el('i'), el('i')); ty.append(a, tb); $('#chat').append(ty); scrollChat();
  await sleep(650);
  ty.remove();
  const b = bubble('tutor', l);
  if (pid && addPhrase(pid)) scene.newPhrases++;
  if (S.autoplay && canSpeak()) speak(l.th, b._sp);
  return b;
}
async function nextTurn(){
  const { sc } = scene;
  if (scene.i >= sc.turns.length){
    $('#panel').innerHTML = '';
    await tutorSays(line(sc.outro), sc.id + ':0:o');
    await sleep(1400);
    if (scene) finishScene();
    return;
  }
  const turn = sc.turns[scene.i];
  $('#panel').innerHTML = '';
  await tutorSays(line(turn.t), sc.id + ':' + scene.i + ':t');
  scene.attempts = 0; scene.locked = false;
  if (scene.mode === 'tiles') renderTiles(turn); else renderChoices(turn);
}
function panelHead(label){
  const h = el('div','phead'); h.append(el('div','lbl', label));
  const te = el('button','toggle-en' + (S.showEn ? ' on' : ''), S.showEn ? 'Meanings on' : 'Meanings off');
  te.onclick = () => { S.showEn = !S.showEn; save(); document.querySelectorAll('.choice .en').forEach(e => e.style.display = S.showEn ? '' : 'none'); te.classList.toggle('on', S.showEn); te.textContent = S.showEn ? 'Meanings on' : 'Meanings off'; };
  if (scene.mode !== 'tiles') h.append(te);
  if (dict){ const mic = el('button','mic','🎙️'); mic.setAttribute('aria-label','Say your reply'); h.append(mic); h._mic = mic; }
  return h;
}

/* choices mode */
function renderChoices(turn){
  const p = $('#panel'); p.innerHTML = '';
  const head = panelHead('Your reply'); p.append(head);
  const heard = el('div','heard'); p.append(heard);
  const wrap = el('div','choices');
  const opts = shuffle(turn.c.map(c => ({ l: line(c), score: c[3], note: c[4] })));
  opts.forEach(o => {
    const row = el('div','choice');
    const pick = el('button','pick'); pick.append(el('div','ro', o.l.ro), el('div','th', o.l.th));
    const en = el('div','en', o.l.en); if (!S.showEn) en.style.display = 'none'; pick.append(en);
    pick.onclick = () => choose(o, row);
    row.append(pick);
    if (canSpeak()){ const say = el('button','say','🔊'); say.setAttribute('aria-label','Hear this reply'); say.onclick = () => speak(o.l.th, say); row.append(say); }
    o.row = row; wrap.append(row);
  });
  p.append(wrap);
  if (head._mic) wireMic(head._mic, heard, text => {
    let best = null, bs = 0;
    opts.forEach(o => { if (o.row.classList.contains('bad')) return; const s = matchScore(text, o.l); if (s > bs){ bs = s; best = o; } });
    if (best && bs >= 0.45){ choose(best, best.row, true); return true; }
    return false;
  });
}
async function choose(o, row, spoken){
  if (scene.locked) return;
  scene.attempts++;
  const turn = scene.sc.turns[scene.i];
  if (o.score === 0){
    row.classList.add('bad','shake'); blip('bad');
    bubble('me', o.l, { meh:true });
    const h = HUH[Math.floor(Math.random()*HUH.length)];
    scene.locked = true;
    await sleep(350);
    const b = bubble('tutor', line(h)); if (S.autoplay && canSpeak()) speak(line(h).th, b._sp);
    const tip = el('div','tipcard bad'); tip.append(el('b', null, 'Hint'), document.createTextNode(o.note || 'Not quite. Try another reply.'));
    $('#chat').append(tip); scrollChat();
    scene.locked = false;
    return;
  }
  scene.locked = true;
  const pts = scene.attempts === 1 ? o.score : 0;
  scene.score += pts;
  const xp = pts === 2 ? 10 : pts === 1 ? 5 : 0; scene.xp += xp;
  row.classList.add(o.score === 2 ? 'good' : 'meh'); blip(o.score === 2 ? 'good' : 'meh');
  if (xp) toast((o.score === 2 ? 'Natural! ' : 'Okay! ') + '+' + xp + ' XP' + (spoken ? ' 🎙️' : ''));
  document.querySelectorAll('.choice .pick').forEach(b => b.disabled = true);
  bubble('me', o.l, { meh: o.score !== 2 });
  if (addPhrase(scene.sc.id + ':' + scene.i + ':b')) scene.newPhrases++;
  if (o.score === 1){
    const best = line(turn.c.find(c => c[3] === 2));
    const tip = el('div','tipcard meh'); tip.append(el('b', null, 'Tip'), document.createTextNode(o.note || ''));
    const nat = el('div'); nat.style.marginTop = '6px'; nat.append(document.createTextNode('More natural: '), el('strong', null, best.ro));
    tip.append(nat); $('#chat').append(tip); scrollChat();
    const p = $('#panel'); p.innerHTML = '';
    const c = el('button','btn primary cont','Continue'); c.onclick = advance; p.append(c);
    return;
  }
  await sleep(700);
  advance();
}
function advance(){ if (!scene) return; scene.i++; updateProg(); nextTurn(); }

/* tiles mode */
const tok = s => s.split(/\s+/).map(w => w.replace(/[,.!?]/g,'')).filter(Boolean);
function renderTiles(turn){
  const p = $('#panel'); p.innerHTML = '';
  const bestC = turn.c.find(c => c[3] === 2); const best = line(bestC);
  const wrongC = turn.c.find(c => c[3] === 0);
  const target = tok(best.ro);
  const extras = shuffle(tok(line(wrongC).ro).filter(w => !target.includes(w))).slice(0, 2);
  const tiles = shuffle(target.concat(extras)).map((w, i) => ({ w, i }));
  const head = panelHead('Build your reply'); p.append(head);
  const goal = el('div','tilegoal'); goal.append(document.createTextNode('Say: '), el('b', null, best.en)); p.append(goal);
  const heard = el('div','heard'); p.append(heard);
  const tray = el('div','tray'); const pool = el('div','pool');
  let chosen = [];
  const redraw = () => {
    tray.innerHTML = ''; tray.classList.remove('no');
    chosen.forEach((t, k) => { const b = el('button','tile', t.w); b.onclick = () => { if (scene.locked) return; chosen.splice(k,1); t.btn.classList.remove('used'); redraw(); }; tray.append(b); });
    check.disabled = chosen.length !== target.length;
  };
  tiles.forEach(t => { const b = el('button','tile', t.w); t.btn = b; b.onclick = () => { if (scene.locked || b.classList.contains('used') || chosen.length >= target.length) return; b.classList.add('used'); chosen.push(t); redraw(); }; pool.append(b); });
  const row = el('div','lbtns');
  const hear = el('button','btn ghost','🔊 Hint'); hear.style.flex = '0 0 auto';
  hear.onclick = () => speak(best.th, hear);
  const check = el('button','btn primary','Check'); check.disabled = true;
  if (canSpeak()) row.append(hear);
  row.append(check);
  p.append(tray, pool, row);
  const succeed = async (pts, spoken) => {
    scene.locked = true; tray.classList.add('ok'); blip(pts ? 'good' : 'meh');
    scene.score += pts; const xp = Math.round((pts === 2 ? 10 : pts === 1 ? 5 : 0) * 1.5); scene.xp += xp;
    if (xp) toast((pts === 2 ? 'Perfect! ' : 'Got it! ') + '+' + xp + ' XP' + (spoken ? ' 🎙️' : ''));
    bubble('me', best, { meh: pts !== 2 });
    if (addPhrase(scene.sc.id + ':' + scene.i + ':b')) scene.newPhrases++;
    await sleep(800); advance();
  };
  check.onclick = async () => {
    if (scene.locked) return;
    scene.attempts++;
    const ok = chosen.map(t => t.w).join(' ') === target.join(' ');
    if (ok) return succeed(scene.attempts === 1 ? 2 : 1);
    blip('bad'); tray.classList.add('no','shake'); setTimeout(()=>tray.classList.remove('shake'), 400);
    if (scene.attempts === 1){
      const tip = el('div','tipcard bad'); tip.append(el('b', null, 'Not quite'), document.createTextNode('Check the word order and try once more. Tap a tile in the answer to remove it.'));
      $('#chat').append(tip); scrollChat();
    } else {
      scene.locked = true;
      const rv = el('div','reveal'); rv.append(document.createTextNode('Answer: '), el('b', null, best.ro));
      p.insertBefore(rv, tray);
      row.innerHTML = ''; const c = el('button','btn primary','Continue');
      c.onclick = async () => { scene.locked = false; bubble('me', best, { meh:true }); if (addPhrase(scene.sc.id + ':' + scene.i + ':b')) scene.newPhrases++; await sleep(300); advance(); };
      row.append(c);
    }
  };
  if (head._mic) wireMic(head._mic, heard, text => {
    if (matchScore(text, best) >= 0.5){
      pool.querySelectorAll('.tile').forEach(b => b.classList.add('used'));
      chosen = target.map(w => ({ w, btn: el('span') })); redraw();
      succeed(scene.attempts === 0 ? 2 : 1, true); return true;
    }
    return false;
  });
}

/* mic wiring (dictation capability) */
function wireMic(btn, heardEl, onText){
  let text = '', partial = '', active = false;
  const offs = [];
  btn.onclick = () => {
    if (scene.locked) return;
    if (active){ dict.stop().catch(()=>{}); return; }
    text = ''; partial = '';
    let p;
    try { p = dict.start(); } catch(e){ heardEl.textContent = 'Mic unavailable here. Tap a reply instead.'; return; }
    active = true; btn.classList.add('listening'); heardEl.textContent = 'Listening… say your reply in Thai';
    Promise.resolve(p).catch(err => {
      active = false; btn.classList.remove('listening');
      heardEl.textContent = (err && err.code === 'not_granted') ? 'Mic permission was declined. Tap a reply instead.' : 'Couldn\'t start the mic. Try again or tap a reply.';
      if (err && err.code === 'not_granted') btn.remove();
    });
  };
  if (!dictWired){
    dictWired = true;
    dict.onPartial(({text: t}) => dictH && dictH.partial(t));
    dict.onFinal(({text: t}) => dictH && dictH.final(t));
    dict.onState(({state}) => dictH && dictH.state(state));
  }
  dictH = {
    partial: t => { partial = t; heardEl.textContent = 'Heard: ' + (text + ' ' + partial).trim(); },
    final: t => { text = (text + ' ' + t).trim(); partial = ''; heardEl.textContent = 'Heard: ' + text; dict.stop().catch(()=>{}); },
    state: st => {
      if (st === 'listening') return;
      if (!active) return;
      active = false; btn.classList.remove('listening');
      const said = (text + ' ' + partial).trim();
      if (!said){ heardEl.textContent = 'Didn\'t catch that. Try again or tap a reply.'; return; }
      if (!onText(said)) heardEl.textContent = 'Heard: "' + said + '". Not quite a match, try again or tap a reply.';
      else heardEl.textContent = '';
    }
  };
}

/* finish */
function finishScene(){
  const sc = scene.sc; const acc = scene.score / scene.max;
  const stars = acc >= 0.9 ? 3 : acc >= 0.65 ? 2 : 1;
  const bonus = Math.round(20 * (scene.mode === 'tiles' ? 1.5 : 1));
  const gained = scene.xp + bonus;
  const prevLevel = levelOf(S.tutorXp[sc.tutor] || 0);
  S.xp += gained; S.tutorXp[sc.tutor] = (S.tutorXp[sc.tutor] || 0) + gained;
  const rec = S.scenes[sc.id] || { stars:0, plays:0, best:0 };
  const firstTime = !S.scenes[sc.id];
  rec.stars = Math.max(rec.stars, stars); rec.plays++; rec.best = Math.max(rec.best, Math.round(acc*100));
  S.scenes[sc.id] = rec;
  const streakUp = bumpStreak();
  if (pendingRemote){ /* local play wins: keep local, push it */ pendingRemote = null; }
  save();
  const newLevel = levelOf(S.tutorXp[sc.tutor]);
  const done = scene; scene = null;
  renderResult({ sc, stars, acc, gained, newPhrases: done.newPhrases, streakUp, levelUp: newLevel > prevLevel ? newLevel : 0, firstTime, mode: done.mode });
}
function renderResult(r){
  const t = tutorById(r.sc.tutor); const v = $('#v-result'); v.innerHTML = '';
  go('result'); refreshHeader();
  const box = el('div','result');
  box.append(el('div','big', r.stars === 3 ? '🏆' : r.stars === 2 ? '🎉' : '👏'));
  box.append(el('h3', null, r.stars === 3 ? 'Kèng mâak! เก่งมาก' : r.stars === 2 ? 'Dii mâak! ดีมาก' : 'Sùu sùu! สู้ๆ'));
  box.append(el('div','rs', r.sc.title + ' with ' + t.name));
  const bs = el('div','bigstars'); for (let i=0;i<3;i++) bs.append(el('span', null, '★')); box.append(bs);
  const grid = el('div','rgrid');
  [['+' + r.gained,'XP'],[Math.round(r.acc*100) + '%','accuracy'],['+' + r.newPhrases,'new phrases']].forEach(([a,b]) => { const d = el('div'); d.append(el('b',null,a), el('span',null,b)); grid.append(d); });
  box.append(grid);
  const notes = [];
  if (r.streakUp) notes.push('🔥 Streak: ' + S.streak.count + (S.streak.count === 1 ? ' day' : ' days'));
  if (r.levelUp) notes.push('⬆️ ' + t.name + ' level ' + r.levelUp + '!');
  if (r.firstTime) notes.push('🧩 Tiles mode unlocked for this lesson');
  const mine = SCENES.filter(s => s.tutor === r.sc.tutor); const idx = mine.indexOf(r.sc);
  if (r.firstTime && mine[idx+1] && !mine[idx+1].added) notes.push('🔓 Unlocked: ' + mine[idx+1].title);
  notes.forEach(n => { const d = el('div','rs', n); d.style.marginBottom = '6px'; box.append(d); });
  const btns = el('div','rbtns');
  const next = mine[idx+1];
  if (next){ const b = el('button','btn primary','Next lesson: ' + next.title); b.onclick = () => startScene(next.id, 'choice'); btns.append(b); }
  const again = el('button','btn pink', r.stars < 3 ? 'Replay for 3 stars' : 'Try it in Tiles mode');
  again.onclick = () => startScene(r.sc.id, r.stars < 3 ? r.mode : 'tiles'); btns.append(again);
  const back = el('button','btn ghost','Back to ' + t.name); back.onclick = () => go('tutor', t.id); btns.append(back);
  box.append(btns); v.append(box);
  setTimeout(() => { bs.querySelectorAll('span').forEach((s,i) => setTimeout(() => s.classList.toggle('on', i < r.stars), i*260)); }, 250);
  blip('win'); if (r.stars === 3) setTimeout(burst, 800);
}
$('#sClose').onclick = () => {
  confirmSheet('Leave this lesson?', 'Your progress in this lesson will be lost. Phrases you\'ve met stay in your phrasebook.', 'Leave', () => {
    try { speechSynthesis.cancel(); } catch(e){}
    const t = scene ? scene.t.id : currentTutor; scene = null; save();
    if (pendingRemote){ S = Object.assign({}, DEFAULTS, pendingRemote); pendingRemote = null; }
    go('tutor', t);
  });
};
$('#sEnAll').onclick = () => {
  if (!scene) return; scene.showEnAll = !scene.showEnAll;
  $('#sEnAll').classList.toggle('on', scene.showEnAll);
  document.querySelectorAll('#chat .bubble').forEach(b => { if (!b.classList.contains('typing')) b.classList.toggle('show-en', scene.showEnAll); });
};

/* ---------- PHRASEBOOK ---------- */
let bookQuery = '';
function renderBook(){
  refreshHeader();
  const v = $('#v-book'); v.innerHTML = '';
  v.append(el('h2', null, 'Phrasebook'));
  const ids = Object.keys(S.phrases).filter(phraseText);
  const due = dueList().length;
  v.append(el('div','sub', ids.length + ' phrases collected · ' + due + ' due for review'));
  const row = el('div','lbtns'); row.style.marginBottom = '14px';
  const r1 = el('button','btn jade', due ? 'Review ' + Math.min(due, 10) + ' due' : 'Nothing due'); r1.disabled = !due; r1.onclick = () => startReview(false);
  const r2 = el('button','btn ghost','Practice any'); r2.disabled = ids.length < 1; r2.onclick = () => startReview(true);
  row.append(r1, r2); v.append(row);
  if (!ids.length){
    const e = el('div','empty'); e.append(el('div','e','📒'), el('div', null, 'Phrases you meet in lessons land here, ready for quick review.'));
    v.append(e); return;
  }
  const s = el('input','search'); s.type = 'search'; s.placeholder = 'Search English or romanization'; s.value = bookQuery;
  s.oninput = () => { bookQuery = s.value; drawList(); };
  v.append(s);
  const list = el('div'); v.append(list);
  function drawList(){
    list.innerHTML = '';
    const q = stripTone(bookQuery);
    TUTORS.forEach(t => {
      const items = ids.filter(id => sceneById(id.split(':')[0]).tutor === t.id).map(id => ({ id, l: phraseText(id), p: S.phrases[id] }))
        .filter(x => !q || stripTone(x.l.ro).includes(q) || stripTone(x.l.en).includes(q));
      if (!items.length) return;
      const g = el('div','pgroup'); const h = el('h4'); h.append(document.createTextNode(t.emoji + '  ' + t.name + ' · ' + t.topic)); g.append(h);
      items.forEach(x => {
        const r = el('div','phrase'); const tx = el('div','pt');
        tx.append(el('div','ro', x.l.ro), el('div','th', x.l.th), el('div','en', x.l.en));
        r.append(tx, el('span','box', x.p.due <= today() ? 'due' : '●'.repeat(Math.min(x.p.box+1,5))));
        if (canSpeak()){ const sp = el('button','mini','🔊'); sp.onclick = () => speak(x.l.th, sp); r.append(sp); }
        g.append(r);
      });
      list.append(g);
    });
  }
  drawList();
}

/* ---------- REVIEW ---------- */
let rv = null;
function startReview(any){
  let ids = any ? shuffle(Object.keys(S.phrases).filter(phraseText)).slice(0,10) : shuffle(dueList()).slice(0,10);
  if (!ids.length) return;
  rv = { ids, k:0, got:0, any };
  go('review'); drawCard();
}
function drawCard(){
  const v = $('#v-review'); v.innerHTML = '';
  const top = el('div','lbtns'); top.style.marginTop = '4px';
  const x = el('button','back','✕ Close'); x.onclick = () => { rv = null; go('book'); };
  v.append(x);
  if (rv.k >= rv.ids.length){
    if (bumpStreak()) toast('🔥 Streak: ' + S.streak.count);
    save();
    const e = el('div','result'); e.append(el('div','big','📒'), el('h3', null, 'Review done!'), el('div','rs', rv.got + ' of ' + rv.ids.length + ' remembered'));
    const b = el('button','btn primary','Back to phrasebook'); b.style.marginTop = '20px'; b.style.width = '100%'; b.onclick = () => { rv = null; go('book'); };
    e.append(b); v.append(e); blip('win'); return;
  }
  const id = rv.ids[rv.k]; const l = phraseText(id); const sc = sceneById(id.split(':')[0]);
  v.append(el('div','rcount', 'Card ' + (rv.k+1) + ' of ' + rv.ids.length));
  const flash = el('div','flash'); const card = el('div','fcard');
  const f = el('div','face front'); f.append(el('div','q','How do you say…'), el('div','big', l.en), el('div','hint', sc.emoji + ' ' + sc.title + '  ·  tap to reveal'));
  const b = el('div','face back'); b.append(el('div','q','Answer'), el('div','ro', l.ro), el('div','th', l.th));
  card.append(f, b); flash.append(card); v.append(flash);
  const btns = el('div','lbtns');
  const again = el('button','btn ghost','Again'); const got = el('button','btn jade','Got it');
  const reveal = el('button','btn primary','Show answer');
  const flip = () => {
    if (card.classList.contains('flipped')) { if (canSpeak()) speak(l.th); return; }
    card.classList.add('flipped'); btns.innerHTML = ''; btns.append(again, got);
    if (canSpeak()) speak(l.th);
  };
  card.onclick = flip; reveal.onclick = flip;
  btns.append(reveal); v.append(btns);
  const grade = ok => {
    const p = S.phrases[id];
    if (ok){ p.box = Math.min(p.box + 1, INTERVALS.length - 1); rv.got++; blip('good'); }
    else { p.box = 0; blip('meh'); }
    p.due = ok ? addDays(today(), INTERVALS[p.box]) : today();
    if (!rv.any || ok) save();
    rv.k++; drawCard();
  };
  again.onclick = () => grade(false); got.onclick = () => grade(true);
}

/* ---------- SETTINGS ---------- */
function renderSettings(){
  const v = $('#v-settings'); v.innerHTML = '';
  v.append(el('h2', null, 'Settings'));
  const s1 = el('div','set');
  const nameRow = (label, sub, key, ph) => {
    const r = el('div','srow'); const l = el('div','sl', label); if (sub) l.append(el('small', null, sub));
    const i = el('input'); i.type = 'text'; i.value = S[key] || ''; i.placeholder = ph; i.autocomplete = 'off';
    i.onchange = () => { S[key] = i.value.trim(); save(); refreshHeader(); };
    r.append(l, i); return r;
  };
  s1.append(nameRow('Your name', 'Used in introductions', 'name', 'Bryan'), nameRow('Name in Thai', 'Read aloud by the Thai voice', 'nameTh', 'ไบรอัน'));
  const pr = el('div','srow'); const pl = el('div','sl','Polite particle'); pl.append(el('small', null, 'Male speaker: khráp (ครับ)')); pr.append(pl, el('span','tag','khráp')); s1.append(pr);
  v.append(s1);

  const s2 = el('div','set');
  const sw = (label, sub, key) => {
    const r = el('div','srow'); const l = el('div','sl', label); if (sub) l.append(el('small', null, sub));
    const b = el('button','sw' + (S[key] ? ' on' : '')); b.setAttribute('role','switch'); b.setAttribute('aria-checked', !!S[key]); b.setAttribute('aria-label', label);
    b.onclick = () => { S[key] = !S[key]; b.classList.toggle('on', S[key]); b.setAttribute('aria-checked', S[key]); save(); };
    r.append(l, b); return r;
  };
  const rr = el('div','srow'); const rl = el('div','sl','Voice speed'); const rs = el('small', null, Math.round(S.rate*100) + '%'); rl.append(rs);
  const range = el('input'); range.type = 'range'; range.min = '0.6'; range.max = '1.1'; range.step = '0.05'; range.value = S.rate;
  range.oninput = () => { S.rate = +range.value; rs.textContent = Math.round(S.rate*100) + '%'; };
  range.onchange = () => { save(); speak('สวัสดีครับ'); };
  rr.append(rl, range);
  s2.append(rr, sw('Auto-play tutor lines', 'Hear each line as it appears', 'autoplay'), sw('Show meanings on replies', 'English under each answer choice', 'showEn'), sw('Sound effects', 'Chimes for right and wrong', 'sfx'));
  const test = el('div','srow'); const tl = el('div','sl','Thai voice');
  tl.append(el('small', null, thaiVoice ? 'Using: ' + thaiVoice.name : ttsCap ? 'Using Claude voice' : 'No Thai voice found on this device'));
  const tb = el('button','mini','🔊 Test'); tb.onclick = () => speak('สวัสดีครับ ยินดีที่ได้รู้จักครับ', tb);
  test.append(tl, tb); s2.append(test);
  v.append(s2);
  if (!canSpeak()){
    v.append(el('div','note','To hear Thai on iPhone: Settings › Accessibility › Spoken Content › Voices › Thai, then download a voice. On Android: Settings › Text-to-speech › install Thai for Google Speech Services. Reload the game afterwards.'));
  }
  const s3 = el('div','set');
  const sy = el('div','srow'); const syl = el('div','sl','Progress saving');
  syl.append(el('small', null, cloud.ref ? (cloud.status === 'synced' ? 'Saved to your Claude account, follows you across devices' : 'Saving to your Claude account…') : 'Saved on this device, in this app'));
  sy.append(syl, el('span','tag', cloud.ref ? '☁️ Synced' : '📱 Local')); s3.append(sy);
  const mr = el('div','srow'); const ml = el('div','sl','Speaking practice');
  ml.append(el('small', null, dict ? 'Mic available: tap 🎙️ in a lesson to say your reply' : 'Mic not available in this browser. Try Chrome on Android or Safari on iPhone.'));
  mr.append(ml, el('span','tag', dict ? '🎙️ On' : 'Off')); s3.append(mr);
  const rs2 = el('div','srow'); const rsl = el('div','sl'); const rsb = el('button','danger','Reset all progress'); rsb.style.minHeight = '44px';
  rsb.onclick = () => confirmSheet('Reset everything?', 'This clears your XP, stars, streak and phrasebook. It can\'t be undone.', 'Reset', () => {
    const keep = { name:S.name, nameTh:S.nameTh, rate:S.rate, autoplay:S.autoplay, showEn:S.showEn, sfx:S.sfx };
    S = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), keep); save(); toast('Progress reset'); renderSettings(); refreshHeader();
  });
  rsl.append(rsb); rs2.append(rsl);
  if (canOfferInstall()){ const ir = el('div','srow'); const il = el('div','sl','Install app'); il.append(el('small', null, 'Add Thai Talk to your home screen')); const ib = el('button','mini','📲 Install'); ib.onclick = doInstall; ir.append(il, ib); s3.append(ir); }
  else if (isStandalone()){ const ir = el('div','srow'); const il = el('div','sl','Installed app'); il.append(el('small', null, 'Running from your home screen, works offline')); ir.append(il, el('span','tag','✅')); s3.append(ir); }
  s3.append(rs2);
  v.append(s3);
  v.append(el('div','note','Romanization guide: à low · â falling · á high · ǎ rising · no mark = mid tone. bp/dt are unaspirated p/t, ph/th/kh are breathy. ue ≈ the "eu" in French "peu", oe ≈ "er" without the r, aw ≈ "aw" in "saw".'));
}


/* ---------- install (PWA) ---------- */
let deferredPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; if (current === 'home') renderHome(); if (current === 'settings') renderSettings(); });
window.addEventListener('appinstalled', () => { deferredPrompt = null; toast('Installed! Find Thai Talk on your home screen'); if (current === 'home') renderHome(); });
function canOfferInstall(){ return !isStandalone() && !window.claude && (deferredPrompt || isIOS()); }
async function doInstall(){
  if (deferredPrompt){
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch(e){}
    deferredPrompt = null; if (current === 'home') renderHome(); return;
  }
  const sh = $('#sheet'); sh.innerHTML = '';
  sh.append(el('h3', null, 'Add Thai Talk to your Home Screen'));
  const p = el('p'); p.append(document.createTextNode('In Safari, tap the Share button (the square with an arrow), scroll down and choose '), el('b', null, 'Add to Home Screen'), document.createTextNode('. Thai Talk then opens full screen and works offline.'));
  sh.append(p);
  const ok = el('button','btn primary','Got it'); ok.style.width = '100%'; ok.onclick = closeModal; sh.append(ok);
  $('#modal').classList.add('show');
}
function installCard(){
  if (!canOfferInstall()) return null;
  try { if (localStorage.getItem('thaitalk.installDismissed') === '1') return null; } catch(e){}
  const c = el('div','install-card');
  const ic = el('img'); ic.src = '/icons/icon-192.png'; ic.alt = ''; ic.width = 48; ic.height = 48;
  const tx = el('div','it'); tx.append(el('div','t','Install Thai Talk'), el('div','d','Practise offline, full screen, from your home screen.'));
  const b = el('button','btn pink','Install'); b.style.flex = '0 0 auto'; b.onclick = doInstall;
  const x = el('button','ix','✕'); x.setAttribute('aria-label','Dismiss'); x.onclick = () => { try { localStorage.setItem('thaitalk.installDismissed','1'); } catch(e){} c.remove(); };
  c.append(ic, tx, b, x);
  return c;
}
if ('serviceWorker' in navigator && !window.claude && location.protocol !== 'file:'){
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(()=>{}); });
  // When a new version (e.g. today's lesson) takes over, reload once, but never mid-lesson.
  let reloaded = false, hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController){ hadController = true; return; }
    if (reloaded) return;
    const doReload = () => { if (reloaded) return; reloaded = true; location.reload(); };
    if (!scene && current !== 'review') doReload();
    else { const iv = setInterval(() => { if (!scene && current !== 'review'){ clearInterval(iv); doReload(); } }, 2000); }
  });
}

/* ---------- capabilities ---------- */
async function initCaps(){
  if (!window.claude || !window.claude.use) return;
  try { const d = await window.claude.use('dictation'); if (d){ dict = d; if (current === 'settings') renderSettings(); } } catch(e){}
  try { const t = await window.claude.use('tts'); if (t){ ttsCap = t; if (!thaiVoice && current === 'home') renderHome(); } } catch(e){}
}

/* ---------- boot ---------- */
if (!window.claude) dict = makeNativeDict();
window.ThaiTalk = { startScene }; // used by scripts/smoke_test.py
drawLights();
go('home');
function whenClaude(fn, n){ if (window.claude && window.claude.use) fn(); else if ((n||0) < 6) setTimeout(() => whenClaude(fn, (n||0)+1), 400); }
whenClaude(initCaps);
whenClaude(initCloud);
setTimeout(pickVoice, 600);
})();
