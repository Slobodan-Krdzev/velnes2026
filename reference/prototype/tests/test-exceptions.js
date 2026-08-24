/* Uitzonderingen op de openingstijden: de vaste week, de dagen waarop
   die week niet geldt, en de feestdagen die de eigenaar mag kiezen. */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/'});
const w=dom.window,d=w.document,E=s=>w.eval(s);
let pass=0,fail=0;
const t=(n,fn)=>{try{const r=fn();if(r===true||r===undefined){pass++;console.log('  pass  '+n)}
  else{fail++;console.log('  FAIL  '+n+' → '+r)}}catch(e){fail++;console.log('  FAIL  '+n+' → '+e.message)}};
const g=n=>console.log('\n'+n);
const qa=s=>[...d.querySelectorAll(s)];
const hours=(tab='regular')=>E(`closePanel(true);closeModal();session.userId='e1';state.route='settings';
  state.settingsTab='calendar';state.hoursTab='${tab}';state.hoursLoc='loc-centar';render()`);
const set=(sel,v)=>{const el=d.querySelector('#panel '+sel);el.value=v;
  el.dispatchEvent(new w.Event('change',{bubbles:true}))};
const save=()=>d.querySelector('#panel [data-panelsave]').click();
const wipe=()=>E('scheduleExceptions.length=0');
const book=(date,start,loc='loc-centar')=>
  E(`bookingCheck({locationId:'${loc}',date:'${date}',start:'${start}',dur:45,emp:'e1',sid:'s1'})`);
const addExc=(loc,from,to,type,periods,reason)=>E(`scheduleExceptions.push({id:excId(),
  locationId:'${loc}',startDate:'${from}',endDate:'${to}',type:'${type}',
  periods:${JSON.stringify(periods||[])},reason:${JSON.stringify(reason||'')},source:'MANUAL',
  createdAt:nowStamp(),updatedAt:nowStamp()})`);
/* Een maandag ver vooruit, zodat de klok de toets niet stuurt. */
const MON=E("(()=>{let d=addDays(TODAY,14);while(wdIdx(d)!==0)d=addDays(d,1);return d})()");
const NEXT_MON=E(`addDays('${MON}',7)`);

setTimeout(()=>{
g('De vaste week is nu echte data');
t('De vestiging draagt hem, niet een los lijstje in de code',()=>{
  const h=E("locById('loc-centar').hours");
  const mon=E("whLabel(locById('loc-centar').hours[0])");
  return (h&&mon==='09:00–19:00')||`hours: ${JSON.stringify(h)}`;
});
t('De boekingspoort leest die week',()=>{
  wipe();
  return book(MON,'10:00')===null||`geweigerd: ${book(MON,'10:00')}`;
});
t('Buiten die week wordt geweigerd',()=>{
  const r=book(MON,'20:00');
  return (r&&/open/.test(r))||`melding: ${r}`;
});
t('Een dag dichtzetten in de week werkt door',()=>{
  E("locById('loc-centar').hours[0]=null");
  const r=book(MON,'10:00');
  E("locById('loc-centar').hours[0]=[['09:00','19:00']]");
  return (r&&/closed on Monday/.test(r))||`melding: ${r}`;
});
t('Het scherm toont de echte tijden van de vestiging',()=>{
  hours('regular');
  const inputs=qa('#view [data-whper]').filter(x=>x.tagName==='INPUT');
  return inputs.length>0||'geen bewerkbare tijden';
});
t('En schrijft ernaartoe',()=>{
  hours('regular');
  /* maandag, eerste vak, begintijd */
  const el=qa('#view input[data-whper$="|0|0|0"]')[0];
  if(!el)return 'geen begintijd voor maandag';
  el.value='08:30'; el.dispatchEvent(new w.Event('change',{bubbles:true}));
  const now=E("whList(locById('loc-centar').hours[0])[0][0]");
  E("locById('loc-centar').hours[0]=[['09:00','19:00']]");
  return now==='08:30'||`bleef ${now}`;
});
t('Elke vestiging heeft zijn eigen week',()=>{
  /* Ze mogen gelijk zijn, maar het moeten wel twee losse objecten zijn:
     anders verandert de ene vestiging de andere mee. */
  const shared=E("locById('loc-centar').hours===locById('loc-aerodrom').hours");
  if(shared)return 'beide vestigingen delen één object';
  E("locById('loc-aerodrom').hours[2]=null");
  const other=E("locById('loc-centar').hours[2]");
  E("locById('loc-aerodrom').hours[2]=[['09:00','19:00']]");
  return !!other||'een dag dichtzetten bij de een raakte de ander';
});

g('Een gesloten dag');
t('Hij overschrijft de week voor die ene datum',()=>{
  wipe(); addExc('loc-centar',MON,MON,'CLOSED',[],'Vacation');
  return E(`scheduleFor('loc-centar','${MON}').open`)===false||'nog open';
});
t('Boeken op die dag wordt geweigerd, met reden',()=>{
  const r=book(MON,'10:00');
  return (r&&/closed/.test(r)&&/Vacation/.test(r))||`melding: ${r}`;
});
t('Elke andere maandag blijft gewoon open',()=>
  book(NEXT_MON,'10:00')===null||`ook dicht: ${book(NEXT_MON,'10:00')}`);
t('De weekindeling zelf is niet aangeraakt',()=>{
  const h=E("locById('loc-centar').hours[0]");
  const lab=E("whLabel(locById('loc-centar').hours[0])");
  return (h&&lab==='09:00–19:00')||`week werd ${JSON.stringify(h)}`;
});
t('De andere vestiging draait door',()=>
  E(`scheduleFor('loc-aerodrom','${MON}').open`)===true||'die ging mee dicht');
t('En daar kun je ook gewoon boeken',()=>{
  const r=book(MON,'10:00','loc-aerodrom');
  return r===null||`geweigerd: ${r}`;
});
t('Ook de medewerker kan er niet omheen',()=>{
  const r=E(`bookingCheck({locationId:'loc-centar',date:'${MON}',start:'10:00',dur:45,emp:'e3',sid:'s6'})`);
  return (r&&/closed/.test(r))||`melding: ${r}`;
});
t('En "geen voorkeur" evenmin',()=>{
  const r=E(`bookingCheck({locationId:'loc-centar',date:'${MON}',start:'10:00',dur:45,emp:'any',sid:'s1'})`);
  return (r&&/closed/.test(r))||`melding: ${r}`;
});
t('Er komen die dag geen tijden meer uit de motor',()=>{
  const free=E(`availableSlots('loc-centar','s1','e1','${MON}',null).filter(s=>s.free).length`);
  return free===0||`${free} tijden`;
});

g('Andere tijden op één dag');
t('Alleen binnen die tijden kun je boeken',()=>{
  wipe(); addExc('loc-centar',MON,MON,'CUSTOM_HOURS',[{start:'10:00',end:'14:00'}],'Special event');
  return book(MON,'11:00')===null||`geweigerd: ${book(MON,'11:00')}`;
});
t('Ervoor niet',()=>{
  const r=book(MON,'09:00');
  return (r&&/only open/.test(r))||`melding: ${r}`;
});
t('Erna ook niet',()=>{
  const r=book(MON,'15:00');
  return (r&&/only open/.test(r))||`melding: ${r}`;
});
t('Een behandeling die eroverheen loopt wordt geweigerd',()=>{
  const r=E(`bookingCheck({locationId:'loc-centar',date:'${MON}',start:'13:30',dur:60,emp:'e1',sid:'s1'})`);
  return !!r||'een afspraak liep over de sluitingstijd heen';
});
t('Een middagpauze laat een gat',()=>{
  wipe(); addExc('loc-centar',MON,MON,'CUSTOM_HOURS',
    [{start:'09:00',end:'12:00'},{start:'14:00',end:'18:00'}],'Split day');
  return (book(MON,'10:00')===null&&book(MON,'15:00')===null&&!!book(MON,'13:00'))
    ||`ochtend ${book(MON,'10:00')} · pauze ${book(MON,'13:00')} · middag ${book(MON,'15:00')}`;
});
t('En dat gat staat er ook zo in het overzicht',()=>{
  const x=E("scheduleExceptions[0]");
  return E(`excHoursLabel(scheduleExceptions[0])`)==='09:00–12:00, 14:00–18:00'
    ||`leest ${E('excHoursLabel(scheduleExceptions[0])')}`;
});

g('Een reeks dagen');
t('Elke dag ertussen valt eronder',()=>{
  wipe();
  const to=E(`addDays('${MON}',4)`);
  addExc('loc-centar',MON,to,'CLOSED',[],'Vacation');
  const mid=E(`addDays('${MON}',2)`);
  return E(`scheduleFor('loc-centar','${mid}').open`)===false||'de woensdag bleef open';
});
t('De dag erna weer niet',()=>{
  const after=E(`addDays('${MON}',5)`);
  return E(`scheduleFor('loc-centar','${after}').open`)===true||'de reeks liep door';
});
t('Het overzicht vat hem samen als één regel',()=>{
  hours('exceptions');
  const rows=qa('#view tbody tr').length;
  return rows===1||`${rows} regels voor één reeks`;
});

g('Het formulier');
t('Add opent de lade',()=>{
  wipe(); hours('exceptions');
  d.querySelector('#view [data-panel^="excNew"]').click();
  return !!d.querySelector('#panel [data-xf="from"]')||'geen formulier';
});
t('Dicht de hele dag staat voorgekozen',()=>
  E("state.excType")==='CLOSED'||`voorgekozen: ${E('state.excType')}`);
t('Eén datum staat voorgekozen, geen reeks',()=>
  E("state.excMode")==='single'||`voorgekozen: ${E('state.excMode')}`);
t('Een einddatum vóór de begindatum wordt geweigerd',()=>{
  d.querySelector('#panel [data-excmode="range"]').click();
  set('[data-xf="from"]',MON);
  set('[data-xf="to"]',E(`addDays('${MON}',-3)`));
  const before=E('scheduleExceptions.length');
  save();
  return E('scheduleExceptions.length')===before||'een omgekeerde reeks werd opgeslagen';
});
t('Een reeks vooruit lukt wel',()=>{
  set('[data-xf="to"]',E(`addDays('${MON}',3)`));
  d.querySelector('#panel [data-xf="reason"]').value='Vacation';
  save();
  const x=E('scheduleExceptions[0]');
  return (x&&x.endDate===E(`addDays('${MON}',3)`))||`opgeslagen als ${JSON.stringify(x)}`;
});
t('Twee regels voor dezelfde dag worden geweigerd',()=>{
  hours('exceptions');
  d.querySelector('#view [data-panel^="excNew"]').click();
  set('[data-xf="from"]',E(`addDays('${MON}',1)`));
  const before=E('scheduleExceptions.length');
  save();
  return E('scheduleExceptions.length')===before||'er staan nu twee regels op één dag';
});
t('En dat wordt uitgelegd voordat je opslaat',()=>
  /already/.test(d.querySelector('#panel').textContent)||'geen waarschuwing in de lade');
t('Aangepaste tijden zonder tijdvak kunnen niet',()=>{
  wipe(); hours('exceptions');
  d.querySelector('#view [data-panel^="excNew"]').click();
  d.querySelector('#panel [data-exctype="CUSTOM_HOURS"]').click();
  set('[data-xp="0|start"]','14:00'); set('[data-xp="0|end"]','10:00');
  const before=E('scheduleExceptions.length');
  save();
  return E('scheduleExceptions.length')===before||'een tijdvak dat eerder eindigt dan begint';
});
t('Overlappende tijdvakken ook niet',()=>{
  set('[data-xp="0|start"]','09:00'); set('[data-xp="0|end"]','13:00');
  d.querySelector('#panel [data-xpadd]').click();
  set('[data-xp="1|start"]','12:00'); set('[data-xp="1|end"]','16:00');
  const before=E('scheduleExceptions.length');
  save();
  const to=d.querySelector('#toast');
  return (E('scheduleExceptions.length')===before&&/overlap/.test(to.textContent))
    ||`melding: ${to&&to.textContent}`;
});
t('Netjes na elkaar wel',()=>{
  set('[data-xp="1|start"]','14:00');
  save();
  return E('scheduleExceptions.length')===1||'niet opgeslagen';
});
t('Een tijdvak weghalen kan',()=>{
  hours('exceptions');
  qa('#view [data-panel^="excEdit"]')[0].click();
  const before=E('state.excPeriods.length');
  d.querySelector('#panel [data-xpdel]').click();
  return E('state.excPeriods.length')===before-1||'het tijdvak bleef staan';
});
E('closePanel(true)');

g('Bestaande afspraken blijven staan');
t('Het formulier waarschuwt dat er al iets geboekt is',()=>{
  wipe();
  const a=E("appointments.find(x=>x.kind==='appointment'&&x.locationId==='loc-centar')");
  hours('exceptions');
  d.querySelector('#view [data-panel^="excNew"]').click();
  set('[data-xf="from"]',a.date);
  return /already\s*booked|appointments? already/i.test(d.querySelector('#panel').textContent)
    ||'geen waarschuwing over bestaande afspraken';
});
t('En zegt erbij dat Velnes niets afzegt',()=>
  /does not cancel/.test(d.querySelector('#panel').textContent)||'dat staat er niet bij');
t('Opslaan zegt de afspraken niet af',()=>{
  const a=E("appointments.find(x=>x.kind==='appointment'&&x.locationId==='loc-centar')");
  const before=E(`appointments.filter(x=>x.date==='${a.date}'&&x.kind==='appointment').length`);
  save();
  const after=E(`appointments.filter(x=>x.date==='${a.date}'&&x.kind==='appointment').length`);
  return before===after||`${before} → ${after}`;
});
t('Ze staan ook niet op afgezegd',()=>{
  const n=E("appointments.filter(x=>x.status==='cancelled').length");
  return n===0||`${n} afgezegd`;
});
t('Maar nieuwe boekingen worden wel geweigerd',()=>{
  const x=E('scheduleExceptions[0]');
  const r=book(x.startDate,'11:00');
  return !!r||'er kan nog geboekt worden';
});

g('Wijzigen en weggooien');
t('Edit opent met wat erop staat',()=>{
  wipe(); addExc('loc-centar',MON,MON,'CLOSED',[],'Vacation');
  hours('exceptions');
  qa('#view [data-panel^="excEdit"]')[0].click();
  return d.querySelector('#panel [data-xf="from"]').value===MON||'andere datum';
});
t('Van dicht naar andere tijden kan',()=>{
  d.querySelector('#panel [data-exctype="CUSTOM_HOURS"]').click();
  set('[data-xp="0|start"]','11:00'); set('[data-xp="0|end"]','15:00');
  save();
  const x=E('scheduleExceptions[0]');
  return (x.type==='CUSTOM_HOURS'&&x.periods[0].start==='11:00')||JSON.stringify(x);
});
t('En dat werkt meteen door in de beschikbaarheid',()=>
  (book(MON,'12:00')===null&&!!book(MON,'09:30'))
  ||`12:00 ${book(MON,'12:00')} · 09:30 ${book(MON,'09:30')}`);
t('Weggooien vraagt eerst om bevestiging',()=>{
  hours('exceptions');
  qa('#view [data-excdel]')[0].click();
  return !!d.querySelector('#modal [data-excdelgo]')||'geen bevestiging';
});
t('En legt uit dat de gewone week terugkomt',()=>
  /Regular hours/.test(d.querySelector('#modal').textContent)||'dat staat er niet');
t('Weggooien herstelt de gewone dag',()=>{
  d.querySelector('#modal [data-excdelgo]').click();
  return (E('scheduleExceptions.length')===0&&book(MON,'10:00')===null)
    ||`over: ${E('scheduleExceptions.length')} · boeking ${book(MON,'10:00')}`;
});
t('En laat de weekindeling ongemoeid',()=>{
  const h=E("locById('loc-centar').hours[0]");
  const lab=E("whLabel(locById('loc-centar').hours[0])");
  return (h&&/^09:00/.test(lab))||`week werd ${JSON.stringify(h)}`;
});

g('Feestdagen komen van de vestiging');
t('Het land wordt afgeleid, niet vastgezet',()=>
  E("countryOf('loc-centar')")==='MK'||`land: ${E("countryOf('loc-centar')")}`);
t('Een ander land zou een andere kalender geven',()=>{
  const was=E('business.country');
  E("business.country='Nowhere'");
  const none=E("calendarOf('loc-centar')");
  E(`business.country=${JSON.stringify(was)}`);
  return none===null||'het land wordt genegeerd';
});
t('En dan zegt het scherm dat netjes',()=>{
  const was=E('business.country');
  E("business.country='Nowhere';state.route='settings';state.settingsTab='calendar';state.hoursTab='exceptions';render()");
  const txt=d.querySelector('#view').textContent;
  E(`business.country=${JSON.stringify(was)};render()`);
  return /does not have a holiday calendar/.test(txt)||'geen uitleg bij een onbekend land';
});
t('De kalender kent meerdere jaren',()=>
  E("holidayYears('loc-centar').length")>=2||'maar één jaar');
t('2026 is geverifieerd, 2027 nog niet',()=>{
  const a=E("holidayYearMeta('loc-centar',2026).verified");
  const b=E("holidayYearMeta('loc-centar',2027).verified");
  return (a===true&&b===false)||`2026 ${a}, 2027 ${b}`;
});
t('Feestdagen die verschoven zijn dragen hun oorsprong mee',()=>{
  const moved=E("holidaysFor('loc-centar',2026).filter(h=>h.moved).map(h=>h.date)");
  return moved.length>=3||`${moved.length} verschoven dagen`;
});
t('En er staat bij voor wie een dag geldt',()=>{
  const some=E("holidaysFor('loc-centar',2026).filter(h=>h.applies!=='Everyone')");
  return some.length>=1||'elke dag geldt voor iedereen — dat klopt niet voor MK';
});

g('De eigenaar beslist, niet Velnes');
t('Er is niets toegepast zonder dat je iets deed',()=>{
  wipe(); hours('exceptions');
  return E("scheduleExceptions.filter(x=>x.source==='PUBLIC_HOLIDAY').length")===0
    ||'er zijn feestdagen vanzelf toegepast';
});
t('De kaart zegt met zoveel woorden dat er niets is gesloten',()=>{
  const txt=d.querySelector('#view').textContent;
  return /has not closed anything/.test(txt)||'die uitleg staat er niet';
});
t('En hij staat er zonder dat je iets hoeft open te klappen',()=>{
  const card=[...qa('#view .card')].find(c=>/Public holidays/.test(c.textContent));
  if(!card)return 'geen feestdagenkaart';
  const btn=card.querySelector('[data-panel^="holidays"]');
  return !!btn||'de knop staat niet in dezelfde kaart als de uitleg';
});
t('Het land staat erbij',()=>{
  const card=[...qa('#view .card')].find(c=>/Public holidays/.test(c.textContent));
  return /North Macedonia/.test(card.textContent)||'het land wordt niet genoemd';
});
t('Review opent de lijst',()=>{
  d.querySelector('#view [data-panel^="holidays"]').click();
  return qa('#panel [data-holpick]').length===12||`${qa('#panel [data-holpick]').length} dagen`;
});
t('Niets staat voorgevinkt',()=>{
  const on=qa('#panel [data-holpick].on').length;
  return on===0||`${on} stonden al aan`;
});
t('Zonder keuze gebeurt er niets',()=>{
  const before=E('scheduleExceptions.length');
  save();
  return E('scheduleExceptions.length')===before||'er werd toch iets aangemaakt';
});
t('Een dag aanvinken en toepassen maakt één uitzondering',()=>{
  qa('#panel [data-holpick]')[0].click();
  save();
  return E('scheduleExceptions.length')===1||`${E('scheduleExceptions.length')} uitzonderingen`;
});
t('Die draagt de naam van de feestdag en zijn herkomst',()=>{
  const x=E('scheduleExceptions[0]');
  return (x.source==='PUBLIC_HOLIDAY'&&x.holidayId&&x.reason&&x.type==='CLOSED')
    ||JSON.stringify(x);
});
t('En sluit die dag echt',()=>{
  const x=E('scheduleExceptions[0]');
  return !!book(x.startDate,'10:00')||'er kan nog geboekt worden';
});
t('De rest van de feestdagen blijft ongemoeid',()=>{
  const n=E("holidaysFor('loc-centar',2026).filter(h=>holidayState('loc-centar',h).status==='open').length");
  return n===11||`${n} nog open`;
});
t('Een tweede keer toepassen maakt geen dubbele',()=>{
  hours('exceptions');
  d.querySelector('#view [data-panel^="holidays"]').click();
  const still=qa('#panel [data-holpick]').length;
  return still===11||`${still} nog aanvinkbaar`;
});
t('Een toegepaste dag staat als toegepast gemarkeerd',()=>
  /Applied/.test(d.querySelector('#panel').textContent)||'geen markering');
t('Een dag die je zelf al had staat als al geregeld',()=>{
  E('closePanel(true)');
  wipe();
  addExc('loc-centar','2026-01-01','2026-01-01','CLOSED',[],'My own day off');
  hours('exceptions');
  d.querySelector('#view [data-panel^="holidays"]').click();
  return /Already configured/.test(d.querySelector('#panel').textContent)||'niet herkend';
});
t('En die eigen regel blijft van jou',()=>{
  const x=E("excFor('loc-centar','2026-01-01')");
  return (x.source==='MANUAL'&&x.reason==='My own day off')||JSON.stringify(x);
});
E('closePanel(true)');

g('Het scherm zelf');
t('Openingstijden heeft twee tabbladen',()=>{
  hours('regular');
  const tabs=qa('#view [data-hourstab]').map(x=>x.textContent.trim().split('\n')[0].trim());
  return tabs.join(',')==='Regular hours,Exceptions'||`tabs: ${tabs.join(', ')}`;
});
t('Het staat onder Opening hours, niet in een eigen sectie',()=>{
  const secs=qa('#view .snav button').map(b=>b.dataset.stab);
  return (secs.includes('calendar')&&!secs.includes('exceptions'))||`secties: ${secs.join(', ')}`;
});
t('Wisselen van tabblad werkt',()=>{
  qa('#view [data-hourstab="exceptions"]')[0].click();
  return E('state.hoursTab')==='exceptions'||`staat op ${E('state.hoursTab')}`;
});
t('Je kiest per vestiging',()=>{
  hours('exceptions');
  return qa('#view [data-hoursloc]').length===E('myLocs().length')||'geen keuze per vestiging';
});
t('En dat verandert wat je ziet',()=>{
  wipe(); addExc('loc-centar',MON,MON,'CLOSED',[],'Only Centar');
  hours('exceptions');
  const a=/Only Centar/.test(d.querySelector('#view').textContent);
  E("state.hoursLoc='loc-aerodrom';render()");
  const b=/Only Centar/.test(d.querySelector('#view').textContent);
  return (a&&!b)||`centar ${a}, aerodrom ${b}`;
});
t('Zonder uitzonderingen staat er geen kale tabel',()=>{
  wipe(); hours('exceptions');
  return /No schedule exceptions/.test(d.querySelector('#view').textContent)||'geen lege stand';
});
t('En die lege stand biedt meteen de uitweg',()=>{
  const btn=[...qa('#view .btn')].find(b=>/Add an exception/.test(b.textContent));
  return !!btn||'geen knop in de lege stand';
});
t('Het tabblad telt hoeveel er aankomen',()=>{
  addExc('loc-centar',MON,MON,'CLOSED',[],'Vacation');
  hours('exceptions');
  const tab=qa('#view [data-hourstab="exceptions"]')[0];
  return /1/.test(tab.textContent)||`tab leest ${tab.textContent.trim()}`;
});
t('Voorbije uitzonderingen staan niet tussen de komende',()=>{
  wipe();
  addExc('loc-centar',E('addDays(TODAY,-20)'),E('addDays(TODAY,-20)'),'CLOSED',[],'Last month');
  hours('exceptions');
  const txt=d.querySelector('#view').textContent;
  return (/No schedule exceptions/.test(txt)&&/Show past/.test(txt))||'voorbije dagen staan ertussen';
});
t('Maar zijn wel op te vragen',()=>{
  d.querySelector('#view [data-excpast]').click();
  return /Last month/.test(d.querySelector('#view').textContent)||'niet te vinden';
});
wipe(); E('state.excPast=false');

g('De agenda weet het ook');
t('Een gesloten dag telt niet als open dag',()=>{
  addExc('loc-centar',MON,MON,'CLOSED',[],'Vacation');
  addExc('loc-aerodrom',MON,MON,'CLOSED',[],'Vacation');
  return E(`isOpenDate('${MON}')`)===false||'de agenda ziet hem nog als open';
});
t('Is één vestiging open, dan is de dag niet dicht',()=>{
  E("scheduleExceptions.splice(1,1)");
  return E(`isOpenDate('${MON}')`)===true||'de dag geldt als dicht terwijl er ergens open is';
});
t('De datumkiezer markeert hem als gesloten',()=>{
  wipe();
  addExc('loc-centar',MON,MON,'CLOSED',[],'Vacation');
  addExc('loc-aerodrom',MON,MON,'CLOSED',[],'Vacation');
  E("state.route='calendar';state.calView='day';state.calDate=TODAY;state.calPick=false;render()");
  d.querySelector('#view [data-calpick]').click();
  /* De kiezer opent op de maand van de gekozen dag. MON ligt twee weken
     vooruit en kan dus net in de volgende maand vallen; dan bladeren we
     erheen in plaats van te concluderen dat hij open staat. */
  let cell=qa('#view .calpick-day').find(b=>b.dataset.calpickday===MON);
  for(let i=0;i<3&&!cell;i++){
    const next=qa('#view [data-calpickmonth]').pop();
    if(!next)break;
    next.click();
    cell=qa('#view .calpick-day').find(b=>b.dataset.calpickday===MON);
  }
  E('state.calPick=false');
  if(!cell)return 'de dag staat niet in de kiezer, ook niet na bladeren';
  return cell.classList.contains('closed')||'de kiezer toont hem als gewone dag';
});
wipe();

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
