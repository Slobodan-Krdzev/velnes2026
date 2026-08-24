/* Multi-merchant / multi-legal-entity — het skelet, zonder geld. Toetst:
   de verkoperresolutie (expliciet wint, huis is standaard), belasting
   als data, de routeerdeur, finishSale die de handelsobjecten schrijft
   zonder dat de kassa met één pixel verandert, de deelbetaal-semantiek
   (betaald op slot, alleen mislukt opnieuw, sleutel blijft), en de drie
   schermen die de configuratie tonen — met Aroma Nordic als échte
   missing-config in HQ. */
const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('/home/claude/velnes/index.html','utf8'),{runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document,E=x=>w.eval(x);
const q=s=>d.querySelector(s),qa=s=>[...d.querySelectorAll(s)];
const click=el=>el.dispatchEvent(new w.Event('click',{bubbles:true}));
let pass=0,fail=0;
const ok=(c,msg)=>{if(c){pass++}else{fail++;console.log('  FAIL ',msg)}};
setTimeout(()=>{try{

console.log('— Verkoperresolutie: expliciet wint, het huis is de standaard —');
ok(E(`sellerForLine({id:'s1',qty:1,price:100}).id`)==='le-velnes','een dienst hoort bij het huis');
ok(E(`sellerForLine({id:'p3',qty:1,price:550}).id`)==='le-velnes','een eigen product hoort bij het huis');
ok(E(`sellerForLine({id:'p2',qty:1,price:850}).id`)==='le-beautypro','de arnica-olie hoort juridisch bij BeautyPro');
ok(E(`defaultEntityFor('supplier','sup2').status`)==='pending','Aroma hoort bewust onaf te zijn');
ok(E(`sellerReady(defaultEntityFor('salon',business.id))`)===true,'het huis hoort verkoopklaar te zijn');
ok(E(`sellerReady(defaultEntityFor('supplier','sup1'))`)===true,'BeautyPro hoort verkoopklaar te zijn');
ok(E(`sellerReady(defaultEntityFor('supplier','sup2'))`)===false,'Aroma hoort níet verkoopklaar te zijn');

console.log('— Belasting is data: entiteit + soort → profiel, geen regel in code —');
ok(E(`taxFor('service',defaultEntityFor('salon',business.id))`)==='tax-svc-mk','dienst → dienstprofiel via de tabel');
ok(E(`taxFor('product',defaultEntityFor('supplier','sup1'))`)==='tax-goods-mk','product → goederenprofiel via de tabel');
E(`taxRules.push({legalEntityId:'le-beautypro',itemClass:'product',taxProfileId:'tax-svc-mk'})`);
ok(E(`taxFor('product',defaultEntityFor('supplier','sup1'))`)==='tax-svc-mk','een entiteitsregel hoort van de basisregel te winnen');
E(`taxRules.pop()`);

console.log('— De routeerdeur: één bon, groepen per rekening —');
const routed=E(`JSON.parse(JSON.stringify(routeCheckout([
  {id:'s1',name:'Dienst',qty:1,price:1200},
  {id:'p2',name:'Olie',qty:2,price:850},
  {id:'p3',name:'Tape',qty:1,price:550}])))`);
ok(routed.groups.length===2,'twee verkopers horen twee groepen te zijn: '+routed.groups.length);
const gS=routed.groups.find(g=>g.legalEntityId==='le-velnes');
const gB=routed.groups.find(g=>g.legalEntityId==='le-beautypro');
ok(gS&&gS.amount===1750&&gB&&gB.amount===1700,'de bedragen horen per verkoper te kloppen');
ok(routed.items.every(i=>i.taxProfileId&&i.sellerLegalEntityId),'elke regel hoort verkoper én belastingprofiel te dragen');
ok(gB.paymentAccountId==='pa-beautypro-1','de groep hoort aan de rekening te hangen, niet aan de naam');

console.log('— Afrekenen schrijft de handelsobjecten — de kassa merkt niets —');
E(`resetSale();state.sale=null;state.basket=[
  {id:'s1',name:'Dienst',qty:1,price:1200},
  {id:'p2',name:'Olie',qty:1,price:850}]`);
const coB=E('checkouts.length'), mtxB=E('merchantTransactions.length');
E(`finishSale('card')`);
ok(E('checkouts.length')===coB+1,'er hoort één checkout bij te komen');
ok(E('merchantTransactions.length')===mtxB+2,'en twee merchant-transacties');
const co=E(`JSON.parse(JSON.stringify(checkouts[0]))`);
ok(co.status==='PAID','contant/kaart vandaag: beide groepen betaald → PAID');
ok(/^INV-/.test(co.invoice),'de checkout hoort aan de factuur te refereren');
const ms=E(`JSON.parse(JSON.stringify(merchantTransactions.filter(m=>m.checkoutId==='${co.id}')))`);
ok(Math.abs(ms.reduce((s,m)=>s+m.amount,0)-2050)<0.01,'de transacties horen samen de bon te zijn');
ok(ms.every(m=>m.providerRef===null&&m.legalDocRef===null),'providerRef en legalDocRef horen leeg te wachten op hun milestone');
ok(ms.every(m=>m.idempotencyKey.startsWith(co.id+':')),'elke transactie hoort een idempotency-sleutel te dragen');
ok(co.items.every(i=>i.merchantTransactionId),'elke regel hoort aan zijn transactie vast te zitten (de refund-draad)');
const oil=co.items.find(i=>i.lineId==='p2');
const oilMtx=ms.find(m=>m.id===oil.merchantTransactionId);
ok(oilMtx.legalEntityId==='le-beautypro','de olie hoort aan BeautyPro\u2019s transactie te hangen');

console.log('— De kassa is met geen pixel veranderd —');
E(`state.sale=null;go('register');render()`);
{const gate=q('#view [data-scope]');if(gate&&!q('.pos'))click(gate)}
ok(!!q('.pos'),'de kassa hoort gewoon open te gaan');
ok(!q('#view').textContent.includes('Merchant')&&!q('#view').textContent.includes('merchant'),
  'de kassa hoort nergens over merchants te spreken');
ok(!q('#view [data-mtx]')&&!q('#view [data-checkout-detail]','geen nieuwe elementen op de kassa'),
  'de kassa hoort geen nieuwe elementen te dragen');

console.log('— Deelbetaling: betaald is op slot, alleen mislukt mag opnieuw —');
const mB=ms.find(m=>m.legalEntityId==='le-beautypro').id;
ok(E(`mtxDemoFail('${mB}')`)===true,'de demo-deur hoort een betaalde groep te kunnen laten mislukken');
ok(E(`checkouts[0].status`)==='PARTIALLY_PAID','de checkout hoort dan PARTIALLY_PAID te zijn');
const mS=ms.find(m=>m.legalEntityId==='le-velnes').id;
const keyBefore=E(`merchantTransactions.find(m=>m.id==='${mB}').idempotencyKey`);
ok(E(`mtxRetry('${mS}')`)===false,'de betaalde salongroep hoort op slot te zitten');
ok(E(`merchantTransactions.find(m=>m.id==='${mS}').status`)==='paid','en betaald te blijven');
ok(E(`mtxRetry('${mB}')`)===true,'alleen de mislukte groep hoort opnieuw te mogen');
ok(E(`merchantTransactions.find(m=>m.id==='${mB}').idempotencyKey`)===keyBefore,
  'de idempotency-sleutel hoort bij de retry dezelfde te blijven');
ok(E(`checkouts[0].status`)==='PAID','daarna hoort de checkout weer PAID te zijn');

console.log('— Onaffe configuratie: eerlijk gemarkeerd, nooit stil verkeerd gerouteerd —');
E(`products.find(p=>p.id==='p3').sellerLegalEntityId='le-aroma'`);
E(`resetSale();state.sale=null;state.basket=[{id:'p3',name:'Tape',qty:1,price:550}]`);
E(`finishSale('cash')`);
ok(E(`merchantTransactions[merchantTransactions.length-1].status`)==='config_incomplete',
  'een groep zonder complete verkoper hoort config_incomplete te heten');
ok(E(`mtxRetry(merchantTransactions[merchantTransactions.length-1].id)`)===false,
  'geld ophalen zonder configuratie hoort geweigerd te worden');
ok(E(`checkouts[0].status`)==='FAILED','de checkout hoort dat eerlijk te dragen');
E(`delete products.find(p=>p.id==='p3').sellerLegalEntityId`);

console.log('— HQ: de diagnose-plek — Aroma vraagt zichtbaar om afronding —');
E(`go('hq');state.hqTab='suppliers';render()`);
ok(q('#view').textContent.includes('MID-90417-BP'),'BeautyPro\u2019s Merchant ID hoort in de lijst te staan');
ok(q('#view').textContent.includes('Missing config'),'de missing-config-markering hoort er te staan');
const chip=q('#view [data-hqmiss]');
ok(!!chip,'het filter hoort er als chip te staan');
click(chip);
ok(!q('#view').textContent.includes('BeautyPro MK DOO'),'gefilterd hoort BeautyPro (compleet) weg te zijn');
ok(q('#view').textContent.includes('Aroma Nordic'),'en Aroma (onaf) te blijven');
click(q('#view [data-hqmiss]'));

console.log('— De lade: betaalidentiteit bovenin, kaarten die niet dichtknijpen —');
E(`state.hqSup='sup1';render()`);
{const rev=qa('#view [data-panel^="hqSupplierEdit|"]').find(b=>b.dataset.panel.endsWith('sup1'));
click(rev);}
const pb=q('.panel-body');
ok(!!pb,'de lade hoort open te gaan');
ok(pb.firstElementChild&&pb.firstElementChild.textContent.includes('Merchant ID')
  &&pb.firstElementChild.textContent.includes('MID-90417-BP'),
  'de betaalidentiteit hoort het éérste in de lade te zijn');
ok((pb.textContent.match(/Merchant ID/g)||[]).length===1,'en maar één keer — één waarheid per lade');
ok(w.getComputedStyle(pb.firstElementChild).flexShrink==='0',
  'kaarten in de lade horen niet te kunnen krimpen (de knijp-bug)');
E('closePanel(true)');E('state.hqSup=null');

console.log('— Portal: de leverancier ziet zijn eigen configuratie, alleen-lezen —');
E(`go('portal');state.portalTab='dashboard';render()`);
ok(q('#view').textContent.includes('MID-90417-BP'),'de portal hoort de eigen Merchant ID te tonen');
ok(q('#view').textContent.includes('Read-only'),'en eerlijk te zeggen dat HQ hem beheert');
ok(!q('#view').textContent.toLowerCase().includes('secret')&&!q('#view').textContent.toLowerCase().includes('api key'),
  'geheimen horen nergens te staan');

console.log('— Saloninstellingen: de eigen entiteit, bescheiden —');
E(`go('settings');state.settingsTab='company';render()`);
ok(q('#view').textContent.includes('Legal & payments'),'de kaart hoort op het bedrijfstabblad te staan');
ok(q('#view').textContent.includes('MID-88214-VS'),'met de eigen Merchant ID');
ok(q('#view').textContent.includes('Velnes Studio DOOEL'),'en de juridische naam');

console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
}catch(e){console.log('CRASH',e);process.exit(1)}},400);
