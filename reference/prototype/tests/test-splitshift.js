/* test-splitshift.js — gebroken diensten: meer dan een tijdvak per dag,
   op de vestiging en op de medewerker.

   De vorm, de poort, de lege tijd en allebei de bewerkschermen. De
   uitzonderingen droegen deze vorm al; deze reeks houdt vast dat de
   vaste week hem nu ook draagt en dat niets onderweg terugvalt op een
   los begin-eindpaar. */
const {JSDOM}=require('jsdom');
const fs=require('fs'),path=require('path');
const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),
  {runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document;
let pass=0,fail=0;
const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL  '+m))};
const q=s=>d.querySelector(s), qa=s=>[...d.querySelectorAll(s)];
const E=x=>w.eval(x);
const J=x=>JSON.stringify(E(x));
const set=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}))};

const LID='loc-centar';
const H=i=>J(`locById('${LID}').hours[${i}]`);

console.log('— De vorm: een dag draagt een lijst vakken —');
ok(E('Array.isArray(stdHours()[0])&&Array.isArray(stdHours()[0][0])'),
  'stdHours levert geen lijst van vakken: '+J('stdHours()[0]'));
ok(E("stdHours()[0][0].join('-')")==='09:00-19:00','het eerste vak klopt niet');
ok(E('stdHours()[6]')===null,'zondag is niet dicht');
/* De oude platte vorm moet leesbaar blijven: bestaande opslag. */
ok(J("whList(['09:00','17:00'])")==='[["09:00","17:00"]]',
  'de oude platte vorm wordt niet gelezen');
ok(J('whList(null)')==='[]','null levert geen lege lijst');

console.log('— Overlap en achteruit lopen worden herkend —');
ok(E("whProblem([['09:00','13:00'],['15:00','19:00']])")===null,
  'een goede gebroken dienst wordt afgekeurd');
ok(/overlap/.test(E("whProblem([['09:00','13:00'],['12:00','19:00']])")),
  'overlap wordt niet gemeld');
ok(/overlap/.test(E("whProblem([['15:00','19:00'],['09:00','16:00']])")),
  'overlap wordt gemist als de vakken door elkaar staan');
ok(E("whProblem([['09:00','13:00'],['13:00','19:00']])")===null,
  'aansluitende vakken tellen als overlap');
ok(/ends before it starts/.test(E("whProblem([['13:00','09:00']])")),
  'een vak dat achteruit loopt wordt niet gemeld');
ok(!!E('whProblem([])'),'een lege dag wordt niet gemeld');

console.log('— Een vak erbij op een volle dag splitst hem —');
/* Een gewone werkdag loopt tot sluitingstijd. Aanplakken kan dan niet,
   dus wordt het laatste vak gesplitst; anders zou de knop niets doen op
   precies de dag waar je een gebroken dienst wil maken. */
ok(J("whAdd([['09:00','19:00']])").split('],[').length===2,
  'een volle dag levert geen twee vakken: '+J("whAdd([['09:00','19:00']])"));
ok(E("whProblem(whAdd([['09:00','19:00']]))")===null,
  'de splitsing levert meteen iets ongeldigs op');
ok(J("whAdd([['09:00','13:00']])")==='[["09:00","13:00"],["14:00","18:00"]]',
  'is er ruimte na het laatste vak, dan hoort het daarachter: '+J("whAdd([['09:00','13:00']])"));
ok(E("whAdd([['09:00','10:00']])")!==null,'een kort vak met ruimte erna kan niets erbij');
ok(E("whCanAdd([['18:30','19:00']])")===false,
  'een kort vak aan het eind van de dag laat zich toch splitsen');

console.log('— De poort leest de vakken —');
const MON=E(`(function(){let v=TODAY;for(let i=0;i<8;i++){if(wdIdx(v)===0)return v;v=addDays(v,1)}})()`);
E(`locById('${LID}').hours[0]=[['09:00','13:00'],['15:00','19:00']]`);
ok(J(`scheduleFor('${LID}','${MON}').periods`)==='[["09:00","13:00"],["15:00","19:00"]]',
  'scheduleFor geeft de vakken niet door');
ok(E(`schedLabel(scheduleFor('${LID}','${MON}'))`)==='09:00–13:00, 15:00–19:00',
  'het label noemt niet beide vakken');
ok(E(`withinSchedule(scheduleFor('${LID}','${MON}'),600,660)`)===true,
  '10:00–11:00 valt binnen het eerste vak maar wordt geweigerd');
ok(E(`withinSchedule(scheduleFor('${LID}','${MON}'),810,870)`)===false,
  '13:30–14:30 valt in de pauze maar wordt toegelaten');
ok(E(`withinSchedule(scheduleFor('${LID}','${MON}'),750,930)`)===false,
  'een afspraak dwars over de pauze heen wordt toegelaten');
ok(E(`isOpenDate('${MON}','${LID}')`)===true,'een gebroken dag geldt als gesloten');

console.log('— De boekingspoort weigert in de pauze —');
E(`employees.find(e=>e.id==='e1').hours[0]=[['09:00','13:00'],['15:00','19:00']]`);
const boek=(start,dur)=>E(`bookingCheck({locationId:'${LID}',date:'${MON}',start:'${start}',
  dur:${dur},emp:'e1',sid:'s1'})`);
ok(boek('10:00',60)===null,'10:00 wordt geweigerd: '+boek('10:00',60));
ok(typeof boek('13:30',30)==='string','13:30 valt in de pauze maar wordt geboekt');
ok(/09:00–13:00, 15:00–19:00/.test(boek('13:30',30)||''),
  'de melding noemt niet beide vakken: '+boek('13:30',30));
ok(typeof boek('12:30',60)==='string','een afspraak die over de pauze heen loopt wordt geboekt');
ok(boek('15:30',60)===null,'na de pauze wordt geweigerd: '+boek('15:30',60));

console.log('— Lege tijd houdt de pauze buiten —');
/* De pauze is geen gat dat je kunt verkopen: er is dan niemand. */
const caps=E(`(function(){
  appointments.filter(a=>a.date==='${MON}').forEach(a=>a.kind='cancelled');
  return openCapacity('${LID}','${MON}').filter(c=>c.empId==='e1')
    .map(c=>c.start+'+'+c.dur);
})()`);
ok(Array.isArray(caps),'openCapacity gaf geen lijst');
const raakt=E(`(function(){
  return openCapacity('${LID}','${MON}').filter(c=>c.empId==='e1')
    .some(c=>mins(c.start)<900&&mins(c.start)+c.dur>780);
})()`);
ok(raakt===false,'een kans loopt dwars door de pauze heen: '+JSON.stringify(caps));

console.log('— De vestiging: vakken bewerken op de instellingenpagina —');
E(`locById('${LID}').hours[0]=[['09:00','19:00']]`);
E(`go('settings'); state.settingsTab='calendar'; state.hoursTab='regular'; state.hoursLoc='${LID}'; render();`);
ok(qa(`[data-whper^="${LID}|0|"]`).length===2,'een gewone dag toont geen twee tijdvelden');
ok(!q(`[data-whperdel^="${LID}|0|"]`),'bij \u00e9\u00e9n vak staat er al een verwijderknop');
ok(!!q(`[data-whperadd="${LID}|0"]`),'de knop om een vak toe te voegen ontbreekt');
/* De knop hoort uiterst rechts op de rij, niet onder de tijdvakken:
   hij hangt aan de rij zelf en is het laatste element. */
const addBtn=(sel)=>q(sel);
const bMon=q(`[data-whperadd="${LID}|0"]`), rMon=bMon.closest('.hoursrow');
ok(bMon.parentElement===rMon,'de knop hangt niet aan de rij maar in de vakkenkolom');
ok(rMon.lastElementChild===bMon,'de knop staat niet als laatste op de rij');
ok(bMon.classList.contains('wh-add'),'de knop draagt de wh-add klasse niet');
ok(/\.hoursrow>\.wh-add\{margin-left:auto/.test(
  fs.readFileSync(path.join(__dirname,'index.html'),'utf8')),
  'de regel die de knop naar rechts duwt staat niet in de opmaak');

q(`[data-whperadd="${LID}|0"]`).click();
ok(E(`whList(locById('${LID}').hours[0]).length`)===2,'er kwam geen tweede vak: '+H(0));
ok(qa(`[data-whper^="${LID}|0|"]`).length===4,'het scherm toont geen vier tijdvelden');
ok(qa(`[data-whperdel^="${LID}|0|"]`).length===2,'niet elk vak heeft een verwijderknop');
ok(/split/.test(q(`[data-lochours="${LID}|0|toggle"]`).closest('.hoursrow').className),
  'de rij stapelt niet bij twee vakken');
/* Ook met twee vakken blijft de knop rechts op de rij staan. */
const bMon2=q(`[data-whperadd="${LID}|0"]`);
ok(bMon2&&bMon2.closest('.hoursrow').lastElementChild===bMon2,
  'na het splitsen staat de knop niet meer als laatste op de rij');

set(q(`[data-whper="${LID}|0|0|1"]`),'13:00');
set(q(`[data-whper="${LID}|0|1|0"]`),'15:00');
set(q(`[data-whper="${LID}|0|1|1"]`),'19:00');
ok(H(0)==='[["09:00","13:00"],["15:00","19:00"]]','de tijden kwamen niet aan: '+H(0));
ok(J(`scheduleFor('${LID}','${MON}').periods`)===H(0),'de poort volgt het scherm niet');

console.log('— Overlap wordt gemeld, niet stil weggeschreven —');
set(q(`[data-whper="${LID}|0|1|0"]`),'12:00');
ok(/overlap/.test((q('#toast')||{}).textContent||''),
  'er komt geen melding bij overlap: '+((q('#toast')||{}).textContent||''));
set(q(`[data-whper="${LID}|0|1|0"]`),'15:00');

console.log('— Een vak eraf —');
q(`[data-whperdel="${LID}|0|1"]`).click();
ok(H(0)==='[["09:00","13:00"]]','het tweede vak ging er niet af: '+H(0));
ok(!q(`[data-whperdel^="${LID}|0|"]`),'de verwijderknop blijft staan bij \u00e9\u00e9n vak');
/* Het laatste vak mag er niet af: dan zou de dag stil dichtgaan. */
E(`document.querySelector('[data-lochours="${LID}|0|toggle"]')`);
ok(E(`whList(locById('${LID}').hours[0]).length`)===1,'er staat niet \u00e9\u00e9n vak klaar');

console.log('— Drie vakken kunnen ook —');
q(`[data-whperadd="${LID}|0"]`).click();
q(`[data-whperadd="${LID}|0"]`)&&q(`[data-whperadd="${LID}|0"]`).click();
ok(E(`whList(locById('${LID}').hours[0]).length`)===3,'een derde vak lukt niet: '+H(0));
ok(E(`whProblem(locById('${LID}').hours[0])`)===null,'drie vakken leveren iets ongeldigs op: '+H(0));

console.log('— Dezelfde rij in de vestigingslade —');
E(`openPanel(PANELS.locationEdit('${LID}'),'locationEdit','${LID}')`);
ok(!!q(`#panel [data-lochours="${LID}|1|toggle"]`),'de lade toont de weekrijen niet');
q(`#panel [data-whperadd="${LID}|1"]`).click();
ok(E(`whList(locById('${LID}').hours[1]).length`)===2,'de lade voegt geen vak toe: '+H(1));
ok(!!E('panelMeta'),'de lade viel dicht door het hertekenen');
ok(qa(`#panel [data-whper^="${LID}|1|"]`).length===4,'de lade tekent de vakken niet bij');

console.log('— De medewerkerslade —');
E(`closePanel(true); go('settings'); state.settingsTab='employees'; render();`);
E(`state.empHours=null; openPanel(PANELS.employeeEdit('e2'),'employeeEdit','e2')`);
const eday=i=>q(`#panel [data-eday="${i}"]`);
ok(!!eday(0),'de lade toont de weekrijen niet');
ok(!!q('#panel [data-ep="1|0|0"]'),'er staat geen tijdveld op dinsdag');
ok(E('state.empHours[0]')===null,'e2 werkt toch op maandag — kies een andere dag');
ok(!q('#panel [data-epdel]'),'bij \u00e9\u00e9n vak staat er al een verwijderknop');
q('#panel [data-epadd="1"]').click();
ok(E('whList(state.empHours[1]).length')===2,'de lade voegt geen vak toe');
ok(qa('#panel [data-ep^="1|"]').length===4,'de lade tekent de vakken niet bij');
/* Dezelfde plek als op de instellingenpagina: rechts op de rij. */
const bEmp=q('#panel [data-epadd="1"]');
ok(bEmp&&bEmp.closest('.hoursrow').lastElementChild===bEmp,
  'in de lade staat de knop niet als laatste op de rij');
ok(bEmp&&bEmp.classList.contains('wh-add'),'de knop in de lade draagt de wh-add klasse niet');
/* Het klad schrijft nog niet door naar de medewerker. */
ok(E("whList(employees.find(e=>e.id==='e2').hours[1]).length")===1,
  'het klad schreef al naar de medewerker');
set(q('#panel [data-ep="1|0|1"]'),'12:00');
set(q('#panel [data-ep="1|1|0"]'),'16:00');
ok(E('whList(state.empHours[1])[0][1]')==='12:00','het klad hield de tijd niet vast');
ok(qa('#panel [data-ep^="1|"]').length===4,'de velden verdwenen na het typen');

console.log('— Opslaan zet het op de medewerker —');
E(`panelMeta.onSave()`);
ok(E("whList(employees.find(e=>e.id==='e2').hours[1]).length")===2,
  'de vakken kwamen niet op de medewerker: '+J("employees.find(e=>e.id==='e2').hours[1]"));
ok(J("employees.find(e=>e.id==='e2').hours[1]")==='[["09:00","12:00"],["16:00","19:00"]]',
  'de opgeslagen vakken kloppen niet: '+J("employees.find(e=>e.id==='e2').hours[1]"));

console.log('— Opslaan weigert overlap —');
E(`state.empHours=null; openPanel(PANELS.employeeEdit('e2'),'employeeEdit','e2')`);
set(q('#panel [data-ep="1|1|0"]'),'10:00');
ok(E(`panelMeta.onSave()`)===false,'overlap wordt gewoon opgeslagen');
ok(J("employees.find(e=>e.id==='e2').hours[1]")==='[["09:00","12:00"],["16:00","19:00"]]',
  'de medewerker werd toch overschreven');

console.log('— Het vinkje zet een dag aan en uit —');
E(`state.empHours=null; openPanel(PANELS.employeeEdit('e2'),'employeeEdit','e2')`);
const vink=eday(2);
const stond=E('whList(state.empHours[2]).length');
vink.checked=false; vink.dispatchEvent(new w.Event('change',{bubbles:true}));
ok(E('state.empHours[2]')===null,'de dag ging niet uit');
ok(!q('#panel [data-ep^="2|"]'),'de tijdvelden staan er nog op een vrije dag');
const vink2=eday(2);
vink2.checked=true; vink2.dispatchEvent(new w.Event('change',{bubbles:true}));
ok(E('whList(state.empHours[2]).length')===1,'de dag kwam niet terug op \u00e9\u00e9n vak');
ok(stond>0,'woensdag stond al uit voor de toets');

console.log('— De samenvatting noemt een gebroken week —');
ok(/split shifts/.test(E("availSummary({hours:{0:[['09:00','12:00'],['16:00','19:00']],6:null}})")),
  'een gebroken week wordt niet als zodanig gemeld');
ok(!/split shifts/.test(E("availSummary({hours:{0:[['09:00','19:00']],6:null}})")),
  'een gewone week wordt als gebroken gemeld');

console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
