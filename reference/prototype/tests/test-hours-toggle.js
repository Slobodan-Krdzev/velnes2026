/* test-hours-toggle.js — de dagschakelaar van de vaste week.

   Dezelfde rij wordt op twee plekken getekend: Settings › Opening hours ›
   Regular hours (een pagina) en de vestigingslade (een paneel). De
   handler tekende alleen het paneel opnieuw, en renderPanel() stapt er
   meteen uit als er geen lade openstaat — op de instellingenpagina sloeg
   de schakelaar dus wel om in de gegevens, maar het scherm bleef staan.
   Deze reeks houdt beide oppervlakken vast. */
const {JSDOM}=require('jsdom');
const fs=require('fs'),path=require('path');
const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),
  {runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document;
let pass=0,fail=0;
const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL  '+m))};
const q=s=>d.querySelector(s), qa=s=>[...d.querySelectorAll(s)];
const E=x=>w.eval(x);

const LID='loc-centar';
const tog=(i,scope)=>q(`${scope||''} [data-lochours="${LID}|${i}|toggle"]`);
/* De tijdvelden hangen aan data-whper: een dag kan meer dan een vak
   dragen, dus staat het vaknummer in de sleutel. */
const times=(i,scope)=>qa(`${scope||''} [data-whper^="${LID}|${i}|"]`)
  .filter(x=>x.tagName==='INPUT'&&x.type==='time');
const hours=i=>E(`locById('${LID}').hours[${i}]`);

console.log('— Settings › Opening hours › Regular hours —');
E(`go('settings'); state.settingsTab='calendar'; state.hoursTab='regular'; state.hoursLoc='${LID}'; render();`);
ok(!!tog(0),'de maandagrij staat er niet');
ok(!E('panelMeta'),'er staat een lade open — dan toetsen we het verkeerde geval');
ok(tog(0).classList.contains('on'),'maandag staat niet aan bij binnenkomst');
ok(times(0).length===2,'maandag toont geen twee tijden: '+times(0).length);

console.log('— Uitzetten op de pagina —');
tog(0).click();
ok(hours(0)===null,'de gegevens gingen niet dicht');
ok(!!tog(0),'de rij verdween na het omzetten');
/* Dit is de eigenlijke fout: de gegevens klopten al, het scherm niet. */
ok(!tog(0).classList.contains('on'),'de schakelaar staat nog aan — het scherm is niet hertekend');
ok(times(0).length===0,'de tijdvelden staan er nog op een gesloten dag');
ok(/Closed/.test(tog(0).closest('.hoursrow').textContent),'de rij zegt niet Closed');

console.log('— Weer aanzetten —');
tog(0).click();
ok(!!hours(0),'de dag ging niet weer open');
ok(tog(0).classList.contains('on'),'de schakelaar staat niet aan na aanzetten');
ok(times(0).length===2,'de tijdvelden komen niet terug: '+times(0).length);
ok(times(0)[0].value==='09:00'&&times(0)[1].value==='19:00',
  'een heropende dag begint niet op 09:00–19:00: '+times(0).map(x=>x.value).join('–'));

console.log('— De boekingspoort volgt de schakelaar —');
/* Niet alleen het scherm: dichtzetten hoort een boeking te weigeren.
   Dinsdag, want maandag is hierboven al heen en weer gezet. */
const TUE=E(`(function(){let v=TODAY;for(let i=0;i<8;i++){if(wdIdx(v)===1)return v;v=addDays(v,1)}return null})()`);
ok(!!TUE,'geen dinsdag gevonden binnen een week');
ok(E(`scheduleFor('${LID}','${TUE}').open`)===true,'dinsdag stond al dicht');
tog(1).click();
ok(E(`scheduleFor('${LID}','${TUE}').open`)===false,'de dag dichtzetten sluit de boekingspoort niet');
ok(E(`scheduleFor('${LID}','${TUE}').periods.length`)===0,'een gesloten dag houdt tijdvakken over');
tog(1).click();
ok(E(`scheduleFor('${LID}','${TUE}').open`)===true,'weer openzetten opent de poort niet');

console.log('— De audit legt het vast —');
ok(E(`(auditLog[0]||{}).action`)==='Opening hours changed',
  'de wijziging staat niet bovenaan de audit: '+E(`(auditLog[0]||{}).action`));

console.log('— Dezelfde rij in de vestigingslade —');
E(`go('settings'); openPanel(PANELS.locationEdit('${LID}'),'locationEdit','${LID}')`);
ok(!!E('panelMeta'),'de vestigingslade ging niet open');
ok(!!tog(2,'#panel'),'de woensdagrij staat niet in de lade');
ok(hours(2)!==null,'woensdag stond al dicht');
tog(2,'#panel').click();
ok(hours(2)===null,'de lade zette de dag niet dicht');
ok(!!E('panelMeta'),'de lade viel dicht door het hertekenen');
ok(!!tog(2,'#panel'),'de rij verdween uit de lade');
ok(!tog(2,'#panel').classList.contains('on'),'de schakelaar in de lade staat nog aan');
ok(times(2,'#panel').length===0,'de lade toont nog tijden op een gesloten dag');
tog(2,'#panel').click();
ok(!!hours(2),'de lade zette de dag niet terug open');
ok(tog(2,'#panel').classList.contains('on'),'de schakelaar in de lade komt niet terug');

console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
