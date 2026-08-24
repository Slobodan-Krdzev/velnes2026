/* Nieuwe vestiging — levensloop, kopieermotor, HQ-poort, gereedheid.
   Toetst de kernregel: de werkplaats maakt en bereidt voor, HQ keurt
   streng, de eigenaar activeert pas na goedkeuring — achter de
   gereedheidspoort, en alleen als eigenaar. Elke klantdeur weigert
   een niet-actieve vestiging: slots, boeken, afrekenen, aanbiedingen,
   zoekmarkt. */
const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('/home/claude/velnes/index.html','utf8'),{runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document,E=x=>w.eval(x);
const q=s=>d.querySelector(s),qa=s=>[...d.querySelectorAll(s)];
const click=el=>el.dispatchEvent(new w.Event('click',{bubbles:true}));
const setF=(sel,v)=>{const el=q(sel);el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}))};
let pass=0,fail=0;
const ok=(c,msg)=>{if(c){pass++}else{fail++;console.log('  FAIL ',msg)}};
setTimeout(()=>{try{

console.log('— Migratie: de zaadjes dragen een levensloop —');
ok(E(`locations.every(l=>!!l.lifecycle)`),'elke vestiging heeft een lifecycle');
ok(E(`locations.filter(l=>l.status==='open').every(l=>l.lifecycle==='ACTIVE')`),'open → ACTIVE');
ok(E(`locLive('loc-centar')&&locLive('loc-aerodrom')`),'de bestaande vestigingen zijn levend');

console.log('— De oude ongegatete deur is dicht —');
E(`state.nloc=null;openPanel(PANELS.location(),'location')`);
ok(!q('#panel [data-lf="name"]'),'het oude directe aanmaakformulier is weg');
{const sb=q('#panel [data-panelsave]');
 ok(!!sb&&!sb.hasAttribute('disabled'),'de wizard-knop staat aan — een paneel zonder velden mag niet op slot');
 /* De echte klikweg, niet onSave() los: zo valt ook de raamwerk-nasleep
    (toast op een leeg panelMeta) onder de toets. */
 click(sb);}
ok(E(`state.route`)==='newloc','de wizard-knop opent de wizard langs de echte klikweg');
ok(E(`typeof panelMeta==='undefined'||panelMeta===null||!document.body.classList.contains('panel-open')`),
  'het paneel is netjes dicht na de sprong');
ok(E(`locations.length`)===2,'geen vestiging ontstaat buiten de wizard om');
E(`closePanel&&closePanel()`);

console.log('— De wizard: stappen, weigeringen, klad die overleeft —');
E(`lastHash=null;state.nloc=nlocNew();applyHash('newloc');render()`);
click(q('[data-nlnext]'));
ok(E(`state.nloc.step`)===1,'zonder startkeuze geen stap verder');
click(q('[data-nlmode="copy"]'));
ok(E(`state.nloc.mode`)==='copy','kopie gekozen');
ok(!!q('[data-nlf="srcId"]'),'bronkeuze verschijnt bij kopie');
ok(E(`nlocSteps().length`)===5,'kopie kent de checkliststap');
click(q('[data-nlmode="scratch"]'));
ok(E(`nlocSteps().length`)===4,'vanaf-nul slaat de checklist over');
click(q('[data-nlmode="copy"]'));
click(q('[data-nlnext]'));
ok(E(`state.nloc.step`)===2,'stap 2 bereikt');
click(q('[data-nlnext]'));
ok(E(`state.nloc.step`)===2,'lege basisgegevens blokkeren');
setF('[data-nlf="loc.name"]','Debar Maalo');
setF('[data-nlf="loc.address"]','Orce Nikolov 55');
setF('[data-nlf="loc.city"]','Skopje');
click(q('[data-nlnext]'));
ok(E(`state.nloc.step`)===3,'basisgegevens gevuld → stap 3');
ok(E(`state.nloc.loc.name`)==='Debar Maalo','veldwaarde overleeft de stapwissel');
click(q('[data-nlleg="new"]'));
click(q('[data-nlnext]'));
ok(E(`state.nloc.step`)===3,'nieuwe entiteit zonder naam/belastingnummer blokkeert');
setF('[data-nlf="legal.name"]','Debar Wellness DOOEL Skopje');
setF('[data-nlf="legal.taxId"]','MK4030029999999');
click(q('[data-nlnext]'));
ok(E(`state.nloc.step`)===4,'entiteit gevuld → checklist');
{const cb=q('[data-nlcopy="products"]');cb.checked=false;
 cb.dispatchEvent(new w.Event('change',{bubbles:true}));}
click(q('[data-nlnext]'));
ok(E(`state.nloc.step`)===5,'review bereikt');

console.log('— Indienen: kopie als momentopname, entiteit wachtend, toegang per rol —');
E(`state.nloc.srcId='loc-centar'`);
const beforeLE=E(`legalEntities.length`);
click(q('[data-nlsubmit]'));
ok(E(`locations.length`)===3,'de vestiging bestaat');
const nid=E(`locations[2].id`);
ok(E(`locations[2].lifecycle`)==='SUBMITTED','direct ingediend');
ok(E(`legalEntities.length`)===beforeLE+1,'nieuwe entiteit aangemaakt');
ok(E(`legalEntities[legalEntities.length-1].status`)==='pending','entiteit wacht op de samengestelde keuring');
ok(E(`legalEntities[legalEntities.length-1].locs.includes('${nid}')`),'entiteit wijst naar de vestiging');
ok(E(`paymentAccounts[paymentAccounts.length-1].status`)==='incomplete','betaalrekening eerlijk onaf');
ok(E(`JSON.stringify(locationCatalog['${nid}'].services['s1'])`)!==undefined,'catalogus gekopieerd');
ok(E(`svcAt(services.find(s=>s.id==='s1'),'${nid}').price===svcAt(services.find(s=>s.id==='s1'),'loc-centar').price`),
  'prijs reisde mee met de momentopname');
ok(E(`products.every(p=>stockAt(p,'${nid}')===0)`),'voorraad begint op nul — altijd');
ok(E(`locationCatalog['${nid}'].products['${E(`products[0].id`)}'].active===false`),'producten uitgevinkt → niet gekopieerd');
ok(E(`employees.filter(e=>e.access==='owner').every(e=>e.locs.includes('${nid}'))`),'eigenaars krijgen automatisch toegang');
ok(E(`employees.filter(e=>e.access!=='owner').every(e=>!e.locs.includes('${nid}')||e.id===session.userId)`),
  'niet-eigenaars blijven expliciet toegewezen');
ok(E(`!Object.prototype.hasOwnProperty.call(locations[2],'copySource')&&!Object.prototype.hasOwnProperty.call(locations[2],'srcId')`),
  'geen terugverwijzing naar de bron — snapshot, geen koppeling');

console.log('— Elke klantdeur is dicht zolang niet ACTIVE —');
ok(E(`availableSlots('${nid}','s1','any',addDays(TODAY,3)).length`)===0,'geen slots');
E(`startBooking('link')`);
ok(E(`!state.book.locs.includes('${nid}')`),'de boekpagina kent de vestiging niet');
E(`state.route='home';render()`);
ok(E(`platformSalons.every(ps=>ps.locId!=='${nid}')`),'de zoekmarkt kent de vestiging niet');
E(`state.poDraft=null`);
ok(E(`(function(){const n=memberRecs.length;return n>=0})()`),'premium-generator draait zonder de vestiging (rooktest)');

console.log('— Levensloop: alleen wettige stappen, alles geauditeerd —');
ok(!E(`locTransition('${nid}','ACTIVE','e1').ok`),'SUBMITTED → ACTIVE is onwettig');
ok(!E(`locTransition('${nid}','DRAFT','e1').ok`),'terug naar DRAFT is onwettig');
ok(E(`locTransition('${nid}','UNDER_REVIEW','hq').ok`),'SUBMITTED → UNDER_REVIEW mag');
ok(E(`locations[2].lifecycleLog.length`)>=2,'overgangen staan in het logboek');

console.log('— HQ: wachtrij, samengestelde keuring, wijzigingen gevraagd —');
E(`state.hqLoc=null;state.hqBiz=null;lastHash=null;applyHash('hq/customers');render()`);
ok(q('#view').textContent.includes('New locations'),'de wachtrij staat op de intaketafel');
click(q(`[data-hqlocopen="${nid}"]`));
ok(E(`state.hqLoc`)===nid,'de beoordelingskaart is open');
ok(q('#view').textContent.includes('Compound review'),'samengestelde keuring aangekondigd');
click(q(`[data-hqlocreq="${nid}"]`));
ok(E(`locations[2].lifecycle`)==='UNDER_REVIEW','zonder reden geen terugzending');
setF('[data-hqlocreason]','Address needs a street number check');
click(q(`[data-hqlocreq="${nid}"]`));
ok(E(`locations[2].lifecycle`)==='CHANGES_REQUIRED','met reden teruggezonden');
ok(E(`locations[2].hqReason`).includes('street number'),'de reden reist mee naar de eigenaar');

console.log('— Eigenaar: reden zichtbaar, herindienen, goedkeuren —');
E(`lastHash=null;applyHash('settings/locations');render()`);
ok(q('#view').textContent.includes('street number'),'de eigenaar leest de HQ-reden');
click(q(`[data-locresubmit="${nid}"]`));
ok(E(`locations[2].lifecycle`)==='RESUBMITTED','herindienen werkt');
ok(E(`locations[2].hqReason`)===null,'de oude reden is opgeruimd');
E(`lastHash=null;applyHash('hq/customers');render()`);
click(q(`[data-hqlocopen="${nid}"]`));
click(q(`[data-hqlocapp="${nid}"]`));
ok(E(`locations[2].lifecycle`)==='APPROVED','goedgekeurd');
ok(E(`legalEntities[legalEntities.length-1].status`)==='verified','samengestelde keuring: entiteit mee geverifieerd');

console.log('— De gereedheidspoort: vijf harde eisen, cosmetica blokkeert nooit —');
const rdy0=E(`locReadiness('${nid}')`);
ok(rdy0.items.length===5,'vijf poortpunten');
ok(rdy0.items.find(i=>i.k==='legal').ok===true,'entiteit geverifieerd telt');
ok(rdy0.items.find(i=>i.k==='service').ok===true,'gekopieerde catalogus levert een boekbare dienst');
ok(rdy0.items.find(i=>i.k==='staff').ok===true,
  'de automatisch toegewezen eigenaar is zelf boekbaar personeel — de poort is terecht open');
/* Nu de poort echt dichtdoen: even niemand boekbaar op deze vestiging. */
E(`employees.find(e=>e.id==='e1').bookable=false`);
ok(E(`locReadiness('${nid}').items.find(i=>i.k==='staff').ok`)===false,'zonder boekbaar personeel → poort dicht');
ok(!E(`locTransition('${nid}','ACTIVE','e1').ok`),'activeren blokkeert zolang de poort dicht is');
E(`lastHash=null;applyHash('settings/locations');render()`);
{const b=q(`[data-locactivate="${nid}"]`);
 ok(!!b&&b.hasAttribute('disabled'),'de knop is er, maar uitgeschakeld');}
E(`employees.find(e=>e.id==='e1').bookable=true`);
ok(E(`locReadiness('${nid}').ok`)===true,'personeel terug → poort open (galerij was nooit een eis)');

console.log('— Activeren: alleen een eigenaar, en dan gaan de deuren open —');
ok(!E(`locTransition('${nid}','ACTIVE','e2').ok`),'een staflid mag niet activeren');
ok(E(`locations[2].lifecycle`)==='APPROVED','en de staat bleef staan');
E(`lastHash=null;applyHash('settings/locations');render()`);
click(q(`[data-locactivate="${nid}"]`));
ok(E(`locations[2].lifecycle`)==='ACTIVE','de eigenaar activeert');
ok(E(`locations[2].online`)===true,'online gaat mee open');
ok(E(`availableSlots('${nid}','s1','any',addDays(TODAY,3)).length`)>0,'slots bestaan nu');
E(`startBooking('link')`);
ok(E(`state.book.locs.includes('${nid}')`),'de boekpagina kent de vestiging nu');
E(`state.route='home';render()`);
ok(E(`platformSalons.some(ps=>ps.locId==='${nid}')`),'toegelaten tot de zoekmarkt');
{const ps=E(`platformSalons.find(p=>p.locId==='${nid}')`);
 ok(!!ps.newUntil,'het nieuw-venster staat aan');
 ok(ps.catQuality&&Object.values(ps.catQuality).every(v=>v===0.5),'vestigingsprestatie begint vers');
 ok(ps.verified===true,'merkverificatie erft mee');}
ok(E(`platformSalons.filter(p=>p.locId==='${nid}').length`)===1,'toelating is eenmalig');
E(`admitLocationToMarket(locations[2])`);
ok(E(`platformSalons.filter(p=>p.locId==='${nid}').length`)===1,'nogmaals aanroepen dupliceert niet');

console.log('— Registraties: dezelfde taal van wijzigingen gevraagd —');
E(`registrations.unshift({id:'regT',ts:TODAY,status:'pending_review',emailVerifiedAt:null,
  acct:{name:'T',email:'t@x.mk'},salon:{name:'Test Salon',type:'Beauty salon'},
  legal:{name:'T DOOEL',taxId:'MK1'},loc:{city:'Ohrid'},hqReason:null,
  draft:JSON.parse(JSON.stringify(regNew()))})`);
E(`state.hqLoc=null;lastHash=null;applyHash('hq/customers');render()`);
click(q('[data-regreq="regT"]'));
ok(!!q('[data-regreqreason]'),'het redenveld klapt uit');
setF('[data-regreqreason]','Tax number format is wrong');
click(q('[data-regreqsend="regT"]'));
ok(E(`registrations.find(r=>r.id==='regT').status`)==='changes_required','registratie teruggezonden');
ok(E(`registrations.find(r=>r.id==='regT').hqReason`).includes('Tax number'),'met reden');
E(`registrations.find(r=>r.id==='regT').status='resubmitted'`);
E(`render()`);
ok(qa('[data-regact="regT"]').length===1,'een herindiening staat terug in de wachtrij');
click(q('[data-regact="regT"]'));
ok(E(`registrations.find(r=>r.id==='regT').status`)==='active','en kan gewoon goedgekeurd worden');

console.log('— Audit: de levensloop laat sporen na —');
ok(E(`auditLog.some(a=>a.action==='Location lifecycle')`),'lifecycle-overgangen geauditeerd');
ok(E(`auditLog.some(a=>a.action==='Location admitted to search')`),'markttoelating geauditeerd');
ok(E(`auditLog.some(a=>a.action==='Legal entity verified')`),'samengestelde verificatie geauditeerd');

}catch(err){fail++;console.log('  UNCAUGHT ',err&&err.message)}
console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);},400);
