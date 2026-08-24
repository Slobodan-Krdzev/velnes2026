/* Wat een rol mag zien. De agenda is de scherpste toets: een medewerker
   met alleen 'eigen afspraken' mag geen kolom van een collega zien. */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/#calendar'});
const w=dom.window,d=w.document,E=s=>w.eval(s);
let pass=0,fail=0;
const t=(n,fn)=>{try{const r=fn();if(r===true||r===undefined){pass++;console.log('  pass  '+n)}
  else{fail++;console.log('  FAIL  '+n+' → '+r)}}catch(e){fail++;console.log('  FAIL  '+n+' → '+e.message)}};
const g=n=>console.log('\n'+n);
const qa=s=>[...d.querySelectorAll(s)];
const nav=()=>[...new Set(qa('[data-nav]').map(b=>b.dataset.nav.split('|')[0]))];
const as=(who,extra='')=>E(`session.userId='${who}';state.route='calendar';state.calView='day';`
  +`state.calDate=TODAY;state.calEmp='all';state.calRes='all';${extra}render()`);

setTimeout(()=>{
/* Twee afspraken van vandaag: één van Elena, één van de eigenaar. */
E("appointments.push({...appointments[0],id:'z-elena',date:TODAY,emp:'e3',start:'11:00',end:'11:45',locationId:'loc-centar'});"
 +"appointments.push({...appointments[0],id:'z-maria',date:TODAY,emp:'e1',start:'12:00',end:'12:45',locationId:'loc-centar'})");

g('Elena ziet alleen haar eigen dag');
as('e3');
t('Eén kolom, en dat is de hare',()=>{
  const heads=qa('.cal-head .dow').map(x=>x.textContent.trim());
  return (heads.length===1&&heads[0]===E("employees.find(e=>e.id==='e3').name"))
    ||`kolommen: ${heads.join(', ')}`;
});
t('Geen afspraak van een collega in de dagweergave',()=>{
  const other=qa('.event').map(e=>E(`appointments.find(x=>x.id==='${e.dataset.appt}')`))
    .filter(a=>a&&a.kind==='appointment'&&a.emp!=='e3');
  return other.length===0||`${other.length} afspraken van anderen`;
});
t('Ook niet in de weekweergave',()=>{
  as('e3',"state.calView='week';");
  const other=qa('.event').map(e=>E(`appointments.find(x=>x.id==='${e.dataset.appt}')`))
    .filter(a=>a&&a.kind==='appointment'&&a.emp!=='e3');
  return other.length===0||`${other.length} afspraken van anderen`;
});
t('Haar eigen afspraak staat er wel',()=>{
  as('e3');
  return qa('[data-appt="z-elena"]').length===1||'haar eigen afspraak ontbreekt';
});
t('Het medewerkersfilter wordt haar niet aangeboden',()=>{
  const f=E('CAL_FILTERS().map(x=>x[0])');
  return !f.includes('calEmp')||`filters: ${f.join(', ')}`;
});
t('Het filter op een collega zetten opent niets',()=>{
  as('e3',"state.calEmp='e1';");
  const ev=qa('.event').map(e=>E(`appointments.find(x=>x.id==='${e.dataset.appt}')`)).filter(Boolean);
  as('e3');
  return ev.every(a=>a.kind!=='appointment'||a.emp==='e3')||'een collega werd alsnog zichtbaar';
});

g('Wat er in de navigatie staat');
as('e3');
t('Alleen de agenda en de kassa',()=>{
  const n=nav().filter(x=>x!=='about');
  return n.join(',')==='calendar,register'||`navigatie: ${n.join(', ')}`;
});
t('Geen catalogus',()=>!nav().includes('catalog')||'de catalogus staat er nog');
t('Geen klanten, leveranciers, marketing of rapporten',()=>{
  const forbidden=['customers','suppliers','marketing','reports'].filter(x=>nav().includes(x));
  return forbidden.length===0||`nog zichtbaar: ${forbidden.join(', ')}`;
});
t('Geen instellingen, want er staat niets in',()=>!nav().includes('settings')||'instellingen staat er nog');
t('De catalogus rechtstreeks openen leidt haar terug',()=>{
  E("session.userId='e3';go('catalog')");
  return E('state.route')!=='catalog'||'ze belandt toch in de catalogus';
});

g('De rol van iemand anders blijft heel');
t('De eigenaar ziet alle kolommen',()=>{
  as('e1');
  return qa('.cal-head .dow').length===E("employees.filter(e=>e.locs.some(inScope)&&e.status==='active').length")
    ||`${qa('.cal-head .dow').length} kolommen`;
});
t('De eigenaar houdt zijn volledige navigatie',()=>{
  const need=['calendar','register','catalog','suppliers','customers','marketing','reports','settings'];
  const missing=need.filter(x=>!nav().includes(x));
  return missing.length===0||`mist: ${missing.join(', ')}`;
});
t('De eigenaar houdt alle instellingen',()=>{
  E("state.route='settings';render()");
  const tabs=qa('[data-stab]').map(b=>b.textContent.trim());
  return ['General','Company','Locations','Roles & permissions','Audit log'].every(x=>tabs.includes(x))
    ||`secties: ${tabs.join(', ')}`;
});
t('De balie ziet de hele agenda, maar niet de rapporten',()=>{
  as('e4');
  if(qa('.cal-head .dow').length<2)return 'de balie ziet maar één kolom';
  return !nav().includes('reports')||'de balie ziet rapporten';
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
