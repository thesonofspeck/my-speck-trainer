const START = new Date(2026, 3, 6);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = d => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

let PHASES, ICONS, BW, BW_BY_PHASE, SWIM, SWIM_BY_PHASE, WATCH, HR_ZONES, WEEK_PARAMS;
const getPhase = w => PHASES.find(p => p.weeks.includes(w));
const getPhaseIndex = w => PHASES.findIndex(p => p.weeks.includes(w));
const getBW = w => BW_BY_PHASE[getPhaseIndex(w)];
const getSwim = w => SWIM_BY_PHASE[getPhaseIndex(w)];

async function fetchJsonData() {
  const [phasesData, bwData, swimData, watchData, workoutsData] = await Promise.all([
    fetch('data/phases.json').then(r => r.json()),
    fetch('data/bodyweight.json').then(r => r.json()),
    fetch('data/swim.json').then(r => r.json()),
    fetch('data/watch.json').then(r => r.json()),
    fetch('data/workouts.json').then(r => r.json()),
  ]);
  PHASES = phasesData.phases;
  ICONS = phasesData.icons;
  BW = bwData;
  BW_BY_PHASE = [BW.foundation, BW.build, BW.peak, BW.raceShape];
  SWIM = swimData;
  SWIM_BY_PHASE = [SWIM.foundation, SWIM.build, SWIM.peak, SWIM.raceShape];
  WATCH = watchData;
  HR_ZONES = workoutsData.hrZones;
  WEEK_PARAMS = workoutsData.weekParams;
}

function buildWeek(w) {
  const phase = getPhase(w);
  const bw = getBW(w);
  const swim = getSwim(w);
  const wp = WEEK_PARAMS.find(p => w <= p.maxWeek);
  let easyDur = wp.easyDur;
  let tempoSpec = wp.tempo;
  let vo2Spec = wp.vo2;
  let longRunDur = wp.longRunDur;

  const tempoSegs = [{name:"Warm-Up",dur:"5:00",zone:"Z1-2",note:"Easy jog"}];
  if(tempoSpec.blocks){
    for(let i=1;i<=tempoSpec.blocks;i++){
      tempoSegs.push({name:`Tempo Block ${i}`,dur:`${tempoSpec.bd}:00`,zone:"Z3-4",note:tempoSpec.note||"Comfortably hard",repeat:true});
      if(i<tempoSpec.blocks) tempoSegs.push({name:"Easy Recovery",dur:`${tempoSpec.rec}:00`,zone:"Z2",note:"Jog easy"});
    }
  } else {
    tempoSegs.push({name:"Tempo",dur:`${tempoSpec.dur}:00`,zone:"Z3-4",note:tempoSpec.note||"Comfortably hard — sustained"});
  }
  tempoSegs.push({name:"Cool-Down",dur:"3:00",zone:"Z1",note:"Walk"});
  const tempoTot = tempoSpec.blocks ? 5+(tempoSpec.bd*tempoSpec.blocks)+(tempoSpec.rec*(tempoSpec.blocks-1))+3 : 5+tempoSpec.dur+3;

  const restFmt = vo2Spec.rest>=1 ? (vo2Spec.rest%1===0?`${vo2Spec.rest}:00`:`${Math.floor(vo2Spec.rest)}:30`) : `0:${vo2Spec.rest*60}`;
  const vo2Tot = 5+(vo2Spec.reps*(vo2Spec.work+vo2Spec.rest))+3;

  const poolTue = w>=5;
  const poolSat = w>=4;
  const weekStart = addDays(START,(w-1)*7);
  const hasLong = longRunDur!==null;
  const isEven = w%2===0;

  if(w===1){
    return { week:w, phase:phase.name, phaseColor:phase.color, focus:"Build the habit — you started with intervals, now build around them", startDate:fmt(START), days:[
      {day:"Mon",date:fmt(START),type:"REST",label:"Rest Day",color:"#555",segments:[{name:"Rest",dur:"—",zone:"",note:"Program starts tomorrow"}],total:"Off"},
      {day:"Tue",date:fmt(addDays(START,1)),type:"VO2MAX",label:"VO₂max Intervals",color:"#E63946",segments:[
        {name:"Warm-Up",dur:"5:00",zone:"Z1-2",note:"Easy jog"},
        {name:"Hard Run",dur:"4:00",zone:"Z4-5",note:"8:30/mi — done!",repeat:true},
        {name:"Recovery",dur:"1:00",zone:"Z1",note:"Walk",repeat:true},
        {name:"↻ Repeat",dur:"×5",zone:"",note:"Completed at 8:30 pace"},
        {name:"Cool-Down",dur:"3:00",zone:"Z1",note:"Walk"},
      ],total:"33 min"},
      {day:"Wed",date:fmt(addDays(START,2)),type:"EASY",label:"Easy Run",color:"#40916C",segments:[
        {name:"Warm-Up",dur:"5:00",zone:"Z1",note:"Walk → jog"},
        {name:"Easy Run",dur:"20:00",zone:"Z2",note:"130-145 bpm. Way slower than yesterday."},
        {name:"Cool-Down",dur:"3:00",zone:"Z1",note:"Walk"},
      ],total:"28 min"},
      {day:"Thu",date:fmt(addDays(START,3)),type:"TEMPO",label:"Tempo Run",color:"#F77F00",segments:tempoSegs,total:`${tempoTot} min`},
      {day:"Fri",date:fmt(addDays(START,4)),type:"EASY",label:"Easy Run + Bodyweight",color:"#40916C",segments:[
        {name:"Warm-Up",dur:"5:00",zone:"Z1",note:"Walk → jog"},
        {name:"Easy Run",dur:"20:00",zone:"Z2",note:"Same as Wednesday"},
        {name:"Cool-Down",dur:"3:00",zone:"Z1",note:"Walk"},
        {name:"Bodyweight",dur:"~20 min",zone:"Strength",note:bw.label},
      ],total:"48 min"},
      {day:"Sat",date:fmt(addDays(START,5)),type:"CROSS",label:"Walk or Hike",color:"#6B7280",segments:[
        {name:"Easy Walk",dur:"40-50 min",zone:"Z1",note:"No pool yet — get outside, stay loose."},
      ],total:"40-50 min"},
      {day:"Sun",date:fmt(addDays(START,6)),type:"PLAY",label:"Beach Volleyball",color:"#9B5DE5",segments:[
        {name:"Beach Volleyball",dur:"As long as you want",zone:"Fun",note:"Natural interval training"},
      ],total:"Enjoy"},
    ]};
  }

  const days = [
    {day:"Mon",date:fmt(weekStart),type:"EASY",label:"Easy Run",color:"#40916C",segments:[
      {name:"Warm-Up",dur:"5:00",zone:"Z1",note:"Walk → jog"},
      {name:"Easy Run",dur:`${easyDur}:00`,zone:"Z2",note:"Conversational. 130-145 bpm."},
      {name:"Cool-Down",dur:"3:00",zone:"Z1",note:"Walk"},
    ],total:`${easyDur+8} min`},

    poolTue
      ? {day:"Tue",date:fmt(addDays(weekStart,1)),type:"SWIM",label:"Swim + Bodyweight",color:"#3A86FF",segments:[
          {name:"Swim",dur:swim.dur,zone:"Cardio",note:swim.desc},
          {name:"Bodyweight",dur:"~20 min",zone:"Strength",note:bw.label},
        ],total:"45-55 min"}
      : {day:"Tue",date:fmt(addDays(weekStart,1)),type:"CROSS",label:"Walk + Bodyweight",color:"#6B7280",segments:[
          {name:"Brisk Walk",dur:"30:00",zone:"Z1-2",note:"Active recovery for your legs"},
          {name:"Bodyweight",dur:"~20 min",zone:"Strength",note:bw.label},
        ],total:"~50 min"},

    {day:"Wed",date:fmt(addDays(weekStart,2)),type:"VO2MAX",label:"VO₂max Intervals",color:"#E63946",segments:[
      {name:"Warm-Up",dur:"5:00",zone:"Z1-2",note:"Easy jog"},
      {name:"Hard Run",dur:`${vo2Spec.work}:00`,zone:"Z4-5",note:vo2Spec.note||"Hard but controlled — RPE 8/10",repeat:true},
      {name:"Recovery",dur:restFmt,zone:"Z1",note:"Walk or very slow jog",repeat:true},
      {name:"↻ Repeat",dur:`×${vo2Spec.reps}`,zone:"",note:`${vo2Spec.reps} rounds`},
      {name:"Cool-Down",dur:"3:00",zone:"Z1",note:"Walk"},
    ],total:`${Math.round(vo2Tot)} min`},

    isEven&&w>=4
      ? {day:"Thu",date:fmt(addDays(weekStart,3)),type:"PROGRESS",label:"Progression Run",color:"#7B2D8E",segments:[
          {name:"Warm-Up",dur:"5:00",zone:"Z1",note:"Walk → jog"},
          {name:"Easy",dur:w<=8?"10:00":"12:00",zone:"Z2",note:"Settle in"},
          {name:"Moderate",dur:"10:00",zone:"Z3",note:"Pick it up"},
          {name:"Hard",dur:w<=8?"5:00":w<=12?"8:00":"5:00",zone:"Z4",note:"Finish strong"},
          {name:"Cool-Down",dur:"3:00",zone:"Z1",note:"Walk"},
        ],total:`${5+(w<=8?25:w<=12?30:25)+3} min`}
      : {day:"Thu",date:fmt(addDays(weekStart,3)),type:"EASY",label:"Easy Run + Bodyweight",color:"#40916C",segments:[
          {name:"Warm-Up",dur:"5:00",zone:"Z1",note:"Walk → jog"},
          {name:"Easy Run",dur:`${easyDur}:00`,zone:"Z2",note:"Easy — recovery from yesterday's intervals"},
          {name:"Cool-Down",dur:"3:00",zone:"Z1",note:"Walk"},
          {name:"Bodyweight",dur:"~20 min",zone:"Strength",note:bw.label},
        ],total:`${easyDur+28} min`},

    {day:"Fri",date:fmt(addDays(weekStart,4)),type:"TEMPO",label:"Tempo Run",color:"#F77F00",segments:tempoSegs,total:`${tempoTot} min`},

    hasLong
      ? {day:"Sat",date:fmt(addDays(weekStart,5)),type:"LONG",label:"Long Easy Run",color:"#1B4332",segments:[
          {name:"Warm-Up",dur:"5:00",zone:"Z1",note:"Walk → easy jog"},
          {name:"Long Run",dur:`${longRunDur}:00`,zone:"Z2",note:"Easy pace the entire time. Build your engine."},
          {name:"Cool-Down",dur:"5:00",zone:"Z1",note:"Walk, stretch"},
        ],total:`${longRunDur+10} min`}
      : poolSat
        ? {day:"Sat",date:fmt(addDays(weekStart,5)),type:"SWIM",label:"Pool Session",color:"#3A86FF",segments:[
            {name:"Swim",dur:swim.dur,zone:"Easy",note:swim.desc},
          ],total:swim.dur}
        : {day:"Sat",date:fmt(addDays(weekStart,5)),type:"CROSS",label:"Walk or Hike",color:"#6B7280",segments:[
            {name:"Easy Walk",dur:"40-50 min",zone:"Z1",note:"No pool yet. Get outside, stay loose."},
          ],total:"40-50 min"},

    {day:"Sun",date:fmt(addDays(weekStart,6)),type:"PLAY",label:"Beach Volleyball",color:"#9B5DE5",segments:[
      {name:"Beach Volleyball",dur:"As long as you want",zone:"Fun",note:"Sprint, jump, recover"},
    ],total:"Enjoy"},
  ];

  return { week:w, phase:phase.name, phaseColor:phase.color, focus:phase.name==="Foundation"?"Build the aerobic base & movement habits":phase.name==="Build"?"Add volume & intensity across all three":phase.name==="Peak"?"Highest training load — push your ceiling":"Sharpen speed, maintain strength, test yourself", startDate:fmt(weekStart), days };
}

let ALL_WEEKS;

const STORE_KEY = "summer_engine_v1";
let _dataCache = null;
function loadData() {
  if(!_dataCache) { try { _dataCache = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { _dataCache = {}; } }
  return _dataCache;
}
function saveData(d) { _dataCache = d; localStorage.setItem(STORE_KEY, JSON.stringify(d)); }
const skey = (w,di) => `${w}-${di}`;
function getDone(w,di) { return !!(loadData()[skey(w,di)]?.done); }
function setDone(w,di,v) { const d=loadData(),k=skey(w,di); if(!d[k]) d[k]={}; d[k].done=v; saveData(d); }
function getNote(w,di) { return loadData()[skey(w,di)]?.note||""; }
function setNote(w,di,v) { const d=loadData(),k=skey(w,di); if(!d[k]) d[k]={}; d[k].note=v; saveData(d); }
function getWeekDone(w) { const wk=ALL_WEEKS[w]; let c=0; wk.days.forEach((_,i)=>{ if(getDone(wk.week,i)) c++; }); return c; }
function getTotalDone() { let c=0; ALL_WEEKS.forEach(wk=>wk.days.forEach((_,i)=>{ if(getDone(wk.week,i)) c++; })); return c; }

let state, now, daysSinceStart, todayWeekIdx, todayDayIdx, lastRenderedWeek;

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if(props) Object.entries(props).forEach(([k,v]) => {
    if(k==='style'&&typeof v==='object') Object.assign(el.style,v);
    else if(k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(),v);
    else if(k==='className') el.className=v;
    else if(k==='innerHTML') el.innerHTML=v;
    else el.setAttribute(k,v);
  });
  children.flat(Infinity).forEach(c => {
    if(c==null) return;
    el.appendChild(typeof c==='string' ? document.createTextNode(c) : c);
  });
  return el;
}

function getWatchItem(day, week) {
  const type = day.type;
  if(!['EASY','VO2MAX','TEMPO','PROGRESS','LONG'].includes(type)) return null;
  const phaseIdx = getPhaseIndex(week);
  const items = WATCH[phaseIdx].items;
  if(type==='EASY') {
    const seg = day.segments.find(s=>s.name==='Easy Run');
    if(seg) return items.find(it=>it.n===`Easy ${parseInt(seg.dur)}`);
  }
  if(type==='LONG') {
    const seg = day.segments.find(s=>s.name==='Long Run');
    if(seg) return items.find(it=>it.n===`Long ${parseInt(seg.dur)}`);
  }
  if(type==='TEMPO') {
    const blocks = day.segments.filter(s=>s.name.startsWith('Tempo Block'));
    if(blocks.length>0) return items.find(it=>it.n===`Tempo ${blocks.length}\u00d7${parseInt(blocks[0].dur)}`);
    const seg = day.segments.find(s=>s.name==='Tempo');
    if(seg) return items.find(it=>it.n===`Tempo ${parseInt(seg.dur)}`);
  }
  if(type==='VO2MAX') {
    const repeat = day.segments.find(s=>s.name==='↻ Repeat');
    const hard = day.segments.find(s=>s.name==='Hard Run');
    const rec = day.segments.find(s=>s.name==='Recovery');
    if(repeat&&hard&&rec) {
      const reps = repeat.dur.replace('×','');
      const work = parseInt(hard.dur);
      const restStr = rec.dur==='1:00'?'1':rec.dur;
      return items.find(it=>it.n===`VO2 ${reps}\u00d7(${work}+${restStr})`);
    }
  }
  if(type==='PROGRESS') return items.find(it=>it.n.startsWith('Progression'));
  return null;
}

let noteTimer = null;

function render() {
  if(noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
  _dataCache = null;
  const savedScroll = window.scrollY;
  const weekChanged = state.week !== lastRenderedWeek;
  lastRenderedWeek = state.week;
  const app = document.getElementById('app');
  app.innerHTML = '';

  const wk = ALL_WEEKS[state.week];
  const phase = getPhase(wk.week);
  const weekDone = getWeekDone(state.week);
  const totalDone = getTotalDone();
  const totalWorkouts = 17*7;
  const pct = Math.round((totalDone/totalWorkouts)*100);

  // Header
  app.appendChild(h('div',{className:'header'},
    h('div',{className:'header-label'},'Apr 6 → Aug 1 · 17 Weeks'),
    h('h1',null,'MySpeckTrainer'),
    h('div',{className:'header-sub'},'Run · Swim · Bodyweight · Volleyball'),
  ));

  // Overall progress
  const circumference = 2*Math.PI*22;
  const dashoffset = circumference - (pct/100)*circumference;
  app.appendChild(h('div',{className:'overall'},
    h('div',{className:'overall-box'},
      h('div',{className:'overall-ring',innerHTML:`<svg width="56" height="56" viewBox="0 0 56 56"><circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="4"/><circle class="progress-circle" cx="28" cy="28" r="22" fill="none" stroke="${phase.color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}"/></svg><div class="overall-ring-text">${pct}%</div>`}),
      h('div',{className:'overall-info'},
        h('div',{className:'overall-label'},'Program Progress'),
        h('div',{className:'overall-detail'},`${totalDone} of ${totalWorkouts} sessions completed`),
      ),
    ),
  ));

  // Phase bar
  const pbar = h('div',{className:'phase-bar',style:{marginTop:'16px'}});
  PHASES.forEach(p => {
    const seg = h('div',{className:'phase-bar-seg'});
    seg.style.flex = p.weeks.length;
    seg.style.background = p.weeks.includes(wk.week) ? p.color : p.color+'33';
    pbar.appendChild(seg);
  });
  app.appendChild(pbar);

  // Week selector with nav arrows
  const weekNavWrapper = h('div',{className:'week-nav-wrapper'});
  const prevBtn = h('button',{className:'week-nav-btn',onClick:()=>{if(state.week>0){state.week--;state.expanded=null;render();}}}, '‹');
  if(state.week===0) prevBtn.disabled=true;
  const nextBtn = h('button',{className:'week-nav-btn',onClick:()=>{if(state.week<16){state.week++;state.expanded=null;render();}}}, '›');
  if(state.week===16) nextBtn.disabled=true;
  const weeks = h('div',{className:'weeks'});
  ALL_WEEKS.forEach((w,i) => {
    const p = getPhase(w.week);
    const isCurr = w.week === todayWeekIdx+1;
    const btn = h('button',{className:`week-btn${state.week===i?' active':''}${isCurr&&state.week!==i?' current':''}`,onClick:()=>{state.week=i;state.expanded=null;render();}},String(w.week));
    if(state.week===i) { btn.style.background=p.color; btn.style.color='#fff'; btn.style.border='none'; }
    else if(isCurr) { btn.style.borderColor=p.color; btn.style.color=p.color; }
    weeks.appendChild(btn);
  });
  weekNavWrapper.appendChild(prevBtn);
  weekNavWrapper.appendChild(weeks);
  weekNavWrapper.appendChild(nextBtn);
  app.appendChild(weekNavWrapper);

  // Week header
  const whBox = h('div',{className:'week-header-box',style:{background:`linear-gradient(135deg,${phase.color}18,${phase.color}06)`,border:`1px solid ${phase.color}33`}},
    h('div',{className:'week-header-top'},
      h('span',{className:'week-header-num'},`Week ${wk.week}`),
      h('div',{className:'week-header-meta'},
        h('span',{className:'week-header-date'},wk.startDate),
        h('span',{className:'week-header-phase',style:{color:phase.color,background:phase.color+'18'}},phase.name),
      ),
    ),
    h('div',{className:'week-header-focus'},wk.focus),
    h('div',{className:'week-progress'},
      h('div',{className:'week-progress-bar'},h('div',{className:'week-progress-fill',style:{width:`${Math.round(weekDone/7*100)}%`,background:phase.color}})),
      h('span',{className:'week-progress-text'},`${weekDone}/7`),
    ),
  );
  app.appendChild(h('div',{className:'week-header'},whBox));

  // Days
  const daysEl = h('div',{className:'days'});
  const daysGroup = h('div',{className:'days-group'});
  wk.days.forEach((day,di) => {
    const isExp = state.expanded===di;
    const isDone = getDone(wk.week,di);
    const isToday = state.week === todayWeekIdx && di === todayDayIdx && todayWeekIdx >= 0 && todayWeekIdx < 17;
    const card = h('div',{className:`day-card${isExp?' expanded':''}${isDone?' completed':''}`});
    if(isExp) { card.style.borderLeft=`3px solid ${day.color}`; }

    const summary = h('div',{className:'day-summary'});
    summary.appendChild(h('span',{className:'day-icon'},ICONS[day.type]||'⚪'));

    const info = h('div',{className:'day-info'});
    info.appendChild(h('div',{className:'day-top'},
      h('span',{className:'day-name'},day.day+' ',h('span',{className:'day-date'},day.date), isToday ? h('span',{className:'today-badge',style:{color:phase.color,background:phase.color+'22'}},'TODAY') : null),
      h('span',{className:'day-total'},day.total),
    ));
    info.appendChild(h('div',{className:'day-label',style:{color:day.color}},day.label));
    info.addEventListener('click',()=>{state.expanded=isExp?null:di;render();});
    summary.appendChild(info);

    // Check button
    const check = h('button',{className:`check-btn${isDone?' done':''}`,onClick:(e)=>{e.stopPropagation();if(!isDone&&navigator.vibrate)navigator.vibrate(30);setDone(wk.week,di,!isDone);render();}},isDone?'✓':'');
    summary.appendChild(check);

    const arrow = h('span',{className:`day-arrow${isExp?' open':''}`},'›');
    arrow.addEventListener('click',()=>{state.expanded=isExp?null:di;render();});
    summary.appendChild(arrow);

    card.appendChild(summary);

    if(isExp) {
      const detail = h('div',{className:'day-detail'});
      const segs = h('div',{className:'segments'});
      day.segments.forEach(seg => {
        const segEl = h('div',{className:`segment${seg.repeat?' repeat-seg':''}`});
        if(seg.repeat) { const bar=h('div',{className:'repeat-bar'}); bar.style.background=day.color; segEl.appendChild(bar); }
        if(seg.repeat) segEl.style.background=day.color+'06';
        const content = h('div',{className:'seg-content'});
        const top = h('div',{className:'seg-top'},h('span',{className:'seg-name'},seg.name));
        const meta = h('div',{className:'seg-meta'});
        if(seg.zone) { const z=h('span',{className:'seg-zone'}); z.style.color=day.color; z.style.background=day.color+'14'; z.textContent=seg.zone; meta.appendChild(z); }
        meta.appendChild(h('span',{className:'seg-dur'},seg.dur));
        top.appendChild(meta);
        content.appendChild(top);
        if(seg.note) content.appendChild(h('div',{className:'seg-note'},seg.note));
        segEl.appendChild(content);
        segs.appendChild(segEl);
      });
      detail.appendChild(segs);

      // Inline detail boxes — rendered in segment order
      const inlineDetails = [];
      day.segments.forEach(seg => {
        if(seg.name==='Swim' && !inlineDetails.some(d=>d.type==='swim')) {
          const sw = getSwim(wk.week);
          const swBox = h('div',{className:'inline-detail'});
          swBox.appendChild(h('div',{className:'inline-detail-label'},'🏊 Swim Session'));
          swBox.appendChild(h('div',{className:'inline-detail-title'},`${sw.dur} — ${sw.goal}`));
          swBox.appendChild(h('div',{className:'inline-detail-note',style:{fontStyle:'normal'}},sw.desc));
          inlineDetails.push({type:'swim',el:swBox});
        }
        if(seg.name==='Bodyweight' && !inlineDetails.some(d=>d.type==='bw')) {
          const bw = getBW(wk.week);
          const bwBox = h('div',{className:'inline-detail'});
          bwBox.appendChild(h('div',{className:'inline-detail-label'},'💪 Bodyweight Circuit'));
          bwBox.appendChild(h('div',{className:'inline-detail-title'},bw.label));
          bw.exercises.forEach(ex => bwBox.appendChild(h('div',{className:'inline-detail-exercise'},ex)));
          bwBox.appendChild(h('div',{className:'inline-detail-note'},bw.note));
          inlineDetails.push({type:'bw',el:bwBox});
        }
      });
      const watchItem = getWatchItem(day, wk.week);
      if(watchItem) {
        const watchBox = h('div',{className:'inline-detail'});
        watchBox.appendChild(h('div',{className:'inline-detail-label'},'⌚ Watch App'));
        watchBox.appendChild(h('div',{className:'inline-detail-title'},watchItem.n));
        watchBox.appendChild(h('div',{className:'inline-detail-sub'},watchItem.s));
        inlineDetails.push({type:'watch',el:watchBox});
      }
      inlineDetails.forEach(d => detail.appendChild(d.el));

      // Notes
      const noteVal = getNote(wk.week,di);
      const notesArea = h('div',{className:'notes-area'});
      const textarea = h('textarea',{className:'notes-input',placeholder:'Add notes — how it felt, pace, etc...'});
      textarea.value = noteVal;
      textarea.addEventListener('input',()=>{
        if(noteTimer) clearTimeout(noteTimer);
        noteTimer = setTimeout(()=>{
          setNote(wk.week,di,textarea.value);
          const saved = notesArea.querySelector('.notes-saved');
          if(saved) saved.textContent = 'Saved ✓';
          setTimeout(()=>{ if(saved) saved.textContent=''; },1500);
        },500);
      });
      textarea.addEventListener('click',(e)=>e.stopPropagation());
      notesArea.appendChild(textarea);
      notesArea.appendChild(h('div',{className:'notes-saved'},''));
      detail.appendChild(notesArea);

      card.appendChild(detail);
    }
    daysGroup.appendChild(card);
  });
  daysEl.appendChild(daysGroup);
  app.appendChild(daysEl);

  // Analytics Dashboard
  const analyticsBox = h('div',{className:'analytics-box'});
  analyticsBox.appendChild(h('div',{className:'analytics-title'},'Completion'));

  // Calculate streaks
  let currentStreak = 0, longestStreak = 0, tempStreak = 0, perfectWeeks = 0;

  // Streak grid — 17 columns × 7 rows
  const streakContainer = h('div',{className:'streak-container'});
  const dayLabels = h('div',{className:'streak-day-labels'});
  ['M','T','W','T','F','S','S'].forEach(d => dayLabels.appendChild(h('div',{className:'streak-day-label'},d)));
  streakContainer.appendChild(dayLabels);

  const grid = h('div',{className:'streak-grid'});
  ALL_WEEKS.forEach((w,wi) => {
    const p = getPhase(w.week);
    const isCurr = wi === state.week;
    const col = h('div',{className:`streak-col${isCurr?' current-week':''}`});
    let weekComplete = 0;
    w.days.forEach((_,di) => {
      const done = getDone(w.week, di);
      const cell = h('div',{className:`streak-cell${done?' done':''}`});
      if(done) { weekComplete++; cell.style.background = p.color; }
      col.appendChild(cell);
      if(done) { tempStreak++; if(tempStreak>longestStreak) longestStreak=tempStreak; }
      else { tempStreak=0; }
    });
    if(weekComplete===7) perfectWeeks++;
    col.appendChild(h('div',{className:'streak-week'},String(w.week)));
    grid.appendChild(col);
  });

  currentStreak = 0;
  for(let i = daysSinceStart; i >= 0; i--) {
    const wi = Math.floor(i/7), di = i%7;
    if(wi<17 && getDone(ALL_WEEKS[wi].week, di)) currentStreak++; else break;
  }

  streakContainer.appendChild(grid);
  analyticsBox.appendChild(streakContainer);

  // Stats row
  const stats = h('div',{className:'streak-stats'});
  [
    {num: currentStreak, label: 'Current streak'},
    {num: longestStreak, label: 'Longest streak'},
    {num: perfectWeeks, label: 'Perfect weeks'},
  ].forEach(s => {
    const stat = h('div',{className:'streak-stat'});
    const numEl = h('div',{className:'streak-stat-num'});
    numEl.style.color = s.num > 0 ? 'var(--green)' : 'var(--text-faint)';
    numEl.textContent = s.num;
    stat.appendChild(numEl);
    stat.appendChild(h('div',{className:'streak-stat-label'},s.label));
    stats.appendChild(stat);
  });
  analyticsBox.appendChild(stats);

  app.appendChild(h('div',{className:'analytics'},analyticsBox));

  // HR Zones
  const zonesBox = h('div',{className:'zones-box'},h('div',{className:'zones-title'},'Heart Rate Zones'));
  HR_ZONES.forEach(z => {
    zonesBox.appendChild(h('div',{className:'zone-row'},
      h('span',{className:'zone-label',style:{color:z.c}},z.z),
      h('span',{className:'zone-desc'},z.d),
      h('span',{className:'zone-range'},z.r+' bpm'),
    ));
  });
  app.appendChild(h('div',{className:'zones'},zonesBox));

  // Reset
  const resetArea = h('div',{className:'reset-area'});
  if(state.resetConfirm) {
    resetArea.appendChild(h('button',{className:'reset-btn reset-confirm',onClick:()=>{localStorage.removeItem(STORE_KEY);state.resetConfirm=false;render();}}, 'Tap again to confirm reset'));
    resetArea.appendChild(h('button',{className:'reset-btn',style:{marginLeft:'8px'},onClick:()=>{state.resetConfirm=false;render();}}, 'Cancel'));
  } else {
    resetArea.appendChild(h('button',{className:'reset-btn',onClick:()=>{state.resetConfirm=true;render();}}, 'Reset all progress'));
  }
  app.appendChild(resetArea);

  // Restore scroll position & scroll week button into view
  requestAnimationFrame(()=>{
    window.scrollTo(0, savedScroll);
    if(weekChanged) {
      const activeBtn = document.querySelector('.week-btn.active');
      if(activeBtn) activeBtn.scrollIntoView({behavior:'instant',inline:'center',block:'nearest'});
    }
  });
}

async function boot() {
  try {
    await fetchJsonData();
  } catch(e) {
    document.getElementById('app').textContent = 'Failed to load training data. Please reload.';
    return;
  }
  ALL_WEEKS = Array.from({length:17},(_,i)=>buildWeek(i+1));

  state = { week:0, expanded:null, resetConfirm:false };
  now = new Date();
  const MS_PER_DAY = 24*60*60*1000;
  daysSinceStart = Math.floor((now - START) / MS_PER_DAY);
  todayWeekIdx = Math.floor(daysSinceStart / 7);
  todayDayIdx = daysSinceStart % 7;
  if(todayWeekIdx>=0 && todayWeekIdx<17) state.week = todayWeekIdx;
  lastRenderedWeek = -1;

  // Swipe to change week
  let touchStartX=0, touchStartY=0;
  document.getElementById('app').addEventListener('touchstart', e=>{
    touchStartX=e.touches[0].clientX; touchStartY=e.touches[0].clientY;
  },{passive:true});
  document.getElementById('app').addEventListener('touchend', e=>{
    const dx=e.changedTouches[0].clientX-touchStartX;
    const dy=e.changedTouches[0].clientY-touchStartY;
    if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5){
      if(dx<0 && state.week<16){state.week++;state.expanded=null;render();}
      else if(dx>0 && state.week>0){state.week--;state.expanded=null;render();}
    }
  },{passive:true});

  render();
}

boot();
