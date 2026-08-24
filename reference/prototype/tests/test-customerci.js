/* test-customerci.js — Customer Intelligence.

   Eén deurfamilie (custStats), gezaaide deterministische historie, een
   sorteerpil naast de filters, een uitgebouwde klantpagina met trends,
   suggesties, inklapbare grafieken, AI-modus en gebladerde historie,
   en de brug naar de aanbiedingslade (SPECIFIC_CUSTOMERS).

   De zaaier gebruikt een vaste LCG, dus exacte aantallen zijn hier
   toetsbaar. Ivana (c2) en Elena (c6) zijn met opzet claimloos en
   leeg: drempels horen te zwijgen zonder bewijs. */
const {JSDOM}=require('jsdom');
const fs=require('fs'),path=require('path');
const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),
  {runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document;
let pass=0,fail=0;
const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL  '+m))};
const q=s=>d.querySelector(s), qa=s=>[...d.querySelectorAll(s)];
const E=x=>w.eval(x);

setTimeout(()=>{
try{

console.log('— custStats: de zaaier levert wat de regels nodig hebben —');
const s4=E(`custStats('c4')`);
ok(s4.seeded===true,'c4 hoort gezaaid te zijn');
ok(s4.totals.visits===98,'c4 bezoeken: verwacht 98, kreeg '+s4.totals.visits);
ok(s4.totals.spend===268800,'c4 besteding: verwacht 268800, kreeg '+s4.totals.spend);
ok(s4.totals.avgSpend===Math.round(268800/98),'c4 gemiddelde per bezoek klopt niet');
ok(s4.cadence.steady===true,'c4 hoort een vast ritme te hebben');
ok(s4.cadence.medianGapDays===14,'c4 mediaan: verwacht 14, kreeg '+s4.cadence.medianGapDays);
ok(s4.cadence.trend==='up','c4 trend hoort omhoog te zijn: '+s4.cadence.trend);
ok(s4.overdueDays===null,'c4 is niet over tijd en mag dat ook niet lijken');
ok(s4.employees[0].empId==='e1'&&s4.employees[0].pct===80,
  'c4 topmedewerker hoort e1 op 80% te zijn: '+JSON.stringify(s4.employees[0]));
ok(s4.favoriteService&&s4.favoriteService.sid==='s2','c4 favoriete dienst hoort s2 te zijn');
ok(s4.favoriteProduct&&s4.favoriteProduct.pid==='p2','c4 favoriete product hoort p2 te zijn');
ok(s4.lapsedServices.length===1&&s4.lapsedServices[0].sid==='s5',
  'c4 hoort precies s5 als weggezakte dienst te dragen');
ok(!!s4.firstVisit&&!!s4.lastVisit,'eerste en laatste bezoek horen er te zijn');
ok(s4.firstVisit.date<s4.lastVisit.date,'eerste bezoek hoort voor het laatste te liggen');
ok(s4.firstVisit.rows.length>=1&&s4.firstVisit.rows[0].empName!=='—',
  'bezoekdetails horen dienst en medewerker te dragen');
ok(s4.lastVisit.amount===s4.lastVisit.rows.reduce((n,r)=>n+r.amount,0),
  'bezoektotaal hoort de som van de regels te zijn');
/* Bezoeken zijn dagen, niet regels: taping reed mee op dezelfde dag. */
ok(E(`custDone('c4').length`)>s4.totals.visits,
  'meer regels dan bezoeken: twee behandelingen in één zit zijn één bezoek');

console.log('— Katerina: ritme met achterstand —');
const s1=E(`custStats('c1')`);
ok(s1.totals.visits===38,'c1 bezoeken: verwacht 38, kreeg '+s1.totals.visits);
ok(s1.cadence.steady===true,'c1 hoort een vast ritme te hebben');
ok(s1.cadence.medianGapDays===35,'c1 mediaan: verwacht 35, kreeg '+s1.cadence.medianGapDays);
ok(s1.overdueDays===17,'c1 achterstand: verwacht 17 dagen, kreeg '+s1.overdueDays);
ok(s1.cadence.trend==='flat','c1 trend hoort vlak te zijn');

console.log('— Drempels zwijgen zonder bewijs —');
const s2=E(`custStats('c2')`);
ok(s2.totals.visits===21,'c2 bezoeken: verwacht 21, kreeg '+s2.totals.visits);
ok(s2.cadence.steady===false,'c2 mag geen ritme claimen: de spreiding is te groot');
ok(E(`custTrends('c2').length`)===0,'c2 hoort nul trends te dragen');
ok(E(`custSuggestions('c2').length`)===0,'c2 hoort nul suggesties te dragen');
const s6=E(`custStats('c6')`);
ok(s6.seeded===false,'c6 hoort op de vastgelegde velden terug te vallen');
ok(s6.totals.visits===1&&s6.totals.spend===1700,'c6 val-terug klopt niet');
ok(E(`custTrends('c6').length`)===0&&E(`custSuggestions('c6').length`)===0,
  'zonder historie horen trends en suggesties leeg te zijn');
ok(E(`aiAnalysis('c6')[0]`).includes("isn't enough"),
  'de AI-tekst hoort eerlijk te zeggen dat er te weinig historie is');

console.log('— Trends dragen hun eigen waarom —');
const tr4=E(`custTrends('c4')`);
ok(tr4.length===6,'c4 hoort 6 trends te dragen, kreeg '+tr4.length+': '+tr4.map(t=>t.id));
['cadence','weekday','daypart','employee','lapsed-s5','trend'].forEach(id=>
  ok(tr4.some(t=>t.id===id),'c4 mist trend '+id));
ok(tr4.every(t=>t.why&&t.why.length>10),'elke trend hoort een waarom te dragen');
ok(tr4.find(t=>t.id==='weekday').text.includes('Friday'),'de weekdagtrend hoort vrijdag te noemen');
const tr1=E(`custTrends('c1')`);
ok(tr1.length===2&&tr1.some(t=>t.id==='cadence')&&tr1.some(t=>t.id==='employee'),
  'c1 hoort precies ritme en medewerker te claimen: '+tr1.map(t=>t.id));

console.log('— Suggesties: alleen persoonlijke aanbiedingen —');
const sg4=E(`custSuggestions('c4')`);
ok(sg4.length===2,'c4 hoort precies pattern en winback te dragen: '+sg4.map(s=>s.id));
ok(sg4.every(s=>s.action&&s.action.kind==='personal_offer'),
  'elke suggestieactie hoort personal_offer te zijn');
ok(sg4.find(s=>s.id==='pattern').action.intent==='pattern','de patroonsuggestie mist zijn intent');
ok(sg4.find(s=>s.id==='winback').action.params.sid==='s5',
  'de winback hoort de weggezakte dienst in params te dragen');
ok(!sg4.some(s=>s.id==='birthday')&&!sg4.some(s=>s.id==='hivalue'),
  'verjaardag en hoge-besteding zijn geschrapt en horen te zwijgen');
ok(sg4.find(s=>s.id==='pattern').text.includes('Favorite service'),
  'de suggestie hoort de favoriete dienst te noemen');
const sg1=E(`custSuggestions('c1')`);
ok(sg1.length===1&&sg1[0].id==='overdue','c1 hoort alleen de terugkeerkans te dragen');
ok(sg1[0].action&&sg1[0].action.intent==='comeback',
  'de terugkeerkans hoort nu een aanbiedingsactie te dragen');
ok(sg1[0].why.includes('35'),'het waarom hoort de mediaan te noemen');

console.log('— Historie, gebladerd —');
const pg0=E(`custHistoryPage('c4',0)`);
ok(pg0.rows.length===15,'pagina 0 hoort 15 regels te dragen: '+pg0.rows.length);
ok(pg0.hasMore===true,'er hoort meer te zijn na pagina 0');
ok(pg0.total===123,'c4 totaal: verwacht 123 regels, kreeg '+pg0.total);
ok(pg0.rows[0].date>=pg0.rows[14].date,'de historie hoort nieuwste eerst te staan');
const pgLast=E(`custHistoryPage('c4',99)`);
ok(pgLast.rows.length===123&&pgLast.hasMore===false,'de laatste pagina hoort alles te dragen zonder meer-knop');
ok(E(`custHistoryRows('c4').some(a=>a.status==='cancelled')`),
  'afzeggingen horen zichtbaar te blijven in de historie');
ok(E(`custDone('c4').every(a=>a.status==='completed')`),
  'afzeggingen mogen nergens in de cijfers meewegen');

console.log('— Sorteerpil: eigen pil, filters onaangeroerd —');
E(`go('customers')`);
ok(!!q('[data-sortmenu]'),'de sorteerpil staat er niet');
ok(!!q('[data-filters]'),'de filterpil hoort te blijven staan');
const orderBefore=qa('tbody tr [data-goprofile]').map(b=>b.dataset.goprofile).join(',');
q('[data-sortmenu]').click();
ok(qa('[data-custsort]').length===5,'de eigenaar hoort 5 sorteeropties te zien: '+qa('[data-custsort]').length);
q('[data-custsort="visitsDesc"]').click();
let order=qa('tbody tr [data-goprofile]').map(b=>b.dataset.goprofile);
ok(order[0]==='c4','meeste bezoeken hoort Marija bovenaan te zetten: '+order[0]);
q('[data-sortmenu]').click();q('[data-custsort="visitsAsc"]').click();
order=qa('tbody tr [data-goprofile]').map(b=>b.dataset.goprofile);
ok(order[0]==='c6','minste bezoeken hoort Elena bovenaan te zetten: '+order[0]);
q('[data-sortmenu]').click();q('[data-custsort="spendDesc"]').click();
order=qa('tbody tr [data-goprofile]').map(b=>b.dataset.goprofile);
ok(order[0]==='c4','hoogste besteding hoort Marija bovenaan te zetten: '+order[0]);
q('[data-sortmenu]').click();q('[data-custsort="default"]').click();
ok(qa('tbody tr [data-goprofile]').map(b=>b.dataset.goprofile).join(',')===orderBefore,
  'Default hoort de vaste volgorde terug te geven');
/* De lijst draagt de afgeleide cijfers, niet de vastgelegde. */
ok(q('#view').textContent.includes('98'),'de lijst hoort de afgeleide 98 bezoeken van Marija te tonen');

console.log('— Terugkeeretiketten: alleen met bewezen ritme —');
ok(E(`custRetention('c4')`)==='returning','Marija hoort Returning te zijn (ritme, niet over tijd)');
ok(E(`custRetention('c1')`)==='at_risk','Katerina hoort At-risk te zijn (ritme, 17 dagen over tijd)');
ok(E(`custRetention('c2')`)===null,'Ivana hoort géén etiket te dragen: geen bewezen ritme');
ok(E(`custRetention('c6')`)===null,'zonder historie hoort er geen etiket te zijn');
E(`go('customers')`);
ok(!!q('tbody [data-citag="returning"]'),'het groene etiket hoort in de lijst te staan');
ok(!!q('tbody [data-citag="at_risk"]'),'het gele etiket hoort in de lijst te staan');
ok(qa('tbody [data-citag]').length===2,'precies twee klanten horen een etiket te dragen: '
  +qa('tbody [data-citag]').length);
E(`state.param='c4';render()`);
ok(!!q('.profile-grid [data-citag="returning"], #view [data-citag="returning"]',
  )&&q('#view').textContent.includes('Returning customer'),
  'het etiket hoort ook op de identiteitskaart van de klantpagina');
E(`state.param=null;render()`);

console.log('— Statusfilter: de etiketten als filterdimensie —');
E(`go('customers')`);
q('[data-filters]').click();
ok(qa('.menu .filterrow').length===2,'de filterpil hoort nu twee dimensies te tonen: '
  +qa('.menu .filterrow').length);
ok(!!q('[data-set="customerStatus"]'),'de statuskeuze staat er niet');
E(`state.filters=false;state.customerStatus='returning';render()`);
let vis=qa('tbody tr [data-goprofile]').map(b=>b.dataset.goprofile);
ok(vis.length===1&&vis[0]==='c4','Returning hoort alleen Marija over te houden: '+vis.join(','));
E(`state.customerStatus='at_risk';render()`);
vis=qa('tbody tr [data-goprofile]').map(b=>b.dataset.goprofile);
ok(vis.length===1&&vis[0]==='c1','At-risk hoort alleen Katerina over te houden: '+vis.join(','));
E(`state.customerQuery='marija';render()`);
ok(qa('tbody tr [data-goprofile]').length===0
  &&q('#view').textContent.includes('within the active filters'),
  'status en zoekterm horen te stapelen, met een eerlijke lege stand');
q('[data-clear="customer"]').click();
ok(E('state.customerStatus')==='all'&&E('state.customerQuery')===''
  &&qa('tbody tr [data-goprofile]').length===6,
  'de wisknop hoort ook de status te legen');
E(`state.customerStatus='returning';render()`);
q('[data-filters]').click();q('[data-filterclear]').click();
ok(E('state.customerStatus')==='all','Clear all in de pil hoort de status mee te nemen');
E(`state.filters=false;render()`);

console.log('— Zoeken in de klantenlijst —');
E(`go('customers')`);
ok(!!q('[data-input="customerQuery"]'),'het zoekveld staat er niet');
E(`state.customerQuery='marija';render()`);
ok(qa('tbody tr [data-goprofile]').length===1
  &&q('tbody tr [data-goprofile]').dataset.goprofile==='c4','zoeken op naam hoort alleen Marija over te houden');
E(`state.customerQuery='70 221';render()`);
ok(qa('tbody tr [data-goprofile]').map(b=>b.dataset.goprofile).join(',').includes('c1'),
  'zoeken op telefoon hoort spaties te negeren');
E(`state.customerQuery='petrovska';state.customerGroup='VIP';render()`);
ok(qa('tbody tr [data-goprofile]').length===0&&q('#view').textContent.includes('No customers match your search'),
  'zoekterm en groepsfilter horen te stapelen, met een eerlijke lege stand');
q('[data-clear="customer"]').click();
ok(E('state.customerQuery')===''&&E('state.customerGroup')==='all',
  'de wisknop hoort zoekterm en groep allebei te legen');
ok(qa('tbody tr [data-goprofile]').length===6,'na wissen hoort de volledige lijst terug');

console.log('— View: naar de klantpagina en terug met behouden stand —');
E(`state.customerGroup='VIP';render()`);
qa('[data-goprofile]').find(b=>b.dataset.goprofile==='c4').click();
ok(E('state.route')==='customers'&&E('state.param')==='c4','View hoort naar de klantpagina te gaan');
ok(E('state.ciPage')===0&&E('state.ciMode')===null,'de paginastand hoort schoon te beginnen');
q('[data-go="customers"]').click();
ok(E('state.param')===null,'terug hoort de lijst te tonen');
ok(E('state.customerGroup')==='VIP','het filter hoort de rondreis te overleven');
E(`state.customerGroup='all';render()`);

console.log('— De klantpagina: koppen, kaarten, cijfers —');
qa('[data-goprofile]').find(b=>b.dataset.goprofile==='c4').click();
ok(d.body.textContent.includes('Average per visit'),'de KPI-rij mist het gemiddelde per bezoek');
ok(d.body.textContent.includes('Lifetime spend'),'de KPI-rij mist de totale besteding');
ok(d.body.textContent.includes('Favorite service')&&d.body.textContent.includes('Favorite product'),
  'favoriete dienst en product horen allebei op de pagina');
ok(qa('[data-civisit]').length===2,'eerste en laatste bezoek horen als kaart in de linkerkolom');
ok(q('[data-civisit="first"]').textContent.includes('First visit'),'de eerste-bezoekkaart mist zijn kop');
ok(/Manual therapy|Physiotherapy/.test(q('[data-civisit="last"]').textContent),
  'de laatste-bezoekkaart hoort de behandeling te noemen');
ok(d.body.textContent.includes('Can book'),'de boekstatus hoort op de identiteitskaart');
ok(!!q('[data-citrends]')&&!!q('[data-cisugs]'),'trends- en suggestiekaart horen er te staan');
ok(qa('[data-cicard]').length===3,'er horen drie grafieksecties te zijn');

console.log('— Grafieken: één open, per stuk inklapbaar, alles tegelijk —');
ok(qa('[data-cicard="services"] [data-cibar]').length>0,'de dienstengrafiek hoort standaard open');
ok(qa('[data-cicard="times"] [data-cibar]').length===0,'de tijdengrafiek hoort standaard dicht');
q('[data-cisec="times"]').click();
ok(qa('[data-cicard="times"] [data-cibar]').length===6,'de tijdengrafiek hoort 6 uurbalken te dragen: '
  +qa('[data-cicard="times"] [data-cibar]').length);
q('[data-cisec="times"]').click();
ok(qa('[data-cicard="times"] [data-cibar]').length===0,'nogmaals klikken hoort weer te sluiten');
q('[data-cisec="services"]').click();
ok(qa('[data-cicard="services"] [data-cibar]').length===0,'ook de open sectie hoort te kunnen sluiten');
q('[data-ciexpand]').click();
ok(qa('[data-cicard="services"] [data-cibar]').length>0
 &&qa('[data-cicard="times"] [data-cibar]').length>0
 &&qa('[data-cicard="spend"] [data-cibar]').length>0,'Expand all hoort alle drie te openen');
ok(q('[data-cicard="spend"]').textContent.includes('Products at the till'),
  'de bestedingsgrafiek hoort ook de balieproducten te tonen');

console.log('— Analyse met AI: grafieken weg, verhaal ervoor in de plaats —');
q('[data-ciai]').click();
ok(!!q('[data-ciaipanel]'),'het analysepaneel staat er niet');
ok(q('[data-ciaipanel]').classList.contains('fd-hero'),
  'het analysepaneel hoort het heldenjasje van de flightdeck te dragen');
ok(!!q('[data-ciaipanel] .fd-kicker'),'het paneel mist zijn AI-kop met vonk');
ok(qa('[data-cicard]').length===0&&!q('[data-citrends]'),'de grafieken horen verborgen te zijn in AI-modus');
ok(qa('[data-ciaipanel] p').length>=4,'de analyse hoort een echt verhaal te zijn: '
  +qa('[data-ciaipanel] p').length+' alinea\'s');
ok(q('[data-ciaipanel]').textContent.includes('Recommended actions'),
  'de suggesties horen als aanbevolen acties ín de analyse te staan');
ok(qa('[data-ciaipanel] [data-cioffer]').length>=2,
  'de aanbevolen acties horen echte knoppen te dragen: '
  +qa('[data-ciaipanel] [data-cioffer]').length);
ok(q('[data-ciaipanel]').textContent.includes('Generated from'),
  'de demo-eerlijkheid hoort eronder te staan');
ok(!q('[data-ciai]')&&!!q('[data-ciback]'),'de werkbalk hoort nu Terug te tonen in plaats van Analyse');
q('[data-ciback]').click();
ok(!!q('[data-citrends]')&&qa('[data-cicard]').length===3,'terug hoort de grafieken terug te brengen');

console.log('— Edit details opent de echte bewerklade —');
const ed=qa('#view .toolbar [data-panel]').find(b=>(b.dataset.panel||'').startsWith('customerEdit|'));
ok(!!ed&&ed.dataset.panel==='customerEdit|c4','Edit details hoort de bewerklade van deze klant te openen');
ed.click();
ok(E('panelMeta&&panelMeta.title')==='Marija Angelovska',
  'de lade hoort dezelfde te zijn als bij Edit in de tabel: '+E('panelMeta&&panelMeta.title'));
E(`state.edOpen={general:true};renderPanel()`);
ok(!!q('[data-inline="c4|birthday"]'),'de lade hoort ook hier het geboortedatumveld te dragen');
E('closePanel(true)');
E(`state.param='c4';render()`);

console.log('— Historie op de pagina: 15 per keer, meer op afroep —');
ok(qa('[data-cihist]').length===15,'de eerste pagina hoort 15 regels te tonen');
ok(!!q('[data-cimore]'),'de meer-knop staat er niet');
q('[data-cimore]').click();
ok(qa('[data-cihist]').length===30,'meer laden hoort er 15 bij te tekenen');
ok(qa('[data-cihist].dim').length>0||qa('[data-cihist] .badge.danger').length>0
  ||E('custHistoryPage(state.param,state.ciPage).rows.every(r=>r.status==="completed")'),
  'niet-afgeronde regels horen gedimd te staan zodra ze in beeld komen');

console.log('— Personal offer: de lade, leeg prijsveld, opslaan —');
qa('[data-cioffer]').find(b=>b.dataset.cioffer==='c4|pattern|').click();
ok(E('panelMeta&&panelMeta.title')==='Personal offer','de personal-offer lade hoort open te gaan');
const dr=E('state.poDraft');
ok(dr.sid==='s2','de favoriete dienst hoort voor-ingevuld: '+dr.sid);
ok(dr.empId==='e1','de voorkeursmedewerker hoort voor-ingevuld');
ok(dr.locId==='loc-centar','de laatste locatie hoort voor-ingevuld');
ok(dr.prefWeekday===4,'vrijdag hoort als voorkeursweekdag voor-ingevuld');
ok(dr.prefBand&&dr.prefBand.from===14&&dr.prefBand.to===17,'het middagvenster hoort voor-ingevuld');
ok(dr.validFrom===E('TODAY')&&dr.validUntil===E('addDays(TODAY,7)'),
  'de geldigheid hoort standaard een week te zijn');
ok(dr.specialPrice==='','de speciale prijs hoort LEEG te beginnen — prijzen is eigenaarswerk');
ok(dr.variantId==='vtwo','de standaardvariant hoort voor-ingevuld, zoals bij een gewone afspraak: '+dr.variantId);
ok(E(`poNormalPrice('s2','vfull','loc-centar')`)===3300,
  'de variantprijs hoort via svcChoice te lopen');
ok(E(`poNormalPrice('s2',null,'loc-centar')`)===E(`svcChoice(services.find(s=>s.id==='s2'),'loc-centar',null).price`),
  'zonder keuze hoort de standaardvariantprijs te gelden, niet de kale dienstprijs');
ok(q('[data-pof="variantId"]')&&/Two regions/.test(q('[data-pof="variantId"]').textContent),
  'de variantopties horen hun eigen label te dragen, zoals in de boekingslade');
E(`(function(){const el=document.querySelector('[data-pof="sid"]');el.value='s8';
  el.dispatchEvent(new window.Event('change',{bubbles:true}));})()`);
ok(E('state.poDraft.sid')==='s8'&&E('state.poDraft.variantId')==='v45',
  'wisselen van dienst hoort de standaardvariant van die dienst te kiezen: '+E('state.poDraft.variantId'));
E(`(function(){const el=document.querySelector('[data-pof="sid"]');el.value='s2';
  el.dispatchEvent(new window.Event('change',{bubbles:true}));})()`);
ok(E('savePersonalOffer()')===false,'opslaan zonder prijs hoort geweigerd te worden');
ok(E('personalOffers.length')===0,'zonder prijs mag er niets zijn opgeslagen');
E(`state.poDraft.specialPrice='1800'`);
E('savePersonalOffer()');
ok(E('personalOffers.length')===1,'met prijs hoort er één aanbieding te staan');
const po=E('personalOffers[0]');
ok(po.normalPrice===2400&&po.specialPrice===1800&&po.discountPct===25,
  'prijs en afgeleide korting kloppen niet: '+JSON.stringify([po.normalPrice,po.specialPrice,po.discountPct]));
ok(po.validUntil===E('addDays(TODAY,7)'),'de einddatum hoort op de aanbieding te staan (zichtbaar voor de klant)');
ok(po.customerId==='c4'&&E('poStatus(personalOffers[0])')==='live','de aanbieding hoort live voor Marija te zijn');
ok(po.intent==='pattern'&&po.relatedSuggestionId==='pattern','de herkomst hoort op de aanbieding te staan');
ok(E(`custActivityFor('c4')`)[0].type==='offer_created','het logboek mist offer_created');

console.log('— Winback en de dubbelwaarschuwing —');
E(`state.param='c4';render()`);
qa('[data-cioffer]').find(b=>b.dataset.cioffer==='c4|winback|s5').click();
ok(E('state.poDraft.sid')==='s5','de winback hoort de weggezakte dienst voor te vullen');
ok(E('state.poDraft.insight').includes('6 months'),'het inzicht hoort de reden te dragen');
E(`state.poDraft.specialPrice='700'`);E('savePersonalOffer()');
ok(E('personalOffers.length')===2,'de winback-aanbieding hoort erbij te staan');
E(`openPersonalOfferFor('c4','manual','s5')`);
ok(d.body.innerHTML.includes('already a live personal offer'),
  'een overlappende live aanbieding hoort een waarschuwing te tonen');
ok(!!q('[data-pof="specialPrice"]'),'het prijsveld hoort in de lade te staan');
E('closePanel(true);state.poDraft=null');

console.log('— Actions: boeken en aanbieden onder één knop —');
E(`state.param='c4';render()`);
ok(!!q('[data-actmenu]'),'de werkbalk mist de Actions-knop');
ok(!q('#view [data-panel="appointment"]'),'de losse boekknop hoort opgegaan te zijn in Actions');
q('[data-actmenu]').click();
ok(!!q('.menu [data-panel="appointment"]'),'het menu mist Book appointment');
ok(!!q('.menu [data-ponew]'),'het menu mist Create personal offer');
q('.menu [data-panel="appointment"]').click();
ok(E('panelMeta&&panelMeta.title')!=null&&E('state.actMenu')===false,
  'boeken hoort de lade te openen en het menu te sluiten');
E('closePanel(true)');
q('[data-actmenu]').click();
q('[data-ponew]').click();
ok(E('panelMeta&&panelMeta.title')==='Personal offer','de handmatige ingang hoort dezelfde lade te openen');
ok(E('state.poDraft.intent')==='manual','de handmatige ingang hoort intent manual te dragen');
ok(E('state.poDraft.specialPrice')==='','ook handmatig begint de prijs leeg');
E('closePanel(true);state.poDraft=null');

console.log('— Geblokkeerde klant krijgt geen belofte —');
E(`customers.find(c=>c.id==='c1').blacklisted=true`);
E(`openPersonalOfferFor('c1','manual','')`);
ok(!E('panelMeta'),'voor een geblokkeerde klant hoort de lade dicht te blijven');
E(`customers.find(c=>c.id==='c1').blacklisted=false`);

console.log('— Marketing: lijst, inlossen, annuleren, verlopen —');
E(`go('marketing');state.marketingTab='offers';render()`);
ok(qa('[data-porow]').length===2,'de marketinglijst hoort beide aanbiedingen te tonen');
ok(q('#view').textContent.includes('Personal offers'),'het blok mist zijn kop');
ok(qa('[data-poredeem]').length===2&&qa('[data-pocancel]').length===2,
  'live aanbiedingen horen inlos- en annuleerknoppen te dragen');
q('[data-poredeem]').click();
ok(E('poStatus(personalOffers[0])')==='redeemed','handmatig inlossen hoort de status te zetten');
ok(E(`custActivityFor('c4')`)[0].type==='offer_redeemed','het logboek mist offer_redeemed');
q('[data-pocancel]')&&q('[data-pocancel]').click();
ok(E('poStatus(personalOffers[1])')==='cancelled','annuleren hoort de status te zetten');
ok(qa('[data-poredeem]').length===0,'afgehandelde aanbiedingen horen geen knoppen meer te dragen');
E(`personalOffers.push({id:'poX',customerId:'c1',businessId:'biz-velnes',locationId:'loc-centar',
  sid:'s4',variantId:null,empId:null,normalPrice:1500,specialPrice:1000,discountPct:33,
  validFrom:addDays(TODAY,-10),validUntil:addDays(TODAY,-3),prefWeekday:null,prefBand:null,
  status:'live',createdAt:TODAY,createdBy:'e1',relatedSuggestionId:null,intent:'manual'})`);
ok(E(`poStatus(personalOffers.find(p=>p.id==='poX'))`)==='expired',
  'verlopen hoort een lezing te zijn, geen opslag');

console.log('— Activiteit: eigen tab, nieuwste eerst —');
E(`go('customers',null);state.param='c4';state.profileTab='activity';render()`);
ok(qa('[data-ciactrow]').length===4,'de activiteitstab hoort vier regels te tonen: '
  +qa('[data-ciactrow]').length);
const acts=E(`custActivityFor('c4')`);
ok(acts[0].type==='offer_cancelled'&&acts[acts.length-1].type==='offer_created',
  'het logboek hoort nieuwste eerst te staan: '+acts.map(a=>a.type).join(','));
ok(acts.every(a=>a.actor&&a.meta),'elke regel hoort een actor en meta te dragen (voor de latere meting)');
E(`state.profileTab='appointments'`);

console.log('— Geboortedatum op de bewerklade —');
E(`go('customers',null);render()`);
qa('[data-panel]').find(b=>(b.dataset.panel||'').startsWith('customerEdit|c1')).click();
E(`state.edOpen={general:true};renderPanel()`);
const bd=q('[data-inline="c1|birthday"]');
ok(!!bd,'het geboortedatumveld staat niet op de bewerklade');
ok(bd&&bd.type==='date','het veld hoort een datumveld te zijn');
ok(bd&&bd.value===E(`customers.find(c=>c.id==='c1').birthday`),'het veld hoort de waarde te tonen');
E('closePanel(true)');

console.log('— Rechten: geld verdwijnt, de rest blijft —');
const fd=E(`(function(){const e=employees.find(x=>roleById(x.roleId).id==='r_frontdesk');return e?e.id:null})()`);
if(fd){
  E(`session.userId='${fd}';go('customers')`);
  ok(!E(`can('customers.view_business')`),'de baliegebruiker hoort geen geldrecht te hebben');
  q('[data-sortmenu]').click();
  ok(qa('[data-custsort]').length===3,'zonder geldrecht horen er 3 sorteeropties te zijn: '
    +qa('[data-custsort]').length);
  ok(!qa('[data-custsort]').some(b=>/spend/i.test(b.dataset.custsort)),
    'de bestedingssorteringen horen verborgen te zijn');
  E(`state.sortMenu=false`);
  qa('[data-goprofile]').find(b=>b.dataset.goprofile==='c4').click();
  ok(!q('[data-ciai]'),'zonder geldrecht hoort er geen AI-knop te zijn');
  ok(!q('[data-citrends]')&&!q('[data-cisugs]')&&qa('[data-cicard]').length===0,
    'inzichten zijn bedrijfsgegevens en horen verborgen te zijn');
  ok(!q('#view').textContent.includes('Lifetime spend'),'de totale besteding hoort verborgen te zijn');
  ok(q('#view').textContent.includes('Visits'),'bezoeken horen zichtbaar te blijven');
  ok(!E(`can('marketing.personal_offers')`),'de balie hoort geen aanbiedingsrecht te hebben');
  ok(!q('[data-ponew]')&&!q('[data-actmenu]'),'zonder recht hoort er geen Actions-menu te zijn');
  ok(!!q('#view [data-panel="appointment"]'),'de kale boekknop hoort te blijven staan');
  E(`state.poDraft=null;openPersonalOfferFor('c4','manual','')`);
  ok(!E('state.poDraft'),'de poort hoort een aanmaak zonder recht te weigeren');
  E(`go('marketing');state.marketingTab='offers';render()`);
  ok(qa('[data-poredeem]').length===0&&qa('[data-pocancel]').length===0,
    'zonder recht horen inlossen en annuleren verborgen te zijn');
  E(`session.userId='e1';go('customers')`);
}else{
  ok(false,'geen baliegebruiker gevonden voor de rechtentoets');
}

}catch(err){fail++;console.log('  FAIL  onverwachte fout: '+err.message+'\n'+err.stack)}
console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
},2500);
