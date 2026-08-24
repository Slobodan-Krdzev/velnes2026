/* Leveranciers-intelligentie — dezelfde behandeling als de klanten:
   gezaaide deterministische historie, één deur (supStats), schermen
   die alleen lezen. Toetst: de zaaier (hygiëne, determinisme binnen
   één wereld, prijzen op de MKD-schaal), de deur op narekenblare
   plakken, vlaggen alleen met bewijs, de HQ-pagina die de deur
   naspreekt, en het portaal dat dezelfde waarheid toont. */
const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('/home/claude/velnes/index.html','utf8'),{runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document,E=x=>w.eval(x);
const q=s=>d.querySelector(s),qa=s=>[...d.querySelectorAll(s)];
const click=el=>el.dispatchEvent(new w.Event('click',{bubbles:true}));
let pass=0,fail=0;
const ok=(c,msg)=>{if(c){pass++}else{fail++;console.log('  FAIL ',msg)}};
const norm=s=>s.replace(/\s+/g,' ');
setTimeout(()=>{try{

console.log('— De zaaier: hygiëne eerst —');
ok(E(`purchaseOrders.filter(p=>!p.seeded).length`)===4,'de vier handgeschreven orders horen onaangeraakt te blijven');
ok(E(`['po1','po2','po3','po4'].every(id=>purchaseOrders.some(p=>p.id===id))`),'en er allemaal nog te zijn');
ok(E(`purchaseOrders.filter(p=>p.seeded).length`)>25,'de gezaaide historie hoort substantieel te zijn');
ok(E(`new Set(purchaseOrders.map(p=>p.id)).size`)===E('purchaseOrders.length'),'geen dubbele order-ids');
ok(E(`new Set(purchaseOrders.map(p=>p.ref)).size`)===E('purchaseOrders.length'),'geen dubbele referenties');
ok(E(`poSeq`)===43,'poSeq hoort met rust gelaten te zijn');
ok(E(`purchaseOrders.filter(p=>p.seeded).every(p=>p.lines.every(l=>l.price>=100))`),
  'gezaaide prijzen horen op de MKD-schaal van po1–po4 te liggen');
ok(E(`purchaseOrders.filter(p=>p.seeded&&p.lines.some(l=>l.sp==='sp1')).every(p=>p.lines.find(l=>l.sp==='sp1').price===550)`),
  'een bekend product hoort exact de handgeschreven pakprijs te dragen');
ok(E(`platformOrders.length`)>15,'de platformlaag hoort gevuld te zijn');
ok(E(`platformOrders.every(o=>o.sup&&o.acct&&o.value>0)`),'elke platformrij hoort compleet te zijn');

console.log('— Determinisme: twee keer vragen, één antwoord —');
ok(E(`JSON.stringify(supStats('sup1'))`)===E(`JSON.stringify(supStats('sup1'))`),
  'de deur hoort een vaste waarheid te geven');
ok(E(`purchaseOrders.filter(p=>p.seeded).every(p=>p.created<=TODAY)`),'gezaaide orders horen in het verleden te liggen');
ok(E(`purchaseOrders.filter(p=>p.seeded&&p.status==='delivered').every(p=>p.deliveredOn&&p.lines.every(l=>l.recv===l.qty))`),
  'geleverd hoort geleverd te zijn: datum en ontvangen aantallen');
ok(E(`purchaseOrders.filter(p=>p.seeded&&p.status==='disputed').every(p=>p.lines.some(l=>l.dmg>0))`),
  'een dispuut hoort schade te dragen — anders is het geen dispuut');

console.log('— De deur: narekenbaar op een klein plak —');
const st1=E(`JSON.parse(JSON.stringify(supStats('sup1')))`);
const st2=E(`JSON.parse(JSON.stringify(supStats('sup2')))`);
ok(st1.series.length===14,'de reeks hoort veertien maanden te zijn');
const sumSeries=st1.series.reduce((s,v)=>s+v,0);
const sumCheck=E(`purchaseOrders.filter(p=>p.sup==='sup1').reduce((s,p)=>s+poTotal(p),0)
  +platformOrders.filter(o=>o.sup==='sup1').reduce((s,o)=>s+o.value,0)`);
ok(Math.abs(sumSeries-sumCheck)<2,'de maandreeks hoort op te tellen tot alle orders samen');
ok(st1.gmv90>=st1.gmv30&&st1.gmv30>0,'90 dagen hoort minstens 30 dagen te zijn');
const dispCheck=E(`(d=>Math.round(d.disputed/(d.delivered+d.disputed)*100))({
  delivered:purchaseOrders.filter(p=>p.sup==='sup1'&&p.status==='delivered').length,
  disputed:purchaseOrders.filter(p=>p.sup==='sup1'&&p.status==='disputed').length})`);
ok(st1.disputeRate===dispCheck,'het dispuutpercentage hoort na te rekenen: '+st1.disputeRate+' vs '+dispCheck);
ok(st1.activeAccts>=2,'sup1 hoort meerdere actieve accounts te hebben');
ok(st1.topProducts.length>0&&st1.topProducts[0].value>=st1.topProducts[st1.topProducts.length-1].value,
  'topproducten horen op waarde gesorteerd te zijn');
ok(st1.seats===40&&st1.seatsTaken===20,'de trainingsstoelen horen uit de rijen te komen (20+20 · 14+6)');

console.log('— Vlaggen alleen met bewijs —');
ok(st1.trend==='growing'&&st1.flags.includes('Growing'),'sup1 hoort aantoonbaar te groeien');
ok(st2.trend==='insufficient','sup2 hoort géén trendoordeel te krijgen op dun bewijs');
ok(!st2.flags.includes('Growing')&&!st2.flags.includes('Cooling'),'en dus ook geen trendvlag');
ok(st2.flags.includes('Config incomplete'),'maar de onaffe configuratie hoort wél gevlagd');
ok(!st1.flags.includes('Config incomplete'),'en bij sup1 juist niet');

console.log('— De doorverkoop op de kassabon telt mee (wat klant-CI nooit had) —');
const sellB=st1.sellThrough;
E(`resetSale();state.sale=null;state.basket=[{id:'p2',name:'Olie',qty:2,price:850}];finishSale('card')`);
ok(E(`supStats('sup1').sellThrough`)===sellB+1700,'een olieverkoop hoort bij BeautyPro\u2019s doorverkoop op te tellen');

console.log('— De HQ-pagina leest de deur na —');
E(`go('hq');state.hqTab='suppliers';state.hqSup=null;render()`);
ok(!!qa('#view [data-hqsup]').length,'de Open-knop hoort in de lijst te staan');
ok(qa('#view tbody .rowact button').every(b=>b.dataset.hqsup!==undefined),
  'de rij hoort één ingang te hebben: Open — Review en Suspend wonen op de pagina');
ok(!qa('#view tbody [data-panel^="hqSupplierEdit|"]').length,'Review hoort uit de rijen te zijn');
click(qa('#view [data-hqsup="sup1"]')[0]);
ok(norm(q('#view').textContent).includes('MID-90417-BP'),'de pagina hoort met de betaalidentiteit te openen');
ok(norm(q('#view').textContent).includes(norm(E(`money(supStats('sup1').gmv90)`))),
  'de GMV op het scherm hoort exact de deur te zijn');
ok(norm(q('#view').textContent).includes('Growing'),'de groeivlag hoort op de pagina te staan');
ok(qa('#view .bar-h').length>=14,'de maandstaven horen er te staan');
ok(norm(q('#view').textContent).includes('CEN-')&&norm(q('#view').textContent).includes('Recent orders'),
  'de recente orders horen er te staan');
click(q('#view [data-hqsup=""]'));
ok(!!q('#view [data-hqmiss]'),'terug hoort terug te zijn — de lijst met het filter staat er weer');
click(qa('#view [data-hqsup="sup2"]')[0]);
ok(norm(q('#view').textContent).includes('Missing config'),'Aroma\u2019s pagina hoort de onaffe configuratie te tonen');
ok(!norm(q('#view').textContent).includes('Growing'),'en geen groeivlag zonder bewijs');
E(`state.hqSup=null`);

console.log('— Het portaal spreekt dezelfde waarheid —');
E(`go('portal');state.portalTab='dashboard';render()`);
ok(norm(q('#view').textContent).includes(norm(E(`money(supStats('sup1').gmv30)`))),
  'de omzet op het portaal hoort exact de deur te zijn');
ok(!norm(q('#view').textContent).includes('484.200'),'het verzonnen getal hoort weg te zijn');
ok(!norm(q('#view').textContent).includes('86 sold'),'de verzonnen verkoopaantallen ook');
ok(norm(q('#view').textContent).includes(norm(E(`money(supStats('sup1').topProducts[0].value)`))),
  'de bestsellers horen uit de deur te komen');

console.log('— De bewerklade is met rust gelaten —');
E(`go('hq');state.hqTab='suppliers';state.hqSup='sup1';render()`);
{const rev=qa('#view [data-panel^="hqSupplierEdit|"]').find(b=>b.dataset.panel.endsWith('sup1'));click(rev);}
ok(q('.panel-body')&&q('.panel-body').firstElementChild.textContent.includes('Merchant ID'),
  'de lade hoort nog steeds met de betaalidentiteit te openen');
E('closePanel(true)');

console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
}catch(e){console.log('CRASH',e);process.exit(1)}},400);
