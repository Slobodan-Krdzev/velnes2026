const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),
  {runScripts:'dangerously',url:'http://x/#register',pretendToBeVisual:true});
const w=dom.window,d=w.document;
let pass=0,fail=0;const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL '+m))};
const q=s=>d.querySelector(s), qa=s=>[...d.querySelectorAll(s)];

// vestiging kiezen als de kassa erom vraagt
const gate=q('[data-scope]'); if(gate&&q('.pos')===null)gate.click();

console.log("— De kassa opent op Today's —");
const openTabs=qa('[data-postype]').map(b=>b.textContent.trim());
ok(openTabs[0]==="Today's",'de eerste tab is niet Today\'s: '+openTabs[0]);
ok(w.eval('state.posType')==='appointments',
  "de kassa opent niet op Today's: "+w.eval('state.posType'));
ok(q('[data-postype="appointments"]').classList.contains('on'),
  "de Today's-tab staat niet aan bij openen");
/* Zelfde stand als een klik op de tab: het lopende uur, of alles als de
   praktijk vandaag dicht is. */
ok(w.eval("state.posCategory===(tillHours()[0]||'all')"),
  'de kassa opent niet op het lopende uur: '+w.eval('state.posCategory'));

/* De blokken hierna gaan over diensten en producten; die stand zetten we zelf. */
q('[data-postype="services"]').click();

console.log('— Categoriekolom —');
const cats=qa('.pos-cats .catbtn');
ok(cats.length>0,'geen categorietegels');
ok(qa('.pos-cats .catchip').length===0,'oude catchip staat er nog');
ok(cats.every(b=>b.querySelector('.catbtn-ic svg')),'tegel zonder icoon');
ok(cats.every(b=>b.querySelector('.catbtn-l').textContent.trim()),'tegel zonder naam');
ok(cats.filter(b=>b.classList.contains('on')).length===1,'niet precies één actief');
console.log('   ',cats.map(b=>b.querySelector('.catbtn-l').textContent.trim()).join(' | '));

console.log('— Producttegel —');
const tile=t=>qa('.pos-tile')[t||0];
ok(qa('.pos-tile').length>0,'geen tegels');
const t0=tile();
const order=[...t0.children].map(e=>e.className);
ok(order[0]==='ptile-img','afbeelding staat niet bovenaan: '+order[0]);
ok(order[1]==='ptile-n','naam staat niet onder de afbeelding: '+order[1]);
ok(order.length===2,'tegel draagt meer dan foto en naam: '+order.join(','));
ok(!t0.querySelector('.ptile-m'),'metaregel staat er nog');
ok(!t0.querySelector('.ptile-foot'),'de voetregel staat er nog');
ok(!!t0.querySelector('.ptile-img > .ptile-p'),'prijs ligt niet op de foto');
ok(!t0.querySelector('.ptile-q'),'aantal zichtbaar zonder dat er iets op de bon staat');

console.log('— Aantal verschijnt na toevoegen (product) —');
const toProducts=()=>{const b=q('[data-postype="products"]');if(b)b.click()};
toProducts();
const byName=n=>qa('.pos-tile').find(x=>x.querySelector('.ptile-n').textContent.trim()===n);
const p0=qa('.pos-tile').find(x=>!x.querySelector('.ptile-q'));
ok(!!p0,'geen producttegel zonder aantal gevonden');
const pname=p0.querySelector('.ptile-n').textContent.trim();
p0.click();
let t1=byName(pname), b1=t1&&t1.querySelector('.ptile-q');
ok(!!b1,'geen aantal op de tegel na toevoegen');
ok(b1&&b1.textContent.replace(/\s/g,'').includes('1'),'aantal is niet 1: '+(b1&&b1.textContent));
ok(t1&&t1.classList.contains('in-cart'),'tegel mist in-cart markering');
ok(!!t1.querySelector('.ptile-img > .ptile-q'),'aantal ligt niet op de foto');
byName(pname).click();
let b2=byName(pname).querySelector('.ptile-q');
ok(b2&&b2.textContent.replace(/\s/g,'').includes('2'),'aantal telt niet op: '+(b2&&b2.textContent));

console.log('— Dienst met opties telt onder zijn eigen tegel —');
const toServices=()=>{const b=q('[data-postype="services"]');if(b)b.click()};
toServices();
const s0=qa('.pos-tile').find(x=>x.dataset.add.split('|')[0]==='s1');
const sname=s0.querySelector('.ptile-n').textContent.trim();
const had=s0.querySelector('.ptile-q');
s0.click();
const done=q('[data-optdone]');
ok(!!done,'optiescherm opent niet');
if(done)done.click();
toServices();
const s1=byName(sname), sb=s1&&s1.querySelector('.ptile-q');
ok(!!sb,'variant telt niet mee op de tegel van de dienst');
ok(!had,'s1 had al een aantal voor de test');

console.log('— Laatst aangeslagen regel staat bovenaan —');
const topLine=()=>{const r=q('.basket-line');return r&&r.querySelector('.bold').textContent.trim()};
const products=()=>{const b=q('[data-postype="products"]');if(b)b.click()};
products();
const two=qa('.pos-tile').slice(0,2);
const [nA,nB]=two.map(x=>x.querySelector('.ptile-n').textContent.trim());
const qtyOf=n=>{const b=byName(n).querySelector('.ptile-q');
  return b?+b.textContent.replace(/[^0-9]/g,''):0};
byName(nA).click();
ok(topLine()===nA,'eerste item staat niet bovenaan: '+topLine());
byName(nB).click();
ok(topLine()===nB,'nieuw item staat niet bovenaan: '+topLine());
const before=qtyOf(nA);
byName(nA).click();
ok(topLine()===nA,'bestaand item schuift niet naar boven: '+topLine());
ok(qtyOf(nA)===before+1,`aantal ging van ${before} naar ${qtyOf(nA)}`);
ok(qa('.basket-line').filter(r=>r.querySelector('.bold').textContent.trim()===nA).length===1,
  'item staat dubbel op de bon');

console.log('— De stippen en de handelingenlade —');
const dots=()=>q('[data-panel="saleActions"]');
ok(!!dots(),'geen stippenknop naast Pay');
/* Het waren paden zonder lengte: alleen zichtbaar door de ronde
   lijnuiteinden, en dan zo dun als de lijn zelf. */
ok(dots().querySelectorAll('circle').length===3,'de stippen zijn geen echte cirkels');
ok([...dots().querySelectorAll('circle')].every(c=>c.getAttribute('fill')==='currentColor'),
  'de stippen zijn niet gevuld');
dots().click();
ok(d.body.classList.contains('panel-open'),'de stippen openen geen lade');
ok(q('#panel').getAttribute('data-screen-name')==='Cash register / Sale actions',
  'de lade heet '+q('#panel').getAttribute('data-screen-name'));
const acts=qa('.sale-act').map(b=>b.querySelector('.t').textContent.trim());
['Add tip','Add cart discount','Add sale note','Add service charge','Redeem loyalty points',
 'Use a gift card','Enter a promo code','Invoices','Clear sale'].forEach(x=>
  ok(acts.includes(x),'ontbreekt in de lade: '+x));
ok(qa('.sale-act .s').every(x=>x.textContent.trim()),'een handeling zonder uitleg');
w.eval('state.tip=300;closePanel(true);render()');
dots().click();
const tip=qa('.sale-act').find(b=>b.querySelector('.t').textContent.trim()==='Add tip');
ok(tip&&tip.querySelector('.now'),'een toegepaste fooi is niet af te lezen in de lade');
q('[data-tillact="tip"]').click();
ok(!d.body.classList.contains('panel-open'),'de lade blijft open onder het formulier');
ok(q('#modal').getAttribute('data-screen-name')==='Cash register / Apply to the sale',
  'het formulier van die handeling gaat niet open: '+q('#modal').getAttribute('data-screen-name'));
q('.modal-close').click();
w.eval('state.tip=0;render()');

console.log('— De bon schuift —');
{
  const b=q('.receipt-body'), cs=w.getComputedStyle(b);
  ok(cs.overflowY==='auto',`de bon schuift niet verticaal: overflow-y ${cs.overflowY}`);
  ok(cs.overflowX==='hidden','de bon schuift zijwaarts');
  ok(cs.overscrollBehavior==='contain','het schuiven slaat door naar de pagina eronder');
  ok(w.getComputedStyle(q('.bl-row')).touchAction==='pan-y',
    'de regel laat verticaal schuiven niet aan de browser over');
  /* Comprimeren blijft de eerste oplossing bij een lange bon. */
  const was=w.eval('JSON.stringify(state.basket)');
  w.eval("state.basket=Array.from({length:12},(_,i)=>({id:'x'+i,name:'Line '+i,price:900,qty:1}));render()");
  ok(q('.receipt-body').className.includes('tight'),'een lange bon wordt niet compacter');
  ok(w.getComputedStyle(q('.receipt-body')).overflowY==='auto','en schuift dan ook niet');
  w.eval(`state.basket=${was};render()`);
}

console.log('— Vegen pakt alleen horizontale beweging —');
{
  const row=q('.bl-row'), line=q('.basket-line');
  const pd=(x,y)=>row.dispatchEvent(new w.PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true}));
  const pm=(x,y)=>d.dispatchEvent(new w.PointerEvent('pointermove',{clientX:x,clientY:y,bubbles:true}));
  const pu=()=>d.dispatchEvent(new w.PointerEvent('pointerup',{bubbles:true}));
  pd(300,300); pm(280,340); pm(270,380);
  ok(!line.style.transform,'een verticale beweging verschuift de regel — dan schuift de bon niet meer');
  pu();
  pd(300,300); pm(260,302); pm(180,304);
  ok(!!line.style.transform,'een horizontale veeg doet niets meer');
  pu();
  ok(w.eval('state.swipeId')!==null,'de veeg blijft niet openstaan');
  w.eval('state.swipeId=null;render()');
}

console.log('— De bonregel loopt niet uit het kaartje —');
const line=()=>q('.basket-line');
ok(!!line(),'geen bonregel');
ok(!!q('.bl-name')&&w.getComputedStyle(q('.bl-name')).minWidth==='0px',
  'de naamkolom mag niet krimpen, dus duwt hij de knoppen eruit');
const cols=[...line().children].map(c=>c.className.split(' ').pop());
ok(cols[cols.length-1]==='bl-more','de puntjes staan niet als laatste in de rij');
ok(!q('.bl-row .menu'),'er hangt nog een popover aan de regel');
ok(w.getComputedStyle(q('.bl-sum')).flexGrow==='0','de prijskolom rekt mee');

console.log('— De puntjes op een regel openen een lade —');
q('.bl-more').click();
ok(d.body.classList.contains('panel-open'),'de regelpuntjes openen geen lade');
ok(q('#panel').getAttribute('data-screen-name')==='Cash register / Line actions',
  'de lade heet '+q('#panel').getAttribute('data-screen-name'));
const lacts=qa('.sale-act').map(b=>b.querySelector('.t').textContent.trim());
ok(lacts.includes('Discount this line'),'korting ontbreekt in de regellade');
ok(lacts.includes('Remove from receipt'),'verwijderen ontbreekt in de regellade');
ok(qa('.sale-act .s').every(x=>x.textContent.trim()),'een regelactie zonder uitleg');
q('[data-linedisc]').click();
ok(!d.body.classList.contains('panel-open'),'de lade blijft open onder het formulier');
q('.modal-close').click();

console.log("— Today's: uren in de kolom —");
q('[data-postype="appointments"]').click();
const hourLabels=()=>qa('.pos-cats .catbtn').map(b=>b.querySelector('.catbtn-l').textContent.trim());
const openToday=w.eval('isOpenDate(TODAY)');
const nowH=w.eval('hhmm(Math.floor(nowMins()/60)*60)');
const close=w.eval('hhmm(DAY_END)');

if(!openToday){
  /* Op een dag dat de praktijk dicht is valt er geen uur aan te slaan.
     Dan hoort de kolom leeg te blijven en toont de kassa gewoon alles. */
  ok(w.eval('tillHours().length')===0,'gesloten dag, maar er staan toch uren');
  ok(hourLabels().length===0,'gesloten dag, maar er staat toch een kolom');
  ok(w.eval("state.posCategory")==='all',"gesloten dag: de kassa staat niet op 'all'");
  console.log('   (praktijk is vandaag gesloten — urenkolom overgeslagen)');
}else{
  const H=hourLabels();
  ok(H.length>1,"geen urenkolom bij Today's");
  ok(H[0].startsWith('All'),'de eerste tegel is niet "All": '+H[0]);
  const hrs=H.slice(1);
  ok(hrs.every(h=>/^\d{2}:00$/.test(h)),'niet elk vak is een heel uur: '+hrs.join(','));
  ok(hrs[0]===nowH,`begint op ${hrs[0]} in plaats van het huidige uur ${nowH}`);
  ok(hrs[hrs.length-1]<close,`laatste vak ${hrs[hrs.length-1]} valt niet voor sluitingstijd ${close}`);
  ok(hrs.every((h,i)=>i===0||w.eval(`mins('${h}')`)===w.eval(`mins('${hrs[i-1]}')`)+60),
    'de uren lopen niet met stappen van een uur: '+hrs.join(','));
  ok(!hrs.some(h=>w.eval(`mins('${h}')`)<w.eval(`mins('${nowH}')`)),'er staat een uur bij dat al voorbij is');
  ok(w.eval('state.posCategory')===nowH,'het huidige uur staat niet voorgeselecteerd: '+w.eval('state.posCategory'));
  ok(qa('.pos-cats .catbtn.on').length===1,'niet precies één uur actief');
  ok(qa('.pos-cats .catbtn')[1].querySelector('.catbtn-n'),'geen telbolletje bij een uur');
}

console.log("— Today's: welke afspraken —");
/* Een afspraak van vandaag in een later uur, en een van gisteren. */
const seeded=w.eval(`(function(){
  const h=hhmm(Math.floor(nowMins()/60)*60);
  const later=hhmm(Math.min(DAY_END-60,Math.floor(nowMins()/60)*60+60));
  const base=appointments.find(a=>a.kind==='appointment');
  appointments.push({...base,id:'t-now',date:TODAY,start:h,end:hhmm(mins(h)+30),title:'Nu Nu'});
  appointments.push({...base,id:'t-later',date:TODAY,start:later,end:hhmm(mins(later)+30),title:'Straks Straks'});
  appointments.push({...base,id:'t-yesterday',date:addDays(TODAY,-1),start:h,end:hhmm(mins(h)+30),title:'Gisteren Gisteren'});
  render(); return [h,later];
})()`);
const names=()=>qa('.pos-tile').map(t=>t.querySelector('.ptile-n').textContent.trim());
ok(names().includes('Nu Nu'),'de afspraak van dit uur staat er niet: '+names().join(','));
ok(!names().includes('Gisteren Gisteren'),'een afspraak van gisteren staat bij Today\'s');
/* Het schiften per uur valt alleen te toetsen als er ook uren zijn: op een
   gesloten dag is er geen kolom, en vlak voor sluitingstijd valt "nu" in
   hetzelfde vak als "straks". */
const laterBtn=q(`[data-poscategory="${seeded[1]}"]`);
if(openToday&&seeded[0]!==seeded[1]&&laterBtn){
  ok(!names().includes('Straks Straks'),'een afspraak uit een later uur lekt in dit uur');
  laterBtn.click();
  ok(names().includes('Straks Straks'),'het latere uur toont zijn afspraak niet');
  ok(!names().includes('Nu Nu'),'de afspraak van dit uur lekt in het latere uur');
}
const allBtn=q('[data-poscategory="all"]');
if(allBtn)allBtn.click();
ok(w.eval('state.posCategory')==='all','All laat zich niet kiezen');
ok(names().includes('Nu Nu')&&names().includes('Straks Straks'),'All toont niet alles van vandaag');
ok(!names().includes('Gisteren Gisteren'),'All toont ook gisteren');
w.eval("appointments.splice(appointments.findIndex(a=>a.id==='t-now'),1);"+
       "appointments.splice(appointments.findIndex(a=>a.id==='t-later'),1);"+
       "appointments.splice(appointments.findIndex(a=>a.id==='t-yesterday'),1);render()");
q('[data-postype="services"]').click();
ok(w.eval('state.posCategory')==='all','terug naar diensten begint niet op alles');

console.log('— De bon: verwijderen en de drie puntjes —');
/* Schoon beginnen: eerdere blokken hebben al van alles aangeslagen. */
w.eval('resetSale();render()');
q('[data-postype="products"]').click();
qa('.pos-tile')[0].click();
const bid=w.eval('state.basket[0].id');
ok(w.eval('state.basket[0].qty')===1,'de eerste regel staat niet op 1');
ok(!!q('.bl-bin'),'bij één stuk staat er geen prullenbak');
ok(!q(`[data-qty="${bid}|-1"]`),'bij één stuk staat er nog een min');
ok(q('.bl-bin').getAttribute('data-linedel')===bid,'de prullenbak verwijdert de verkeerde regel');
/* jsdom lost geen variabelen op, dus we lezen de regel uit de opmaak. */
ok(/\.basket-line \.bl-bin\{color:var\(--danger\)/.test(fs.readFileSync(__dirname+'/index.html','utf8')),
  'de prullenbak is niet rood gezet');
q(`[data-qty="${bid}|1"]`).click();
ok(!q('.bl-bin'),'bij twee stuks staat er nog een prullenbak');
ok(!!q(`[data-qty="${bid}|-1"]`),'bij twee stuks ontbreekt de min');
q(`[data-qty="${bid}|-1"]`).click();
ok(!!q('.bl-bin'),'terug op één stuk komt de prullenbak niet terug');

/* Achter een bureau veegt niemand, dus staan dezelfde twee acties ook
   achter drie puntjes — nu als lade in plaats van als popover, want die
   popover liep het kaartje uit. Vegen blijft voor wie het kent. */
ok(!!q('.bl-more'),'geen drie puntjes op de regel');
ok(!q('.bl-row .menu'),'er hangt nog een popover aan de regel');
ok(!!q('.bl-actions [data-linedel]')&&!!q('.bl-actions [data-linedisc]'),
  'de veegacties zijn verdwenen');
const wasN=w.eval('state.basket.length');
q('.bl-more').click();
q('.sale-act.danger').click();
ok(w.eval('state.basket.length')===wasN-1,'verwijderen via de lade werkt niet');
ok(!d.body.classList.contains('panel-open'),'de lade bleef openstaan na een keuze');

console.log('— Eén sluitkruis per modal —');
q('[data-postype="services"]').click();
qa('.pos-tile').find(x=>x.dataset.add.split('|')[0]==='s1').click();
const head=q('#modal .modal-head');
ok(!!head,'geen modalkop');
ok(head.querySelectorAll('[data-close]').length===0,'de kop tekent zijn eigen sluitkruis nog');
const crosses=qa('#modal [data-close]').filter(b=>!b.closest('.modal-foot'));
ok(crosses.length===1,`${crosses.length} sluitkruizen buiten de voet`);
ok(crosses[0]&&crosses[0].classList.contains('modal-close'),'het kruis komt niet uit openModal');
const cancel=q('#modal [data-close]');
q('.modal-close').click();

console.log('— Soortenbalk —');
const types=qa('[data-postype]').map(b=>b.textContent.trim());
ok(types.length===5,'niet vijf soorten: '+types.length);
/* Today's vooraan: daar staat de balie het vaakst. */
ok(types[0]==="Today's",'de eerste tab heet '+JSON.stringify(types[0]));
/* De cadeaubon hoort niet bij de verkoop van dat moment en staat achteraan. */
ok(types[4]==='Gift cards','laatste tab heet '+JSON.stringify(types[4]));
ok(types.join('|')==="Today's|Services|Products|Packages|Gift cards",
  'volgorde klopt niet: '+types.join(' | '));

console.log('— Andere soorten houden hun kolom —');
['products','combos','giftcards'].forEach(ty=>{
  const b=q(`[data-postype="${ty}"]`); if(!b)return;
  b.click();
  const n=qa('.pos-cats .catbtn').length;
  ok(n>0||ty!=='products',ty+': geen categorietegels');
});
console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
