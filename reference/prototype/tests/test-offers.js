/* Vrije capaciteit, aanbiedingen en de prijsmotor.

   De kern die hier bewaakt wordt: er is één plek die zegt wat iets
   kost, niets stapelt, en een inbegrepen sessie opmaken is een keuze
   van de klant en geen uitkomst van een rekensom. */
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
const norm=s=>(s||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();

setTimeout(()=>{

/* Een vaste dag om op te rekenen: morgen, zodat "al voorbij" nooit
   meespeelt en de test niet van de klok afhangt. */
E("window.D=addDays(TODAY,1);window.L='loc-centar'");

g('Velnes vindt de gaten zelf');
t('Er staat lege tijd op een gewone werkdag',()=>{
  E("while(!scheduleFor(L,D).open)D=addDays(D,1);window.CAPS=openCapacity(L,D)");
  return E('CAPS.length')>0||'geen enkele kans gevonden';
});
t('Elke kans heeft een tijd, een medewerker en een passende behandeling',()=>{
  const bad=E("CAPS.filter(c=>!c.start||!c.empId||!c.sid||!(c.dur>0)).length");
  return bad===0||`${bad} kansen zonder invulling`;
});
t('De behandeling past echt in het gat, opruimtijd meegerekend',()=>{
  /* Voorbereiden en opruimen zitten in operationalMin; dat is wat de
     agenda kwijt is en dus wat in het gat moet passen. */
  const bad=E("CAPS.filter(c=>(c.operationalMin||c.dur)>c.gap).length");
  return bad===0||`${bad} kansen die niet passen`;
});
t('Niemand krijgt werk dat hij niet doet',()=>{
  const bad=E("CAPS.filter(c=>{const e=employees.find(x=>x.id===c.empId);"
    +"return e.skills.length&&!e.skills.includes(c.sid)}).length");
  return bad===0||`${bad} kansen bij de verkeerde persoon`;
});
t('Een bezette tijd levert geen kans op',()=>{
  const bad=E("CAPS.filter(c=>appointments.some(a=>a.emp===c.empId&&a.date===D&&a.kind!=='cancelled'"
    +"&&mins(a.start)<mins(c.start)+c.dur&&mins(c.start)<mins(a.end))).length");
  return bad===0||`${bad} kansen boven op een afspraak`;
});
t('Een gesloten dag levert niets op',()=>{
  E("scheduleExceptions.push({id:excId(),locationId:L,startDate:D,endDate:D,"
   +"type:'CLOSED',periods:[],reason:'Test',source:'MANUAL'})");
  const n=E("openCapacity(L,D).length");
  E("scheduleExceptions.pop()");
  return n===0||`${n} kansen op een dag dat de zaak dicht is`;
});
t('De waarde is de som van wat er normaal voor gevraagd wordt',()=>{
  return E("capacityValue(CAPS)===CAPS.reduce((n,c)=>n+c.price,0)")||'de optelling klopt niet';
});

g('Eén aanbieding, twee fasen');
t('Publiceren maakt één aanbieding, geen twee',()=>{
  E("offers.length=0;state.offerDraft=offerDraftInit(L,D);"
   +"state.offerDraft.vipFrom='08:00';state.offerDraft.vipUntil='11:00';"
   +"openPanel(PANELS.offerNew(),'offerNew');saveOffer()");
  return E('offers.length')===1||`${E('offers.length')} aanbiedingen`;
});
t('Met twee fasen erin',()=>{
  return E('offers[0].phases.length')===2||`${E('offers[0].phases.length')} fasen`;
});
t('Eerst de leden, daarna iedereen',()=>{
  const a=E("offers[0].phases.map(p=>p.audience).join('|')");
  return a==='PREMIUM_MEMBERS|PUBLIC'||`las: ${a}`;
});
t('De tweede begint waar de eerste ophoudt',()=>{
  return E("offers[0].phases[0].endsAt===offers[0].phases[1].startsAt")
    ||'er zit een gat of een overlap tussen de fasen';
});
t('En loopt door tot de afspraak zelf begint',()=>{
  return E("offers[0].phases[1].endsAt")===null||'fase twee heeft een hard einde';
});
t('De kansen gaan als momentopname mee',()=>{
  /* Morgen zijn de gaten van vandaag geen gaten meer; de aanbieding moet
     blijven weten waar hij over ging. */
  return E("offers[0].slotIds.every(id=>!!offers[0].slots[id])")||'niet elke plek is bewaard';
});
t('Zonder plekken wordt er niets gepubliceerd',()=>{
  E("state.offerDraft=offerDraftInit(L,D);state.offerDraft.picked=[]");
  const r=E("saveOffer()");
  return r===false||'een lege aanbieding kwam er doorheen';
});
t('En een venster dat eerder eindigt dan het begint ook niet',()=>{
  E("state.offerDraft=offerDraftInit(L,D);state.offerDraft.vipFrom='14:00';state.offerDraft.vipUntil='11:00'");
  const r=E("saveOffer()");
  return r===false||'een omgekeerd venster kwam er doorheen';
});

g('Alleen wie er nu bij mag, ziet de prijs');
t('Binnen fase één geldt de ledenfase',()=>{
  E("window.S=offers[0].slotIds[0];window.C=offers[0].slots[S]");
  const ph=E("(offerFor(S,D,mins('09:00'))||{}).phase");
  return E("(offerFor(S,D,mins('09:00'))||{}).phase.audience")==='PREMIUM_MEMBERS'
    ||'de eerste fase geldt niet om 09:00';
});
t('Daarna de publieke fase',()=>{
  return E("(offerFor(S,D,mins('12:00'))||{}).phase.audience")==='PUBLIC'
    ||'de tweede fase geldt niet om 12:00';
});
t('Een Velnes Premium-lid krijgt de vroege korting',()=>{
  E("window.VIP=customers.find(c=>isPremium(c.id)&&!c.blacklisted).id");
  const r=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,custId:VIP,slotId:S,date:D,nowM:mins('09:00')})");
  return r.best.kind==='offer'||`kreeg ${r.best.kind}`;
});
t('Een niet-lid nog niet',()=>{
  E("window.REG=customers.find(c=>!isPremium(c.id)&&!c.blacklisted).id");
  const r=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,custId:REG,slotId:S,date:D,nowM:mins('09:00')})");
  return r.best.kind!=='offer'||'de vroege fase lekte naar buiten';
});
t('Maar na elven wel',()=>{
  const r=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,custId:REG,slotId:S,date:D,nowM:mins('12:00')})");
  return r.best.kind==='offer'||`kreeg ${r.best.kind}`;
});
t('Zonder klant zie je alleen wat publiek is',()=>{
  const vroeg=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,slotId:S,date:D,nowM:mins('09:00')}).best.kind");
  const laat=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,slotId:S,date:D,nowM:mins('12:00')}).best.kind");
  return (vroeg!=='offer'&&laat==='offer')||`vroeg ${vroeg}, laat ${laat}`;
});
t('Een plek die er niet in zit krijgt niets',()=>{
  const r=E("priceFor({sid:C.sid,locId:L,custId:VIP,slotId:'cap|nope',date:D,nowM:mins('09:00')})");
  return r.best.kind!=='offer'||'een onbekende plek kreeg toch een aanbieding';
});
t('Salonabonnementen bestaan niet meer in de prijsmotor',()=>{
  const kinds=E("priceFor({sid:C.sid,locId:L,custId:VIP,date:D,nowM:mins('09:00')}).options.map(o=>o.kind).join('|')");
  return !/membership/.test(kinds)||`las: ${kinds}`;
});

g('Percentages rekenen tegen de prijs die hier geldt');
t('Twintig procent van de vestigingsprijs, niet van een basisprijs elders',()=>{
  E("offers[0].phases[1].discountValue=20");
  const r=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,slotId:S,date:D,nowM:mins('12:00')})");
  const lijst=E("listPrice(C.sid,L,C.variantId)");
  return r.effective===Math.round(lijst*0.8)||`${r.effective} bij een lijstprijs van ${lijst}`;
});
t('Een andere vestiging met een andere prijs levert een ander bedrag',()=>{
  /* Dezelfde 20% op 2.200 en op 1.900 hoort 1.760 en 1.520 te geven, en
     niet twee keer hetzelfde. */
  const a=E("applyRule({discountType:'percentage_discount',discountValue:20},2200)");
  const b=E("applyRule({discountType:'percentage_discount',discountValue:20},1900)");
  return (a===1760&&b===1520)||`${a} en ${b}`;
});
t('Een vaste aanbiedingsprijs is een bedrag, geen som',()=>{
  return E("applyRule({discountType:'fixed_promo_price',discountValue:895},1295)")===895
    ||'de vaste prijs werd toch uitgerekend';
});
t('Een kanaal mag zichzelf uitsluiten',()=>{
  E("offers[0].phases[1].channels={marketplace:null}");
  const till=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,slotId:S,date:D,channel:'till',nowM:mins('12:00')}).best.kind");
  const mk=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,slotId:S,date:D,channel:'marketplace',nowM:mins('12:00')}).best.kind");
  return (till==='offer'&&mk==='list')||`till ${till}, marktplaats ${mk}`;
});
t('En mag een eigen percentage voeren',()=>{
  E("offers[0].phases[1].channels={online:{discountValue:50}}");
  const lijst=E("listPrice(C.sid,L,C.variantId)");
  const on=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,slotId:S,date:D,channel:'online',nowM:mins('12:00')}).effective");
  E("offers[0].phases[1].channels=null;offers[0].phases[1].discountValue=25");
  return on===Math.round(lijst*0.5)||`${on} bij een lijstprijs van ${lijst}`;
});
t('Een aanbieding kan zich tot bepaalde varianten beperken',()=>{
  E("offers[0].eligibleVariantIds=['nope']");
  const r=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,slotId:S,date:D,nowM:mins('12:00')}).best.kind");
  E("offers[0].eligibleVariantIds=[]");
  return r==='list'||`kreeg ${r}`;
});

g('Niets stapelt');
t('Salonabonnementen zijn hard uitgefaseerd',()=>{
  return E('typeof memberships')==='undefined'&&E('typeof planById')==='undefined'
    ||'er leeft nog een stuk van het oude stelsel';
});
t('Zonder abonnement is er niets te kiezen',()=>{
  const r=E("priceFor({sid:C.sid,locId:L,variantId:C.variantId,slotId:S,date:D,nowM:mins('12:00')})");
  return r.hasChoice===false||'er verscheen een keuze uit het niets';
});

g('Wat de eigenaar ervan ziet');
/* De capaciteitskaart boven de agenda is er op verzoek uit: alle
   belangrijke handelingen wonen nu op de flightdeck. De ingang die hier
   getoetst wordt is dus de heldkaart daar — de agenda moet juist
   schoon blijven. */
t('De agenda zelf draagt de kaart niet meer',()=>{
  E("offers.length=0;state.scope=[L];session.userId='e1';closePanel(true);go('calendar')");
  return !d.querySelector('#view .capcard')||'de kaart staat nog boven de agenda';
});
t('De flightdeck zegt hoeveel er leeg staat en wat het waard is',()=>{
  E("go('home')");
  /* De Velnes Premium-aanbeveling mag ervóór staan; dit toetst de
     capaciteitskaart zelf. */
  const hero=d.querySelector('#view .fd-hero:not([data-fdrec])');
  if(!hero)return 'geen heldkaart';
  return /remaining capacity/.test(norm(hero.textContent))&&/unsold capacity/.test(norm(hero.textContent))
    ||`las "${norm(hero.textContent).slice(0,90)}"`;
});
t('Met de standaardpercentages er al in',()=>{
  const hero=norm(d.querySelector('#view .fd-hero:not([data-fdrec])').textContent);
  return /40%/.test(hero)&&/25%/.test(hero)||`las "${hero.slice(0,120)}"`;
});
t('En één knop die de lade opent',()=>{
  d.querySelector('#view .fd-hero [data-offernew]').click();
  return !!d.querySelector('#panel .ed-sechead')||'de lade bleef leeg';
});
t('Capaciteit staat dicht, want de kop zegt het antwoord al',()=>{
  /* Velnes heeft de gaten al gevonden en alles aangevinkt. De lijst
     hoeft dus niet open te staan: "4 of 4 · 6.800 ден." beantwoordt de
     vraag. Wat wél open staat is waar ze iets moet kiezen. */
  const open=qa('#panel .ed-sec').map(x=>x.classList.contains('open'));
  return (open[0]===false&&open[1]===true)||`open: ${open.join(', ')}`;
});
t('De lade heeft drie secties: capaciteit, vroeg, publiek',()=>{
  const titels=qa('#panel .ed-sectitle').map(x=>norm(x.textContent).replace(/^\d+\. /,''));
  return (titels.length===3&&/^Capacity/.test(titels[0])&&/^Early access/.test(titels[1])
    &&/^Then everyone/.test(titels[2]))||`las: ${titels.join(' | ')}`;
});
t('De kop van elke sectie zegt zelf hoe hij ervoor staat',()=>{
  const pills=qa('#panel .ed-pill').map(x=>norm(x.textContent));
  return (/of \d+/.test(pills[0])&&/Velnes Premium · 40% until/.test(pills[1])&&/Public · 25%/.test(pills[2]))
    ||`labels: ${pills.join(' | ')}`;
});
t('Een plek uitvinken telt meteen mee op de kop',()=>{
  qa('#panel .ed-sechead')[0].click();
  const voor=norm(qa('#panel .ed-pill')[0].textContent);
  d.querySelector('#panel [data-offercap]').click();
  const na=norm(qa('#panel .ed-pill')[0].textContent);
  return voor!==na||`het label bleef "${voor}"`;
});
t('Publiek uitzetten zegt dat de rest leeg blijft',()=>{
  const h=qa('#panel .ed-sechead')[2]; h.click();
  d.querySelector('#panel [data-offpublic]').click();
  const pill=norm(qa('#panel .ed-pill')[2].textContent);
  d.querySelector('#panel [data-offpublic]').click();
  return pill==='Stays private'||`las "${pill}"`;
});

g('De catalogus laat het zien');
t('Een dienst met een lopende aanbieding draagt een label',()=>{
  E("closePanel(true);state.offerDraft=offerDraftInit(L,D);"
   +"state.offerDraft.vipFrom='00:00';state.offerDraft.vipUntil='23:59';"
   +"openPanel(PANELS.offerNew(),'offerNew');saveOffer();closePanel(true);"
   +"state.route='catalog';state.catTab='services';render()");
  const sid=E("offers[0].slots[offers[0].slotIds[0]].sid");
  return E(`svcOfferState('${sid}')`)==='active'||'de dienst weet niets van de aanbieding';
});
t('En dat label staat ook echt op de regel',()=>{
  const badges=qa('#view .badge').map(x=>norm(x.textContent));
  return badges.includes('Promo running')||`geen promolabel tussen: ${[...new Set(badges)].join(', ')}`;
});
t('De dienst zelf bewaart er niets van',()=>{
  /* Een aanbieding hoort bij lege tijd, niet bij de dienst. Zou hij op
     het record staan, dan klopt hij morgen niet meer. */
  const vuil=E("services.filter(s=>'promo' in s||'discount' in s||'offer' in s).length");
  return vuil===0||`${vuil} diensten dragen een aanbiedingsveld`;
});
t('De doorgestreepte prijs houdt de oude leesbaar',()=>{
  /* Deze aanbieding staat de hele dag in fase één, dus je moet er wel
     bij mogen om de streep te zien. */
  const tag=E("priceTag(priceFor({sid:offers[0].slots[offers[0].slotIds[0]].sid,locId:L,"
    +"custId:customers.find(c=>isPremium(c.id)).id,slotId:offers[0].slotIds[0],date:D,nowM:mins('12:00')}))");
  return /<s /.test(tag)&&/<strong/.test(tag)||`las: ${tag.slice(0,80)}`;
});
t('Zonder aanbieding staat er gewoon één prijs',()=>{
  const tag=E("priceTag(priceFor({sid:C.sid,locId:L,date:D}))");
  return !/<s /.test(tag)||'er stond een streep zonder aanbieding';
});
t('De heldkaart is opgemaakt in het olijfpalet, niet in koraal',()=>{
  /* Was .capcard; de kaart woont nu als .fd-hero op de flightdeck en
     moet in hetzelfde palet blijven. */
  const m=/\n\.fd-hero\{([^}]*)\}/.exec(css);
  return (m&&/var\(--accent-deep\)/.test(m[1])&&/var\(--accent-tint\)/.test(m[1]))
    ||`.fd-hero leest ${m&&m[1]}`;
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode=fail?1:0;
},400);
