/* Kassa + widget door priceFor() — de prijs die je belooft is de prijs
   die je rekent, overal, vanzelf. Toetst: de twee nieuwe soorten in de
   deur, herprijzen als de klant aan de bon komt, inlossen bij betalen
   (één keer, met bonnummer), de boekingsflow door dezelfde deur, en de
   handmatige knop als gelogde correctie. Aanbiedingen worden expliciet
   door de toets zelf opgevoerd (zelfde regel als memberRecs). */
const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('/home/claude/velnes/index.html','utf8'),{runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document,E=x=>w.eval(x);
const q=s=>d.querySelector(s);
let pass=0,fail=0;
const ok=(c,msg)=>{if(c){pass++}else{fail++;console.log('  FAIL ',msg)}};
setTimeout(()=>{try{

const BASE=E(`priceFor({sid:'s1',locId:'loc-centar'}).base`);
ok(BASE>0,'s1 hoort een lijstprijs te hebben');

console.log('— De deur: persoonlijke aanbieding —');
E(`personalOffers.push({id:'poT1',customerId:'c2',businessId:'biz-velnes',locationId:'loc-centar',
  sid:'s1',variantId:null,empId:null,normalPrice:${BASE},specialPrice:${BASE}-310,discountPct:20,
  validFrom:TODAY,validUntil:TODAY,status:'live',createdAt:TODAY,createdBy:'u1',intent:'toets'})`);
const r1=E(`priceFor({sid:'s1',locId:'loc-centar',custId:'c2'})`);
ok(r1.effective===BASE-310&&r1.best.kind==='personal','de belofte hoort de prijs te zijn voor c2');
ok(r1.best.poId==='poT1'&&r1.discounted===true,'de deur hoort te weten wélke belofte, en dat er korting is');
ok(E(`priceFor({sid:'s1',locId:'loc-centar',custId:'c3'}).effective`)===BASE,'een ander hoort de lijstprijs te zien');
ok(E(`priceFor({sid:'s2',locId:'loc-centar',custId:'c2'}).best.kind`)!=='personal','een andere dienst hoort niet mee te liften');
E(`personalOffers.find(p=>p.id==='poT1').validUntil='2026-01-01'`);
ok(E(`priceFor({sid:'s1',locId:'loc-centar',custId:'c2'}).effective`)===BASE,'een verlopen belofte hoort te zwijgen');
E(`personalOffers.find(p=>p.id==='poT1').validUntil=TODAY`);

console.log('— De deur: ledenaanbieding, trapsgewijs zichtbaar —');
E(`premiumOffers.push({id:'pmoT1',recId:'x',locationId:'loc-centar',date:TODAY,start:'10:00',end:'11:00',
  sid:'s2',empId:'e1',normalPrice:1800,pct:40,price:1080,stage:1,status:'live',createdAt:TODAY,
  candidates:[{cid:'c4',name:'Vier'},{cid:'c1',name:'Een'}]})`);
ok(E(`priceFor({sid:'s2',locId:'loc-centar',custId:'c4'}).best.kind`)==='member','fase 1: het beste lid hoort hem te zien');
ok(E(`priceFor({sid:'s2',locId:'loc-centar',custId:'c1'}).best.kind`)!=='member','fase 1: het tweede lid nog niet');
E(`premiumOffers.find(o=>o.id==='pmoT1').stage=2`);
ok(E(`priceFor({sid:'s2',locId:'loc-centar',custId:'c1'}).best.kind`)==='member','fase 2: de groep hoort erbij');
ok(E(`priceFor({sid:'s2',locId:'loc-centar',custId:'c2'}).best.kind`)!=='member','fase 2: een niet-kandidaat niet');
E(`premiumOffers.find(o=>o.id==='pmoT1').stage=3`);
ok(E(`priceFor({sid:'s2',locId:'loc-centar'}).best.kind`)==='member','fase 3: iedereen, ook zonder klant');
ok(E(`priceFor({sid:'s2',locId:'loc-centar'}).best.label`)==='Special offer','publiek hoort geen ledentaal te dragen');
E(`premiumOffers.find(o=>o.id==='pmoT1').stage=1`);

console.log('— Goedkoopste eerlijke prijs wint —');
E(`personalOffers.push({id:'poT2',customerId:'c4',businessId:'biz-velnes',locationId:'loc-centar',
  sid:'s2',variantId:null,empId:null,normalPrice:1800,specialPrice:900,discountPct:50,
  validFrom:TODAY,validUntil:TODAY,status:'live',createdAt:TODAY,createdBy:'u1',intent:'toets'})`);
const r2=E(`priceFor({sid:'s2',locId:'loc-centar',custId:'c4'})`);
ok(r2.effective===900&&r2.best.kind==='personal','900 (belofte) hoort van 1080 (ledenprijs) te winnen');

console.log('— De kassa: de klant komt ná de regels, de prijs volgt —');
E(`resetSale()`);
E(`state.basket=[{id:'s1',name:'Dienst',price:${BASE},qty:1}]`);
E(`tillReprice()`);
ok(E(`state.basket[0].price`)===BASE,'zonder klant hoort de lijstprijs te staan');
E(`window.AP2=appointments.find(x=>x.cust==='c2'&&x.kind==='appointment')`);
E(`state.basket.push({id:AP2.id,name:'Afspraak',price:AP2.price,qty:1});tillReprice()`);
ok(E(`state.basket[0].price`)===BASE-310,'mét c2 aan de bon hoort de dienstregel de belofte te dragen');
ok(E(`state.basket[0].base`)===BASE&&E(`state.basket[0].poId`)==='poT1','de regel hoort basis en belofte te onthouden');
E(`state.basket[0].disc=100;tillReprice()`);
ok(E(`state.basket[0].disc`)===100,'een handmatige regelkorting hoort het herprijzen te overleven');
E(`state.basket=state.basket.filter(l=>l.id!==AP2.id);tillReprice()`);
ok(E(`state.basket[0].price`)===BASE&&!E(`state.basket[0].poId`),'klant eraf, lijstprijs terug');

console.log('— Betalen lost in: één keer, met bonnummer —');
E(`resetSale()`);
E(`state.basket=[{id:'s1',name:'Dienst',price:${BASE},qty:1},{id:AP2.id,name:'Afspraak',price:AP2.price,qty:1}]`);
E(`tillReprice()`);
const actsBefore=E('custActivity.length');
E(`finishSale('cash')`);
ok(E(`personalOffers.find(p=>p.id==='poT1').status`)==='redeemed','betalen hoort de belofte in te lossen');
const act=E(`custActivity[custActivity.length-1]`);
ok(act.type==='offer_redeemed'&&act.meta&&/^INV-/.test(act.meta.invoice),'de gebeurtenis hoort het bonnummer te dragen');
ok(!act.meta.override,'de kassaweg is geen correctie');
E(`state.basket=[{id:'s1',name:'Dienst',price:${BASE}-310,qty:1,poId:'poT1'}];finishSale('cash')`);
ok(E(`custActivity.filter(a=>a.type==='offer_redeemed'&&a.refId==='poT1').length`)===1,
  'twee keer inlossen hoort onmogelijk te zijn');

console.log('— Ledenaanbieding aan de kassa —');
E(`resetSale()`);
E(`window.AP4=appointments.find(x=>x.cust==='c4'&&x.kind==='appointment')`);
E(`premiumOffers.find(o=>o.id==='pmoT1').sid=AP4?'s2':'s2'`);
E(`personalOffers.find(p=>p.id==='poT2').status='cancelled'`);
E(`state.basket=[{id:'s2',name:'Dienst 2',price:1800,qty:1},{id:AP4.id,name:'Afspraak',price:AP4.price,qty:1}]`);
E(`tillReprice()`);
ok(E(`state.basket[0].pmoId`)==='pmoT1'&&E(`state.basket[0].price`)===1080,'het beste lid hoort de ledenprijs te krijgen');
E(`finishSale('card')`);
ok(E(`premiumOffers.find(o=>o.id==='pmoT1').status`)==='booked','betalen hoort het venster te sluiten');
ok(E(`custActivity[custActivity.length-1].type`)==='member_offer_redeemed','met de eigen gebeurtenis');

console.log('— De boekingsflow: zelfde deur, herkende bezoeker —');
E(`personalOffers.push({id:'poT3',customerId:'c2',businessId:'biz-velnes',locationId:'loc-centar',
  sid:'s1',variantId:null,empId:null,normalPrice:${BASE},specialPrice:${BASE}-500,discountPct:28,
  validFrom:TODAY,validUntil:TODAY,status:'live',createdAt:TODAY,createdBy:'u1',intent:'toets'})`);
E(`window.C2=customers.find(c=>c.id==='c2')`);
E(`state.route='book';state.book={step:5,source:'link',loc:'loc-centar',svc:'s1',emp:'any',emp2:null,
  date:TODAY,time:'10:00',name:C2.name,phone:C2.phone||'',email:C2.email||'',vid:null,mods:[],
  couponOk:false,accent:'#000',key:'idem_toets1'};render()`);
ok(q('#view').textContent.includes('Personal offer'),'de samenvatting hoort de belofte te benoemen');
ok(!!q('#view s.tnum'),'de oude prijs hoort er doorgestreept bij te staan');
E(`state.book.email='onbekend@voorbeeld.mk';state.book.phone='';state.book.name='Gast';render()`);
ok(!q('#view').textContent.includes('Personal offer'),'een gast hoort geen andermans belofte te zien');

console.log('— Vastleggen vraagt de deur opnieuw; de kassa lost later in —');
E(`window.APB=confirmReservation({key:'idem_toets2',locationId:'loc-centar',svc:'s1',emp:'any',
  date:nextOpenDate(TODAY),time:(availableSlots('loc-centar','s1','any',nextOpenDate(TODAY)).find(s=>s.free)||{}).t,
  name:C2.name,phone:C2.phone||'',email:C2.email||'',vid:null,mods:[],source:'widget',deposit:0,widget:'w1'})`);
ok(!!E('window.APB'),'de reservering hoort te lukken');
ok(E('APB.poId')==='poT3'&&E('APB.price')===BASE-500,'de afspraak hoort belofte en beloofde prijs vast te leggen');
E(`resetSale();state.basket=[{id:APB.id,name:'Afspraak',price:APB.price,qty:1}];finishSale('cash')`);
ok(E(`personalOffers.find(p=>p.id==='poT3').status`)==='redeemed','afrekenen van de boeking hoort de belofte in te lossen');

console.log('— De bon: dienst vet, klant in de ondertoon —');
E(`resetSale();state.sale=null;state.basket=[{id:AP2.id,name:apptLineName(AP2),price:AP2.price,qty:1}];go('register');render()`);
{const gate=q('#view [data-scope]');if(gate&&!q('.pos')){gate.dispatchEvent(new w.Event('click',{bubbles:true}))}}
const bold=q('#view .basket-line .bold');
ok(!!bold&&!bold.textContent.includes(' · '),'de vette regel hoort alleen de dienst te dragen');
ok(!!bold&&bold.textContent.trim()===E('AP2.service'),'en wel precies die dienst');
const cname=E('(customers.find(c=>c.id===AP2.cust)||{}).name');
ok(!!q('#view .basket-line .bl-name')&&q('#view .basket-line .bl-name').textContent.includes(cname),'de klant hoort er in de ondertoon onder te staan');
E(`resetSale()`);

console.log('— De handmatige knop is een gelogde correctie —');
E(`personalOffers.push({id:'poT4',customerId:'c3',businessId:'biz-velnes',locationId:'loc-centar',
  sid:'s1',variantId:null,empId:null,normalPrice:${BASE},specialPrice:${BASE}-100,discountPct:6,
  validFrom:TODAY,validUntil:TODAY,status:'live',createdAt:TODAY,createdBy:'u1',intent:'toets'})`);
E(`poRedeem('poT4')`);
const oa=E(`custActivity[custActivity.length-1]`);
ok(oa.type==='offer_redeemed'&&oa.meta&&oa.meta.override===true,'de correctie hoort als correctie gelogd te worden');
E(`go('marketing');state.marketingTab='offers';render()`);
ok(!q('#view').textContent.includes('Mark as redeemed'),'het oude etiket hoort weg te zijn');

console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
}catch(e){console.log('CRASH',e);process.exit(1)}},400);
