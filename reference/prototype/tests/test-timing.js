/* test-timing.js — voorbereiden, behandelen, opruimen, en hoe lang
   iemand er zelf over doet.

   Vier dingen worden hier vastgehouden:
     1. de dienst draagt prep en reset, de agenda rekent ermee
     2. de behandeltijd hangt aan de medewerker, via zijn tempo
     3. varianten erven dat tempo zonder eigen steekproef
     4. de leerlus stopt nooit: goedgekeurd is niet eeuwig
*/
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
const SV=id=>`services.find(s=>s.id==='${id}')`;

/* Een maandag waarop Centar open is, en leeggemaakt zodat botsingen
   uit deze reeks komen en niet uit de voorbeeldgegevens. */
const MON=E("(function(){let v=TODAY;for(let i=0;i<9;i++){if(wdIdx(v)===0&&isOpenDate(v,'loc-centar'))return v;v=addDays(v,1)}return null})()");
ok(!!MON,'geen open maandag gevonden binnen negen dagen');
E(`appointments.filter(a=>a.date==='${MON}').forEach(a=>a.kind='cancelled')`);

console.log('— De dienst draagt zijn eigen randen —');
ok(J(`svcTiming(${SV('s1')},'loc-centar')`)==='{"prep":10,"reset":10}',
  's1 draagt geen 10/10: '+J(`svcTiming(${SV('s1')},'loc-centar')`));
ok(J(`svcTiming(${SV('s8')},'loc-centar')`)==='{"prep":5,"reset":15}',
  's8 draagt geen 5/15: '+J(`svcTiming(${SV('s8')},'loc-centar')`));
/* Wie niets instelt krijgt de oude BUFFER als opruimtijd terug \u2014 dat
   was de afspraak bij de overgang. */
ok(J(`svcTiming(${SV('s3')},'loc-centar')`)==='{"prep":0,"reset":10}',
  'een dienst zonder tijden valt niet terug op 0/10');
ok(E('typeof BUFFER')==='undefined','BUFFER staat er nog');

console.log('— De regel telt de drie bij elkaar op —');
const L=E(`svcLine(${SV('s1')},'loc-centar',null,[],null)`);
ok(L.treatmentMin===45,'behandeltijd is niet 45: '+L.treatmentMin);
ok(L.prepMin===10&&L.resetMin===10,'randen komen niet mee');
ok(L.operationalMin===65,'operationele duur is niet 65: '+L.operationalMin);
/* `duration` blijft de behandeltijd: dat is wat de klant koopt en wat
   op de bon komt. De agenda kijkt naar operationalMin. */
ok(L.duration===45,'duration is niet meer de behandeltijd: '+L.duration);
ok(L.basis==='catalog','zonder medewerker is de herkomst niet catalog: '+L.basis);

console.log('— De agenda rekent met het hele blok —');
const chk=(start,dur,emp,sid)=>E(`bookingCheck({locationId:'loc-centar',date:'${MON}',
  start:'${start}',dur:${dur},emp:'${emp}',sid:'${sid}'})`);
/* De eerste afspraak van een tijdvak heeft geen voorbereiding nodig: de
   ruimte is de avond ervoor opgeruimd en staat klaar. Om negen uur moet
   de zaak dus gewoon kunnen beginnen. */
ok(chk('09:00',45,'e1','s1')===null,'09:00 wordt geweigerd: '+chk('09:00',45,'e1','s1'));
ok(E(`clipPrep(10,540,scheduleFor('loc-centar','${MON}'))`)===0,
  'de voorbereiding wordt niet weggeknipt op openingstijd');
/* Geen drempel: vlak na openingstijd blijft staan wat er past. */
ok(E(`clipPrep(10,545,scheduleFor('loc-centar','${MON}'))`)===5,
  '09:05 knipt de voorbereiding niet af op vijf minuten');
ok(chk('09:05',45,'e1','s1')===null,'09:05 wordt geweigerd: '+chk('09:05',45,'e1','s1'));
/* Verderop op de dag geldt de volle voorbereiding weer. */
ok(E(`clipPrep(10,660,scheduleFor('loc-centar','${MON}'))`)===10,
  'later op de dag wordt de voorbereiding toch afgeknipt');
ok(chk('09:10',45,'e1','s1')===null,'09:10 wordt geweigerd: '+chk('09:10',45,'e1','s1'));
/* En aan het eind van de dag moet het opruimen er nog bij kunnen. */
ok(typeof chk('18:20',45,'e1','s1')==='string','18:20 wordt geboekt terwijl het opruimen na sluitingstijd valt');
ok(chk('18:00',45,'e1','s1')===null,'18:00 wordt geweigerd: '+chk('18:00',45,'e1','s1'));

console.log('— De eerste afspraak draagt geen voorbereiding —');
const eerst=E(`createAppointment({locationId:'loc-centar',date:'${MON}',start:'09:00',
  dur:45,emp:'e1',sid:'s1',name:'Eerste'})`);
ok(eerst.ok,'de afspraak op openingstijd lukte niet: '+(eerst.reason||''));
ok(E('appointments[appointments.length-1].prepMin')===0,
  'de afspraak op openingstijd legt toch voorbereiding vast');
ok(E("hhmm(apptFrom(appointments[appointments.length-1]))")==='09:00',
  'het blok begint voor openingstijd: '+E("hhmm(apptFrom(appointments[appointments.length-1]))"));
E('appointments[appointments.length-1].kind="cancelled"');

console.log('— Ook na een pauze in een gebroken dienst —');
/* Om 15:00 treft de therapeut een ruimte aan die om 13:00 is
   achtergelaten; ook dan hoeft er niet voorbereid te worden. */
E(`locById('loc-centar').hours[0]=[['09:00','13:00'],['15:00','19:00']]`);
ok(E(`clipPrep(10,900,scheduleFor('loc-centar','${MON}'))`)===0,
  'het tweede tijdvak knipt de voorbereiding niet weg');
ok(chk('15:00',45,'e1','s1')===null,'15:00 wordt geweigerd: '+chk('15:00',45,'e1','s1'));
ok(typeof chk('14:50',45,'e1','s1')==='string','een afspraak in de pauze wordt toegelaten');
E(`locById('loc-centar').hours[0]=[['09:00','19:00']]`);

console.log('— Twee blokken raken elkaar niet —');
const mk=(start,emp,sid,dur)=>E(`createAppointment({locationId:'loc-centar',date:'${MON}',
  start:'${start}',dur:${dur||45},emp:'${emp}',sid:'${sid}',name:'Toets'})`);
const r1=mk('11:00','e1','s1');
ok(r1.ok,'de eerste afspraak lukte niet: '+(r1.reason||''));
const a1=E('appointments[appointments.length-1]');
ok(a1.prepMin===10&&a1.resetMin===10,'de afspraak draagt de randen niet');
ok(E("hhmm(apptFrom(appointments[appointments.length-1]))")==='10:50',
  'het blok begint niet op 10:50: '+E("hhmm(apptFrom(appointments[appointments.length-1]))"));
ok(E("hhmm(apptTo(appointments[appointments.length-1]))")==='12:00',
  'het blok eindigt niet op 12:00: '+E("hhmm(apptTo(appointments[appointments.length-1]))"));
/* Direct erachter kan niet: het opruimen van de een en het klaarzetten
   van de ander vallen over elkaar. */
ok(typeof chk('11:55',45,'e1','s1')==='string','een afspraak in de opruimtijd wordt toegelaten');
ok(chk('12:10',45,'e1','s1')===null,'ruim erachter wordt geweigerd: '+chk('12:10',45,'e1','s1'));

console.log('— Een oude afspraak zonder randen krijgt ze alsnog —');
/* Anders zou de agenda ineens ruimer worden voor alles wat er al stond. */
E(`(function(){const a=appointments[appointments.length-1];delete a.prepMin;delete a.resetMin})()`);
ok(E("hhmm(apptFrom(appointments[appointments.length-1]))")==='10:50',
  'een afspraak zonder eigen randen valt niet terug op die van de dienst');

console.log('— Het tempo van de medewerker —');
/* Maria doet er structureel langer over: 45 wordt 50. */
ok(E(`effTreatment(${SV('s1')},'loc-centar',null,'e1').min`)===50,
  'het tempo van e1 komt niet uit op 50: '+E(`effTreatment(${SV('s1')},'loc-centar',null,'e1').min`));
ok(E(`effTreatment(${SV('s1')},'loc-centar',null,'e1').basis`)==='employee-pace',
  'de herkomst is niet employee-pace');
/* Zonder medewerker blijft het de catalogus. */
ok(E(`effTreatment(${SV('s1')},'loc-centar',null,null).min`)===45,'zonder medewerker wijkt de duur af');
ok(E(`effTreatment(${SV('s1')},'loc-centar',null,'any').min`)===45,'"any" krijgt geen catalogustijd');
/* Een goedgekeurde tijd gaat v\u00f3\u00f3r een tempo. */
ok(E(`effTreatment(${SV('s8')},'loc-centar',null,'e3').min`)===40,
  'de goedgekeurde 40 van e3 wordt niet gebruikt');
ok(E(`effTreatment(${SV('s8')},'loc-centar',null,'e3').basis`)==='employee-approved',
  'de herkomst van een goedgekeurde tijd klopt niet');

console.log('— Varianten erven de tijd zonder eigen steekproef —');
/* Dit is waarom het tempo bestaat: drie lengtes maal vijf mensen zou
   nooit genoeg waarnemingen opleveren. 40/45 op een variant van 90
   geeft 80. */
ok(E(`effTreatment(${SV('s8')},'loc-centar','v90','e3').min`)===80,
  'de variant van 90 erft de tijd niet: '+E(`effTreatment(${SV('s8')},'loc-centar','v90','e3').min`));
ok(E(`effTreatment(${SV('s8')},'loc-centar','v60','e3').min`)===55,
  'de variant van 60 erft de tijd niet: '+E(`effTreatment(${SV('s8')},'loc-centar','v60','e3').min`));
/* De randen schalen niet mee: dezelfde tafel, dezelfde wisbeurt. */
const v90=E(`svcLine(${SV('s8')},'loc-centar','v90',[],'e3')`);
ok(v90.prepMin===5&&v90.resetMin===15,'de randen veranderen mee met de lengte');
ok(v90.operationalMin===100,'de operationele duur van v90 klopt niet: '+v90.operationalMin);

console.log('— De afspraak legt vast wat beloofd was —');
const r2=mk('14:00','e1','s1');
ok(r2.ok,'de tweede afspraak lukte niet: '+(r2.reason||''));
const a2=E('appointments[appointments.length-1]');
/* Pas na het toewijzen is bekend wie het doet, dus pas dan de duur. */
ok(a2.duration===50,'de afspraak draagt niet de tijd van deze medewerker: '+a2.duration);
ok(a2.end==='14:50','het einde volgt de duur niet: '+a2.end);
ok(!!a2.quoted,'er is niets vastgelegd over wat beloofd was');
ok(a2.quoted.treatmentMin===50&&a2.quoted.basis==='employee-pace',
  'de offerte klopt niet: '+JSON.stringify(a2.quoted));

console.log('— Waarnemen uit de medewerkersapp —');
const obs=(id,van,tot)=>E(`(function(){
  const a=appointments.find(x=>x.id==='${id}');
  a.history=[{when:'${van}',what:TREAT_START,by:'t',source:'employee-app'},
             {when:'${tot}',what:TREAT_END,by:'t',source:'employee-app'}];
  return apptObserved(a);
})()`);
const o1=obs(a2.id,'2026-08-17 14:00','2026-08-17 14:52');
ok(o1&&o1.min===52,'de waarneming komt niet op 52 uit: '+JSON.stringify(o1));
ok(o1&&Math.abs(o1.ratio-52/50)<0.001,'de verhouding wordt niet tegen de offerte gerekend');
/* Onzin telt niet mee: wie vergeet te stoppen levert geen waarneming. */
ok(obs(a2.id,'2026-08-17 14:00','2026-08-17 17:30')===null,'een absurd lange meting telt mee');
ok(obs(a2.id,'2026-08-17 14:00','2026-08-17 14:05')===null,'een absurd korte meting telt mee');
ok(E(`(function(){
  const a=appointments.find(x=>x.id==='${a2.id}');
  a.history=[{when:'2026-08-17 14:00',what:TREAT_START,by:'t',source:'employee-app'}];
  return apptObserved(a);
})()`)===null,'een halve meting telt mee');

console.log('— De mediaan negeert uitschieters —');
ok(E('median([10,20,30])')===20,'mediaan van drie klopt niet');
ok(E('median([10,20,30,40])')===25,'mediaan van vier klopt niet');
ok(E('trim([10,11,12,13,900]).length')===4,'de uitschieter blijft staan');

console.log('— Het voorstel wordt afgezet tegen wat er nu geldt —');
/* Dit is de leerlus. Maria kreeg als beginner 60 minuten goedgekeurd
   voor s4 en draait nu structureel 49. Het voorstel hoort tegen die 60
   te staan, niet tegen de catalogus \u2014 anders zou een goedkeuring de
   waarheid voor altijd bevriezen. */
const et3=E("empTimings.find(t=>t.id==='et3')");
ok(et3.approvedMin===60,'et3 draagt geen goedgekeurde 60');
ok(E("currentTimingMin('e2','s4',null,null)")===60,
  'de agenda houdt de goedgekeurde 60 niet aan: '+E("currentTimingMin('e2','s4',null,null)"));
ok(et3.status==='suggested','er ligt geen nieuw voorstel ondanks tegenbewijs');
ok(et3.recommendedMin===50,'het voorstel is niet 50: '+et3.recommendedMin);
ok(E("timingSuggestions().length")>=1,'er staat niets op de stapel van de eigenaar');

console.log('— Aannemen verandert de agenda, afwijzen niet —');
ok(E("acceptTiming('et3','Toets')")===true,'het voorstel kon niet worden aangenomen');
ok(E("currentTimingMin('e2','s4',null,null)")===50,
  'na aannemen houdt de agenda de nieuwe tijd niet aan');
ok(E("empTimings.find(t=>t.id==='et3').status")==='approved','de stand blijft suggested');
ok(E("(auditLog[0]||{}).action")==='Timing approved','de goedkeuring staat niet in de audit');
ok(E(`effTreatment(${SV('s4')},'loc-centar',null,'e2').min`)===50,
  'de nieuwe tijd komt niet in de duurberekening terecht');

const et1=E("empTimings.find(t=>t.id==='et1')");
ok(et1.status==='suggested','et1 stond niet klaar als voorstel');
ok(E("dismissTiming('et1')")===true,'afwijzen lukte niet');
ok(E("empTimings.find(t=>t.id==='et1').status")==='dismissed','de stand werd niet dismissed');
ok(E("empTimings.find(t=>t.id==='et1').dismissedAtN")===18,
  'de steekproefgrootte werd niet onthouden bij afwijzen');
/* Afgewezen betekent niet vergeten: de agenda houdt de oude tijd aan,
   maar het tempo blijft bestaan tot de steekproef flink groeit. */
ok(E(`effTreatment(${SV('s1')},'loc-centar',null,'e1').min`)===50,
  'afwijzen zou de gemeten tijd niet mogen wissen');

console.log('— De kans in de agenda kent zijn eigen blok —');
const caps=E(`openCapacity('loc-centar','${MON}')`);
ok(Array.isArray(caps),'openCapacity gaf geen lijst');
const metBlok=caps.filter(c=>c.operationalMin);
ok(metBlok.length===caps.length,'niet elke kans draagt zijn operationele duur');
ok(caps.every(c=>c.operationalMin<=c.gap),'een kans past niet in zijn eigen gat');
ok(caps.every(c=>c.prepMin===undefined||mins(c.start)-c.prepMin>=0),'een kans begint voor middernacht');
function mins(t){const[h,m]=t.split(':').map(Number);return h*60+m}

console.log('— De catalogus laat de optelsom zien —');
E("go('catalog'); state.catTab='services'; render();");
E(`openPanel(PANELS.serviceEdit('s1'),'serviceEdit','s1'); state.edView='full'; renderPanel();`);
const pb=d.querySelector('#panel').textContent.replace(/\s+/g,' ');
ok(/Preparation time/.test(pb),'het veld voor voorbereiding ontbreekt');
ok(/Reset \/ cleanup time/.test(pb),'het veld voor opruimen ontbreekt');
ok(/65 min/.test(pb),'de operationele duur van 65 staat er niet');
ok(!!q('#panel [data-inline="s1|prepMin"]'),'het veld prepMin is niet bewerkbaar');
ok(!!q('#panel [data-inline="s1|resetMin"]'),'het veld resetMin is niet bewerkbaar');

console.log('— De varianttabel toont wat de agenda kwijt is —');
E(`closePanel(true); openPanel(PANELS.serviceEdit('s8'),'serviceEdit','s8'); state.edView='full'; renderPanel();`);
const vb=d.querySelector('#panel').textContent.replace(/\s+/g,' ');
ok(/In the calendar/.test(vb),'de kolom "In the calendar" ontbreekt');
/* 45 + 5 + 15 = 65, 90 + 20 = 110 */
ok(/65 min/.test(vb),'de kortste lengte telt niet op naar 65');
ok(/110 min/.test(vb),'de langste lengte telt niet op naar 110');

console.log('— De medewerkerslade toont en beslist —');
E(`closePanel(true); go('settings'); state.settingsTab='employees'; render();`);
E(`state.empHours=null; openPanel(PANELS.employeeEdit('e1'),'employeeEdit','e1'); state.edView='full'; renderPanel();`);
const eb=d.querySelector('#panel').textContent.replace(/\s+/g,' ');
ok(/Timing/.test(eb),'de sectie Timing ontbreekt in de medewerkerslade');
ok(/Catalog/.test(eb)&&/In use/.test(eb),'de kolommen catalogus en in gebruik ontbreken');
/* Het tempo is rekenwerk en hoort niet in beeld. */
ok(!/[Pp]ace factor/.test(eb),'het tempo staat in de taal van de eigenaar');
ok(!/1\.13/.test(eb),'de tempofactor staat letterlijk in beeld');

console.log('— De stapel van de eigenaar —');
E(`closePanel(true); go('reports'); state.reportTab='timing'; render();`);
const tb=d.querySelector('#view').textContent.replace(/\s+/g,' ');
ok(/Timing insights/.test(tb),'de tab Timing insights ontbreekt');
ok(/never changes a duration by itself/.test(tb)||/never changes/.test(tb)
  ||/enough evidence/.test(tb),
  'de belofte dat Velnes niets zelf verandert ontbreekt');

console.log('— De medewerkersapp meet —');
E(`go('mobile'); state.mobileUser='e1'; state.mobileTab='agenda'; render();`);
const start=q('[data-motreat$="|start"]');
ok(!!start,'er staat geen knop om een behandeling te beginnen');
const aid=start.dataset.motreat.split('|')[0];
start.click();
ok(E(`!!evAt(appointments.find(a=>a.id==='${aid}'),TREAT_START)`),'het beginmoment werd niet vastgelegd');
ok(E(`appointments.find(a=>a.id==='${aid}').status`)==='in-treatment','de stand werd niet bijgewerkt');
ok(!!q(`[data-motreat="${aid}|end"]`),'er staat geen knop om te stoppen');
q(`[data-motreat="${aid}|end"]`).click();
ok(E(`!!evAt(appointments.find(a=>a.id==='${aid}'),TREAT_END)`),'het eindmoment werd niet vastgelegd');
ok(E(`appointments.find(a=>a.id==='${aid}').status`)==='completed','de afspraak staat niet op completed');
ok(!!q(`[data-mocheckout="${aid}"]`),'afrekenen komt niet in beeld na afloop');
/* De twee momenten staan in de geschiedenis die de afspraak al had. */
ok(E(`appointments.find(a=>a.id==='${aid}').history.filter(h=>h.source==='employee-app').length`)===2,
  'de twee momenten staan niet in de historie');

console.log('— De schakelaar in de instellingen —');
E("go('settings'); state.settingsTab='calendar'; state.hoursTab='regular'; render();");
const sw=()=>q('[data-timingswitch]');
ok(!!sw(),'de schakelaar staat niet bij de openingstijden');
ok(E('timingOn()')===true,'de rekenwijze staat niet standaard aan');
ok(sw().classList.contains('on'),'de schakelaar staat niet aan');
/* De uitleg hoort erbij te staan: dit verandert wat er geboekt kan worden. */
const uitleg=q('#view').textContent.replace(/\s+/g,' ');
ok(/preparation \+ treatment \+ cleanup/i.test(uitleg),'de optelsom wordt niet uitgelegd');
ok(/With it on/.test(uitleg)&&/With it off/.test(uitleg),'aan en uit worden niet allebei uitgelegd');
ok(/back to back/.test(uitleg),'er staat niet bij dat afspraken zonder tussenruimte komen');
ok(/keeps measuring/.test(uitleg),'er staat niet bij dat Velnes blijft meten');

console.log('— Uitzetten zet het overal uit —');
sw().click();
ok(E('timingOn()')===false,'de schakelaar zette niets om');
ok(J(`svcTiming(${SV('s1')},'loc-centar')`)==='{"prep":0,"reset":0}',
  'de randen tellen nog mee terwijl het uit staat');
ok(E(`svcLine(${SV('s1')},'loc-centar',null,[],'e1').duration`)===45,
  'het tempo telt nog mee terwijl het uit staat');
ok(E(`svcLine(${SV('s1')},'loc-centar',null,[],'e1').operationalMin`)===45,
  'de operationele duur is niet gelijk aan de behandeling');
ok(E(`effTreatment(${SV('s8')},'loc-centar',null,'e3').basis`)==='catalog',
  'een goedgekeurde tijd telt nog mee terwijl het uit staat');
/* Uit betekent: rug aan rug, precies de behandeltijd. */
E(`appointments.filter(a=>a.date==='${MON}').forEach(a=>a.kind='cancelled')`);
const uitR=E(`createAppointment({locationId:'loc-centar',date:'${MON}',start:'10:00',
  dur:45,emp:'e1',sid:'s1',name:'Uit'})`);
ok(uitR.ok,'boeken lukt niet met de schakelaar uit: '+(uitR.reason||''));
ok(E('appointments[appointments.length-1].duration')===45,'de duur volgt niet de catalogus');
ok(E("hhmm(apptFrom(appointments[appointments.length-1]))")==='10:00','er wordt toch voorbereid');
ok(E("hhmm(apptTo(appointments[appointments.length-1]))")==='10:45','er wordt toch opgeruimd');
ok(chk('10:45',45,'e1','s1')===null,'rug aan rug boeken lukt niet: '+chk('10:45',45,'e1','s1'));

console.log('— En de schermen laten het merken —');
E("go('catalog'); state.catTab='services'; render();");
E(`openPanel(PANELS.serviceEdit('s1'),'serviceEdit','s1'); state.edView='full'; renderPanel();`);
const uitPanel=d.querySelector('#panel').textContent.replace(/\s+/g,' ');
ok(!q('#panel [data-inline="s1|prepMin"]'),'het veld voor voorbereiding staat er nog');
ok(/switched off/.test(uitPanel),'de dienst legt niet uit waarom de velden weg zijn');
E(`closePanel(true); go('settings'); state.settingsTab='employees'; render();`);
E(`state.empHours=null; openPanel(PANELS.employeeEdit('e1'),'employeeEdit','e1'); state.edView='full'; renderPanel();`);
ok(!/Catalog In use Seen/.test(d.querySelector('#panel').textContent.replace(/\s+/g,' ')),
  'de tabel met tijden staat er nog terwijl het uit staat');
E(`closePanel(true); go('reports'); state.reportTab='timing'; render();`);
ok(/Paused/.test(d.querySelector('#view').textContent),'de stapel meldt niet dat hij stilligt');

console.log('— Meten gaat door, zodat het bewijs er ligt —');
/* Dit is de belofte uit de instelling: uit betekent niet blind. */
const meetId=E('appointments[appointments.length-1].id');
ok(E(`(function(){
  const a=appointments.find(x=>x.id==='${meetId}');
  a.history=[{when:'2026-08-17 10:00',what:TREAT_START,by:'t',source:'employee-app'},
             {when:'2026-08-17 10:52',what:TREAT_END,by:'t',source:'employee-app'}];
  return !!apptObserved(a);
})()`)===true,'er wordt niet meer gemeten terwijl de schakelaar uit staat');

console.log('— Weer aanzetten herstelt alles —');
E("go('settings'); state.settingsTab='calendar'; state.hoursTab='regular'; render();");
sw().click();
ok(E('timingOn()')===true,'de schakelaar ging niet terug aan');
ok(J(`svcTiming(${SV('s1')},'loc-centar')`)==='{"prep":10,"reset":10}','de randen komen niet terug');
ok(E(`svcLine(${SV('s1')},'loc-centar',null,[],'e1').duration`)===50,'het tempo komt niet terug');
ok(E("(auditLog[0]||{}).action")==='Scheduling changed','het omzetten staat niet in de audit');

console.log('— Herrekenen is idempotent —');
const n1=E('recomputeAllTimings()');
const n2=E('recomputeAllTimings()');
ok(n1===n2,'twee keer herrekenen geeft een ander antwoord: '+n1+' vs '+n2);

console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
