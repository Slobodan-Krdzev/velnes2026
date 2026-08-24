/* Velnes Premium — het lidmaatschap is van het platform, de eigenaar
   is de poort. Toetst: harde uitfasering van de salonplannen, de
   status-deur, ×1,5 punten, het alleen-lezen regelpaneel, de
   aanbeveling → Approve/Decline → trapsgewijze ledenaanbieding,
   producttesten op basisniveau, en de rechten. */
const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('/home/claude/velnes/index.html','utf8'),{runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document,E=x=>w.eval(x);
const q=s=>d.querySelector(s),qa=s=>[...d.querySelectorAll(s)];
let pass=0,fail=0;
const ok=(c,msg)=>{if(c){pass++}else{fail++;console.log('  FAIL ',msg)}};
setTimeout(()=>{try{

console.log('— Harde uitfasering: de salonplannen zijn wég —');
ok(E('typeof membershipPlans')==='undefined','membershipPlans hoort niet meer te bestaan');
ok(E('typeof membershipOf')==='undefined'&&E('typeof membershipBenefit')==='undefined',
  'de oude deuren horen niet meer te bestaan');
ok(E('typeof PANELS.membershipNew')==='undefined','de inschrijflade hoort weg te zijn');
const kinds=E(`priceFor({sid:'s1',locId:'loc-centar',custId:'c4',date:TODAY}).options.map(o=>o.kind).join('|')`);
ok(!/membership/.test(kinds),'de prijsmotor hoort geen abonnementsoptie meer te kennen: '+kinds);

console.log('— De ene deur: isPremium —');
ok(E(`isPremium('c4')`)===true&&E(`isPremium('c1')`)===true,'c4 en c1 horen actieve leden te zijn');
ok(E(`isPremium('c6')`)===false,'een verlopen lid hoort niet als actief te gelden');
ok(E(`isPremium('c2')`)===false,'een niet-lid hoort geen lid te zijn');
ok(E('premiumMembers().length')===2,'er horen precies twee actieve leden te zijn');
E(`VELNES_HQ.premium.enabled=false`);
ok(E(`isPremium('c4')`)===false,'de HQ-schakelaar hoort alles uit te kunnen zetten');
E(`VELNES_HQ.premium.enabled=true`);

console.log('— Kassa: ×1,5 punten, met naam op de bon —');
E(`window.A4=appointments.find(x=>x.cust==='c4'&&x.kind==='appointment')`);
E(`state.basket=[{id:A4.id,name:A4.service,qty:1,price:1800,kind:'service'}];finishSale('cash')`);
const led=E('loyaltyLedger[loyaltyLedger.length-1]');
ok(led.points===45,'een lid hoort 45 punten te krijgen over 1800 (×1,5): '+led.points);
ok(led.reason.includes('×1.5 Velnes Premium'),'de bonregel hoort de factor te benoemen');
E(`window.A2=appointments.find(x=>x.cust==='c2'&&x.kind==='appointment')`);
E(`state.basket=[{id:A2.id,name:A2.service,qty:1,price:1800,kind:'service'}];finishSale('cash')`);
const led2=E('loyaltyLedger[loyaltyLedger.length-1]');
ok(led2.points===30&&!led2.reason.includes('Velnes'),'een niet-lid hoort ×1 zonder etiket te krijgen');

console.log('— Klantpagina en bewerklade: alleen-lezen status —');
E(`go('customers',null);state.param='c4';state.profileTab='premium';render()`);
ok(q('#view').textContent.includes('Member since'),'de Premium-tab hoort de status te tonen');
ok(q('#view').textContent.includes('Velnes Premium'),'het naamplaatje hoort op de identiteitskaart');
ok(!q('#view [data-msnew]'),'er hoort geen inschrijfknop meer te bestaan');
E(`state.param='c6';render()`);
ok(q('#view').textContent.includes('expired')&&q('#view').textContent.includes('Ended'),
  'een verlopen lid hoort de status verlopen te zien, met einddatum');
ok(!q('#view .badge.accent')||!q('#view .badge.accent').textContent.includes('Velnes Premium'),
  'een verlopen lid hoort geen actief naamplaatje te dragen');
E(`state.param=null;state.profileTab='appointments'`);

console.log('— Marketing › Velnes Premium: regels alleen-lezen, kans wacht —');
E(`go('marketing');state.marketingTab='premium';render()`);
ok(!!q('[data-premrules]'),'het regelpaneel staat er niet');
ok(q('[data-premrules]').textContent.includes('read-only')
  &&q('[data-premrules]').textContent.includes('50%'),'de regels horen alleen-lezen en met het plafond te staan');
ok(!q('[data-premrules] input:not([disabled])')&&!q('[data-premrules] select'),
  'er hoort niets aan de regels te bewerken te zijn');
ok(qa('[data-recrow]').length===1,'er hoort precies één aanbeveling te wachten');
const rec=E('memberRecs[0]');
ok(rec.recPct<=E('VELNES_HQ.premium.rules.maxDiscountPct'),'de aanbevolen korting hoort binnen het plafond te blijven');
ok(rec.candidates.length===2&&rec.candidates[0].score>=rec.candidates[1].score,
  'de kandidaten horen gerangschikt te staan');
ok(!!q('[data-recpreview]'),'de minimale ledenweergave hoort erbij te staan');
ok(q('[data-recrow] details').textContent.length>10,'het waarom hoort uitklapbaar bij de beste kandidaat');

console.log('— De at-risk als zácht signaal —');
const katScore=E(`memberScore('c1',{sid:memberRecs[0].sid,empId:memberRecs[0].empId,date:memberRecs[0].date,hour:parseInt(memberRecs[0].start,10)})`);
ok(katScore.why.some(x=>/at-risk/.test(x)),'Katerina hoort het at-risk-signaal te dragen');
const marScore=E(`memberScore('c4',{sid:memberRecs[0].sid,empId:memberRecs[0].empId,date:memberRecs[0].date,hour:parseInt(memberRecs[0].start,10)})`);
ok(!marScore.why.some(x=>/at-risk/.test(x))&&marScore.score>0,
  'een lid zonder achterstand hoort gewoon mee te scoren — at-risk is geen voorwaarde');

console.log('— Approve → trapsgewijs venster → publiek → dicht —');
q('[data-recapp]').click();
ok(E('memberRecs[0].status')==='approved'&&E('premiumOffers.length')===1,
  'goedkeuren hoort de ledenaanbieding te starten');
ok(E('premiumOffers[0].stage')===1,'het venster hoort bij het beste lid te beginnen');
ok(E(`custActivityFor(memberRecs[0].candidates[0].cid)`)[0].type==='member_offer_sent',
  'het logboek mist member_offer_sent');
ok(q('#view').textContent.includes('Advance stage · demo'),'de tijdknop hoort eerlijk als demo gelabeld te staan');
q('[data-pmoadv]').click();
ok(E('premiumOffers[0].stage')===2,'stap twee hoort de ledengroep te zijn');
q('[data-pmoadv]').click();
ok(E('premiumOffers[0].stage')===3,'stap drie hoort publiek te zijn (regel publicFallback aan)');
ok(E(`custActivity.some(a=>a.type==='public_fallback')`),'het logboek mist public_fallback');
q('[data-pmoadv]').click();
ok(E('premiumOffers[0].status')==='expired','daarna hoort het venster dicht te zijn');
ok(qa('[data-pmoadv]').length===0,'een gesloten venster hoort geen demoknop meer te dragen');

console.log('— Decline is ook een uitkomst —');
E(`memberRecs.push({id:'recX',locationId:'loc-centar',date:addDays(TODAY,1),start:'11:00',end:'12:00',sid:'s1',empId:null,normalPrice:1800,recPct:20,recPrice:1440,candidates:[{cid:'c4',name:'Marija Angelovska',score:10,why:[]}],status:'pending',offerId:null,createdAt:TODAY});render()`);
qa('[data-recdec]').slice(-1)[0].click();
ok(E(`memberRecs.find(r=>r.id==='recX').status`)==='declined','afwijzen hoort vastgelegd te worden');
ok(E(`custActivity.some(a=>a.type==='rec_declined')`),'het logboek mist rec_declined');
ok(E('premiumOffers.length')===1,'afwijzen hoort géén aanbieding te maken');

console.log('— Producttesten: omschrijving, beeld en een gericht lid —');
E(`go('marketing');state.marketingTab='premium';render()`);
ok(!!q('[data-set="tpDesc"]'),'het omschrijvingsveld hoort in het formulier');
ok(!!q('[data-tpfile]')&&q('[data-tpfile]').getAttribute('accept')==='image/*'
  &&q('[data-tpfile]').type==='file','de foto hoort als bestand aan te hechten te zijn');
const lbls=qa('[data-testops] .field > span').map(s=>s.textContent.replace('*','').trim());
ok(lbls.includes('Product')&&lbls.includes('Description')&&lbls.includes('Product photo')
  &&lbls.includes('Invite a specific member'),
  'de velden horen echte labels te dragen, geen placeholders als naam: '+lbls.join(', '));
const og=qa('[data-tpmember] optgroup').map(o=>o.label);
ok(og.length===2&&/Your customers/.test(og[0])&&/other salons/.test(og[1]),
  'de keuzelijst hoort eigen leden vóór de platformleden te tonen: '+og.join(' | '));
ok(qa('[data-tpmember] optgroup')[0].querySelectorAll('option').length===2
  &&qa('[data-tpmember] optgroup')[1].querySelectorAll('option').length===3,
  'eigen leden (2) en platformleden (3) horen elk in hun groep');
E(`state.tpName='Recovery oil';state.tpSid='';state.tpQty=1;state.tpDesc='Cold-pressed arnica blend for post-treatment care';state.tpImg='data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';state.tpImgName='oil.png';render()`);
ok(q('#view').textContent.includes('Replace image')&&q('#view').textContent.includes('oil.png'),
  'met een foto hoort het veld Vervangen en de bestandsnaam te tonen');
E(`state.tpMember='pm2';render()`);
q('[data-tpnew]').click();
ok(E('testOps[0].desc').includes('arnica')&&E('testOps[0].img').startsWith('data:image/'),
  'omschrijving en foto (als data-URL) horen op de test te staan');
ok(E('state.tpName')===''&&E('state.tpImg')===''&&E('state.tpMember')==='',
  'na aanmaken hoort het formulier schoon te zijn');
ok(E('testOps[0].invited[0].cid')==='pm2'&&E('testOps[0].invited[0].picked')===true,
  'het gekozen platformlid hoort gegarandeerd bovenaan');
ok(q('[data-tprow]').textContent.includes('Wellness Point'),'de thuissalon hoort bij een platformlid te staan');
ok(!!q('[data-tpdesc]')&&q('[data-tprow] img'),'omschrijving en beeld horen in de rij te staan');
ok(E('testOps[0].invited.length')===2&&E('testOps[0].invited[1].cid')!=='pm2',
  'de koppeling hoort de resterende uitnodiging te vullen');
E(`tpRespond('tp1','pm2',true)`);
ok(E('testOps[0].status')==='filled','een platformlid hoort gewoon te kunnen accepteren');

console.log('— Producttesten: kans → koppeling → uitnodiging —');
E(`state.tpName='New serum';state.tpSid='s2';state.tpQty=1;state.tpDesc='';state.tpImg='';state.tpMember='';render()`);
q('[data-tpnew]').click();
ok(E('testOps.length')===2&&E('testOps[1].invited.length')===2,
  'de test hoort twee leden uit te nodigen (2× het aantal plekken)');
ok(E(`custActivity.filter(a=>a.type==='test_invited').length`)===4,'het logboek mist de uitnodigingen');
q('[data-tpdecl]').click();
ok(E('testOps[1].invited.some(i=>i.status==="declined")'),'afslaan hoort vastgelegd te worden');
q('[data-tpacc]').click();
ok(E('testOps[1].status')==='filled'&&E('testOps[1].left')===0,'de laatste plek hoort de test te vullen');
ok(E('testOps[1].invited.every(i=>i.status!=="invited")'),'na vulling horen open uitnodigingen te sluiten');

console.log('— Flightdeck: de kans klopt aan op het thuisscherm —');
E(`memberRecs.push({id:'recY',locationId:'loc-centar',date:addDays(TODAY,1),start:'15:00',end:'16:00',sid:'s2',empId:'e1',normalPrice:2400,recPct:30,recPrice:1680,candidates:[{cid:'c4',name:'Marija Angelovska',score:55,why:['booked before']}],status:'pending',offerId:null,createdAt:TODAY})`);
E(`go('home')`);
ok(!!q('[data-fdrec]'),'de aanbevelingskaart hoort op het flightdeck te staan');
ok(!q('[data-fdrec]').textContent.includes('Marija'),
  'de kaart hoort géén kandidaten meer te noemen — dat dossier hoort op het Premium-scherm');
ok(!q('[data-fdrec] [data-recapp]')&&!q('[data-fdrec] [data-recdec]'),
  'goedkeuren en afslaan horen niet meer op het thuisscherm');
ok(q('[data-fdrec]').textContent.includes('worth'),'de kaart hoort te zeggen wat de kansen waard zijn');
ok(!!q('[data-fdrec] [data-go="marketing"]'),'de ene knop hoort naar Velnes Premium te wijzen');
ok(q('#view').textContent.includes('Send member offer')&&!q('#view').textContent.includes('Send VIP offer'),
  'de VIP-taal hoort overal vervangen te zijn');
E(`state.marketingTab='overview'`);
q('[data-fdrec] [data-go="marketing"]').click();
ok(E('state.route')==='marketing'&&E('state.marketingTab')==='premium',
  'de knop hoort op het Velnes Premium-scherm uit te komen — tab en al');
q('[data-recapp="recY"]').click();
ok(E(`memberRecs.find(r=>r.id==='recY').status`)==='approved',
  'goedkeuren hoort dáár te werken, met de context eromheen');

console.log('— Rechten: kijken is breed, handelen is gegund —');
E(`session.userId='e4';go('marketing');render()`);
ok(!q('[data-premrules]'),'de balie hoort het marketingscherm (en dus het paneel) niet te zien');
E(`window.RB=memberRecs.length;memberRecs.push({id:'recZ',locationId:'loc-centar',date:addDays(TODAY,1),start:'10:00',end:'11:00',sid:'s1',empId:null,normalPrice:1800,recPct:20,recPrice:1440,candidates:[{cid:'c1',name:'Katerina',score:9,why:[]}],status:'pending',offerId:null,createdAt:TODAY})`);
E(`recApprove('recZ')`);
ok(E(`memberRecs.find(r=>r.id==='recZ').status`)==='pending','de poort hoort goedkeuren zonder recht te weigeren');
E(`window.TPB=testOps.length;tpCreate('X','',1)`);
ok(E('testOps.length')===E('TPB'),'de poort hoort testaanmaak zonder recht te weigeren');
E(`session.userId='e1'`);

console.log('— De regels van de aanbiedingslade spreken ledentaal —');
E(`go('marketing');state.marketingTab='offers';render()`);
E(`state.offerDraft=offerDraftInit('loc-centar',addDays(TODAY,1))`);
ok(E('state.offerDraft.caps.length')>0,'zonder gaten valt er niets te toetsen');
/* De klok uit de toets: de standaard vipFrom is "nu + aanlooptijd" en
   loopt 's avonds voorbij vipUntil, waardoor saveOffer terecht weigert.
   De toets prikt het venster vast — determinisme boven wandklok. */
E(`state.offerDraft.vipFrom='07:00';state.offerDraft.vipUntil='08:30'`);
E(`saveOffer()`);
const aud=E("offers[0].phases.map(p=>p.audience).join('|')");
ok(aud==='PREMIUM_MEMBERS|PUBLIC','fase één hoort van de leden te zijn: '+aud);
ok(E(`phaseAllows({audience:'PREMIUM_MEMBERS'},'c4')`)===true
 &&E(`phaseAllows({audience:'PREMIUM_MEMBERS'},'c2')`)===false,
  'de poort hoort leden binnen en niet-leden buiten te laten');

console.log(`${pass}/${pass+fail} geslaagd`);
}catch(e){console.log('SUITE ERR',e.message,(e.stack||'').split('\n')[1]);console.log(`${pass}/${pass+fail} geslaagd`)}},2500);
