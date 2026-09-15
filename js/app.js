/* MySpeckTrainer — Strength · Treadmill · Core
   Vanilla JS PWA. All state lives in localStorage. */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DOW1 = ["M","T","W","T","F","S","S"];
const KINDS = ["push","legs","pull","cardio"];
const LIFT_KINDS = ["push","legs","pull"];
const MS_PER_DAY = 24*60*60*1000;

const fmt = d => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const fmtLong = d => `${DOW[(d.getDay()+6)%7]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseISO = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
function mondayOf(d) { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const dow = (r.getDay()+6)%7; r.setDate(r.getDate()-dow); return r; }

let P, WEEKS, store, state, today, todayWeekIdx, todayDowIdx;

/* ---------------- Storage ---------------- */
const STORE_KEY = "speck_strength_v1";
function defaultSettings() {
  return { gymDays:[0,2,4], floatDay:5, startDate: iso(mondayOf(new Date())), units:"lb", cycle:1, theme:"system" };
}
function loadStore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { s = null; }
  if(!s || typeof s !== 'object') s = {};
  s.settings = Object.assign(defaultSettings(), s.settings || {});
  if(!Array.isArray(s.settings.gymDays) || s.settings.gymDays.length===0) s.settings.gymDays = [0,2,4];
  s.settings.gymDays = [...new Set(s.settings.gymDays)].filter(d=>d>=0&&d<=4).sort((a,b)=>a-b).slice(0,3);
  if(!s.sessions) s.sessions = {};
  if(!s.weeks) s.weeks = {};
  return s;
}
function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} }
function applyTheme() { const t = store.settings.theme; if(t==='dark'||t==='light') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }

const sessionKey = (cycle, week, kind, dow) => kind==='rest' ? `c${cycle}-w${week}-rest-${dow}` : `c${cycle}-w${week}-${kind}`;
function getSession(key) { return store.sessions[key] || null; }
function touchSession(key) { if(!store.sessions[key]) store.sessions[key] = {}; return store.sessions[key]; }
function setDone(key, v) { const s = touchSession(key); s.done = v; s.doneAt = v ? iso(new Date()) : undefined; saveStore(); }
function setNote(key, v) { const s = touchSession(key); s.note = v; saveStore(); }
function setChoice(key, v) { const s = touchSession(key); s.choice = v; saveStore(); }
function setSetField(key, exId, idx, field, val) {
  const s = touchSession(key);
  if(!s.sets) s.sets = {};
  if(!s.sets[exId]) s.sets[exId] = [];
  if(!s.sets[exId][idx]) s.sets[exId][idx] = {};
  const n = val === '' ? null : Number(val);
  s.sets[exId][idx][field] = (n===null || Number.isNaN(n)) ? null : n;
  saveStore();
}
function setSwap(key, slot, v) { const s = touchSession(key); if(!s.swaps) s.swaps = {}; if(v) s.swaps[slot] = true; else delete s.swaps[slot]; saveStore(); }

/* ---------------- Program helpers ---------------- */
const getBlock = w => P.blocks.find(b => b.weeks.includes(w)) || P.blocks[P.blocks.length-1];
const blockIndex = w => Math.max(0, P.blocks.indexOf(getBlock(w)));
const setsFor = w => { const b = getBlock(w); return b.sets[w - b.weeks[0]] ?? b.sets[b.sets.length-1]; };
const repsFor = (ex, w) => ex.reps || getBlock(w).reps;
const repRange = r => { const [lo, hi] = String(r).split('-').map(Number); return { lo, hi: hi||lo }; };
const restSeconds = w => parseInt(getBlock(w).rest) || 60;
const startDate = () => parseISO(store.settings.startDate);
const weekStart = w => addDays(startDate(), (w-1)*7);
const unitStep = () => store.settings.units==='kg' ? P.progression.dbStepKg : P.progression.dbStepLb;
const isLiftKind = k => LIFT_KINDS.includes(k);
const toneOf = kind => P.days[kind].tone;
const col = tone => `var(--tone-${tone})`;
const tint = (tone, pct) => `color-mix(in srgb, var(--tone-${tone}) ${pct}%, transparent)`;

/* ---------------- Week plans (which session lands on which day) ----------------
   plan[kind] = day index 0-6, 'skip', or null (not on a day this week) */
const weekKey = w => `c${store.settings.cycle}-w${w}`;
function defaultPlan() {
  const gym = [...store.settings.gymDays].sort((a,b)=>a-b);
  let f = store.settings.floatDay;
  if(gym.includes(f)) { const free = [0,1,2,3,4,5,6].filter(d=>!gym.includes(d)); f = free.find(d=>d>f) ?? free[free.length-1]; }
  return { push: gym[0] ?? null, legs: gym[1] ?? null, pull: gym[2] ?? null, cardio: f };
}
function weekPlan(w) { const o = store.weeks[weekKey(w)]; return o ? Object.assign(defaultPlan(), o) : defaultPlan(); }
function isWeekEdited(w) { return !!store.weeks[weekKey(w)]; }
function setPlan(w, patch) { store.weeks[weekKey(w)] = Object.assign({}, weekPlan(w), patch); saveStore(); }
function assignDay(w, dow, kind) {
  const plan = weekPlan(w), patch = {};
  KINDS.forEach(k => { if(plan[k]===dow) patch[k] = null; });
  if(kind && kind!=='rest') patch[kind] = dow;
  setPlan(w, patch);
}
function skipKind(w, kind, v) { setPlan(w, { [kind]: v ? 'skip' : null }); }
function resetWeek(w) { delete store.weeks[weekKey(w)]; saveStore(); }

function buildWeek(w) {
  const plan = weekPlan(w), ws = weekStart(w), cycle = store.settings.cycle;
  const days = [];
  for(let d=0; d<7; d++) {
    const kind = KINDS.find(k => plan[k]===d) || 'rest';
    days.push({ dow:d, dowName:DOW[d], dateObj:addDays(ws,d), date:fmt(addDays(ws,d)), kind, key:sessionKey(cycle,w,kind,d), def:P.days[kind] });
  }
  return { week:w, block:getBlock(w), startDate:fmt(ws), endDate:fmt(addDays(ws,6)), days, plan,
    unscheduled: KINDS.filter(k => plan[k]==null), skipped: KINDS.filter(k => plan[k]==='skip') };
}
function dayOfKind(wk, kind) { return wk.days.find(d => d.kind===kind) || null; }

/* ---------------- Variants ---------------- */
function variantFor(slot, w) { return slot.variants[blockIndex(w) % slot.variants.length]; }
function exercisesFor(kind, w, sess) {
  const def = P.days[kind];
  if(!def || !def.exercises) return [];
  return def.exercises.map(slot => {
    const v = variantFor(slot, w);
    const swapped = !!(sess && sess.swaps && sess.swaps[slot.slot]);
    const ex = swapped ? Object.assign({}, v.alt) : Object.assign({}, v);
    ex.slot = slot.slot; ex.anchor = !!slot.anchor; ex.swapped = swapped;
    ex.altName = swapped ? v.name : v.alt.name;
    ex.newThisBlock = !swapped && !slot.anchor && w > 1 && blockIndex(w) !== blockIndex(w-1) && variantFor(slot, w-1).id !== v.id;
    return ex;
  });
}
function coreFor(kind, w) { const c = P.days[kind].core; return Array.isArray(c[0]) ? c[blockIndex(w) % c.length] : c; }
function treadmillFor(kind, w) {
  const order = LIFT_KINDS.indexOf(kind);
  return P.treadmill[(((w-1)*3 + order) % P.treadmill.length + P.treadmill.length) % P.treadmill.length];
}
function allExercisesFor(kind) {
  const seen = new Set(), out = [];
  (P.days[kind].exercises||[]).forEach(slot => slot.variants.forEach(v => [v, v.alt].forEach(e => { if(e && !seen.has(e.id)) { seen.add(e.id); out.push(Object.assign({anchor:!!slot.anchor}, e)); } })));
  return out;
}
function estimateMinutes(kind, w, sess) {
  const sets = setsFor(w);
  let lift = 0;
  exercisesFor(kind, w, sess).forEach(ex => { lift += sets * (ex.perSide ? 2 : 1.5); });
  return { warm:P.meta.warmupMinutes, lift:Math.round(lift), core:P.meta.coreMinutes, total:Math.round(P.meta.warmupMinutes+lift+P.meta.coreMinutes) };
}

/* ---------------- History / progression ---------------- */
function sessionsFor(kind) {
  const out = [];
  Object.entries(store.sessions).forEach(([k, s]) => {
    const m = k.match(/^c(\d+)-w(\d+)-([a-z]+)$/);
    if(m && m[3]===kind) out.push({ cycle:+m[1], week:+m[2], s });
  });
  return out.sort((a,b)=> a.cycle-b.cycle || a.week-b.week);
}
const hasLog = arr => Array.isArray(arr) && arr.some(x => x && (x.w!=null || x.r!=null));
function exerciseLogs(kind, exId) {
  return sessionsFor(kind).filter(e => e.s.sets && hasLog(e.s.sets[exId])).map(e => ({ cycle:e.cycle, week:e.week, sets:e.s.sets[exId].filter(x=>x&&(x.w!=null||x.r!=null)) }));
}
function lastLog(kind, exId, cycle, week) {
  const logs = exerciseLogs(kind, exId).filter(l => l.cycle<cycle || (l.cycle===cycle && l.week<week));
  return logs.length ? logs[logs.length-1] : null;
}
function fmtSets(sets, units) {
  const ws = [...new Set(sets.map(s=>s.w).filter(w=>w!=null))];
  const reps = sets.map(s=>s.r!=null?s.r:'–').join(', ');
  if(ws.length===1) return `${ws[0]} ${units} × ${reps}`;
  return sets.map(s=>`${s.w!=null?s.w:'–'}×${s.r!=null?s.r:'–'}`).join('  ');
}
// Suggest the next session's weight + reps. Double progression: fill the rep range, then the smallest step up.
function suggestNext(ex, last, w) {
  const sets = setsFor(w);
  const { lo, hi } = repRange(repsFor(ex, w));
  const units = store.settings.units;
  const fmtW = x => ex.equip==='Cable' ? `${x} ${units} (stack)` : `${x} ${units}`;
  if(!last) return { kind:'new', weight:null, reps:Array(sets).fill(lo), text:`First time. Start light and aim for ${lo} clean reps per set with 3 left in the tank. Log the weight and the app takes it from here.` };
  const reps = last.sets.map(s=>s.r).filter(r=>r!=null);
  const ws = last.sets.map(s=>s.w).filter(x=>x!=null);
  const weight = ws.length ? Math.max(...ws) : null;
  const step = unitStep();
  const extend = arr => Array.from({length:sets},(_,i)=> arr[Math.min(i, arr.length-1)]);
  if(!reps.length) return { kind:'hold', weight, reps:Array(sets).fill(lo), text:`Reps weren't logged last time. Stay at ${weight!=null?fmtW(weight):'the same weight'} and aim for ${lo}-${hi}.` };
  if(reps.every(r => r >= hi)) {
    const nw = weight!=null ? weight + step : null;
    return { kind:'up', weight:nw, reps:Array(sets).fill(lo), text:`You hit ${hi}+ on every set. Go up ${step} ${units}${ex.equip==='Cable'?' (one plate)':''} and start again at ${lo} reps.` };
  }
  const avg = reps.reduce((a,b)=>a+b,0)/reps.length;
  if(avg < lo - 2 && weight!=null) return { kind:'down', weight:Math.max(0, weight - step), reps:Array(sets).fill(lo), text:`Reps fell well under ${lo}, so that weight is too heavy for now. Drop ${step} ${units} and own ${lo} clean reps.` };
  if(reps.some(r => r < lo)) return { kind:'hold', weight, reps:extend(reps).map(r=>Math.max(lo, Math.min(hi, r))), text:`Same weight. Get every set to at least ${lo} reps before adding more.` };
  return { kind:'add', weight, reps:extend(reps).map(r => Math.min(hi, r + 1)), text:`Same weight, one more rep per set. When every set reaches ${hi}, the weight goes up.` };
}
const fmtSuggest = (sg, units) => sg.weight!=null ? `${sg.weight} ${units} × ${sg.reps.join(', ')}` : `${sg.reps.join(', ')} reps`;

/* ---------------- Counting ---------------- */
function weekStats(w) {
  const wk = buildWeek(w), cycle = store.settings.cycle;
  const planned = KINDS.filter(k => wk.plan[k] !== 'skip');
  const done = KINDS.filter(k => (getSession(sessionKey(cycle, w, k))||{}).done);
  return { planned: planned.length, done: done.length, perfect: planned.length >= 3 && planned.every(k => done.includes(k)), skipped: wk.skipped.length };
}
function cycleStats() { let p=0, d=0; for(let w=1; w<=WEEKS; w++) { const s = weekStats(w); p += s.planned; d += s.done; } return { planned:p, done:d }; }
function sessionProgress(kind, w, sess) {
  const exs = exercisesFor(kind, w, sess), sets = setsFor(w);
  let done = 0;
  exs.forEach(ex => { const arr = (sess && sess.sets && sess.sets[ex.id]) || []; for(let i=0;i<sets;i++) if(arr[i] && arr[i].done) done++; });
  return { done, total: exs.length*sets };
}
function liftSessionsDone() { let n=0; Object.entries(store.sessions).forEach(([k,s]) => { if(s.done && /-(push|legs|pull)$/.test(k)) n++; }); return n; }

/* ---------------- DOM helpers ---------------- */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if(props) Object.entries(props).forEach(([k,v]) => {
    if(v==null || v===false) return;
    if(k==='style'&&typeof v==='object') Object.assign(el.style,v);
    else if(k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(),v);
    else if(k==='className') el.className=v;
    else if(k==='innerHTML') el.innerHTML=v;
    else el.setAttribute(k,v===true?'':v);
  });
  children.flat(Infinity).forEach(c => {
    if(c==null||c===false) return;
    el.appendChild(typeof c==='string'||typeof c==='number' ? document.createTextNode(String(c)) : c);
  });
  return el;
}
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.3 4.3l1.4 1.4M18.3 18.3l1.4 1.4M2.5 12h2M19.5 12h2M4.3 19.7l1.4-1.4M18.3 5.7l1.4-1.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M5 20v-8M11 20V5M17 20v-5"/><path d="M3 20h18"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  chev: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5"/>',
  swap: '<path d="M6.5 8h11l-3-3M17.5 16h-11l3 3"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  edit: '<path d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20z"/>',
  dash: '<path d="M6 12h12"/>',
};
function icon(name, size) {
  const el = document.createElementNS('http://www.w3.org/2000/svg','svg');
  el.setAttribute('viewBox','0 0 24 24'); el.setAttribute('width',size||22); el.setAttribute('height',size||22);
  el.setAttribute('fill','none'); el.setAttribute('stroke','currentColor'); el.setAttribute('stroke-width','1.9'); el.setAttribute('stroke-linecap','round'); el.setAttribute('stroke-linejoin','round');
  el.setAttribute('aria-hidden','true'); el.classList.add('ic');
  el.innerHTML = ICONS[name] || '';
  return el;
}
const dot = (tone, cls) => h('span',{className:`dot${cls?' '+cls:''}`,style:{background:col(tone)}});
function checkDot(tone) { const d = h('span',{className:'dot done',style:{background:col(tone)}}); d.appendChild(icon('check',14)); return d; }

/* ---------------- Rest timer (outside the re-rendered tree) ---------------- */
const timer = { remaining:0, total:0, id:null };
const timerEl = () => document.getElementById('rest-timer');
function startTimer(sec) {
  stopTimer(false);
  timer.total = sec; timer.remaining = sec;
  timer.id = setInterval(() => { timer.remaining--; if(timer.remaining<=0) { stopTimer(true); return; } drawTimer(); }, 1000);
  drawTimer();
}
function stopTimer(finished) {
  if(timer.id) clearInterval(timer.id);
  timer.id = null;
  const el = timerEl();
  document.documentElement.classList.remove('timer-on');
  if(finished) {
    if(navigator.vibrate) navigator.vibrate([120,60,120]);
    el.className = 'rest-timer done';
    el.innerHTML = '';
    el.appendChild(h('span',{className:'rest-timer-text'},'Rest done. Next set.'));
    el.appendChild(h('button',{className:'pill-btn','aria-label':'Dismiss',onClick:()=>{ el.className='rest-timer'; }},icon('close',18)));
    setTimeout(()=>{ if(el.className==='rest-timer done') el.className='rest-timer'; }, 4000);
  } else el.className = 'rest-timer';
}
function drawTimer() {
  const el = timerEl();
  document.documentElement.classList.add('timer-on');
  el.className = 'rest-timer show';
  el.innerHTML = '';
  const pct = timer.total ? (timer.remaining/timer.total)*100 : 0;
  el.appendChild(h('div',{className:'rest-timer-bar'},h('div',{className:'rest-timer-fill',style:{width:pct+'%'}})));
  el.appendChild(h('span',{className:'rest-timer-label'},'Rest'));
  el.appendChild(h('span',{className:'rest-timer-text'},`${Math.floor(timer.remaining/60)}:${String(timer.remaining%60).padStart(2,'0')}`));
  el.appendChild(h('button',{className:'pill-btn',onClick:()=>{ timer.remaining+=15; timer.total+=15; drawTimer(); }},'+15'));
  el.appendChild(h('button',{className:'pill-btn',onClick:()=>stopTimer(false)},'Skip'));
}

/* ---------------- Navigation state ---------------- */
function openScreen(sc) { state.screen = sc; state.sheet = null; state.exOpen = {}; state.warmupOpen = null; render(); }
function closeScreen() { stopTimer(false); state.screen = null; render(); }
function openSession(w, di, from) { openScreen({ type:'session', week:w, di, from: from || state.tab }); }
function openSheet(sh) { state.sheet = sh; render(); }
function closeSheet() { state.sheet = null; render(); }

let noteTimer = null, nextPlanTimer = null;

function render() {
  if(noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
  if(nextPlanTimer) { clearTimeout(nextPlanTimer); nextPlanTimer = null; }
  state.nextPlanCtx = null;
  const viewKey = state.screen ? `${state.screen.type}:${state.screen.week||''}:${state.screen.di??''}` : `tab:${state.tab}:${state.week}`;
  const viewChanged = viewKey !== state.lastViewKey;
  const savedScroll = window.scrollY;
  state.lastViewKey = viewKey;
  const app = document.getElementById('app');
  app.innerHTML = '';
  document.body.classList.toggle('has-tabbar', !state.screen);
  document.body.classList.toggle('sheet-open', !!state.sheet);

  if(state.screen && state.screen.type==='session') renderSession(app);
  else if(state.screen && state.screen.type==='settings') renderSettingsScreen(app);
  else {
    if(state.tab==='plan') renderPlan(app);
    else if(state.tab==='progress') renderProgress(app);
    else renderToday(app);
    app.appendChild(tabbar());
  }
  if(state.sheet) app.appendChild(renderSheet());

  requestAnimationFrame(()=>{
    if(viewChanged) window.scrollTo(0, 0); else window.scrollTo(0, savedScroll);
    if(viewChanged && state.tab==='plan' && !state.screen) { const b = document.querySelector('.wk-chip.active'); if(b) b.scrollIntoView({behavior:'instant',inline:'center',block:'nearest'}); }
  });
}

function tabbar() {
  const bar = h('nav',{className:'tabbar',role:'tablist'});
  [{id:'today',ic:'sun',label:'Today'},{id:'plan',ic:'calendar',label:'Plan'},{id:'progress',ic:'chart',label:'Progress'}].forEach(t => {
    bar.appendChild(h('button',{className:`tab${state.tab===t.id?' active':''}`,role:'tab','aria-selected':state.tab===t.id?'true':'false',onClick:()=>{state.tab=t.id;render();}},icon(t.ic,24),h('span',{className:'tab-label'},t.label)));
  });
  return bar;
}
function largeTitle(title, sub, trailing) {
  return h('header',{className:'lt'},h('div',{className:'lt-row'},h('div',{className:'lt-text'},h('h1',{className:'lt-title'},title),sub?h('div',{className:'lt-sub'},sub):null),trailing||null));
}
function section(title, trailing) { const s = h('section',{className:'sec'}); if(title) s.appendChild(h('div',{className:'sec-head'},h('h2',{className:'sec-title'},title),trailing||null)); return s; }
function todayInfo() {
  if(todayWeekIdx < 0) return { kind:'before' };
  if(todayWeekIdx >= WEEKS) return { kind:'after' };
  const wk = buildWeek(todayWeekIdx+1);
  return { kind:'in', wk, day:wk.days[todayDowIdx], di:todayDowIdx };
}
// next scheduled, not-done session strictly after (week w, day di)
function nextKeySession(w, di) {
  for(let ww=w; ww<=WEEKS; ww++) {
    const wk = buildWeek(ww);
    for(let i=(ww===w?di+1:0); i<7; i++) if(wk.days[i].kind!=='rest' && !(getSession(wk.days[i].key)||{}).done) return { wk, day:wk.days[i], di:i };
  }
  return null;
}
function sessionMeta(day, w) {
  if(isLiftKind(day.kind)) return `${P.meta.strengthMinutes} + ${P.meta.treadmillMinutes} min · ${treadmillFor(day.kind, w).style}`;
  if(day.kind==='cardio') return '30–40 min · at home';
  return '';
}

/* ---------------- Today tab ---------------- */
function renderToday(app) {
  const t = todayInfo();
  const wk = t.wk || buildWeek(t.kind==='before' ? 1 : WEEKS);
  app.appendChild(largeTitle('Today', `${fmtLong(today)} · Week ${wk.week} · ${wk.block.name}`,
    h('button',{className:'icon-btn','aria-label':'Settings',onClick:()=>openScreen({type:'settings'})},icon('sliders'))));
  app.appendChild(heroCard(t, wk));
  const sec = section('This week', h('button',{className:'text-btn',onClick:()=>openSheet({type:'editWeek',week:wk.week})},'Edit'));
  sec.appendChild(weekStrip(wk));
  sec.appendChild(sessionList(wk, 'today'));
  app.appendChild(sec);
}

function heroCard(t, wk) {
  const card = h('div',{className:'hero'});
  if(t.kind==='in' && t.day.kind!=='rest') {
    const day = t.day, def = day.def, sess = getSession(day.key)||{}, tone = def.tone;
    const lift = isLiftKind(day.kind);
    const prog = lift ? sessionProgress(day.kind, wk.week, sess) : null;
    const est = lift ? estimateMinutes(day.kind, wk.week, sess) : null;
    card.style.background = `linear-gradient(160deg, ${tint(tone,22)}, ${tint(tone,6)}), var(--bg-2)`;
    card.appendChild(h('div',{className:'eyebrow',style:{color:col(tone)}}, sess.done ? 'Completed' : 'Today’s session'));
    card.appendChild(h('div',{className:'hero-title'},def.name));
    card.appendChild(h('div',{className:'hero-sub'},def.muscles));
    const chips = h('div',{className:'chips'});
    if(lift) { chips.appendChild(chip(`${setsFor(wk.week)} × ${wk.block.reps}`)); chips.appendChild(chip(`~${est.total} min lifts`)); chips.appendChild(chip(`${P.meta.treadmillMinutes} min ${treadmillFor(day.kind, wk.week).style.toLowerCase()}`)); }
    else { chips.appendChild(chip('20–30 min cardio')); chips.appendChild(chip('10 min core')); }
    card.appendChild(chips);
    if(lift && prog.done>0 && !sess.done) card.appendChild(h('div',{className:'prog'},h('div',{className:'prog-bar'},h('div',{className:'prog-fill',style:{width:`${Math.round(prog.done/prog.total*100)}%`,background:col(tone)}})),h('span',{className:'prog-text'},`${prog.done}/${prog.total} sets`)));
    const label = sess.done ? 'View session' : (lift && prog.done>0) ? 'Continue' : 'Start';
    card.appendChild(h('button',{className:`btn-primary${sess.done?' quiet':''}`,style: sess.done?null:{background:col(tone)},onClick:()=>openSession(wk.week, t.di, 'today')}, sess.done ? icon('check',20) : null, label));
  } else if(t.kind==='in') {
    const nx = nextKeySession(wk.week, t.di);
    card.appendChild(h('div',{className:'eyebrow'},'Rest day'));
    card.appendChild(h('div',{className:'hero-title'},'Rest & walk'));
    card.appendChild(h('div',{className:'hero-sub'},P.days.rest.note));
    if(nx) {
      const row = h('div',{className:'next-up'});
      row.appendChild(h('button',{className:'btn-secondary',onClick:()=>openSession(nx.wk.week, nx.di, 'today')}, dot(nx.day.def.tone), `Next: ${nx.day.def.name} · ${nx.day.dowName} ${nx.day.date}`, icon('chev',18)));
      if(nx.wk.week===wk.week) row.appendChild(h('button',{className:'text-btn',onClick:()=>{ assignDay(wk.week, t.di, nx.day.kind); render(); }},'Do it today instead'));
      card.appendChild(row);
    } else card.appendChild(h('div',{className:'hero-note'},'Nothing else scheduled this cycle.'));
  } else if(t.kind==='before') {
    card.appendChild(h('div',{className:'eyebrow'},'Cycle not started'));
    card.appendChild(h('div',{className:'hero-title'},`Starts ${fmt(startDate())}`));
    card.appendChild(h('div',{className:'hero-sub'},'Browse the plan, or change the start date in Settings.'));
    card.appendChild(h('button',{className:'btn-secondary',onClick:()=>openScreen({type:'settings'})},'Change start date'));
  } else {
    card.appendChild(h('div',{className:'eyebrow'},'Cycle complete'));
    card.appendChild(h('div',{className:'hero-title'},`${WEEKS} weeks done`));
    card.appendChild(h('div',{className:'hero-sub'},'Start the next cycle from Progress. Your lift history carries over.'));
    card.appendChild(h('button',{className:'btn-secondary',onClick:()=>{state.tab='progress';render();}},'Go to Progress'));
  }
  return card;
}
const chip = txt => h('span',{className:'chip'},txt);

function weekStrip(wk) {
  const strip = h('div',{className:'strip'});
  wk.days.forEach((day, di) => {
    const isToday = wk.week===todayWeekIdx+1 && di===todayDowIdx;
    const sess = getSession(day.key)||{};
    const has = day.kind!=='rest';
    const b = h('button',{className:`dp${isToday?' today':''}${has?' has':''}`,'aria-label':`${day.dowName} ${day.date}${has?': '+day.def.name:''}`,onClick:()=> has ? openSession(wk.week, di, state.tab) : openSheet({type:'day',week:wk.week,dow:di})});
    b.appendChild(h('span',{className:'dp-d'},DOW1[di]));
    b.appendChild(h('span',{className:'dp-n'},String(day.dateObj.getDate())));
    b.appendChild(has ? (sess.done ? checkDot(day.def.tone) : dot(day.def.tone)) : h('span',{className:'dot none'}));
    strip.appendChild(b);
  });
  return strip;
}

function sessionList(wk, from) {
  const wrap = h('div',{className:'list-wrap'});
  const list = h('div',{className:'list'});
  wk.days.filter(d => d.kind!=='rest').forEach(day => {
    const sess = getSession(day.key)||{}, def = day.def;
    const lift = isLiftKind(day.kind);
    const prog = lift ? sessionProgress(day.kind, wk.week, sess) : null;
    const isToday = wk.week===todayWeekIdx+1 && day.dow===todayDowIdx;
    const row = h('button',{className:`row${sess.done?' done':''}`,onClick:()=>openSession(wk.week, day.dow, from)});
    row.appendChild(sess.done ? checkDot(def.tone) : dot(def.tone,'lg'));
    row.appendChild(h('div',{className:'row-body'},
      h('div',{className:'row-title'},def.name, isToday ? h('span',{className:'tag',style:{color:col(def.tone),background:tint(def.tone,14)}},'Today') : null),
      h('div',{className:'row-sub'},`${day.dowName}, ${day.date} · ${sessionMeta(day, wk.week)}`),
    ));
    row.appendChild(h('span',{className:'row-trail'}, sess.done ? 'Done' : (lift && prog.done>0 ? `${prog.done}/${prog.total}` : null), icon('chev',18)));
    list.appendChild(row);
  });
  wk.skipped.forEach(k => {
    const def = P.days[k];
    const row = h('div',{className:'row muted'});
    row.appendChild(h('span',{className:'dot none'}));
    row.appendChild(h('div',{className:'row-body'},h('div',{className:'row-title'},def.name),h('div',{className:'row-sub'},'Skipped this week')));
    row.appendChild(h('button',{className:'text-btn',onClick:()=>{ skipKind(wk.week, k, false); render(); }},'Undo'));
    list.appendChild(row);
  });
  if(list.children.length) wrap.appendChild(list);
  wk.unscheduled.forEach(k => {
    const def = P.days[k];
    wrap.appendChild(h('div',{className:'banner',style:{background:tint(def.tone,12)}},
      h('div',{className:'banner-text'},dot(def.tone),h('span',null,`${def.name} isn’t on a day this week.`)),
      h('div',{className:'banner-actions'},
        h('button',{className:'btn-secondary sm',onClick:()=>openSheet({type:'pickDay',week:wk.week,kind:k})},'Pick a day'),
        h('button',{className:'text-btn',onClick:()=>{ skipKind(wk.week, k, true); render(); }},'Skip this week'),
      )));
  });
  if(!wk.days.some(d=>d.kind!=='rest') && !wk.unscheduled.length) wrap.appendChild(h('div',{className:'empty'},'Nothing scheduled. Tap Edit to plan the week.'));
  return wrap;
}

/* ---------------- Sheets ---------------- */
function renderSheet() {
  const sh = state.sheet;
  const wrap = h('div',{className:'sheet-wrap'});
  wrap.appendChild(h('div',{className:'sheet-backdrop',onClick:closeSheet}));
  const panel = h('div',{className:'sheet',role:'dialog','aria-modal':'true'});
  panel.appendChild(h('div',{className:'sheet-grab'}));
  const wk = buildWeek(sh.week);
  const whereIs = k => { const v = wk.plan[k]; return v==='skip' ? 'Skipped' : v==null ? 'Not scheduled' : DOW[v]; };

  if(sh.type==='day') {
    const day = wk.days[sh.dow];
    panel.appendChild(h('div',{className:'sheet-title'},`${day.dowName}, ${day.date}`));
    panel.appendChild(h('div',{className:'sheet-sub'},'What’s on this day?'));
    const list = h('div',{className:'sheet-list'});
    [...KINDS,'rest'].forEach(k => {
      const def = P.days[k], sel = day.kind===k;
      const hint = k==='rest' ? '' : (wk.plan[k]===sh.dow ? 'This day' : whereIs(k));
      list.appendChild(h('button',{className:`opt${sel?' selected':''}`,onClick:()=>{ assignDay(sh.week, sh.dow, k); closeSheet(); }},
        k==='rest' ? h('span',{className:'dot none'}) : dot(def.tone,'lg'),
        h('div',{className:'opt-body'},h('div',{className:'opt-title'},def.name),hint?h('div',{className:'opt-hint'},hint):null),
        sel ? h('span',{className:'opt-check'},icon('check',20)) : null));
    });
    panel.appendChild(list);
  }
  else if(sh.type==='pickDay') {
    const def = P.days[sh.kind];
    panel.appendChild(h('div',{className:'sheet-title'},`Pick a day for ${def.name}`));
    panel.appendChild(h('div',{className:'sheet-sub'},`Week ${sh.week} · ${wk.startDate} – ${wk.endDate}`));
    const list = h('div',{className:'sheet-list'});
    wk.days.forEach(day => {
      const occupied = day.kind!=='rest';
      list.appendChild(h('button',{className:'opt',onClick:()=>{ assignDay(sh.week, day.dow, sh.kind); closeSheet(); }},
        occupied ? dot(day.def.tone,'lg') : h('span',{className:'dot none'}),
        h('div',{className:'opt-body'},h('div',{className:'opt-title'},`${day.dowName}, ${day.date}`),h('div',{className:'opt-hint'}, occupied ? `${day.def.name} moves off this day` : 'Free')),
        icon('chev',18)));
    });
    panel.appendChild(list);
    panel.appendChild(h('button',{className:'text-btn block',onClick:()=>{ skipKind(sh.week, sh.kind, true); closeSheet(); }},'Skip this week instead'));
  }
  else if(sh.type==='editWeek') {
    panel.appendChild(h('div',{className:'sheet-title'},`Week ${sh.week}`));
    panel.appendChild(h('div',{className:'sheet-sub'},`${wk.startDate} – ${wk.endDate} · tap a day to move a session`));
    KINDS.forEach(k => {
      const def = P.days[k], v = wk.plan[k];
      const blockEl = h('div',{className:'edit-row'});
      blockEl.appendChild(h('div',{className:'edit-head'},dot(def.tone,'lg'),h('span',{className:'edit-name'},def.name),h('span',{className:'edit-where'},whereIs(k))));
      const seg = h('div',{className:'seg7'});
      for(let d=0; d<7; d++) {
        const sel = v===d;
        const other = KINDS.find(o => o!==k && wk.plan[o]===d);
        const b = h('button',{className:`seg${sel?' on':''}${other?' taken':''}`,'aria-label':`${DOW[d]}${other?' ('+P.days[other].name+')':''}`,onClick:()=>{ assignDay(sh.week, d, k); render(); }},DOW1[d]);
        if(sel) { b.style.background = col(def.tone); }
        else if(other) { b.appendChild(h('span',{className:'seg-dot',style:{background:col(P.days[other].tone)}})); }
        seg.appendChild(b);
      }
      seg.appendChild(h('button',{className:`seg skip${v==='skip'?' on':''}`,onClick:()=>{ skipKind(sh.week, k, v!=='skip'); render(); }},'Skip'));
      blockEl.appendChild(seg);
      panel.appendChild(blockEl);
    });
    const foot = h('div',{className:'sheet-foot'});
    if(isWeekEdited(sh.week)) foot.appendChild(h('button',{className:'text-btn',onClick:()=>{ resetWeek(sh.week); render(); }},'Reset to usual schedule'));
    foot.appendChild(h('button',{className:'btn-primary sm',style:{background:'var(--tint)'},onClick:closeSheet},'Done'));
    panel.appendChild(foot);
  }
  wrap.appendChild(panel);
  return wrap;
}

/* ---------------- Plan tab ---------------- */
function renderPlan(app) {
  const wNum = state.week + 1;
  const wk = buildWeek(wNum), block = wk.block, sets = setsFor(wNum);
  app.appendChild(largeTitle('Plan', `${WEEKS}-week cycle · ${fmt(startDate())} → ${fmt(addDays(startDate(), WEEKS*7-1))} · Cycle ${store.settings.cycle}`));

  // Block timeline
  const tl = h('div',{className:'timeline'});
  P.blocks.forEach(b => {
    const cur = b.weeks.includes(wNum);
    const seg = h('button',{className:`tl-seg${cur?' cur':''}`,style:{flex:b.weeks.length,background: cur ? tint(b.tone,22) : tint(b.tone,8), color: col(b.tone)},onClick:()=>{state.week=b.weeks[0]-1;render();}},
      h('span',{className:'tl-name'},b.name),h('span',{className:'tl-weeks'},`Wk ${b.weeks[0]}–${b.weeks[b.weeks.length-1]}`));
    tl.appendChild(seg);
  });
  app.appendChild(h('div',{className:'pad'},tl));

  // Week chips
  const chips = h('div',{className:'wk-chips'});
  for(let i=0;i<WEEKS;i++) {
    const b = getBlock(i+1), isCurr = i===todayWeekIdx, active = state.week===i;
    const c = h('button',{className:`wk-chip${active?' active':''}${isCurr?' now':''}`,onClick:()=>{state.week=i;render();}},String(i+1));
    if(active) { c.style.background = col(b.tone); }
    else if(isCurr) { c.style.boxShadow = `inset 0 0 0 1.5px ${col(b.tone)}`; c.style.color = col(b.tone); }
    chips.appendChild(c);
  }
  app.appendChild(chips);

  // Week card
  const stats = weekStats(wNum);
  const sec = section(`Week ${wNum}`, h('button',{className:'text-btn',onClick:()=>openSheet({type:'editWeek',week:wNum})},'Edit'));
  const card = h('div',{className:'card'});
  card.appendChild(h('div',{className:'card-row'},
    h('span',{className:'card-date'},`${wk.startDate} – ${wk.endDate}`),
    h('span',{className:'tag',style:{color:col(block.tone),background:tint(block.tone,14)}},block.name)));
  const rx = h('div',{className:'chips'}); rx.appendChild(chip(`${sets} × ${block.reps}`)); rx.appendChild(chip(`RPE ${block.rpe}`)); rx.appendChild(chip(`Rest ${block.rest}`)); card.appendChild(rx);
  card.appendChild(h('p',{className:'card-text'},block.focus));
  card.appendChild(h('div',{className:'prog'},h('div',{className:'prog-bar'},h('div',{className:'prog-fill',style:{width:`${stats.planned?Math.round(stats.done/stats.planned*100):0}%`,background:col(block.tone)}})),h('span',{className:'prog-text'},`${stats.done}/${stats.planned}`)));
  sec.appendChild(card);
  sec.appendChild(weekStrip(wk));
  sec.appendChild(sessionList(wk, 'plan'));
  app.appendChild(sec);

  // This block's lifts
  const lifts = section('This block’s lifts');
  const lcard = h('div',{className:'card'});
  LIFT_KINDS.forEach((k, i) => {
    const def = P.days[k];
    const g = h('div',{className:'lift-group'});
    g.appendChild(h('div',{className:'lift-group-head',style:{color:col(def.tone)}},dot(def.tone),def.name,h('span',{className:'lift-group-sub'},def.muscles)));
    exercisesFor(k, wNum, null).forEach((ex, j) => g.appendChild(h('div',{className:'lift-line'},h('span',{className:'lift-n'},String(j+1)),h('span',{className:'lift-name'},ex.name),ex.anchor?h('span',{className:'tag sm'},'Anchor'):null,ex.newThisBlock?h('span',{className:'tag sm tint'},'New'):null)));
    g.appendChild(h('div',{className:'lift-line core'},h('span',{className:'lift-n'},'+'),h('span',{className:'lift-name'},'Core: '+coreFor(k, wNum).map(c=>c.name).join(' · '))));
    lcard.appendChild(g);
  });
  lifts.appendChild(lcard);
  app.appendChild(lifts);

  // Guidelines
  const g = section('Guidelines');
  const groups = [
    { id:'spine', title:'Spine-safe rules', items:P.spine },
    { id:'prog', title:'How to progress', items:P.progression.rules },
    { id:'hr', title:'Treadmill effort', items:P.hrZones.map(z => `${z.z} · ${z.r} bpm · ${z.d}`) },
  ];
  const gcard = h('div',{className:'list'});
  groups.forEach(gr => {
    const open = !!state.groupOpen[gr.id];
    gcard.appendChild(h('button',{className:'row fold',onClick:()=>{state.groupOpen[gr.id]=!open;render();}},h('div',{className:'row-body'},h('div',{className:'row-title'},gr.title)),h('span',{className:`row-trail arrow${open?' open':''}`},icon('chev',18))));
    if(open) { const ul = h('ol',{className:'rules'}); gr.items.forEach(t => ul.appendChild(h('li',null,t))); gcard.appendChild(ul); }
  });
  g.appendChild(gcard);
  app.appendChild(g);
}

/* ---------------- Progress tab ---------------- */
function renderProgress(app) {
  const cs = cycleStats(), pct = cs.planned ? Math.round(cs.done/cs.planned*100) : 0;
  const curBlock = getBlock(Math.min(Math.max(todayWeekIdx+1,1),WEEKS));
  app.appendChild(largeTitle('Progress', `Cycle ${store.settings.cycle} · ${cs.done} of ${cs.planned} sessions`));
  const circumference = 2*Math.PI*26, dashoffset = circumference - (pct/100)*circumference;
  const ring = h('div',{className:'card ring-card'},
    h('div',{className:'ring',innerHTML:`<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--fill-3)" stroke-width="6"/><circle class="ring-arc" cx="32" cy="32" r="26" fill="none" stroke="${col(curBlock.tone)}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}"/></svg><div class="ring-text">${pct}%</div>`}),
    h('div',{className:'ring-info'},h('div',{className:'ring-label'},'Cycle progress'),h('div',{className:'ring-sub'},'3 lifts + 1 cardio a week. Skipped sessions don’t count against you.')));
  app.appendChild(h('div',{className:'pad'},ring));
  app.appendChild(renderConsistency());
  app.appendChild(renderLifts());
  if(todayWeekIdx >= WEEKS-1) {
    const sec = section('Next cycle');
    const box = h('div',{className:'card'});
    box.appendChild(h('p',{className:'card-text'},'Start the next 12 weeks with the weights you have now. Your lift history carries over, so week 1 picks up where week 12 left off.'));
    if(state.cycleConfirm) {
      box.appendChild(h('div',{className:'btn-row'},h('button',{className:'btn-primary sm',style:{background:'var(--tint)'},onClick:startNextCycle},`Confirm: start cycle ${store.settings.cycle+1}`),h('button',{className:'text-btn',onClick:()=>{state.cycleConfirm=false;render();}},'Cancel')));
    } else box.appendChild(h('button',{className:'btn-secondary',onClick:()=>{state.cycleConfirm=true;render();}},`Start cycle ${store.settings.cycle+1}`));
    sec.appendChild(box); app.appendChild(sec);
  }
}
function renderConsistency() {
  const sec = section('Consistency');
  const card = h('div',{className:'card'});
  const container = h('div',{className:'grid-wrap'});
  const labels = h('div',{className:'grid-labels'});
  const ABBR = { push:'P', legs:'L', pull:'Pu', cardio:'C' };
  KINDS.forEach(k => labels.appendChild(h('div',{className:'grid-label',style:{color:col(P.days[k].tone)}},ABBR[k])));
  container.appendChild(labels);
  const grid = h('div',{className:'grid',style:{gridTemplateColumns:`repeat(${WEEKS}, 1fr)`}});
  let perfect = 0, longest = 0, run = 0, streak = 0;
  for(let w=1; w<=WEEKS; w++) {
    const wk = buildWeek(w), cyc = store.settings.cycle, st = weekStats(w);
    const colEl = h('div',{className:`grid-col${w===todayWeekIdx+1?' now':''}`});
    KINDS.forEach(k => {
      const done = !!(getSession(sessionKey(cyc, w, k))||{}).done;
      const skipped = wk.plan[k]==='skip';
      const cell = h('div',{className:`cell${done?' done':''}${skipped?' skipped':''}`});
      if(done) cell.style.background = col(P.days[k].tone);
      colEl.appendChild(cell);
    });
    if(st.perfect) { perfect++; run++; longest = Math.max(longest, run); } else run = 0;
    colEl.appendChild(h('div',{className:'grid-week'},String(w)));
    grid.appendChild(colEl);
  }
  for(let w=Math.min(WEEKS, todayWeekIdx); w>=1; w--) { if(weekStats(w).perfect) streak++; else break; }
  if(todayWeekIdx>=0 && todayWeekIdx<WEEKS && weekStats(todayWeekIdx+1).perfect) streak++;
  container.appendChild(grid);
  card.appendChild(container);
  const stats = h('div',{className:'stats'});
  [{num:cycleStats().done,label:'Sessions'},{num:streak,label:'Week streak'},{num:perfect,label:'Perfect weeks'}].forEach(s => stats.appendChild(h('div',{className:'stat'},h('div',{className:`stat-num${s.num>0?' on':''}`},String(s.num)),h('div',{className:'stat-label'},s.label))));
  card.appendChild(stats);
  sec.appendChild(card);
  return sec;
}
function renderLifts() {
  const units = store.settings.units;
  const sec = section('Your lifts');
  const list = h('div',{className:'list'});
  let any = false;
  LIFT_KINDS.forEach(kind => {
    allExercisesFor(kind).forEach(ex => {
      const logs = exerciseLogs(kind, ex.id).filter(l => l.sets.some(x => x.w!=null));
      if(!logs.length) return;
      any = true;
      const maxW = l => { const ws = l.sets.map(s=>s.w).filter(x=>x!=null); return ws.length?Math.max(...ws):null; };
      const fw = maxW(logs[0]), lw = maxW(logs[logs.length-1]);
      const delta = (fw!=null && lw!=null) ? lw-fw : null;
      const bestR = logs[logs.length-1].sets.map(s=>s.r).filter(x=>x!=null);
      list.appendChild(h('div',{className:'row'},dot(P.days[kind].tone),
        h('div',{className:'row-body'},h('div',{className:'row-title sm'},ex.name, ex.anchor?h('span',{className:'tag sm'},'Anchor'):null),h('div',{className:'row-sub'},`${logs.length} session${logs.length===1?'':'s'}`)),
        h('div',{className:'lift-val'},h('span',{className:'lift-now'},`${lw} ${units}`),bestR.length?h('span',{className:'lift-reps'},` × ${Math.max(...bestR)}`):null,
          h('div',{className:`lift-delta${delta>0?' up':''}`}, delta==null||logs.length<2 ? 'first log' : delta>0?`+${delta} ${units}`:delta<0?`${delta} ${units}`:'holding'))));
    });
  });
  if(!any) list.appendChild(h('div',{className:'empty'},'Log weights in a session and your progress shows up here.'));
  sec.appendChild(list);
  return sec;
}
function startNextCycle() {
  const endOfCycle = addDays(startDate(), WEEKS*7);
  const t = new Date();
  store.settings.startDate = iso(t >= endOfCycle ? mondayOf(t) : endOfCycle);
  store.settings.cycle += 1;
  saveStore();
  state.cycleConfirm = false; state.week = 0; state.screen = null; state.tab = 'today';
  computeToday();
  render();
}

/* ---------------- Settings screen ---------------- */
function screenHeader(title, sub, trailing) {
  const head = h('header',{className:'sh'});
  head.appendChild(h('button',{className:'back',onClick:closeScreen},icon('back',22),h('span',null,'Back')));
  const row = h('div',{className:'sh-row'});
  row.appendChild(h('div',{className:'sh-text'},h('h1',{className:'sh-title'},title),sub?h('div',{className:'sh-sub'},sub):null));
  if(trailing) row.appendChild(trailing);
  head.appendChild(row);
  return head;
}
function renderSettingsScreen(app) {
  const s = store.settings;
  app.appendChild(screenHeader('Settings', 'Schedule, units, appearance'));
  const body = h('div',{className:'pad'});

  const sched = section('Usual schedule');
  const c1 = h('div',{className:'card'});
  c1.appendChild(h('div',{className:'field-label'},'Office gym days — Push, Legs, Pull in that order'));
  const gymRow = h('div',{className:'seg7'});
  for(let d=0; d<7; d++) {
    const on = s.gymDays.includes(d);
    const b = h('button',{className:`seg${on?' on':''}`,disabled:d>4,onClick:()=>{
      if(on) { if(s.gymDays.length>1) s.gymDays = s.gymDays.filter(x=>x!==d); }
      else { s.gymDays = [...s.gymDays, d].sort((a,b)=>a-b); if(s.gymDays.length>3) s.gymDays = s.gymDays.slice(-3); }
      saveStore(); render();
    }},DOW1[d]);
    if(on) b.style.background = col(P.days[LIFT_KINDS[s.gymDays.indexOf(d)]].tone);
    gymRow.appendChild(b);
  }
  c1.appendChild(gymRow);
  c1.appendChild(h('div',{className:'field-label'},'Home cardio day'));
  const fRow = h('div',{className:'seg7'});
  for(let d=0; d<7; d++) {
    const on = s.floatDay===d;
    const b = h('button',{className:`seg${on?' on':''}`,onClick:()=>{ s.floatDay=d; saveStore(); render(); }},DOW1[d]);
    if(on) b.style.background = col(P.days.cardio.tone);
    if(s.gymDays.includes(d)) b.style.opacity = '0.45';
    fRow.appendChild(b);
  }
  c1.appendChild(fRow);
  c1.appendChild(h('p',{className:'field-note'},'This is the default for new weeks. Any week can be rearranged from Today or Plan without changing this.'));
  sched.appendChild(c1); body.appendChild(sched);

  const pref = section('Preferences');
  const c2 = h('div',{className:'card'});
  c2.appendChild(h('div',{className:'field-label'},'Units'));
  c2.appendChild(segmented(['lb','kg'], s.units, v => { s.units=v; saveStore(); render(); }));
  c2.appendChild(h('div',{className:'field-label'},'Appearance'));
  c2.appendChild(segmented(['system','light','dark'], s.theme, v => { s.theme=v; saveStore(); applyTheme(); render(); }, v => v[0].toUpperCase()+v.slice(1)));
  pref.appendChild(c2); body.appendChild(pref);

  const cyc = section('Cycle');
  const c3 = h('div',{className:'card'});
  c3.appendChild(h('div',{className:'field-label'},`Cycle ${s.cycle} start (a Monday)`));
  const dateIn = h('input',{className:'date-in',type:'date',id:'start-date',value:s.startDate});
  dateIn.addEventListener('change',()=>{ if(!dateIn.value) return; s.startDate = iso(mondayOf(parseISO(dateIn.value))); saveStore(); computeToday(); state.week = (todayWeekIdx>=0&&todayWeekIdx<WEEKS)?todayWeekIdx:0; render(); });
  c3.appendChild(dateIn);
  cyc.appendChild(c3); body.appendChild(cyc);

  const data = section('Data');
  const c4 = h('div',{className:'card'});
  if(state.resetConfirm) {
    c4.appendChild(h('div',{className:'btn-row'},h('button',{className:'btn-primary sm',style:{background:'var(--bad)'},onClick:()=>{localStorage.removeItem(STORE_KEY);store=loadStore();applyTheme();state.resetConfirm=false;computeToday();render();}},'Erase everything'),h('button',{className:'text-btn',onClick:()=>{state.resetConfirm=false;render();}},'Cancel')));
  } else c4.appendChild(h('button',{className:'text-btn danger',onClick:()=>{state.resetConfirm=true;render();}},'Reset all progress'));
  c4.appendChild(h('p',{className:'field-note'},'Everything is stored on this device only.'));
  data.appendChild(c4); body.appendChild(data);
  app.appendChild(body);
}
function segmented(opts, val, onPick, labelOf) {
  const seg = h('div',{className:'segmented'});
  opts.forEach(o => seg.appendChild(h('button',{className:`segmented-btn${val===o?' on':''}`,onClick:()=>onPick(o)}, labelOf ? labelOf(o) : o)));
  return seg;
}

/* ---------------- Session screen ---------------- */
function renderSession(app) {
  const wNum = state.screen.week, di = state.screen.di;
  const wk = buildWeek(wNum), day = wk.days[di], def = day.def, block = wk.block;
  const sess = getSession(day.key)||{};
  const units = store.settings.units;
  const lift = isLiftKind(day.kind);
  const isDone = !!sess.done;

  const head = h('header',{className:'sh'});
  head.appendChild(h('button',{className:'back',onClick:closeScreen},icon('back',22),h('span',null, state.screen.from==='plan' ? `Week ${wNum}` : 'Today')));
  const row = h('div',{className:'sh-row'});
  row.appendChild(h('div',{className:'sh-text'},h('h1',{className:'sh-title',style:{color:col(def.tone)}},def.name),h('div',{className:'sh-sub'},`${day.dowName}, ${day.date}${lift?` · ${setsFor(wNum)} × ${block.reps} · rest ${block.rest}`:''}`)));
  if(lift) row.appendChild(h('button',{className:'icon-btn','aria-label':'Start rest timer',onClick:()=>startTimer(restSeconds(wNum))},icon('timer')));
  head.appendChild(row);
  app.appendChild(head);

  const body = h('div',{className:'pad session'});
  if(lift) renderLiftSession(body, wk, day, sess, units);
  else if(day.kind==='cardio') renderCardioSession(body, day, sess);
  else body.appendChild(h('div',{className:'card'},h('p',{className:'card-text'},def.note)));

  const notes = h('div',{className:'card notes'});
  const ta = h('textarea',{className:'notes-input',id:`note-${day.key}`,placeholder: lift ? 'Notes: how it felt, what to change next time' : 'Notes'});
  ta.value = sess.note || '';
  ta.addEventListener('input',()=>{ if(noteTimer) clearTimeout(noteTimer); noteTimer = setTimeout(()=>{ setNote(day.key, ta.value); const sv = notes.querySelector('.notes-saved'); if(sv) { sv.textContent='Saved'; setTimeout(()=>{ sv.textContent=''; },1500); } },500); });
  notes.appendChild(ta); notes.appendChild(h('div',{className:'notes-saved'},''));
  body.appendChild(notes);

  body.appendChild(h('button',{className:`btn-primary${isDone?' quiet':''}`,style: isDone?null:{background:col(def.tone)},onClick:()=>{ if(!isDone&&navigator.vibrate)navigator.vibrate(30); setDone(day.key,!isDone); if(!isDone) closeScreen(); else render(); }}, isDone ? 'Completed · tap to undo' : (day.kind==='rest' ? 'Log a walk' : 'Complete session')));
  app.appendChild(body);
}

function renderLiftSession(body, wk, day, sess, units) {
  const def = day.def, wNum = wk.week, tone = def.tone;
  const sets = setsFor(wNum);
  const est = estimateMinutes(day.kind, wNum, sess);
  const exs = exercisesFor(day.kind, wNum, sess);
  const prog = sessionProgress(day.kind, wNum, sess);

  const plan = h('div',{className:'time-plan'});
  [{l:'Warm-up',m:est.warm,t:'gray'},{l:'Lifts',m:est.lift,t:tone},{l:'Core',m:est.core,t:'lavender'},{l:'Treadmill',m:P.meta.treadmillMinutes,t:'apricot'}]
    .forEach(s => plan.appendChild(h('div',{className:'time-seg',style:{flex:Math.max(s.m,10),background:tint(s.t,16),color:col(s.t)}},h('span',{className:'time-seg-l'},s.l),h('span',{className:'time-seg-m'},`${s.m}m`))));
  body.appendChild(plan);

  const top = h('div',{className:'toprow'});
  top.appendChild(h('span',{className:'toprow-prog'},`${prog.done}/${prog.total} sets`));
  top.appendChild(h('button',{className:'text-btn',onClick:()=>{
    exs.forEach(ex => { const sg = suggestNext(ex, lastLog(day.kind, ex.id, store.settings.cycle, wNum), wNum); const s = touchSession(day.key); if(!s.sets) s.sets={}; if(!s.sets[ex.id]) s.sets[ex.id]=[]; for(let si=0; si<sets; si++) { const cur = s.sets[ex.id][si]||{}; if(cur.w==null && sg.weight!=null) cur.w = sg.weight; if(cur.r==null) cur.r = sg.reps[si]; cur.done = true; s.sets[ex.id][si]=cur; } });
    saveStore(); if(navigator.vibrate) navigator.vibrate(20); render();
  }},'Log all as planned'));
  body.appendChild(top);

  // Warm-up
  if(state.warmupOpen===null) state.warmupOpen = liftSessionsDone() < 2;
  const wu = h('div',{className:'card'});
  wu.appendChild(h('button',{className:'card-fold',onClick:()=>{state.warmupOpen=!state.warmupOpen;render();}},h('span',{className:'card-title'},`Warm-up · ${P.meta.warmupMinutes} min`),h('span',{className:`arrow${state.warmupOpen?' open':''}`},icon('chev',18))));
  if(state.warmupOpen) { const l = h('div',{className:'mini-list'}); P.warmup.forEach(x => l.appendChild(h('div',{className:'mini-row'},h('span',{className:'mini-name'},x.name),h('span',{className:'mini-dur'},x.dur)))); wu.appendChild(l); }
  body.appendChild(wu);

  // Find the next set to do (first not-done set, in order)
  let nextSet = null;
  exs.forEach((ex, i) => { if(nextSet) return; const arr = (sess.sets && sess.sets[ex.id]) || []; for(let si=0; si<sets; si++) if(!(arr[si] && arr[si].done)) { nextSet = { i, si }; return; } });

  exs.forEach((ex, i) => {
    const reps = repsFor(ex, wNum);
    const last = lastLog(day.kind, ex.id, store.settings.cycle, wNum);
    const sg = suggestNext(ex, last, wNum);
    const logged = (sess.sets && sess.sets[ex.id]) || [];
    const doneCount = logged.filter(x=>x&&x.done).length;
    const open = state.exOpen[ex.id] !== undefined ? state.exOpen[ex.id] : exerciseLogs(day.kind, ex.id).filter(l=>l.week!==wNum||l.cycle!==store.settings.cycle).length < 2;
    const card = h('div',{className:`card ex${doneCount>=sets?' all-done':''}`});
    card.appendChild(h('button',{className:'ex-head',onClick:()=>{state.exOpen[ex.id]=!open;render();}},
      h('span',{className:'ex-num',style:{background:col(tone)}},String(i+1)),
      h('span',{className:'ex-name'},ex.name, ex.anchor ? h('span',{className:'tag sm'},'Anchor') : null, ex.newThisBlock ? h('span',{className:'tag sm tint'},'New') : null, ex.swapped ? h('span',{className:'tag sm warn'},'Swapped') : null),
      h('span',{className:'ex-target'},`${sets} × ${reps}${ex.perSide?' /side':''}`),
      h('span',{className:`arrow${open?' open':''}`},icon('chev',16))));
    card.appendChild(h('div',{className:`ex-line ${sg.kind}`},
      h('span',{className:'ex-last'}, last ? `Last ${fmtSets(last.sets, units).replace(' '+units,'')}` : 'First time'),
      h('span',{className:'ex-now'}, sg.weight!=null ? `${sg.weight} ${units} × ${sg.reps.join(', ')}` : `${sg.reps.join(', ')} reps · find a weight`)));
    if(open) {
      const det = h('div',{className:'ex-details'});
      det.appendChild(h('p',{className:'ex-cue'},ex.cue));
      if(ex.spine) det.appendChild(h('p',{className:'ex-spine'},ex.spine));
      det.appendChild(h('p',{className:'ex-hint'},sg.text));
      det.appendChild(h('div',{className:'ex-alt-row'},h('span',{className:'ex-alt'}, ex.swapped ? `Swapped in for ${ex.altName}` : `Alternative: ${ex.altName}`),h('button',{className:'btn-secondary sm',onClick:(e)=>{ e.stopPropagation(); setSwap(day.key, ex.slot, !ex.swapped); render(); }},icon('swap',16), ex.swapped ? 'Undo' : 'Swap')));
      card.appendChild(det);
    }
    const grid = h('div',{className:'sets'});
    for(let si=0; si<sets; si++) {
      const cur = logged[si] || {};
      const isNext = nextSet && nextSet.i===i && nextSet.si===si;
      const row = h('div',{className:`set${cur.done?' done':''}${isNext?' next':''}`});
      row.appendChild(h('span',{className:'set-n'},String(si+1)));
      const wIn = h('input',{className:'set-in',id:`${day.key}-${ex.id}-${si}-w`,type:'number',inputmode:'decimal',step:'0.5',min:'0','aria-label':`Set ${si+1} weight`,placeholder: sg.weight!=null ? String(sg.weight) : '–'});
      if(cur.w!=null) wIn.value = cur.w;
      wIn.addEventListener('input',()=>{ setSetField(day.key, ex.id, si, 'w', wIn.value); scheduleNextPlan(); });
      const rIn = h('input',{className:'set-in',id:`${day.key}-${ex.id}-${si}-r`,type:'number',inputmode:'numeric',step:'1',min:'0','aria-label':`Set ${si+1} reps`,placeholder: String(sg.reps[si])});
      if(cur.r!=null) rIn.value = cur.r;
      rIn.addEventListener('input',()=>{ setSetField(day.key, ex.id, si, 'r', rIn.value); scheduleNextPlan(); });
      const isLastSet = (i===exs.length-1 && si===sets-1);
      const chk = h('button',{className:`set-check${cur.done?' done':''}`,'aria-label':cur.done?'Mark set not done':'Mark set done',onClick:(e)=>{
        e.stopPropagation();
        const s = touchSession(day.key); if(!s.sets) s.sets={}; if(!s.sets[ex.id]) s.sets[ex.id]=[];
        const c = s.sets[ex.id][si] || {};
        if(c.done) { c.done = false; s.sets[ex.id][si]=c; saveStore(); render(); return; }
        if(wIn.value!=='') c.w = Number(wIn.value); else if(c.w==null && sg.weight!=null) c.w = sg.weight;
        if(rIn.value!=='') c.r = Number(rIn.value); else if(c.r==null) c.r = sg.reps[si];
        c.done = true; s.sets[ex.id][si]=c; saveStore();
        if(navigator.vibrate) navigator.vibrate(20);
        if(!isLastSet) startTimer(restSeconds(wNum));
        render();
      }}, icon('check',18));
      if(isNext) chk.style.boxShadow = `0 0 0 2px ${col(tone)}`;
      row.appendChild(h('label',{className:'set-field'},wIn,h('span',{className:'set-unit'},units)));
      row.appendChild(h('label',{className:'set-field'},rIn,h('span',{className:'set-unit'},'reps')));
      row.appendChild(chk);
      grid.appendChild(row);
    }
    card.appendChild(grid);
    body.appendChild(card);
  });

  // Core
  const core = h('div',{className:`card${sess.coreDone?' checked':''}`});
  core.appendChild(h('div',{className:'card-fold static'},h('span',{className:'card-title'},`Core finisher · ${P.meta.coreMinutes} min`),h('button',{className:`set-check${sess.coreDone?' done':''}`,'aria-label':'Core done',onClick:()=>{const s=touchSession(day.key); s.coreDone=!s.coreDone; saveStore(); render();}},icon('check',18))));
  const cl = h('div',{className:'mini-list'});
  coreFor(day.kind, wNum).forEach(c => cl.appendChild(h('div',{className:'mini-row col'},h('div',{className:'mini-top'},h('span',{className:'mini-name'},c.name),h('span',{className:'mini-dur'},c.target)),h('div',{className:'mini-note'},c.cue))));
  core.appendChild(cl);
  body.appendChild(core);

  // Treadmill
  const tr = treadmillFor(day.kind, wNum);
  const tm = h('div',{className:`card${sess.treadmillDone?' checked':''}`});
  tm.appendChild(h('div',{className:'card-fold static'},h('span',{className:'card-title'},`Treadmill · ${P.meta.treadmillMinutes} min`),h('button',{className:`set-check${sess.treadmillDone?' done':''}`,'aria-label':'Treadmill done',onClick:()=>{const s=touchSession(day.key); s.treadmillDone=!s.treadmillDone; saveStore(); render();}},icon('check',18))));
  const intTone = tr.intensity==='hard' ? 'rose' : tr.intensity==='moderate' ? 'apricot' : 'sage';
  tm.appendChild(h('div',{className:'tm-title'},tr.style,h('span',{className:'tag sm',style:{color:col(intTone),background:tint(intTone,14)}},tr.intensity)));
  tm.appendChild(h('p',{className:'card-text'},tr.note));
  tm.appendChild(h('p',{className:'field-note'},P.treadmillNote));
  body.appendChild(tm);

  const nextBox = h('div',{className:'card next-plan',id:'next-plan'});
  body.appendChild(nextBox);
  renderNextPlan(nextBox, wk, day, units);
}
function scheduleNextPlan() {
  if(nextPlanTimer) clearTimeout(nextPlanTimer);
  nextPlanTimer = setTimeout(()=>{ const box = document.getElementById('next-plan'); if(!box || !state.nextPlanCtx) return; renderNextPlan(box, state.nextPlanCtx.wk, state.nextPlanCtx.day, store.settings.units); }, 400);
}
function renderNextPlan(box, wk, day, units) {
  state.nextPlanCtx = { wk, day };
  box.innerHTML = '';
  const def = day.def, wNum = wk.week, nextW = wNum + 1, isLast = nextW > WEEKS;
  const targetW = isLast ? 1 : nextW, nextBlock = getBlock(targetW);
  const sess = getSession(day.key) || {};
  box.appendChild(h('div',{className:'card-title'},`Next ${def.name} · ${isLast ? 'next cycle, week 1' : 'week '+nextW} · ${nextBlock.name}`));
  const nextExs = exercisesFor(day.kind, targetW, null), todayExs = exercisesFor(day.kind, wNum, sess);
  const rows = []; let any = false;
  nextExs.forEach((ex, i) => {
    const same = todayExs[i] && todayExs[i].id === ex.id;
    const src = same && sess.sets && hasLog(sess.sets[ex.id]) ? { cycle:store.settings.cycle, week:wNum, sets:sess.sets[ex.id].filter(x=>x&&(x.w!=null||x.r!=null)) } : lastLog(day.kind, ex.id, store.settings.cycle + (isLast?1:0), targetW);
    if(src) any = true;
    const sg = suggestNext(ex, src, targetW);
    rows.push(h('div',{className:'mini-row'},h('span',{className:'mini-name'},h('span',{className:`sg-dot ${sg.kind}`}),ex.name, (todayExs[i] && todayExs[i].id!==ex.id) ? h('span',{className:'tag sm tint'},'New') : null),h('span',{className:`mini-dur sg-${sg.kind}`}, sg.kind==='new' ? 'find weight' : fmtSuggest(sg, units))));
  });
  if(!any) box.appendChild(h('p',{className:'field-note'},'Log weights and reps above and next week’s targets appear here as you type.'));
  else {
    const l = h('div',{className:'mini-list'}); rows.forEach(r => l.appendChild(r)); box.appendChild(l);
    box.appendChild(h('div',{className:'legend'},[['up','weight up'],['add','+1 rep'],['hold','hold'],['down','lighter']].map(([k,t]) => h('span',{className:'legend-item'},h('span',{className:`sg-dot ${k}`}),t))));
  }
}
function renderCardioSession(body, day, sess) {
  const def = day.def;
  const card = h('div',{className:'card'});
  card.appendChild(h('div',{className:'card-title'},'Pick one · 20–30 min'));
  const l = h('div',{className:'mini-list'});
  def.options.forEach(o => {
    const sel = sess.choice === o.id;
    l.appendChild(h('button',{className:`opt${sel?' selected':''}`,onClick:()=>{ setChoice(day.key, sel?null:o.id); render(); }},
      h('span',{className:`radio${sel?' on':''}`,style: sel?{background:col(def.tone),borderColor:col(def.tone)}:null}, sel?icon('check',14):null),
      h('div',{className:'opt-body'},h('div',{className:'opt-title'},o.name,h('span',{className:'opt-dur'},o.dur)),h('div',{className:'opt-hint'},o.note))));
  });
  card.appendChild(l); body.appendChild(card);
  const core = h('div',{className:`card${sess.coreDone?' checked':''}`});
  core.appendChild(h('div',{className:'card-fold static'},h('span',{className:'card-title'},`Then core · ${def.core.dur}`),h('button',{className:`set-check${sess.coreDone?' done':''}`,'aria-label':'Core done',onClick:()=>{const s=touchSession(day.key); s.coreDone=!s.coreDone; saveStore(); render();}},icon('check',18))));
  core.appendChild(h('div',{className:'tm-title'},def.core.name));
  core.appendChild(h('p',{className:'card-text'},def.core.note));
  body.appendChild(core);
  const cd = h('div',{className:'card'});
  cd.appendChild(h('div',{className:'card-title'},`Optional · ${def.cooldown.dur}`));
  cd.appendChild(h('div',{className:'tm-title'},def.cooldown.name));
  cd.appendChild(h('p',{className:'card-text'},def.cooldown.note));
  body.appendChild(cd);
}

/* ---------------- Boot ---------------- */
function computeToday() {
  today = new Date();
  const daysSinceStart = Math.floor((new Date(today.getFullYear(),today.getMonth(),today.getDate()) - startDate()) / MS_PER_DAY);
  todayWeekIdx = Math.floor(daysSinceStart / 7);
  todayDowIdx = ((daysSinceStart % 7) + 7) % 7;
}
async function boot() {
  try { P = await fetch('data/program.json').then(r => r.json()); }
  catch(e) { document.getElementById('app').textContent = 'Failed to load the program. Please reload.'; return; }
  WEEKS = P.meta.weeks;
  store = loadStore(); saveStore(); applyTheme();
  state = { tab:'today', screen:null, sheet:null, week:0, exOpen:{}, warmupOpen:null, groupOpen:{}, resetConfirm:false, cycleConfirm:false, lastViewKey:null, nextPlanCtx:null };
  computeToday();
  if(todayWeekIdx>=0 && todayWeekIdx<WEEKS) state.week = todayWeekIdx; else if(todayWeekIdx>=WEEKS) state.week = WEEKS-1;
  if(!document.getElementById('rest-timer')) document.body.appendChild(h('div',{id:'rest-timer',className:'rest-timer',role:'status'}));

  // Swipe between weeks on the Plan tab (ignore swipes starting on inputs)
  let tx=0, ty=0, onInput=false;
  const app = document.getElementById('app');
  app.addEventListener('touchstart', e=>{ tx=e.touches[0].clientX; ty=e.touches[0].clientY; onInput = ['INPUT','TEXTAREA'].includes(e.target.tagName); },{passive:true});
  app.addEventListener('touchend', e=>{
    if(onInput || state.screen || state.sheet || state.tab!=='plan') return;
    const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty;
    if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5){ if(dx<0 && state.week<WEEKS-1){state.week++;render();} else if(dx>0 && state.week>0){state.week--;render();} }
  },{passive:true});
  window.addEventListener('keydown', e => { if(e.key==='Escape' && state.sheet) closeSheet(); });

  render();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}
boot();
