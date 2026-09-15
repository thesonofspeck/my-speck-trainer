/* MySpeckTrainer — Strength · Treadmill · Core
   Vanilla JS PWA. All state lives in localStorage. */

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const KEY_KINDS = ["push","legs","pull","cardio"];
const KIND_ABBR = { push:"P", legs:"L", pull:"Pu", cardio:"C" };
const MS_PER_DAY = 24*60*60*1000;

const fmt = d => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseISO = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
// Monday of the week containing d (local time)
function mondayOf(d) { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const dow = (r.getDay()+6)%7; r.setDate(r.getDate()-dow); return r; }

let P;             // program.json
let WEEKS;         // number of weeks in a cycle
let store;         // persisted state
let state;         // ui state
let today, todayWeekIdx, todayDowIdx;

/* ---------------- Storage ---------------- */
const STORE_KEY = "speck_strength_v1";
function defaultSettings() {
  return { gymDays:[0,2,4], floatDay:5, startDate: iso(mondayOf(new Date())), units:"lb", cycle:1 };
}
function loadStore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { s = null; }
  if(!s || typeof s !== 'object') s = {};
  s.settings = Object.assign(defaultSettings(), s.settings || {});
  if(!Array.isArray(s.settings.gymDays) || s.settings.gymDays.length===0) s.settings.gymDays = [0,2,4];
  s.settings.gymDays = [...new Set(s.settings.gymDays)].filter(d=>d>=0&&d<=4).sort((a,b)=>a-b).slice(0,3);
  if(!s.sessions) s.sessions = {};
  return s;
}
function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} }

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

/* ---------------- Program helpers ---------------- */
const getBlock = w => P.blocks.find(b => b.weeks.includes(w)) || P.blocks[P.blocks.length-1];
const setsFor = w => { const b = getBlock(w); return b.sets[w - b.weeks[0]] ?? b.sets[b.sets.length-1]; };
const repsFor = (ex, w) => ex.reps || getBlock(w).reps;
const repRange = r => { const [lo, hi] = String(r).split('-').map(Number); return { lo, hi: hi||lo }; };
const startDate = () => parseISO(store.settings.startDate);
const weekStart = w => addDays(startDate(), (w-1)*7);
const unitStep = () => store.settings.units==='kg' ? P.progression.dbStepKg : P.progression.dbStepLb;

// Build 7 days for a week: assign push/legs/pull to gym days in order, cardio to the floating day.
function buildWeek(w) {
  const gym = [...store.settings.gymDays].sort((a,b)=>a-b);
  let floatDay = store.settings.floatDay;
  if(gym.includes(floatDay)) { // pick next free day, prefer later in the week
    const free = [0,1,2,3,4,5,6].filter(d=>!gym.includes(d));
    floatDay = free.find(d=>d>floatDay) ?? free[free.length-1];
  }
  const kinds = ["push","legs","pull"];
  const ws = weekStart(w);
  const cycle = store.settings.cycle;
  const days = [];
  for(let d=0; d<7; d++) {
    let kind = 'rest';
    const gi = gym.indexOf(d);
    if(gi>=0 && gi<kinds.length) kind = kinds[gi];
    else if(d===floatDay) kind = 'cardio';
    days.push({ dow:d, dowName:DOW[d], date:fmt(addDays(ws,d)), kind, key:sessionKey(cycle,w,kind,d), def:P.days[kind] });
  }
  return { week:w, block:getBlock(w), startDate:fmt(ws), endDate:fmt(addDays(ws,6)), days };
}

const blockIndex = w => Math.max(0, P.blocks.indexOf(getBlock(w)));
// The variant a slot uses in week w (rotates per block; anchors have one variant)
function variantFor(slot, w) { return slot.variants[blockIndex(w) % slot.variants.length]; }
// Resolved exercise list for a lift day in week w, honoring per-session swaps
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
// Treadmill session rotates through every lift workout: 3 per week, so the pattern shifts each week
function treadmillFor(kind, w) {
  const order = ["push","legs","pull"].indexOf(kind);
  return P.treadmill[(((w-1)*3 + order) % P.treadmill.length + P.treadmill.length) % P.treadmill.length];
}
function setSwap(key, slot, v) { const s = touchSession(key); if(!s.swaps) s.swaps = {}; if(v) s.swaps[slot] = true; else delete s.swaps[slot]; saveStore(); }
// Every exercise id that can appear on a day (variants + alternatives), deduped, in program order
function allExercisesFor(kind) {
  const seen = new Set(), out = [];
  (P.days[kind].exercises||[]).forEach(slot => slot.variants.forEach(v => [v, v.alt].forEach(e => { if(e && !seen.has(e.id)) { seen.add(e.id); out.push(Object.assign({anchor:!!slot.anchor}, e)); } })));
  return out;
}

function estimateMinutes(kind, w, sess) {
  const def = P.days[kind];
  if(!def || !def.exercises) return null;
  const sets = setsFor(w);
  let lift = 0;
  exercisesFor(kind, w, sess).forEach(ex => { lift += sets * (ex.perSide ? 2 : 1.5); });
  return { warm:P.meta.warmupMinutes, lift:Math.round(lift), core:P.meta.coreMinutes, total:Math.round(P.meta.warmupMinutes+lift+P.meta.coreMinutes) };
}

/* ---------------- History / progression ---------------- */
// All logged sessions for a kind, sorted by (cycle, week)
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
// Suggest next session's weight + reps for an exercise, given the last logged session.
// Double progression: fill the rep range at a weight, then take the smallest step up.
function suggestNext(ex, last, w) {
  const sets = setsFor(w);
  const { lo, hi } = repRange(repsFor(ex, w));
  const units = store.settings.units;
  const fmtW = x => ex.equip==='Cable' ? `${x} ${units} (stack)` : `${x} ${units}`;
  if(!last) return { kind:'new', weight:null, reps:Array(sets).fill(lo), text:`First time — start light. Aim for ${lo} clean reps per set with 3 left in the tank; note the weight and the app takes it from here.` };
  const reps = last.sets.map(s=>s.r).filter(r=>r!=null);
  const ws = last.sets.map(s=>s.w).filter(x=>x!=null);
  const weight = ws.length ? Math.max(...ws) : null;
  const step = unitStep();
  const extend = arr => Array.from({length:sets},(_,i)=> arr[Math.min(i, arr.length-1)]);
  if(!reps.length) {
    return { kind:'hold', weight, reps:Array(sets).fill(lo), text:`Reps weren't logged last time — stay at ${weight!=null?fmtW(weight):'the same weight'} and aim for ${lo}-${hi}.` };
  }
  if(reps.every(r => r >= hi)) {
    const nw = weight!=null ? weight + step : null;
    return { kind:'up', weight:nw, reps:Array(sets).fill(lo), text:`You hit ${hi}+ on every set — go up ${step} ${units}${ex.equip==='Cable'?' (one plate)':''} and start again at ${lo} reps.` };
  }
  const avg = reps.reduce((a,b)=>a+b,0)/reps.length;
  if(avg < lo - 2 && weight!=null) {
    return { kind:'down', weight:Math.max(0, weight - step), reps:Array(sets).fill(lo), text:`Reps fell well under ${lo} — that weight is too heavy for now. Drop ${step} ${units} and own ${lo} clean reps. Nothing in this plan should be a grind.` };
  }
  if(reps.some(r => r < lo)) {
    return { kind:'hold', weight, reps:extend(reps).map(r=>Math.max(lo, Math.min(hi, r))), text:`Same weight. Get every set to at least ${lo} reps before adding more.` };
  }
  const next = extend(reps).map(r => Math.min(hi, r + 1));
  return { kind:'add', weight, reps:next, text:`Same weight, one more rep per set. When every set reaches ${hi}, the weight goes up.` };
}
const fmtSuggest = (sg, units) => sg.weight!=null ? `${sg.weight} ${units} × ${sg.reps.join(', ')}` : `${sg.reps.join(', ')} reps`;

/* ---------------- Counting ---------------- */
function weekKeyDone(w) {
  const wk = buildWeek(w);
  return wk.days.filter(d => d.kind!=='rest' && getSession(d.key)?.done).length;
}
function totalKeyDone() { let c=0; for(let w=1; w<=WEEKS; w++) c += weekKeyDone(w); return c; }

/* ---------------- DOM helper ---------------- */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if(props) Object.entries(props).forEach(([k,v]) => {
    if(v==null) return;
    if(k==='style'&&typeof v==='object') Object.assign(el.style,v);
    else if(k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(),v);
    else if(k==='className') el.className=v;
    else if(k==='innerHTML') el.innerHTML=v;
    else el.setAttribute(k,v);
  });
  children.flat(Infinity).forEach(c => {
    if(c==null||c===false) return;
    el.appendChild(typeof c==='string'||typeof c==='number' ? document.createTextNode(String(c)) : c);
  });
  return el;
}

/* ---------------- Rest timer (lives outside the re-rendered tree) ---------------- */
const timer = { remaining:0, total:0, id:null };
function timerEl() { return document.getElementById('rest-timer'); }
function startTimer(sec) {
  stopTimer(false);
  timer.total = sec; timer.remaining = sec;
  timer.id = setInterval(() => {
    timer.remaining--;
    if(timer.remaining<=0) { stopTimer(true); return; }
    drawTimer();
  }, 1000);
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
    el.appendChild(h('span',{className:'rest-timer-text'},'Rest done — next set'));
    el.appendChild(h('button',{className:'rest-timer-x',onClick:()=>{ el.className='rest-timer'; }},'✕'));
    setTimeout(()=>{ if(el.className==='rest-timer done') el.className='rest-timer'; }, 4000);
  } else {
    el.className = 'rest-timer';
  }
}
function drawTimer() {
  const el = timerEl();
  document.documentElement.classList.add('timer-on');
  el.className = 'rest-timer show';
  el.innerHTML = '';
  const pct = timer.total ? (timer.remaining/timer.total)*100 : 0;
  el.appendChild(h('div',{className:'rest-timer-bar'},h('div',{className:'rest-timer-fill',style:{width:pct+'%'}})));
  el.appendChild(h('span',{className:'rest-timer-text'},`Rest  ${Math.floor(timer.remaining/60)}:${String(timer.remaining%60).padStart(2,'0')}`));
  el.appendChild(h('button',{className:'rest-timer-add',onClick:()=>{ timer.remaining+=15; timer.total+=15; drawTimer(); }},'+15'));
  el.appendChild(h('button',{className:'rest-timer-x',onClick:()=>stopTimer(false)},'Skip'));
}

/* ---------------- Render ---------------- */
let noteTimer = null;
const restSeconds = w => parseInt(getBlock(w).rest) || 60;
const isLiftKind = k => !!(P.days[k] && P.days[k].exercises);

function sessionProgress(kind, w, sess) {
  const exs = exercisesFor(kind, w, sess), sets = setsFor(w);
  let done = 0;
  exs.forEach(ex => { const arr = (sess && sess.sets && sess.sets[ex.id]) || []; for(let i=0;i<sets;i++) if(arr[i] && arr[i].done) done++; });
  return { done, total: exs.length*sets };
}
function liftSessionsDone() { let n=0; Object.entries(store.sessions).forEach(([k,s]) => { if(s.done && /-(push|legs|pull)$/.test(k)) n++; }); return n; }
function todayInfo() {
  if(todayWeekIdx < 0) return { kind:'before' };
  if(todayWeekIdx >= WEEKS) return { kind:'after' };
  const wk = buildWeek(todayWeekIdx+1);
  return { kind:'in', wk, day:wk.days[todayDowIdx], di:todayDowIdx };
}
// next key session on or after (week w, day di)
function nextKeySession(w, di) {
  for(let ww=w; ww<=WEEKS; ww++) {
    const wk = buildWeek(ww);
    for(let i=(ww===w?di:0); i<7; i++) if(wk.days[i].kind!=='rest' && !(getSession(wk.days[i].key)||{}).done) return { wk, day:wk.days[i], di:i };
  }
  return null;
}
function openSession(w, di) { state.session = { week:w, di }; state.exOpen = {}; state.warmupOpen = null; render(); }
function closeSession() { stopTimer(false); state.session = null; render(); }

function render() {
  if(noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
  if(nextPlanTimer) { clearTimeout(nextPlanTimer); nextPlanTimer = null; }
  state.nextPlanCtx = null;
  const viewKey = state.session ? `s:${state.session.week}:${state.session.di}` : `t:${state.tab}:${state.week}`;
  const viewChanged = viewKey !== state.lastViewKey;
  const savedScroll = window.scrollY;
  state.lastViewKey = viewKey;
  const app = document.getElementById('app');
  app.innerHTML = '';
  document.body.classList.toggle('in-session', !!state.session);

  if(state.session) renderSessionView(app);
  else if(state.tab==='progress') renderProgressTab(app);
  else renderTrainTab(app);

  if(!state.session) {
    const bar = h('div',{className:'tabbar'});
    [{id:'train',icon:'🏋️',label:'Train'},{id:'progress',icon:'📈',label:'Progress'}].forEach(t => {
      bar.appendChild(h('button',{className:`tab${state.tab===t.id?' active':''}`,onClick:()=>{state.tab=t.id;render();}},h('span',{className:'tab-icon'},t.icon),h('span',{className:'tab-label'},t.label)));
    });
    app.appendChild(bar);
  }

  requestAnimationFrame(()=>{
    if(viewChanged) window.scrollTo(0, 0); else window.scrollTo(0, savedScroll);
    if(viewChanged && !state.session) { const b = document.querySelector('.week-btn.active'); if(b) b.scrollIntoView({behavior:'instant',inline:'center',block:'nearest'}); }
  });
}

function appHeader(label, title, sub) {
  return h('div',{className:'header'},
    h('div',{className:'header-label'},label),
    h('h1',null,title),
    sub ? h('div',{className:'header-sub'},sub) : null,
  );
}

/* ---------------- Train tab ---------------- */
function renderTrainTab(app) {
  const wNum = state.week + 1;
  const wk = buildWeek(wNum);
  const block = wk.block;
  const sets = setsFor(wNum);
  app.appendChild(appHeader(`Cycle ${store.settings.cycle} · Week ${todayWeekIdx>=0&&todayWeekIdx<WEEKS?todayWeekIdx+1:'—'} of ${WEEKS}`, 'MySpeckTrainer', P.meta.tagline));

  // Today card
  const t = todayInfo();
  const todayBox = h('div',{className:'today-box'});
  if(t.kind==='in' && t.day.kind!=='rest') {
    const def = t.day.def, sess = getSession(t.day.key)||{};
    const lift = isLiftKind(t.day.kind);
    const prog = lift ? sessionProgress(t.day.kind, t.wk.week, sess) : null;
    const est = lift ? estimateMinutes(t.day.kind, t.wk.week, sess) : null;
    todayBox.style.background = `linear-gradient(135deg,${def.color}2a,${def.color}0a)`;
    todayBox.style.border = `1px solid ${def.color}55`;
    todayBox.appendChild(h('div',{className:'today-label'},`Today · ${t.day.dowName} ${t.day.date}`));
    todayBox.appendChild(h('div',{className:'today-title'},h('span',{className:'today-icon'},def.icon),def.name));
    todayBox.appendChild(h('div',{className:'today-sub'}, lift ? `${def.muscles} · ~${est.total} min + ${P.meta.treadmillMinutes} treadmill · ${sets} × ${block.reps}` : `${def.muscles} · 30-40 min`));
    if(lift && prog.done>0 && !sess.done) todayBox.appendChild(h('div',{className:'today-prog'},h('div',{className:'today-prog-bar'},h('div',{className:'today-prog-fill',style:{width:`${Math.round(prog.done/prog.total*100)}%`,background:def.color}})),h('span',{className:'today-prog-text'},`${prog.done}/${prog.total} sets`)));
    const label = sess.done ? '✓ Completed · view' : (lift && prog.done>0) ? `Continue · ${prog.done}/${prog.total} sets` : 'Start';
    todayBox.appendChild(h('button',{className:`start-btn${sess.done?' done':''}`,style: sess.done?null:{background:def.color},onClick:()=>openSession(t.wk.week, t.di)},label));
  } else if(t.kind==='in') {
    const nx = nextKeySession(t.wk.week, t.di+1);
    todayBox.appendChild(h('div',{className:'today-label'},`Today · ${t.day.dowName} ${t.day.date}`));
    todayBox.appendChild(h('div',{className:'today-title'},h('span',{className:'today-icon'},'⚪'),'Rest / Walk'));
    todayBox.appendChild(h('div',{className:'today-sub'},P.days.rest.note));
    if(nx) todayBox.appendChild(h('button',{className:'start-btn ghost',onClick:()=>openSession(nx.wk.week, nx.di)},`Next up: ${nx.day.def.name} · ${nx.day.dowName} ${nx.day.date} ›`));
  } else if(t.kind==='before') {
    todayBox.appendChild(h('div',{className:'today-label'},'Cycle not started'));
    todayBox.appendChild(h('div',{className:'today-title'},`Starts ${fmt(startDate())}`));
    todayBox.appendChild(h('div',{className:'today-sub'},'Peek at week 1 below, or change the start date in Progress › Settings.'));
  } else {
    todayBox.appendChild(h('div',{className:'today-label'},'Cycle complete'));
    todayBox.appendChild(h('div',{className:'today-title'},`${WEEKS} weeks done`));
    todayBox.appendChild(h('button',{className:'start-btn ghost',onClick:()=>{state.tab='progress';render();}},'Start the next cycle in Progress ›'));
  }
  app.appendChild(h('div',{className:'today'},todayBox));

  // Week strip
  const weekNavWrapper = h('div',{className:'week-nav-wrapper'});
  const prevBtn = h('button',{className:'week-nav-btn',onClick:()=>{if(state.week>0){state.week--;render();}}}, '‹');
  if(state.week===0) prevBtn.disabled=true;
  const nextBtn = h('button',{className:'week-nav-btn',onClick:()=>{if(state.week<WEEKS-1){state.week++;render();}}}, '›');
  if(state.week===WEEKS-1) nextBtn.disabled=true;
  const weeks = h('div',{className:'weeks'});
  for(let i=0;i<WEEKS;i++) {
    const b = getBlock(i+1);
    const isCurr = i === todayWeekIdx;
    const btn = h('button',{className:`week-btn${state.week===i?' active':''}`,onClick:()=>{state.week=i;render();}},String(i+1));
    if(state.week===i) { btn.style.background=b.color; btn.style.color='#fff'; }
    else if(isCurr) { btn.style.boxShadow=`inset 0 0 0 1.5px ${b.color}`; btn.style.color=b.color; }
    weeks.appendChild(btn);
  }
  weekNavWrapper.appendChild(prevBtn); weekNavWrapper.appendChild(weeks); weekNavWrapper.appendChild(nextBtn);
  app.appendChild(weekNavWrapper);

  // Week header (compact)
  const weekDone = weekKeyDone(wNum);
  const whBox = h('div',{className:'week-header-box compact',style:{background:`linear-gradient(135deg,${block.color}18,${block.color}06)`,border:`1px solid ${block.color}33`}},
    h('div',{className:'week-header-top'},
      h('span',{className:'week-header-num'},`Week ${wNum}`),
      h('div',{className:'week-header-meta'},
        h('span',{className:'week-header-date'},`${wk.startDate} – ${wk.endDate}`),
        h('span',{className:'week-header-phase',style:{color:block.color,background:block.color+'18'}},block.name),
      ),
    ),
    h('div',{className:'week-rx'},
      h('span',{className:'rx-chip'},`${sets} × ${block.reps}`),
      h('span',{className:'rx-chip'},`RPE ${block.rpe}`),
      h('span',{className:'rx-chip'},`Rest ${block.rest}`),
    ),
    h('div',{className:'week-progress'},
      h('div',{className:'week-progress-bar'},h('div',{className:'week-progress-fill',style:{width:`${Math.round(weekDone/4*100)}%`,background:block.color}})),
      h('span',{className:'week-progress-text'},`${weekDone}/4`),
    ),
  );
  const blockRow = h('div',{className:'fold-row',onClick:()=>{state.blockOpen=!state.blockOpen;render();}},h('span',null,'This block'),h('span',{className:`day-arrow${state.blockOpen?' open':''}`},'›'));
  whBox.appendChild(blockRow);
  if(state.blockOpen) {
    whBox.appendChild(h('div',{className:'week-header-focus',style:{marginTop:'8px'}},block.focus));
    whBox.appendChild(h('div',{className:'week-variants'}, ["push","legs","pull"].map(k => h('span',{className:'wv'}, h('span',{className:'wv-k',style:{color:P.days[k].color}}, `${P.days[k].name} `), exercisesFor(k, wNum, null).map(e=>e.name.replace(/ \(.*\)$/,'')).join(' · ')))));
  }
  app.appendChild(h('div',{className:'week-header'},whBox));

  // Day list
  const daysGroup = h('div',{className:'days-group'});
  wk.days.forEach((day, di) => {
    const def = day.def, sess = getSession(day.key)||{}, isDone = !!sess.done;
    const isToday = wNum === todayWeekIdx+1 && day.dow === todayDowIdx;
    const isKey = day.kind!=='rest';
    const lift = isLiftKind(day.kind);
    const prog = lift ? sessionProgress(day.kind, wNum, sess) : null;
    const card = h('div',{className:`day-card${isDone?' completed':''}${isKey?'':' rest-day'}`});
    const summary = h('div',{className:'day-summary'});
    summary.appendChild(h('span',{className:'day-icon'},def.icon));
    const info = h('div',{className:'day-info'});
    info.appendChild(h('div',{className:'day-top'},
      h('span',{className:'day-name'},day.dowName+' ',h('span',{className:'day-date'},day.date), isToday ? h('span',{className:'today-badge',style:{color:block.color,background:block.color+'22'}},'TODAY') : null),
      h('span',{className:'day-total'}, lift ? (prog.done>0&&!isDone ? `${prog.done}/${prog.total} sets` : `${P.meta.strengthMinutes}+${P.meta.treadmillMinutes} min`) : day.kind==='cardio' ? '30-40 min' : ''),
    ));
    info.appendChild(h('div',{className:'day-label',style:{color:def.color}}, def.name, lift ? h('span',{className:'day-muscles'},' · '+treadmillFor(day.kind, wNum).style) : null));
    summary.appendChild(info);
    if(isKey) summary.appendChild(h('button',{className:`check-btn${isDone?' done':''}`,onClick:(e)=>{e.stopPropagation();if(!isDone&&navigator.vibrate)navigator.vibrate(30);setDone(day.key,!isDone);render();}},isDone?'✓':''));
    summary.appendChild(h('span',{className:'day-arrow'},'›'));
    summary.addEventListener('click',()=>openSession(wNum, di));
    card.appendChild(summary);
    daysGroup.appendChild(card);
  });
  app.appendChild(h('div',{className:'days'},daysGroup));
}

/* ---------------- Session view ---------------- */
function renderSessionView(app) {
  const wNum = state.session.week, di = state.session.di;
  const wk = buildWeek(wNum), day = wk.days[di], def = day.def, block = wk.block;
  const sess = getSession(day.key)||{};
  const units = store.settings.units;
  const lift = isLiftKind(day.kind);
  const isDone = !!sess.done;

  const head = h('div',{className:'header session-head'});
  head.appendChild(h('button',{className:'back-btn',onClick:closeSession},'‹ Week '+wNum));
  const hrow = h('div',{className:'session-head-row'});
  hrow.appendChild(h('div',{className:'session-head-info'},
    h('h1',{style:{color:def.color}},def.icon+' '+def.name),
    h('div',{className:'header-sub'},`${day.dowName} ${day.date}${lift?` · ${setsFor(wNum)} × ${block.reps} · rest ${block.rest}`:''}`),
  ));
  if(lift) hrow.appendChild(h('button',{className:'timer-start',onClick:()=>startTimer(restSeconds(wNum))},'⏱'));
  head.appendChild(hrow);
  app.appendChild(head);

  const body = h('div',{className:'session-body'});
  if(lift) renderLiftSession(body, wk, day, sess, units);
  else if(day.kind==='cardio') renderCardioSession(body, day, sess);
  else body.appendChild(h('div',{className:'inline-detail'},h('div',{className:'inline-detail-label'},'⚪ Recovery'),h('div',{className:'inline-detail-note',style:{fontStyle:'normal',marginTop:0}},def.note)));

  // Notes
  const notesArea = h('div',{className:'notes-area'});
  const textarea = h('textarea',{className:'notes-input',placeholder: lift ? 'Notes — how it felt, what to change next time...' : 'Notes...'});
  textarea.value = sess.note || '';
  textarea.addEventListener('input',()=>{
    if(noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(()=>{ setNote(day.key, textarea.value); const sv = notesArea.querySelector('.notes-saved'); if(sv) { sv.textContent='Saved ✓'; setTimeout(()=>{ sv.textContent=''; },1500); } },500);
  });
  notesArea.appendChild(textarea); notesArea.appendChild(h('div',{className:'notes-saved'},''));
  body.appendChild(notesArea);

  body.appendChild(h('button',{className:`complete-btn${isDone?' undone':''}`,style: isDone?null:{background:def.color},onClick:()=>{ if(!isDone&&navigator.vibrate)navigator.vibrate(30); setDone(day.key,!isDone); if(!isDone) closeSession(); else render(); }}, isDone ? '✓ Completed — tap to undo' : (day.kind==='rest' ? 'Walked ✓' : 'Complete session')));
  app.appendChild(body);
}

function renderLiftSession(body, wk, day, sess, units) {
  const def = day.def, wNum = wk.week, block = wk.block;
  const sets = setsFor(wNum);
  const est = estimateMinutes(day.kind, wNum, sess);
  const exs = exercisesFor(day.kind, wNum, sess);
  const prog = sessionProgress(day.kind, wNum, sess);

  // Time plan + progress + log-all
  const plan = h('div',{className:'time-plan'});
  [{l:'Warm-up',m:est.warm,c:'#8e8e93'},{l:'Lifts',m:est.lift,c:def.color},{l:'Core',m:est.core,c:'#bf5af2'},{l:'Treadmill',m:P.meta.treadmillMinutes,c:'#F77F00'}]
    .forEach(s => plan.appendChild(h('div',{className:'time-seg',style:{flex:Math.max(s.m,10),background:s.c+'22',color:s.c}},h('span',{className:'time-seg-l'},s.l),h('span',{className:'time-seg-m'},`${s.m}m`))));
  body.appendChild(plan);
  const topRow = h('div',{className:'session-toprow'});
  topRow.appendChild(h('span',{className:'session-prog'},`${prog.done}/${prog.total} sets`));
  topRow.appendChild(h('button',{className:'text-btn',onClick:()=>{
    exs.forEach(ex => { const last = lastLog(day.kind, ex.id, store.settings.cycle, wNum); const sg = suggestNext(ex, last, wNum); for(let si=0; si<sets; si++) { const s = touchSession(day.key); if(!s.sets) s.sets={}; if(!s.sets[ex.id]) s.sets[ex.id]=[]; const cur = s.sets[ex.id][si]||{}; if(cur.w==null && sg.weight!=null) cur.w = sg.weight; if(cur.r==null) cur.r = sg.reps[si]; cur.done = true; s.sets[ex.id][si]=cur; } });
    saveStore(); if(navigator.vibrate) navigator.vibrate(20); render();
  }},'Log all as planned'));
  body.appendChild(topRow);

  // Warm-up (folds after the first two sessions)
  if(state.warmupOpen===null) state.warmupOpen = liftSessionsDone() < 2;
  const wu = h('div',{className:'inline-detail'});
  wu.appendChild(h('div',{className:'inline-detail-label fold',onClick:()=>{state.warmupOpen=!state.warmupOpen;render();}},h('span',null,`🔥 Warm-up · ${P.meta.warmupMinutes} min`),h('span',{className:`day-arrow${state.warmupOpen?' open':''}`},'›')));
  if(state.warmupOpen) P.warmup.forEach(x => wu.appendChild(h('div',{className:'mini-row'},h('span',{className:'mini-name'},x.name),h('span',{className:'mini-dur'},x.dur))));
  body.appendChild(wu);

  // Exercises
  exs.forEach((ex, i) => {
    const reps = repsFor(ex, wNum);
    const last = lastLog(day.kind, ex.id, store.settings.cycle, wNum);
    const sg = suggestNext(ex, last, wNum);
    const logged = (sess.sets && sess.sets[ex.id]) || [];
    const doneCount = logged.filter(x=>x&&x.done).length;
    const open = state.exOpen[ex.id] !== undefined ? state.exOpen[ex.id] : exerciseLogs(day.kind, ex.id).filter(l=>l.week!==wNum||l.cycle!==store.settings.cycle).length < 2;
    const exEl = h('div',{className:`exercise${doneCount>=sets?' all-done':''}`});
    exEl.appendChild(h('div',{className:'ex-top',onClick:()=>{state.exOpen[ex.id]=!open;render();}},
      h('div',{className:'ex-title'},h('span',{className:'ex-num',style:{background:def.color}},String(i+1)),h('span',{className:'ex-name'},ex.name, ex.anchor ? h('span',{className:'ex-tag anchor'},'★') : null, ex.newThisBlock ? h('span',{className:'ex-tag new'},'NEW') : null, ex.swapped ? h('span',{className:'ex-tag swap'},'SWAP') : null)),
      h('div',{className:'ex-meta'},h('span',{className:'ex-target'},`${sets} × ${reps}${ex.perSide?' /side':''}`),h('span',{className:`day-arrow${open?' open':''}`},'›')),
    ));
    // one-line last → today
    exEl.appendChild(h('div',{className:`ex-line ${sg.kind}`},
      last ? h('span',{className:'ex-line-last'},`Last ${fmtSets(last.sets, units).replace(' '+units,'')}`) : h('span',{className:'ex-line-last'},'First time'),
      h('span',{className:'ex-line-arrow'},'→'),
      h('span',{className:'ex-line-now'}, sg.weight!=null ? `${sg.weight} ${units} × ${sg.reps.join(', ')}` : `${sg.reps.join(', ')} reps, find weight`),
    ));
    if(open) {
      const det = h('div',{className:'ex-details'});
      det.appendChild(h('div',{className:'ex-cue'},ex.cue));
      if(ex.spine) det.appendChild(h('div',{className:'ex-spine'},'🦴 '+ex.spine));
      det.appendChild(h('div',{className:'ex-hint-text'},sg.text));
      det.appendChild(h('div',{className:'ex-alt-row'},
        h('span',{className:'ex-alt'}, ex.swapped ? `Swapped in for ${ex.altName}` : `Alt: ${ex.altName}`),
        h('button',{className:'swap-btn',onClick:(e)=>{ e.stopPropagation(); setSwap(day.key, ex.slot, !ex.swapped); render(); }}, ex.swapped ? '↩ Undo swap' : '⇄ Swap'),
      ));
      exEl.appendChild(det);
    }
    const grid = h('div',{className:'set-grid'});
    for(let si=0; si<sets; si++) {
      const cur = logged[si] || {};
      const row = h('div',{className:`set-row${cur.done?' done':''}`});
      row.appendChild(h('span',{className:'set-n'},`${si+1}`));
      const wIn = h('input',{className:'set-in',type:'number',inputmode:'decimal',step:'0.5',min:'0',placeholder: sg.weight!=null ? String(sg.weight) : '–'});
      if(cur.w!=null) wIn.value = cur.w;
      wIn.addEventListener('input',()=>{ setSetField(day.key, ex.id, si, 'w', wIn.value); scheduleNextPlan(); });
      const rIn = h('input',{className:'set-in',type:'number',inputmode:'numeric',step:'1',min:'0',placeholder: String(sg.reps[si])});
      if(cur.r!=null) rIn.value = cur.r;
      rIn.addEventListener('input',()=>{ setSetField(day.key, ex.id, si, 'r', rIn.value); scheduleNextPlan(); });
      const isLastSet = (i===exs.length-1 && si===sets-1);
      const chk = h('button',{className:`set-check${cur.done?' done':''}`,onClick:(e)=>{
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
      }}, cur.done ? '✓' : '');
      row.appendChild(wIn); row.appendChild(h('span',{className:'set-x'},units)); row.appendChild(rIn); row.appendChild(h('span',{className:'set-x'},'reps')); row.appendChild(chk);
      grid.appendChild(row);
    }
    exEl.appendChild(grid);
    body.appendChild(exEl);
  });

  // Core finisher
  const core = h('div',{className:`inline-detail${sess.coreDone?' checked':''}`});
  core.appendChild(h('div',{className:'inline-detail-label fold'},h('span',null,`🧱 Core finisher · ${P.meta.coreMinutes} min`),h('button',{className:`set-check${sess.coreDone?' done':''}`,onClick:()=>{const s=touchSession(day.key); s.coreDone=!s.coreDone; saveStore(); render();}},sess.coreDone?'✓':'')));
  coreFor(day.kind, wNum).forEach(c => core.appendChild(h('div',{className:'mini-row col'},h('div',{className:'mini-top'},h('span',{className:'mini-name'},c.name),h('span',{className:'mini-dur'},c.target)),h('div',{className:'mini-note'},c.cue))));
  body.appendChild(core);

  // Treadmill
  const tr = treadmillFor(day.kind, wNum);
  const tm = h('div',{className:`inline-detail treadmill${sess.treadmillDone?' checked':''}`});
  tm.appendChild(h('div',{className:'inline-detail-label fold'},h('span',null,`🏃 Treadmill · ${P.meta.treadmillMinutes} min`),h('button',{className:`set-check${sess.treadmillDone?' done':''}`,onClick:()=>{const s=touchSession(day.key); s.treadmillDone=!s.treadmillDone; saveStore(); render();}},sess.treadmillDone?'✓':'')));
  tm.appendChild(h('div',{className:'inline-detail-title'},tr.style, h('span',{className:`tr-int ${tr.intensity}`},tr.intensity)));
  tm.appendChild(h('div',{className:'inline-detail-note',style:{fontStyle:'normal'}},tr.note));
  tm.appendChild(h('div',{className:'inline-detail-note'},P.treadmillNote));
  body.appendChild(tm);

  // Next week
  const nextBox = h('div',{className:'inline-detail next-plan',id:'next-plan'});
  body.appendChild(nextBox);
  renderNextPlan(nextBox, wk, day, units);
}

// Debounced refresh of the next-week box while typing (avoids a full re-render that would steal focus)
let nextPlanTimer = null;
function scheduleNextPlan() {
  if(nextPlanTimer) clearTimeout(nextPlanTimer);
  nextPlanTimer = setTimeout(()=>{
    const box = document.getElementById('next-plan');
    if(!box || !state.nextPlanCtx) return;
    renderNextPlan(box, state.nextPlanCtx.wk, state.nextPlanCtx.day, store.settings.units);
  }, 400);
}
function renderNextPlan(box, wk, day, units) {
  state.nextPlanCtx = { wk, day };
  box.innerHTML = '';
  const def = day.def, wNum = wk.week;
  const nextW = wNum + 1;
  const isLastWeek = nextW > WEEKS;
  const nextBlock = getBlock(isLastWeek ? 1 : nextW);
  const sess = getSession(day.key) || {};
  box.appendChild(h('div',{className:'inline-detail-label'},`📅 Next ${def.name} day · ${isLastWeek ? 'next cycle, week 1' : 'week '+nextW} · ${nextBlock.name}`));
  const rows = [];
  const targetW = isLastWeek ? 1 : nextW;
  const nextExs = exercisesFor(day.kind, targetW, null);
  const todayExs = exercisesFor(day.kind, wNum, sess);
  let anyLogged = false;
  nextExs.forEach((ex, i) => {
    // history for that exact variant: today's sets if it's the same lift, else its own last log (maybe a previous cycle)
    const sameToday = todayExs[i] && todayExs[i].id === ex.id;
    const todays = sameToday && sess.sets && hasLog(sess.sets[ex.id])
      ? { cycle:store.settings.cycle, week:wNum, sets:sess.sets[ex.id].filter(x=>x&&(x.w!=null||x.r!=null)) }
      : lastLog(day.kind, ex.id, store.settings.cycle + (isLastWeek?1:0), targetW);
    if(todays) anyLogged = true;
    const sg = suggestNext(ex, todays, targetW);
    const changed = todayExs[i] && todayExs[i].id !== ex.id;
    rows.push(h('div',{className:'mini-row'},
      h('span',{className:'mini-name'},h('span',{className:`sg-dot ${sg.kind}`}),ex.name, changed ? h('span',{className:'ex-tag new'},'NEW') : null),
      h('span',{className:`mini-dur sg-${sg.kind}`}, sg.kind==='new' ? 'find weight' : fmtSuggest(sg, units)),
    ));
  });
  if(!anyLogged) rows.length = 0;
  if(!rows.length) {
    box.appendChild(h('div',{className:'mini-note'},'Log your weights and reps above and next week\'s targets appear here as you type.'));
  } else {
    rows.forEach(r => box.appendChild(r));
    box.appendChild(h('div',{className:'sg-legend'},
      h('span',{className:'sg-key'},h('span',{className:'sg-dot up'}),'weight up'),
      h('span',{className:'sg-key'},h('span',{className:'sg-dot add'}),'+1 rep'),
      h('span',{className:'sg-key'},h('span',{className:'sg-dot hold'}),'hold'),
      h('span',{className:'sg-key'},h('span',{className:'sg-dot down'}),'lighter'),
    ));
  }
}

function renderCardioSession(body, day, sess) {
  const def = day.def;
  const box = h('div',{className:'inline-detail'});
  box.appendChild(h('div',{className:'inline-detail-label'},'🏃 Pick one · 20-30 min'));
  def.options.forEach(o => {
    const sel = sess.choice === o.id;
    box.appendChild(h('div',{className:`option-row${sel?' selected':''}`,onClick:()=>{ setChoice(day.key, sel?null:o.id); render(); }},
      h('span',{className:'option-radio',style: sel?{background:def.color,borderColor:def.color}:null}, sel?'✓':''),
      h('div',{className:'option-body'},h('div',{className:'mini-top'},h('span',{className:'mini-name'},o.name),h('span',{className:'mini-dur'},o.dur)),h('div',{className:'mini-note'},o.note)),
    ));
  });
  body.appendChild(box);
  const core = h('div',{className:`inline-detail${sess.coreDone?' checked':''}`});
  core.appendChild(h('div',{className:'inline-detail-label fold'},h('span',null,`🧱 Then core · ${def.core.dur}`),h('button',{className:`set-check${sess.coreDone?' done':''}`,onClick:()=>{const s=touchSession(day.key); s.coreDone=!s.coreDone; saveStore(); render();}},sess.coreDone?'✓':'')));
  core.appendChild(h('div',{className:'inline-detail-title'},def.core.name));
  core.appendChild(h('div',{className:'inline-detail-note',style:{fontStyle:'normal'}},def.core.note));
  body.appendChild(core);
  const cd = h('div',{className:'inline-detail'});
  cd.appendChild(h('div',{className:'inline-detail-label'},`🧘 Optional · ${def.cooldown.dur}`));
  cd.appendChild(h('div',{className:'inline-detail-title'},def.cooldown.name));
  cd.appendChild(h('div',{className:'inline-detail-note',style:{fontStyle:'normal'}},def.cooldown.note));
  body.appendChild(cd);
}

/* ---------------- Progress tab ---------------- */
function renderProgressTab(app) {
  const totalDone = totalKeyDone(), totalSessions = WEEKS*4, pct = Math.round((totalDone/totalSessions)*100);
  const curBlock = getBlock(Math.min(Math.max(todayWeekIdx+1,1),WEEKS));
  app.appendChild(appHeader(`${fmt(startDate())} → ${fmt(addDays(startDate(), WEEKS*7-1))} · Cycle ${store.settings.cycle}`, 'Progress', P.meta.goal));
  const circumference = 2*Math.PI*22, dashoffset = circumference - (pct/100)*circumference;
  app.appendChild(h('div',{className:'overall'},
    h('div',{className:'overall-box'},
      h('div',{className:'overall-ring',innerHTML:`<svg width="56" height="56" viewBox="0 0 56 56"><circle cx="28" cy="28" r="22" fill="none" stroke="rgba(128,128,128,0.15)" stroke-width="4"/><circle class="progress-circle" cx="28" cy="28" r="22" fill="none" stroke="${curBlock.color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}"/></svg><div class="overall-ring-text">${pct}%</div>`}),
      h('div',{className:'overall-info'},
        h('div',{className:'overall-label'},'Cycle Progress'),
        h('div',{className:'overall-detail'},`${totalDone} of ${totalSessions} sessions · 3 lifts + 1 cardio per week`),
      ),
    ),
  ));
  const pbar = h('div',{className:'phase-bar',style:{marginTop:'16px'}});
  P.blocks.forEach(b => { const seg = h('div',{className:'phase-bar-seg'}); seg.style.flex = b.weeks.length; seg.style.background = b===curBlock ? b.color : b.color+'33'; pbar.appendChild(seg); });
  app.appendChild(pbar);
  app.appendChild(renderAnalytics());
  app.appendChild(renderLifts(store.settings.units));

  if(todayWeekIdx >= WEEKS-1) {
    const box = h('div',{className:'cycle-box',style:{marginTop:'28px'}});
    box.appendChild(h('div',{className:'cycle-title'},'End of the cycle'));
    box.appendChild(h('div',{className:'cycle-text'},'Start the next 12 weeks with the weights you have now. Your lift history carries over, so week 1 of the new cycle picks up where week 12 left off.'));
    if(state.cycleConfirm) {
      box.appendChild(h('button',{className:'primary-btn',onClick:()=>{ startNextCycle(); }},`Tap again to start cycle ${store.settings.cycle+1}`));
      box.appendChild(h('button',{className:'reset-btn',style:{marginLeft:'8px'},onClick:()=>{state.cycleConfirm=false;render();}},'Cancel'));
    } else box.appendChild(h('button',{className:'primary-btn',onClick:()=>{state.cycleConfirm=true;render();}},`Start cycle ${store.settings.cycle+1}`));
    app.appendChild(box);
  }
  app.appendChild(renderRules());
  app.appendChild(renderSettings());
  const resetArea = h('div',{className:'reset-area'});
  if(state.resetConfirm) {
    resetArea.appendChild(h('button',{className:'reset-btn reset-confirm',onClick:()=>{localStorage.removeItem(STORE_KEY);store=loadStore();state.resetConfirm=false;state.settingsOpen=false;computeToday();render();}}, 'Tap again to erase everything'));
    resetArea.appendChild(h('button',{className:'reset-btn',style:{marginLeft:'8px'},onClick:()=>{state.resetConfirm=false;render();}}, 'Cancel'));
  } else resetArea.appendChild(h('button',{className:'reset-btn',onClick:()=>{state.resetConfirm=true;render();}}, 'Reset all progress'));
  app.appendChild(resetArea);
}

function startNextCycle() {
  const endOfCycle = addDays(startDate(), WEEKS*7);
  const t = new Date();
  store.settings.startDate = iso(t >= endOfCycle ? mondayOf(t) : endOfCycle);
  store.settings.cycle += 1;
  saveStore();
  state.cycleConfirm = false; state.week = 0; state.session = null; state.tab = 'train';
  computeToday();
  render();
}

/* ---------------- Analytics ---------------- */
function renderAnalytics() {
  const box = h('div',{className:'analytics-box'});
  box.appendChild(h('div',{className:'analytics-title'},'Consistency'));
  const container = h('div',{className:'streak-container'});
  const labels = h('div',{className:'streak-day-labels'});
  KEY_KINDS.forEach(k => labels.appendChild(h('div',{className:'streak-day-label',style:{color:P.days[k].color}},KIND_ABBR[k])));
  container.appendChild(labels);
  const grid = h('div',{className:'streak-grid',style:{gridTemplateColumns:`repeat(${WEEKS}, 1fr)`}});
  let perfectWeeks = 0, weekStreak = 0, longestWeekStreak = 0, run = 0;
  for(let w=1; w<=WEEKS; w++) {
    const wk = buildWeek(w);
    const col = h('div',{className:`streak-col${state.week===w-1?' current-week':''}`});
    let n = 0;
    KEY_KINDS.forEach(k => {
      const d = wk.days.find(x=>x.kind===k);
      const done = d ? !!getSession(d.key)?.done : false;
      const cell = h('div',{className:`streak-cell${done?' done':''}`});
      if(done) { n++; cell.style.background = P.days[k].color; }
      col.appendChild(cell);
    });
    if(n===4) { perfectWeeks++; run++; if(run>longestWeekStreak) longestWeekStreak=run; } else run = 0;
    col.appendChild(h('div',{className:'streak-week'},String(w)));
    grid.appendChild(col);
  }
  // current streak: consecutive perfect weeks ending at the last completed week
  const lastFull = Math.min(WEEKS, todayWeekIdx); // weeks strictly before this one
  for(let w=lastFull; w>=1; w--) { if(weekKeyDone(w)===4) weekStreak++; else break; }
  if(todayWeekIdx>=0 && todayWeekIdx<WEEKS && weekKeyDone(todayWeekIdx+1)===4) weekStreak++;
  container.appendChild(grid);
  box.appendChild(container);
  const stats = h('div',{className:'streak-stats'});
  [{num:totalKeyDone(),label:'Sessions'},{num:weekStreak,label:'Week streak'},{num:perfectWeeks,label:'Perfect weeks'}].forEach(s => {
    const numEl = h('div',{className:'streak-stat-num'}); numEl.style.color = s.num>0?'var(--green)':'var(--text-faint)'; numEl.textContent = s.num;
    stats.appendChild(h('div',{className:'streak-stat'},numEl,h('div',{className:'streak-stat-label'},s.label)));
  });
  box.appendChild(stats);
  return h('div',{className:'analytics'},box);
}

function renderLifts(units) {
  const box = h('div',{className:'zones-box'});
  box.appendChild(h('div',{className:'zones-title'},'Your lifts'));
  let any = false;
  ["push","legs","pull"].forEach(kind => {
    allExercisesFor(kind).forEach(ex => {
      const logs = exerciseLogs(kind, ex.id).filter(l => l.sets.some(x => x.w!=null));
      if(!logs.length) return;
      any = true;
      const first = logs[0], latest = logs[logs.length-1];
      const maxW = l => { const ws = l.sets.map(s=>s.w).filter(x=>x!=null); return ws.length?Math.max(...ws):null; };
      const fw = maxW(first), lw = maxW(latest);
      const delta = (fw!=null && lw!=null) ? lw-fw : null;
      const bestR = latest.sets.map(s=>s.r).filter(x=>x!=null);
      box.appendChild(h('div',{className:'lift-row'},
        h('div',{className:'lift-name'},h('span',{className:'lift-dot',style:{background:P.days[kind].color}}),ex.name, ex.anchor ? h('span',{className:'ex-tag anchor'},'★') : null),
        h('div',{className:'lift-now'},lw!=null?`${lw} ${units}`:'—', bestR.length?h('span',{className:'lift-reps'},` × ${Math.max(...bestR)}`):null),
        h('div',{className:`lift-delta${delta>0?' up':''}`}, delta==null||logs.length<2 ? `${logs.length} log${logs.length===1?'':'s'}` : delta>0?`+${delta} ${units}`:delta<0?`${delta} ${units}`:'same'),
      ));
    });
  });
  if(!any) box.appendChild(h('div',{className:'lift-empty'},'Log weight and reps in a session and your progress shows up here.'));
  return h('div',{className:'zones'},box);
}

function renderRules() {
  const wrap = h('div',{className:'zones'});
  const box = h('div',{className:'zones-box'});
  box.appendChild(h('div',{className:'zones-title'},'Spine-safe rules'));
  P.spine.forEach((r,i) => box.appendChild(h('div',{className:'rule-row'},h('span',{className:'rule-n'},String(i+1)),h('span',{className:'rule-text'},r))));
  box.appendChild(h('div',{className:'zones-title',style:{marginTop:'16px'}},'How to progress'));
  P.progression.rules.forEach(r => box.appendChild(h('div',{className:'rule-row'},h('span',{className:'rule-n'},'↑'),h('span',{className:'rule-text'},r))));
  box.appendChild(h('div',{className:'zones-title',style:{marginTop:'16px'}},'Treadmill effort'));
  P.hrZones.forEach(z => box.appendChild(h('div',{className:'zone-row'},h('span',{className:'zone-label',style:{color:z.c}},z.z),h('span',{className:'zone-desc'},z.d),h('span',{className:'zone-range'},z.r+' bpm'))));
  wrap.appendChild(box);
  return wrap;
}

/* ---------------- Settings ---------------- */
function renderSettings() {
  const wrap = h('div',{className:'zones'});
  const box = h('div',{className:'zones-box'});
  const s = store.settings;
  const head = h('div',{className:'settings-head',onClick:()=>{state.settingsOpen=!state.settingsOpen;render();}},
    h('div',{className:'zones-title',style:{marginBottom:0}},'Schedule & settings'),
    h('span',{className:'settings-sum'},`${s.gymDays.map(d=>DOW[d]).join(' · ')} + ${DOW[s.floatDay]}`),
    h('span',{className:`day-arrow${state.settingsOpen?' open':''}`},'›'),
  );
  box.appendChild(head);
  if(state.settingsOpen) {
    const body = h('div',{className:'settings-body'});
    body.appendChild(h('div',{className:'settings-label'},'Office gym days (pick 3, Mon–Fri) — Push, Legs, Pull in that order'));
    const gymRow = h('div',{className:'chip-row'});
    for(let d=0; d<7; d++) {
      const on = s.gymDays.includes(d);
      const disabled = d>4;
      const chip = h('button',{className:`chip${on?' on':''}`,disabled:disabled?'true':null,onClick:()=>{
        if(on) { if(s.gymDays.length>1) s.gymDays = s.gymDays.filter(x=>x!==d); }
        else { s.gymDays = [...s.gymDays, d].sort((a,b)=>a-b); if(s.gymDays.length>3) s.gymDays = s.gymDays.slice(-3); }
        saveStore(); render();
      }},DOW[d]);
      if(on) { const gi = s.gymDays.indexOf(d); chip.style.background = P.days[["push","legs","pull"][gi]]?.color || 'var(--green)'; }
      gymRow.appendChild(chip);
    }
    body.appendChild(gymRow);
    body.appendChild(h('div',{className:'settings-label'},'Home cardio + core day'));
    const floatRow = h('div',{className:'chip-row'});
    for(let d=0; d<7; d++) {
      const on = s.floatDay===d;
      const chip = h('button',{className:`chip${on?' on':''}`,onClick:()=>{ s.floatDay=d; saveStore(); render(); }},DOW[d]);
      if(on) chip.style.background = P.days.cardio.color;
      if(s.gymDays.includes(d)) chip.style.opacity = '0.4';
      floatRow.appendChild(chip);
    }
    body.appendChild(floatRow);
    body.appendChild(h('div',{className:'settings-note'},'Completion is tracked per session, not per date — if you go in on a different day one week, just log it on the card.'));

    body.appendChild(h('div',{className:'settings-label'},'Units'));
    const uRow = h('div',{className:'chip-row'});
    ['lb','kg'].forEach(u => { const chip = h('button',{className:`chip${s.units===u?' on':''}`,onClick:()=>{ s.units=u; saveStore(); render(); }},u); if(s.units===u) chip.style.background='var(--blue)'; uRow.appendChild(chip); });
    body.appendChild(uRow);

    body.appendChild(h('div',{className:'settings-label'},'Cycle start (a Monday)'));
    const dateIn = h('input',{className:'date-in',type:'date',value:s.startDate});
    dateIn.addEventListener('change',()=>{ if(!dateIn.value) return; s.startDate = iso(mondayOf(parseISO(dateIn.value))); saveStore(); computeToday(); state.week = (todayWeekIdx>=0&&todayWeekIdx<WEEKS)?todayWeekIdx:0; render(); });
    body.appendChild(dateIn);
    box.appendChild(body);
  }
  wrap.appendChild(box);
  return wrap;
}

/* ---------------- Boot ---------------- */
function computeToday() {
  today = new Date();
  const daysSinceStart = Math.floor((new Date(today.getFullYear(),today.getMonth(),today.getDate()) - startDate()) / MS_PER_DAY);
  todayWeekIdx = Math.floor(daysSinceStart / 7);
  todayDowIdx = ((daysSinceStart % 7) + 7) % 7;
}

async function boot() {
  try {
    P = await fetch('data/program.json').then(r => r.json());
  } catch(e) {
    document.getElementById('app').textContent = 'Failed to load the program. Please reload.';
    return;
  }
  WEEKS = P.meta.weeks;
  store = loadStore();
  saveStore();
  state = { tab:'train', session:null, week:0, exOpen:{}, warmupOpen:null, blockOpen:false, resetConfirm:false, cycleConfirm:false, settingsOpen:false, lastViewKey:null };
  computeToday();
  if(todayWeekIdx>=0 && todayWeekIdx<WEEKS) state.week = todayWeekIdx;
  else if(todayWeekIdx>=WEEKS) state.week = WEEKS-1;

  if(!document.getElementById('rest-timer')) document.body.appendChild(h('div',{id:'rest-timer',className:'rest-timer'}));

  // Swipe to change week on the Train tab (ignore swipes that start on inputs)
  let touchStartX=0, touchStartY=0, touchOnInput=false;
  const app = document.getElementById('app');
  app.addEventListener('touchstart', e=>{ touchStartX=e.touches[0].clientX; touchStartY=e.touches[0].clientY; touchOnInput = ['INPUT','TEXTAREA'].includes(e.target.tagName); },{passive:true});
  app.addEventListener('touchend', e=>{
    if(touchOnInput || state.session || state.tab!=='train') return;
    const dx=e.changedTouches[0].clientX-touchStartX, dy=e.changedTouches[0].clientY-touchStartY;
    if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5){
      if(dx<0 && state.week<WEEKS-1){state.week++;render();}
      else if(dx>0 && state.week>0){state.week--;render();}
    }
  },{passive:true});

  render();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}

boot();
