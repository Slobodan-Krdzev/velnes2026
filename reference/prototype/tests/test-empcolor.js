/* Kleur per medewerker: waar je hem kiest, waar hij landt, en of de agenda
   tot onderaan het scherm doorloopt. */
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
const settings=()=>E("closePanel(true);session.userId='e1';state.route='settings';state.settingsTab='employees';render()");

setTimeout(()=>{
g('Het palet');
t('Acht tinten, elk met een diepere variant',()=>{
  const p=E('EMP_COLORS');
  if(p.length!==8)return `${p.length} tinten`;
  const bad=p.filter(c=>!/^#[0-9a-f]{6}$/i.test(c[2])||!/^#[0-9a-f]{6}$/i.test(c[3]));
  return bad.length===0||`${bad.length} zonder geldige kleur`;
});
t('Iedereen in het team heeft er een',()=>{
  const zonder=E("employees.filter(e=>!e.color).map(e=>e.name)");
  return zonder.length===0||`zonder kleur: ${zonder.join(', ')}`;
});
t('En niemand deelt er een met een ander',()=>{
  const cols=E('employees.map(e=>e.color)');
  return new Set(cols).size===cols.length||`dubbel: ${cols.join(', ')}`;
});
t('Een onbekende medewerker valt terug op de standaard',()=>{
  const c=E("empColor('nobody')");
  return c[0]===E('EMP_COLOR_DEF[0]')||`viel terug op ${c[0]}`;
});
t('Een nieuwe medewerker krijgt een kleur die nog vrij is',()=>{
  const next=E('nextEmpColor()');
  return !E('employees.map(e=>e.color)').includes(next)||`${next} is al vergeven`;
});

g('Kiezen in de medewerkerslade');
t('De lade toont acht vakjes',()=>{
  settings();
  qa('#view [data-panel^="employeeEdit"]')[0].click();
  return qa('#panel [data-empcolor]').length===8||`${qa('#panel [data-empcolor]').length} vakjes`;
});
t('Het vakje van deze persoon staat aan',()=>{
  const on=qa('#panel .swatch.on').map(b=>b.dataset.empcolor);
  return on.join(',')===E("employees.find(e=>e.id==='e1').color")||`aan: ${on.join(', ')}`;
});
t('Een ander vakje aanklikken verzet de keuze',()=>{
  qa('#panel [data-empcolor="lilac"]')[0].click();
  if(E('state.empColorPick')!=='lilac')return 'de keuze verschoof niet';
  const on=qa('#panel .swatch.on').map(b=>b.dataset.empcolor);
  return on.join(',')==='lilac'||`aan: ${on.join(', ')}`;
});
t('Maar pas na opslaan staat hij op de persoon',()=>
  E("employees.find(e=>e.id==='e1').color")!=='lilac'||'de wijziging lekte alvast door');
t('Kiezen zet de lade op onopgeslagen',()=>
  E('state.panelDirty')===true||'de lade merkte de wijziging niet');
t('Opslaan legt hem vast',()=>{
  d.querySelector('#panel [data-panelsave]').click();
  return E("employees.find(e=>e.id==='e1').color")==='lilac'||'niet opgeslagen';
});
t('De rest van de persoon blijft heel',()=>{
  /* Niet op een vast aantal vaardigheden toetsen: dat verandert als de
     catalogus verandert. Het gaat erom dat de kleurwissel niets anders
     heeft aangeraakt. */
  const e=E("employees.find(x=>x.id==='e1')");
  if(e.name!=='Maria Petrovska')return `naam werd ${e.name}`;
  if(!e.skills.length)return 'de vaardigheden zijn leeggelopen';
  return e.access==='owner'||`toegang werd ${e.access}`;
});
t('Een nieuwe lade opent op een vrije kleur',()=>{
  E('closePanel(true)');
  settings();
  /* De kaart heeft geen eigen Add-knop meer; die staat in de balk. */
  d.querySelector('#view .toolbar [data-panel="employee"]').click();
  const pick=E('state.empColorPick');
  return !E('employees.map(e=>e.color)').includes(pick)||`${pick} was al vergeven`;
});
E('closePanel(true)');

g('Snel wisselen vanaf het vlakje naast de naam');
t('De kleurkolom is uit de tabel verdwenen',()=>{
  settings();
  const heads=qa('#view thead th').map(x=>x.textContent.trim());
  return !heads.includes('Colour')||`koppen: ${heads.join(', ')}`;
});
t('En er staan geen acht vakjes meer in een rij',()=>
  qa('#view tbody [data-emprowcolor]').length===0||'de vakjes staan nog in de tabel');
t('Elke naam draagt zijn eigen kleurvlakje',()=>{
  const n=qa('#view tbody [data-empdot]').length;
  return n===E('employees.length')||`${n} vlakjes bij ${E('employees.length')} mensen`;
});
t('Het vlakje draagt de kleur van die persoon',()=>{
  const b=d.querySelector('#view [data-empdot="e2"]');
  return b.getAttribute('style').includes(E("empColor('e2')[2]"))||'verkeerde kleur';
});
t('En het is een knop, geen plaatje',()=>{
  const b=d.querySelector('#view [data-empdot="e2"]');
  return (b.tagName==='BUTTON'&&b.getAttribute('aria-haspopup')==='menu')||`het is een ${b.tagName}`;
});
t('Klikken opent een klein keuzemenu',()=>{
  d.querySelector('#view [data-empdot="e2"]').click();
  const menu=d.querySelector('#view .menu-dot');
  return !!menu||'geen menu';
});
t('Met alle acht kleuren erin',()=>{
  const n=qa('#view .menu-dot [data-emprowcolor="e2"]').length;
  return n===8||`${n} vakjes`;
});
t('De huidige kleur staat aangevinkt, met zijn naam erbij',()=>{
  const on=qa('#view .menu-dot .swatch.on').map(b=>b.dataset.c);
  const foot=d.querySelector('#view .menu-dot .menu-foot').textContent.trim();
  return (on.join(',')===E("empColor('e2')[0]")&&foot===E("empColorName(empColor('e2')[0])"))
    ||`aan: ${on.join(', ')}, voet: ${foot}`;
});
t('Kiezen verzet de kleur meteen',()=>{
  d.querySelector('#view .menu-dot [data-emprowcolor="e2"][data-c="sand"]').click();
  return E("employees.find(e=>e.id==='e2').color")==='sand'||'de kleur bleef staan';
});
t('En sluit het menu',()=>
  E('state.empDot')===null&&!d.querySelector('#view .menu-dot')||'het menu bleef open');
t('Het vlakje draagt daarna de nieuwe kleur',()=>{
  const b=d.querySelector('#view [data-empdot="e2"]');
  return b.getAttribute('style').includes(E("EMP_COLORS.find(c=>c[0]==='sand')[2]"))||'het vlakje liep niet mee';
});
t('Er staat er nooit meer dan één open',()=>{
  d.querySelector('#view [data-empdot="e1"]').click();
  d.querySelector('#view [data-empdot="e2"]').click();
  return qa('#view .menu-dot').length===1||`${qa('#view .menu-dot').length} menu's open`;
});
t('Nog eens klikken sluit hem weer',()=>{
  d.querySelector('#view [data-empdot="e2"]').click();
  return !d.querySelector('#view .menu-dot')||'hij bleef open';
});
t('Dezelfde kleur als een collega geeft een waarschuwing',()=>{
  settings();
  const other=E("employees.find(e=>e.id!=='e2').color");
  d.querySelector('#view [data-empdot="e2"]').click();
  qa(`#view .menu-dot [data-emprowcolor="e2"][data-c="${other}"]`)[0].click();
  const to=d.querySelector('#toast');
  return (to&&/already uses/.test(to.textContent))||`melding: ${to&&to.textContent}`;
});
t('Maar hij wordt wel gezet — het is een waarschuwing, geen verbod',()=>
  E("employees.filter(e=>e.color===employees.find(x=>x.id==='e2').color).length")>=2
  ||'de kleur werd geweigerd');
t('De lade blijft de andere weg om het te wijzigen',()=>{
  settings();
  const edit=d.querySelector('#view [data-panel^="employeeEdit"]');
  edit.click();
  return qa('#panel [data-empcolor]').length===8||'de lade kent de kleuren niet meer';
});
E('closePanel(true)');

g('En één Add-knop op dit scherm');
t('De kaart heeft er geen meer',()=>{
  settings();
  return !d.querySelector('#view .settings-pane [data-panel="employee"]')||'er staat er nog een in de kaart';
});
t('De balk wel',()=>
  !!d.querySelector('#view .toolbar [data-panel="employee"], #view .toolbar [data-addmenu]')
  ||'de knop in de balk is ook weg');

g('De medewerkerskleur wint van de behandelkleur');
/* Dit ging de eerste keer mis: de regel stond vóór de behandeltonen, met
   precies dezelfde soortelijkheid. Dan wint de laatste regel en zag je
   nog steeds de kleur van de behandelsoort. jsdom rekent geen cascade uit,
   dus toetsen we de opmaak zelf: staat hij achteraan, en is hij specifieker? */
const evRules=[...css.matchAll(/\n(\.event[^\n{]*)\{([^}]*)\}/g)]
  .map(m=>({sel:m[1].trim(),body:m[2],at:m.index}));
const paints=evRules.filter(r=>/background:/.test(r.body));
t('De medewerkerregel staat na alle behandeltonen',()=>{
  const emp=paints.find(r=>/ev-emp/.test(r.sel));
  if(!emp)return 'de regel bestaat niet';
  const later=paints.filter(r=>/ev-(manual|rehab|assess|recovery|other)\b/.test(r.sel)&&r.at>emp.at);
  return later.length===0||`nog na hem: ${later.map(r=>r.sel).join(', ')}`;
});
t('En hij is specifieker dan een behandeltoon',()=>{
  const emp=paints.find(r=>/ev-emp/.test(r.sel));
  const cls=sel=>(sel.match(/\./g)||[]).length;
  const tone=paints.find(r=>/ev-manual\b/.test(r.sel));
  return cls(emp.sel)>cls(tone.sel)||`${emp.sel} (${cls(emp.sel)}) vs ${tone.sel} (${cls(tone.sel)})`;
});
t('Hij pakt alleen echte afspraken',()=>{
  const emp=paints.find(r=>/ev-emp/.test(r.sel));
  return /\.appointment\b/.test(emp.sel)||`selector: ${emp.sel}`;
});
t('Het icoon kleurt mee met de medewerker',()=>{
  const ic=evRules.filter(r=>/ev-emp/.test(r.sel)&&/\.ev-ic/.test(r.sel));
  if(!ic.length)return 'geen regel voor het icoon';
  const tones=evRules.filter(r=>/ev-(manual|rehab|assess|recovery)\b/.test(r.sel)&&/\.ev-ic/.test(r.sel));
  const later=tones.filter(r=>r.at>ic[0].at);
  return later.length===0||`nog na hem: ${later.map(r=>r.sel).join(', ')}`;
});
t('De twee waarden komen van de knop zelf',()=>{
  E("state.route='calendar';state.calView='week';state.calDate=TODAY;render()");
  const ev=qa('#view .event.appointment')[0];
  if(!ev)return 'geen afspraak in beeld';
  const a=E(`appointments.find(x=>x.id==='${ev.dataset.appt}')`);
  const want=E(`empColor('${a.emp}')`);
  return (ev.style.getPropertyValue('--ev-bg').trim()===want[2]
    &&ev.style.getPropertyValue('--ev-ink').trim()===want[3])
    ||`blok draagt ${ev.style.getPropertyValue('--ev-bg')}`;
});
t('En de knop draagt de klasse die ze gebruikt',()=>{
  const ev=qa('#view .event.appointment')[0];
  return ev.classList.contains('ev-emp')||`klassen: ${ev.className}`;
});

/* Deze drie regels bewaakten een terugdraaiing: cal-mode was er eerder
   uit gehaald en de hoogtegrens stond weer op calc(100vh - 320px). Op
   uitdrukkelijk verzoek is de hoogteketen nu opnieuw ingevoerd, dit keer
   zonder vast getal en met rijen die de ruimte verdelen. De regels
   toetsen daarom nu het omgekeerde \u2014 dat is een besluit, geen
   verslapping, en het staat gemeld. */
g('De agenda draagt zijn eigen hoogteketen');
t('Het agendascherm heeft zijn eigen stand',()=>{
  E("state.route='calendar';render()");
  return d.body.classList.contains('cal-mode')||'cal-mode ontbreekt';
});
t('En de vaste hoogtegrens is weg',()=>
  !/\.cal-body\{max-height:calc/.test(css)
  ||'er staat weer een vast getal op de agendahoogte');
t('De agenda krimpt en rekt in plaats daarvan mee',()=>{
  const m=/\n\.cal-body\{([^}]*)\}/.exec(css);
  return (m&&/flex:1/.test(m[1])&&/min-height:0/.test(m[1]))||`.cal-body leest ${m&&m[1]}`;
});
t('De padding van main is onveranderd',()=>{
  const m=/\nmain\{padding:([^}]+)\}/.exec(css);
  return (m&&m[1].trim()==='24px 26px 64px')||`padding leest ${m&&m[1]}`;
});
t('Het rooster staat er nog gewoon',()=>{
  E("state.route='calendar';state.calView='week';render()");
  return qa('#view .cal-body .cal-col').length===7||`${qa('#view .cal-body .cal-col').length} kolommen`;
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
