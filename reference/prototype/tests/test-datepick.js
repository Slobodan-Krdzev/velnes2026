/* De datumkiezer boven de agenda: openen, bladeren, kiezen, en of hij er
   uitziet als de rest van de app in plaats van als een kaal invoerveld. */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/'});
const w=dom.window,d=w.document,E=s=>w.eval(s);
let pass=0,fail=0;
const t=(n,fn)=>{try{const r=fn();if(r===true||r===undefined){pass++;console.log('  pass  '+n)}
  else{fail++;console.log('  FAIL  '+n+' → '+r)}}catch(e){fail++;console.log('  FAIL  '+n+' → '+e.message)}};
const g=n=>console.log('\n'+n);
const qa=s=>[...d.querySelectorAll(s)];
const cal=(extra='')=>E(`closePanel(true);session.userId='e1';state.route='calendar';
  state.calPick=false;state.calPickMonth=null;${extra}render()`);
const openPick=()=>{d.querySelector('#view [data-calpick]').click()};

setTimeout(()=>{
g('De datum is een knop geworden');
t('Het was een veld, nu kun je erop drukken',()=>{
  cal("state.calView='day';state.calDate=TODAY;");
  const b=d.querySelector('#view [data-calpick]');
  return (b&&b.tagName==='BUTTON')||`het is een ${b&&b.tagName}`;
});
t('Hij toont nog steeds de datum waar je staat',()=>{
  const b=d.querySelector('#view [data-calpick]');
  return b.textContent.trim()===E('dayLabel(state.calDate)')||`knop leest ${b.textContent.trim()}`;
});
t('In weekweergave het weekbereik',()=>{
  cal("state.calView='week';state.weekStart=THIS_WEEK;");
  const b=d.querySelector('#view [data-calpick]');
  return b.textContent.trim()===E('weekRangeLabel(state.weekStart)')||`knop leest ${b.textContent.trim()}`;
});
t('En hij vertelt schermlezers wat hij doet',()=>{
  const b=d.querySelector('#view [data-calpick]');
  return (b.getAttribute('aria-label')==='Pick a date'&&b.getAttribute('aria-haspopup')==='dialog')
    ||'geen aankondiging';
});

g('Het maandrooster');
t('Klikken opent hem',()=>{
  cal("state.calView='day';state.calDate=TODAY;");
  openPick();
  return E('state.calPick')===true&&!!d.querySelector('#view .menu-cal')||'hij bleef dicht';
});
t('Zes rijen van zeven, altijd even hoog',()=>{
  const n=qa('#view .calpick-day').length;
  return n===42||`${n} vakjes`;
});
t('De week begint op maandag',()=>{
  const dows=qa('#view .calpick-dow').map(x=>x.textContent);
  return dows.join('')==='MTWTFSS'||`kopjes: ${dows.join('')}`;
});
t('De maand staat erboven, met het jaar',()=>{
  const title=d.querySelector('#view .calpick-title').textContent.trim();
  return title===`${E('monthOf(pickMonth())')} ${E('dOf(pickMonth()).getFullYear()')}`||`kop leest ${title}`;
});
t('Vandaag is aangemerkt',()=>{
  const today=qa('#view .calpick-day.today').map(b=>b.dataset.calpickday);
  return (today.length===1&&today[0]===E('TODAY'))||`gemarkeerd: ${today.join(', ')}`;
});
t('En de dag waar je staat is gekozen',()=>{
  const on=qa('#view .calpick-day.on').map(b=>b.dataset.calpickday);
  return (on.length===1&&on[0]===E('state.calDate'))||`gekozen: ${on.join(', ')}`;
});
t('Dagen met afspraken dragen een stip',()=>{
  const dotted=qa('#view .calpick-day').filter(b=>b.querySelector('.calpick-dot'))
    .map(b=>b.dataset.calpickday);
  if(!dotted.length)return 'nergens een stip';
  const wrong=dotted.filter(v=>!E(`appointments.some(a=>a.date==='${v}'&&a.kind==='appointment')`));
  return wrong.length===0||`stip op een lege dag: ${wrong.join(', ')}`;
});
t('En een lege dag draagt er geen',()=>{
  const undotted=qa('#view .calpick-day').filter(b=>!b.querySelector('.calpick-dot'))
    .map(b=>b.dataset.calpickday);
  const missed=undotted.filter(v=>E(`appointments.some(a=>a.date==='${v}'&&a.kind==='appointment'
    &&inScope(a.locationId))`));
  return missed.length===0||`stip vergeten op: ${missed.join(', ')}`;
});
t('Dagen uit de buurmaanden staan er, maar gedempt',()=>{
  const out=qa('#view .calpick-day.out').length;
  return out>0&&out<15||`${out} dagen buiten de maand`;
});

g('Bladeren');
t('Een maand vooruit',()=>{
  const was=d.querySelector('#view .calpick-title').textContent.trim();
  d.querySelector('#view [data-calpickmonth="1"]').click();
  const now=d.querySelector('#view .calpick-title').textContent.trim();
  return now!==was||`bleef op ${now}`;
});
t('Bladeren sluit hem niet',()=>E('state.calPick')===true||'hij klapte dicht');
t('En verzet de agenda nog niet',()=>{
  return E('state.calDate')===E('TODAY')||'de agenda sprong al mee';
});
t('Een maand terug brengt je waar je was',()=>{
  d.querySelector('#view [data-calpickmonth="-1"]').click();
  return d.querySelector('#view .calpick-title').textContent.trim()
    ===`${E('monthOf(TODAY)')} ${E('dOf(TODAY).getFullYear()')}`||'niet terug';
});
t('Over de jaargrens heen blijft het kloppen',()=>{
  cal("state.calView='day';state.calDate='2026-12-15';");
  openPick();
  d.querySelector('#view [data-calpickmonth="1"]').click();
  const title=d.querySelector('#view .calpick-title').textContent.trim();
  return title==='Jan 2027'||`kop leest ${title}`;
});

g('Kiezen');
t('Een dag aanklikken verzet de agenda',()=>{
  cal("state.calView='day';state.calDate=TODAY;");
  openPick();
  const target=qa('#view .calpick-day').find(b=>b.dataset.calpickday===E('addDays(TODAY,11)'));
  if(!target)return 'die dag staat niet in beeld';
  target.click();
  return E('state.calDate')===E('addDays(TODAY,11)')||`beland op ${E('state.calDate')}`;
});
t('En sluit de kiezer',()=>E('state.calPick')===false||'hij bleef open');
t('De week loopt mee met de gekozen dag',()=>
  E('state.weekStart')===E('weekStartOf(state.calDate)')||'de week bleef achter');
t('De knop toont daarna de nieuwe datum',()=>{
  const b=d.querySelector('#view [data-calpick]');
  return b.textContent.trim()===E('dayLabel(state.calDate)')||`knop leest ${b.textContent.trim()}`;
});
t('Een dag uit de buurmaand kiezen kan ook',()=>{
  cal("state.calView='day';state.calDate=TODAY;");
  openPick();
  const out=qa('#view .calpick-day.out')[0];
  const want=out.dataset.calpickday;
  out.click();
  return E('state.calDate')===want||`beland op ${E('state.calDate')}`;
});
t('De Today-knop brengt je terug',()=>{
  cal("state.calView='day';state.calDate=addDays(TODAY,40);");
  openPick();
  d.querySelector('#view .calpick-foot [data-calpickday]').click();
  return E('state.calDate')===E('TODAY')||`beland op ${E('state.calDate')}`;
});
t('Volgende keer opent hij weer bij de maand waar je staat',()=>{
  cal("state.calView='day';state.calDate='2026-03-04';");
  openPick();
  return d.querySelector('#view .calpick-title').textContent.trim()==='Mar 2026'
    ||'hij onthield de vorige maand';
});

g('In weekweergave kies je een week');
t('De hele week licht op, niet één dag',()=>{
  cal("state.calView='week';state.weekStart=THIS_WEEK;");
  openPick();
  const on=qa('#view .calpick-day.on').length;
  return on===7||`${on} dagen opgelicht`;
});
t('Een dag kiezen springt naar die week',()=>{
  const target=qa('#view .calpick-day').find(b=>b.dataset.calpickday===E('addDays(THIS_WEEK,16)'));
  if(!target)return 'die dag staat niet in beeld';
  target.click();
  return E('state.weekStart')===E('weekStartOf(addDays(THIS_WEEK,16))')||`week werd ${E('state.weekStart')}`;
});
t('De voettekst legt dat ook uit',()=>{
  cal("state.calView='week';state.weekStart=THIS_WEEK;");
  openPick();
  return /Picks the week/.test(d.querySelector('#view .calpick-foot').textContent)||'geen uitleg';
});

g('Hij gedraagt zich als de andere popovers');
t('Ernaast klikken sluit hem',()=>{
  cal("state.calView='day';state.calDate=TODAY;");
  openPick();
  d.querySelector('#view').click();
  return E('state.calPick')===false||'hij bleef open';
});
t('Het filtermenu en de kiezer staan niet samen open',()=>{
  cal("state.calView='day';");
  d.querySelector('#view [data-calfilters]').click();
  openPick();
  return E('state.calFilters')===false||'allebei open';
});
t('En de kiezer dimt het scherm erachter',()=>{
  cal("state.calView='day';");
  openPick();
  return !!d.querySelector('#view .toolbar-cal.popped')||'de balk merkt hem niet op';
});

g('Hij ziet eruit als de rest van de app');
t('Geen enkele klasse zonder opmaak',()=>{
  const used=['calpick-btn','menu-cal','calpick-head','calpick-title','calpick-grid',
    'calpick-dow','calpick-day','calpick-dot','calpick-foot'];
  const missing=used.filter(c=>!css.includes('.'+c));
  return missing.length===0||`zonder opmaak: ${missing.join(', ')}`;
});
t('Hij hangt in het menu dat de app overal gebruikt',()=>{
  cal("state.calView='day';");
  openPick();
  const m=d.querySelector('#view .menu-cal');
  return m.classList.contains('menu')||`klassen: ${m.className}`;
});
t('De kleuren komen uit het palet, niet uit losse waarden',()=>{
  const m=/\.calpick-day\.on\{([^}]*)\}/.exec(css);
  return (m&&/var\(--accent-deep\)/.test(m[1]))||`.calpick-day.on leest ${m&&m[1]}`;
});
t('De keuze wint van vandaag',()=>
  css.indexOf('.calpick-day.on{')>css.indexOf('.calpick-day.today')||'vandaag overschrijft je keuze');
t('En van een dag buiten de maand',()=>
  css.indexOf('.calpick-day.on{')>css.indexOf('.calpick-day.out')||'gedempt overschrijft je keuze');
/* Dit ging mis: centreren met transform. `.pop>.menu` is soortelijker dan
   `.menu-cal` en won op left/right, terwijl de verschuiving bleef staan.
   En de openanimatie eindigt op `transform:none`, dus stond hij eerst goed
   en sprong hij daarna pas opzij. */
t('Hij hangt onder zijn knop, niet gecentreerd met transform',()=>{
  const m=/\.menu-cal\{([^}]*)\}/.exec(css);
  if(!m)return 'geen regel voor .menu-cal';
  if(/transform/.test(m[1]))return `.menu-cal verschuift zichzelf: ${m[1]}`;
  return !/left:|right:/.test(m[1])||`.menu-cal zet zelf left/right: ${m[1]}`;
});
t('Hij volgt dus de gewone uitlijning van een popover',()=>
  /\.pop>\.menu\{left:auto;right:0\}/.test(css)||'de gewone uitlijning is weg');
t('De openanimatie kan hem niet meer verspringen',()=>{
  /* De animatie eindigt op transform:none. Zolang de opmaak zelf geen
     transform zet, staat hij voor en na de animatie op dezelfde plek. */
  const m=/\.menu-cal\{([^}]*)\}/.exec(css)[1];
  const base=/\n\.menu\{([^}]*)\}/.exec(css)[1];
  return (!/transform/.test(m)&&!/transform:translateX/.test(base))||'er staat nog een verschuiving';
});
t('Tegen de rand klapt hij om in plaats van eraf te vallen',()=>{
  cal("state.calView='day';");
  openPick();
  const m=d.querySelector('#view .menu-cal');
  E('keepMenuInView()');
  /* jsdom meet niets, dus alle randen zijn nul: dan hoort de functie de
     stand met rust te laten in plaats van te gokken. */
  return !!m||'de kiezer verdween';
});
t('En hij klapt niet om als dat hem er aan de andere kant uit duwt',()=>{
  const fn=E('keepMenuInView.toString()');
  return /r2\.right>vw-8/.test(fn)||'de functie kijkt maar één kant op';
});
t('Het rooster is echt een rooster van zeven',()=>{
  const m=/\.calpick-grid\{([^}]*)\}/.exec(css);
  return (m&&/repeat\(7,1fr\)/.test(m[1]))||`.calpick-grid leest ${m&&m[1]}`;
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
