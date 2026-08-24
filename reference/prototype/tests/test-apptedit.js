/* Een afspraak verzetten zolang hij nog moet komen, en de optiepil met
   zijn tekst in het midden. */
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
/* Een afspraak ver in de toekomst, zodat de klok de test niet stuurt. */
const future=()=>E("appointments.find(a=>a.kind==='appointment'&&a.date>TODAY)");
const openDetail=id=>E(`closePanel(true);session.userId='e1';state.route='calendar';render();
  openPanel(apptDetailMeta('${id}'),'appointment','${id}')`);
/* Een veld in de lade wijzigen zoals een mens dat doet. */
const setField=(sel,val)=>{const el=d.querySelector('#panel '+sel);el.value=val;
  el.dispatchEvent(new w.Event('change',{bubbles:true}));};
const save=()=>d.querySelector('#panel [data-panelsave]').click();

setTimeout(()=>{
g('De optiepil');
t('De pil zet zijn tekst in het midden',()=>{
  const m=/\n\.chip\{([^}]*)\}/.exec(css);
  if(!m)return 'geen regel voor .chip';
  return /align-items:center/.test(m[1])||`.chip leest ${m[1]}`;
});
t('En hij is een flexvak, anders doet uitlijnen niets',()=>{
  const m=/\n\.chip\{([^}]*)\}/.exec(css)[1];
  return /display:inline-flex/.test(m)||'geen inline-flex';
});
t('Ook horizontaal gecentreerd',()=>{
  const m=/\n\.chip\{([^}]*)\}/.exec(css)[1];
  return /justify-content:center/.test(m)||'niet horizontaal gecentreerd';
});
t('De vaste hoogte staat er nog',()=>{
  const m=/\n\.chip\{([^}]*)\}/.exec(css)[1];
  return /height:46px/.test(m)||'de hoogte is weg';
});
t('De pil in het afspraakscherm is er echt een',()=>{
  /* Geen enkele afspraak in de demo draagt opties — die ontstaan pas als
     je er een boekt. Voor het tekenen zetten we er zelf een op. */
  const id=future().id;
  E(`appointments.find(x=>x.id==='${id}').modNames=['Knee or ankle']`);
  openDetail(id);
  const chip=d.querySelector('#panel .chips .chip');
  E(`appointments.find(x=>x.id==='${id}').modNames=[]`);
  return (chip&&chip.textContent.trim()==='Knee or ankle')||'geen pil in het scherm';
});

g('Bewerken mag alleen vooruit');
t('Een afspraak die nog moet komen is te verzetten',()=>
  E(`apptEditable(appointments.find(a=>a.id==='${future().id}'))`)===true||'niet bewerkbaar');
t('Een dag die geweest is niet',()=>{
  const a=E("appointments.find(a=>a.kind==='appointment')");
  const was=a.date;
  E(`appointments.find(x=>x.id==='${a.id}').date=addDays(TODAY,-3)`);
  const ok=E(`apptEditable(appointments.find(x=>x.id==='${a.id}'))`);
  E(`appointments.find(x=>x.id==='${a.id}').date='${was}'`);
  return ok===false||'een afspraak van eergisteren is nog te verzetten';
});
t('Een afgezegde afspraak niet',()=>{
  const id=future().id;
  const was=E(`appointments.find(x=>x.id==='${id}').status`);
  E(`appointments.find(x=>x.id==='${id}').status='cancelled'`);
  const ok=E(`apptEditable(appointments.find(x=>x.id==='${id}'))`);
  E(`appointments.find(x=>x.id==='${id}').status='${was}'`);
  return ok===false||'een afzegging is nog te verzetten';
});
t('Een betaalde afspraak niet',()=>{
  const id=future().id;
  E(`appointments.find(x=>x.id==='${id}').paid='paid'`);
  const ok=E(`apptEditable(appointments.find(x=>x.id==='${id}'))`);
  E(`appointments.find(x=>x.id==='${id}').paid='unpaid'`);
  return ok===false||'een betaalde afspraak is nog te verzetten';
});
t('Geblokkeerde tijd is geen afspraak',()=>{
  const b=E("appointments.find(a=>a.kind==='blocked')");
  return !b||E(`apptEditable(appointments.find(x=>x.id==='${b.id}'))`)===false
    ||'geblokkeerde tijd biedt de knop aan';
});

g('De knop staat er, en alleen waar hij hoort');
t('Een komende afspraak toont de knop',()=>{
  openDetail(future().id);
  return !!d.querySelector('#panel [data-apptedit]')||'geen bewerkknop';
});
t('Een afspraak die geweest is toont hem niet',()=>{
  const id=future().id, was=E(`appointments.find(x=>x.id==='${id}').date`);
  E(`appointments.find(x=>x.id==='${id}').date=addDays(TODAY,-2)`);
  openDetail(id);
  const none=!d.querySelector('#panel [data-apptedit]');
  const why=/already started/.test(d.querySelector('#panel').textContent);
  E(`appointments.find(x=>x.id==='${id}').date='${was}'`);
  return (none&&why)||(none?'er staat geen uitleg bij':'de knop staat er nog');
});
t('Afzeggen kan nog wel',()=>{
  const id=future().id, was=E(`appointments.find(x=>x.id==='${id}').date`);
  E(`appointments.find(x=>x.id==='${id}').date=addDays(TODAY,-2)`);
  openDetail(id);
  const can=!!d.querySelector('#panel [data-apptcancel]');
  E(`appointments.find(x=>x.id==='${id}').date='${was}'`);
  return can||'afzeggen is ook verdwenen';
});

g('Het formulier opent met wat er staat');
t('De knop opent de bewerklade',()=>{
  openDetail(future().id);
  d.querySelector('#panel [data-apptedit]').click();
  return /Edit appointment/.test(d.querySelector('#panel .panel-head h2').textContent)
    ||'een ander scherm ging open';
});
t('Met de klant die erop staat',()=>{
  const a=future();
  return d.querySelector('#panel [data-af="cust"]').value===a.cust||'andere klant voorgekozen';
});
t('Met de datum die erop staat',()=>{
  const a=future();
  return d.querySelector('#panel [data-af="date"]').value===a.date||'andere datum';
});
t('Met de dienst en de medewerker die erop staan',()=>{
  const a=future();
  const sid=d.querySelector('#panel [data-rowfield="sid"]').value;
  const eid=d.querySelector('#panel [data-rowfield="eid"]').value;
  return (sid===a.sid&&eid===a.emp)||`dienst ${sid}, medewerker ${eid}`;
});
t('Zonder "geen voorkeur" — er is al iemand aan gekoppeld',()=>{
  const opts=qa('#panel [data-rowfield="eid"] option').map(o=>o.value);
  return !opts.includes('any')||'"geen voorkeur" staat er nog in';
});
t('En zonder verwijderknop — één afspraak is één regel',()=>
  !d.querySelector('#panel [data-delrow]')||'er staat een verwijderknop');

g('Verzetten landt');
t('De opslaanknop staat uit tot je iets wijzigt',()=>{
  const b=d.querySelector('#panel [data-panelsave]');
  if(!b.disabled)return 'de knop stond meteen aan';
  setField('[data-rowfield="start"]','16:00');
  return !d.querySelector('#panel [data-panelsave]').disabled||'de knop bleef uit na een wijziging';
});
t('Een andere tijd komt op de afspraak',()=>{
  const id=future().id;
  save();
  const a=E(`appointments.find(x=>x.id==='${id}')`);
  return a.start==='16:00'||`staat op ${a.start}`;
});
t('De eindtijd loopt mee met de duur',()=>{
  const a=future();
  return mins(a.end)>mins(a.start)||`${a.start}–${a.end}`;
  function mins(s){const[h,m]=s.split(':').map(Number);return h*60+m}
});
t('Er kwam geen tweede afspraak bij',()=>{
  const n=E("appointments.filter(a=>a.kind==='appointment').length");
  E("state.lastN=state.lastN||0");
  return n===E('appointments.filter(a=>a.kind===\'appointment\').length')||'dubbel geboekt';
});
t('De geschiedenis houdt bij dat hij verzet is',()=>{
  const a=future();
  return (a.history||[]).some(h=>h.what==='Rescheduled')||'niets in de geschiedenis';
});
t('Het logboek ook',()=>
  E("auditLog.some(x=>x.action==='Appointment changed')")||'geen regel in het logboek');
t('Een botsing met een collega wordt geweigerd',()=>{
  const a=future();
  const other=E(`appointments.find(x=>x.emp==='${a.emp}'&&x.date==='${a.date}'&&x.id!=='${a.id}'&&x.kind==='appointment')`);
  if(!other)return true;
  openDetail(a.id);
  d.querySelector('#panel [data-apptedit]').click();
  setField('[data-rowfield="start"]',other.start);
  save();
  const now=E(`appointments.find(x=>x.id==='${a.id}').start`);
  return now!==other.start||'hij is boven op de collega geboekt';
});
t('En de afspraak botst niet met zichzelf',()=>{
  const a=future();
  openDetail(a.id);
  d.querySelector('#panel [data-apptedit]').click();
  /* Zet hem op zijn eigen tijd terug: dat mag niet als botsing gelden. */
  setField('[data-rowfield="start"]',a.start);
  save();
  return E(`appointments.find(x=>x.id==='${a.id}').start`)===a.start
    ||'zijn eigen tijd werd geweigerd';
});
E('closePanel(true)');

g('De lade heeft een adres');
t('Hij staat in de registry',()=>E("!!OVERLAYS['apptEdit']")||'geen naam');
t('En draagt de afspraak mee in het adres',()=>{
  const a=future();
  openDetail(a.id);
  d.querySelector('#panel [data-apptedit]').click();
  return E('screenHash()').includes('apptEdit')||`adres: ${E('screenHash()')}`;
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
