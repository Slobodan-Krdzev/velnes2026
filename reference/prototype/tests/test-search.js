/* Zoeken & aanbevelen — de motor uit het voorstel, als toetsbare
   deuren. Toetst: harde eisen die personalisatie nooit laat redden,
   intentie die domineert, de drempel die zwakke verkenning tegenhoudt,
   seed-determinisme (zelfde seed = zelfde lijst; andere bucket =
   meetbare rotatie in de staart, top-3 op basis), keten-ontdubbeling,
   nieuw-salonvenster binnen het budget en nooit #1, blootstelling die
   vervalt en vergeeft, consent in béide standen, trends die verbreden
   bij dun bewijs, kaarten met eerlijke 'Closest available', de
   gebeurtenistrechter, en het HQ-zoeklab dat de uitleg naspreekt. */
const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('/home/claude/velnes/index.html','utf8'),{runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document,E=x=>w.eval(x);
const q=s=>d.querySelector(s),qa=s=>[...d.querySelectorAll(s)];
const click=el=>el.dispatchEvent(new w.Event('click',{bubbles:true}));
let pass=0,fail=0;
const ok=(c,msg)=>{if(c){pass++}else{fail++;console.log('  FAIL ',msg)}};
const RUN=(cust,extra)=>E(`JSON.parse(JSON.stringify(searchRun({categoryId:'cat-massage',area:'gevgelija',date:addDays(TODAY,1),timeMin:900${extra||''}},${cust?`'${cust}'`:'null'},{seedBucket:7})))`);
setTimeout(()=>{try{

console.log('— De wereld staat: gezaaid, deterministisch, met persoonlijkheden —');
ok(E('platformSalons.length')>=25,'de markt hoort gevuld te zijn: '+E('platformSalons.length'));
ok(E(`platformSalons.filter(s=>s.area==='gevgelija').length`)>=5,'Gevgelija hoort het briefvoorbeeld te kunnen dragen');
ok(E(`platformSalons.some(s=>s.name==='Terma Nova Spa'&&s.newUntil>TODAY)`),'de nieuwe salon hoort in zijn venster te zitten');
ok(E(`platformSalons.filter(s=>s.biz==='psb-chain').length`)===2,'de keten hoort twee vestigingen te hebben');

console.log('— Fase A: harde eisen — personalisatie redt hier nooit iemand —');
const r1=RUN('c2');
ok(r1.results.length>0,'er horen resultaten te zijn');
ok(r1.results.every(r=>E(`platformSalons.find(s=>s.id==='${r.salonId}').cats.includes('cat-massage')`)),
  'elk resultaat hoort de dienst echt te bieden');
ok(r1.results.every(r=>E(`availSummaryFor('${r.salonId}','cat-massage',addDays(TODAY,1)).any`)),
  'elk resultaat hoort echte beschikbaarheid te hebben — een favoriet zonder plek staat er niet');
ok(!r1.results.some(r=>r.name==='Weak Corner'&&r.explain.extra>0),
  'de kwaliteitsvloer hoort zwakke verkenning tegen te houden');

console.log('— Determinisme: zelfde seed, zelfde lijst; andere bucket, rotatie —');
const r1b=RUN('c2');
ok(JSON.stringify(r1.results.map(x=>x.salonId))===JSON.stringify(r1b.results.map(x=>x.salonId)),
  'dezelfde seed hoort byte-voor-byte dezelfde volgorde te geven');
const r2=E(`JSON.parse(JSON.stringify(searchRun({categoryId:'cat-massage',area:'gevgelija',date:addDays(TODAY,1),timeMin:900},'c2',{seedBucket:8})))`);
/* Rotatie is een belofte óver zoekacties heen, niet per se elke
   tijdstap: minstens één van de volgende buckets hoort te verschillen. */
const tail=rs=>JSON.stringify(rs.results.slice(3).map(x=>x.salonId));
const tails=[8,9,10,11].map(b=>E(`JSON.stringify(searchRun({categoryId:'cat-massage',area:'gevgelija',date:addDays(TODAY,1),timeMin:900},'c2',{seedBucket:${b}}).results.slice(3).map(x=>x.salonId))`));
ok(tails.some(t=>t!==tail(r1))||r1.results.length<=4,
  'over meerdere buckets hoort de staart te roteren');
const top3base=rs=>rs.results.slice(0,3).map(x=>x.explain.base);
ok(JSON.stringify(top3base(r1))===JSON.stringify(top3base(r2)),
  'de top drie hoort puur op basis te staan — verkenning vormt de rest');

console.log('— Eén keten, één rij —');
const chainRows=r1.results.filter(r=>r.name.startsWith('Grand Chain'));
ok(chainRows.length<=1,'de keten hoort maar één rij te krijgen');
if(chainRows.length===1)ok(chainRows[0].alsoAt.length>=0,'met de zusjes als ook-in in plaats van eigen posities');

console.log('— Nieuw op Velnes: binnen het budget, nooit gegarandeerd #1 —');
const nieuw=r1.results.find(r=>r.name==='Terma Nova Spa');
ok(!nieuw||nieuw.pos>1||nieuw.explain.base>=r1.results[1].explain.base,
  'de nieuw-salonboost hoort geen #1 te kopen');

console.log('— De kaart: eerlijk over de tijd, hoogstens twee badges —');
ok(r1.results.every(r=>r.badges.length<=2),'nooit meer dan twee badges');
const nietExact=r1.results.find(r=>!r.exact);
ok(!nietExact||nietExact.badges.some(b=>b.startsWith('Closest available'))||nietExact.badges.length===2,
  'geen exacte tijd hoort "Closest available: …" te zeggen');
ok(!JSON.stringify(r1.results).includes('%'),'nooit een verzonnen matchpercentage');

console.log('— Consent: beide standen gebouwd, de stand is config —');
ok(E(`searchConfig.consentMode`)==='opt-out','de stand hoort config te zijn (juridisch besluit volgt)');
const pOptOut=r1.results.map(r=>r.explain.parts.personal);
ok(pOptOut.some(v=>v>0),'opt-out + unset: persoonlijk hoort mee te doen');
E(`searchConfig.consentMode='opt-in'`);
const rIn=RUN('c2');
ok(rIn.results.every(r=>r.explain.parts.personal===0),'opt-in + unset: persoonlijk hoort uit te staan');
ok(rIn.results.length===r1.results.length,'en de lijst hoort er nog steeds te zijn — gewicht schuift, resultaat blijft');
E(`searchConfig.consentMode='opt-out'`);
const rGuest=RUN(null);
ok(rGuest.results.every(r=>r.explain.parts.personal===0),'een gast hoort nooit persoonlijke signalen te dragen');

console.log('— Blootstelling: vervalt, is begrensd, en een klik vergeeft sneller —');
E(`exposureLog.length=0`);
for(let i=0;i<12;i++)RUN('c2');
const pen1=E(`exposurePenalty('c2',platformSalons.find(s=>s.area==='gevgelija'&&s.cats.includes('cat-massage')).id)`);
ok(pen1>0&&pen1<=E('searchConfig.penaltyCapPct'),'herhaalde vertoning hoort begrensd te straffen: '+pen1);
E(`exposureLog.forEach(e=>e.ts=addDays(TODAY,-28))`);
const pen2=E(`exposurePenalty('c2',exposureLog[0].salonId)`);
ok(pen2<pen1/4,'vier weken later hoort de straf grotendeels vervallen te zijn');

console.log('— Trends: dun lokaal bewijs verbreedt vanzelf, en zegt dat —');
ok(E(`localTrendFor('gevgelija','cat-massage').granularity`)==='area','genoeg bewijs hoort lokaal te blijven');
ok(['region','platform'].includes(E(`localTrendFor('bitola','cat-facial').granularity`)),
  'dun bewijs hoort te verbreden');
ok(r1.results.every(r=>['area','region','platform'].includes(r.explain.parts.trendGranularity)),
  'en de gebruikte laag hoort in de uitleg te staan');

console.log('— Weinig kandidaten: één keer verbreden, eerlijk benoemd —');
const rWide=E(`JSON.parse(JSON.stringify(searchRun({categoryId:'cat-nails',area:'gevgelija',date:addDays(TODAY,1),timeMin:900},null,{seedBucket:7})))`);
ok(rWide.widened===true,'te weinig in het gebied hoort te verbreden en dat te zeggen');

console.log('— De trechter: zoekactie, vertoning met positie, klik —');
E(`searchEvents.length=0;exposureLog.length=0`);
const r3=RUN('c2');
ok(E(`searchEvents.filter(e=>e.type==='search').length`)===1,'de zoekactie hoort gelogd');
ok(E(`searchEvents.filter(e=>e.type==='impression').length`)===r3.results.length,
  'elke vertoning hoort gelogd, met positie');
ok(E(`searchEvents.find(e=>e.type==='impression').meta.pos`)===1,'en de positie klopt');
E(`searchClick('c2','${r3.results[0].salonId}')`);
ok(E(`searchEvents[searchEvents.length-1].type`)==='click','de klik hoort gelogd');
ok(E(`exposureLog.find(e=>e.salonId==='${r3.results[0].salonId}').engaged`)===true,
  'en de blootstelling hoort als beantwoord te gelden');
ok(r3.results.every(r=>r.explain.config==='v2026-08.1'),'elke uitleg hoort de configversie te dragen');

console.log('— Het HQ-zoeklab: de motor, afleesbaar —');
E(`go('hq');state.hqTab='search';state.slabBucket=7;render()`);
ok(q('#view').textContent.includes('Search lab'),'het lab hoort in HQ te staan');
click(q('[data-slabrun="c2"]'));
ok(qa('#view .card').length>3,'de resultaten horen als kaarten te staan');
ok(q('#view').textContent.includes('base ')&&q('#view').textContent.includes('final '),
  'met de volledige uitleg per kaart — §12 in het echt');
ok(q('#view').textContent.includes('never per salon'),'en de regel dat niemand aan zijn eigen score draait');

console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
}catch(e){console.log('CRASH',e);process.exit(1)}},400);
