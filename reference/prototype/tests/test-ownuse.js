/* Eigen gebruik: de categorie, het aftellen per behandeling, de monsters
   van een leverancier, en de kleurenstrook boven de agenda. */
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
const go=(route,extra='')=>E(`closePanel(true);session.userId='e1';state.route='${route}';${extra}render()`);
const OWNCAT=E('OWN_CAT');
/* Voorraad zetten doen we per vestiging. De verzamelsetter op p.stock
   verdeelt een nieuw totaal over de vestigingen en klemt daarbij op nul,
   dus `p.stock=0` laat er eentje staan. Zie het rapport. */
const setAll=(id,n)=>E(`myLocs().forEach(l=>setStock(prodById('${id}'),l,${n}))`);

setTimeout(()=>{
g('De categorie');
t('Own use staat in de productcategorieën',()=>
  E("productCategories.includes(OWN_CAT)")||`categorieën: ${E('productCategories').join(', ')}`);
t('Er staan producten in',()=>{
  const n=E("products.filter(p=>p.cat===OWN_CAT).length");
  return n>=4||`${n} producten`;
});
t('Elk eigen-gebruikproduct kent zijn verpakking',()=>{
  const bad=E("products.filter(p=>p.own&&(!p.size||!p.unit)).map(p=>p.name)");
  return bad.length===0||`zonder maat: ${bad.join(', ')}`;
});
t('Ze staan onder Own use en nergens anders',()=>{
  const bad=E("products.filter(p=>p.own&&p.cat!==OWN_CAT).map(p=>p.name)");
  return bad.length===0||`verkeerde categorie: ${bad.join(', ')}`;
});
t('Ze hebben een inkoopprijs, geen verkoopprijs',()=>{
  const bad=E("products.filter(p=>p.own&&(p.price>0||!p.cost)).map(p=>p.name)");
  return bad.length===0||`prijs klopt niet bij: ${bad.join(', ')}`;
});

g('Ze horen niet op de kassa');
t('Geen tegel voor eigen gebruik',()=>{
  go('register',"state.posType='products';state.posCategory='all';");
  const names=qa('#view .tile-name, #view .postile').map(x=>x.textContent);
  const own=E("products.filter(p=>p.own).map(p=>p.name)");
  const shown=own.filter(n=>names.some(x=>x.includes(n)));
  return shown.length===0||`op de kassa: ${shown.join(', ')}`;
});
t('En de vestiging zet ze ook niet aan',()=>{
  const bad=E("products.filter(p=>p.own).filter(p=>myLocs().some(l=>prodAt(p,l).pos!==false)).map(p=>p.name)");
  return bad.length===0||`staat toch op de kassa: ${bad.join(', ')}`;
});
t('In de catalogus staan ze wel',()=>{
  go('catalog',"state.catTab='products';");
  /* De naam staat in een invoerveld, dus in value en niet in de tekst. */
  const names=qa('#view input').map(i=>i.value);
  const own=E("products.filter(p=>p.own).map(p=>p.name)");
  const missing=own.filter(n=>!names.includes(n));
  return missing.length===0||`niet in de lijst: ${missing.join(', ')}`;
});
t('Onder één kopje, en dat kopje bestaat',()=>{
  const heads=qa('#view .catgroup').map(x=>x.textContent);
  return heads.some(h=>h.includes(OWNCAT))||`kopjes: ${heads.join(' | ')}`;
});
t('De oude categorie Clinic supplies is leeg',()=>{
  const left=E("products.filter(p=>p.cat==='Clinic supplies').map(p=>p.name)");
  return left.length===0||`nog onder Clinic supplies: ${left.join(', ')}`;
});
t('Met voorraad erbij, in de eenheid waarin je het afmeet',()=>{
  const txt=d.querySelector('#view').textContent;
  return /ml total/.test(txt)||'geen voorraad in ml te zien';
});
t('En met hoeveel behandelingen je er nog mee doet',()=>{
  const txt=d.querySelector('#view').textContent;
  return /treatments/.test(txt)||'geen aantal behandelingen';
});

g('Wat er in een fles zit');
t('Alles bij elkaar is de volle verpakkingen plus wat er open staat',()=>{
  const left=E("ownLeft(prodById('o1'))");
  const want=E("prodById('o1').stock*prodById('o1').size+prodById('o1').opened");
  return left===want||`${left} ≠ ${want}`;
});
t('Een liter met 12 ml per keer is meer dan tachtig behandelingen',()=>{
  const n=E("ownDoses(prodById('o1'),12)");
  return n>80||`${n} behandelingen`;
});
t('Kosten per behandeling volgen de inkoopprijs per verpakking',()=>{
  const c=E("ownUnitCost(prodById('o1'))*12");
  const want=E("prodById('o1').cost/prodById('o1').size*12");
  return Math.abs(c-want)<0.001||`${c} ≠ ${want}`;
});

g('Aftellen');
t('Een behandeling haalt het uit de open fles',()=>{
  E("prodById('o1').stock=6;prodById('o1').opened=400");
  E("consumeOwn(prodById('o1'),50,'TEST','s1')");
  return E("prodById('o1').opened")===350||`open: ${E("prodById('o1').opened")}`;
});
t('De voorraad aan flessen blijft dan staan',()=>
  E("prodById('o1').stock")===6||`${E("prodById('o1').stock")} flessen`);
t('Is de open fles leeg, dan gaat de volgende eraan',()=>{
  E("prodById('o1').stock=6;prodById('o1').opened=30");
  E("consumeOwn(prodById('o1'),50,'TEST','s1')");
  const p=E("({stock:prodById('o1').stock,opened:prodById('o1').opened})");
  return (p.stock===5&&p.opened===980)||`stock ${p.stock}, open ${p.opened}`;
});
t('Er gaat nooit meer af dan er is',()=>{
  setAll('o2',0); E("prodById('o2').opened=10");
  const r=E("consumeOwn(prodById('o2'),80,'TEST','s8')");
  const p=E("({stock:prodById('o2').stock,opened:prodById('o2').opened})");
  if(p.stock<0||p.opened<0)return `negatief: stock ${p.stock}, open ${p.opened}`;
  return r.short===70||`tekort gemeld als ${r.short}`;
});
t('En het tekort wordt gemeld in plaats van weggerekend',()=>{
  setAll('o2',0); E("prodById('o2').opened=0");
  const short=E("consumeForService('s8',1,'TEST')");
  return short.length>0&&/short/.test(short[0])||`melding: ${JSON.stringify(short)}`;
});
t('Elk verbruik komt in het logboek, met de bon erbij',()=>{
  E("usageLog.length=0;prodById('o1').stock=6;prodById('o1').opened=500");
  E("consumeForService('s1',1,'INV-TEST')");
  const l=E("usageLog.filter(u=>u.ref==='INV-TEST')");
  return l.length>=1&&l[0].sid==='s1'||`logboek: ${JSON.stringify(l)}`;
});

g('Afrekenen boekt het af');
t('Een verkochte behandeling trekt van de voorraad af',()=>{
  E("prodById('o1').stock=6;prodById('o1').opened=500;usageLog.length=0");
  const before=E("ownLeft(prodById('o1'))");
  go('register');
  E("state.basket=[{id:'s1',name:'Physiotherapy session',price:1800,qty:1}];finishSale('Card')");
  const after=E("ownLeft(prodById('o1'))");
  const per=E("recipes.s1.find(r=>r.p==='o1').qty");
  return before-after===per||`${before} → ${after}, verwacht ${per} eraf`;
});
t('Twee keer dezelfde behandeling telt twee keer',()=>{
  E("prodById('o1').stock=6;prodById('o1').opened=500");
  const before=E("ownLeft(prodById('o1'))");
  E("state.basket=[{id:'s1',name:'Physiotherapy session',price:1800,qty:2}];finishSale('Card')");
  const per=E("recipes.s1.find(r=>r.p==='o1').qty");
  return before-E("ownLeft(prodById('o1'))")===per*2||'de aantallen tellen niet mee';
});
t('Een product verkopen verbruikt niets',()=>{
  const before=E("ownLeft(prodById('o1'))");
  E("state.basket=[{id:'p1',name:'Resistance band set',price:1200,qty:1}];finishSale('Card')");
  return E("ownLeft(prodById('o1'))")===before||'er ging voorraad af van een productverkoop';
});

g('Koppelen aan een behandeling');
/* De dienstlade is in secties gegaan: verbruik per behandeling zit onder
   Advanced settings, en die staat dicht tot je hem opent. Dat is de
   bedoeling — een lade laat niet alles tegelijk zien. De test loopt
   daarom dezelfde weg als de gebruiker. */
const openAdvanced=()=>{
  const h=d.querySelector('#panel [data-edsec$="|advanced"]');
  if(h&&h.getAttribute('aria-expanded')!=='true')h.click();
};
t('De knop opent een lade in plaats van een toast',()=>{
  go('catalog',"state.catTab='services';");
  E("openPanel(PANELS.serviceEdit('s4'),'serviceEdit','s4')");
  openAdvanced();
  const b=d.querySelector('#panel [data-panel^="svcUsage"]');
  if(!b)return 'geen knop gevonden';
  if(b.hasAttribute('data-toast'))return 'het is nog een toast';
  b.click();
  return !!d.querySelector('#panel [data-uf="pid"]')||'de lade bleef leeg';
});
t('Alleen eigen gebruik is te kiezen',()=>{
  const opts=qa('#panel [data-uf="pid"] option').map(o=>o.value);
  const bad=opts.filter(id=>!E(`(prodById('${id}')||{}).own`));
  return bad.length===0||`ook te kiezen: ${bad.join(', ')}`;
});
t('Zonder hoeveelheid wordt er niets gekoppeld',()=>{
  const before=E("(recipes.s4||[]).length");
  d.querySelector('#panel [data-panelsave]').click();
  return E("(recipes.s4||[]).length")===before||'gekoppeld zonder hoeveelheid';
});
t('Met hoeveelheid komt het erbij, in de eenheid van het product',()=>{
  if(!d.querySelector('#panel [data-uf="pid"]')){
    E("openPanel(PANELS.serviceEdit('s4'),'serviceEdit','s4')");
    openAdvanced();
    const b=d.querySelector('#panel [data-panel^="svcUsage"]'); if(b)b.click();
  }
  const sel=d.querySelector('#panel [data-uf="pid"]');
  sel.value='o3';
  const q=d.querySelector('#panel [data-uf="qty"]'); q.value='30';
  q.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('#panel [data-panelsave]').click();
  const r=E("(recipes.s4||[]).find(x=>x.p==='o3')");
  return (r&&r.qty===30&&r.unit==='ml')||`opgeslagen als ${JSON.stringify(r)}`;
});
t('En telt dan mee in de materiaalkosten',()=>{
  const cost=E("materialCost('s4')");
  return cost>0||'de kostprijs bleef nul';
});
t('Weghalen haalt precies die regel weg',()=>{
  E("openPanel(PANELS.serviceEdit('s4'),'serviceEdit','s4')");
  const ix=E("(recipes.s4||[]).findIndex(x=>x.p==='o3')");
  const before=E("(recipes.s4||[]).length");
  const b=d.querySelector(`#panel [data-usedel="s4|${ix}"]`);
  if(!b)return 'geen verwijderknop voor die regel';
  b.click();
  if(E("(recipes.s4||[]).some(x=>x.p==='o3')"))return 'de regel staat er nog';
  return E("(recipes.s4||[]).length")===before-1||'er ging meer dan één regel weg';
});
t('En laat de andere regels staan',()=>
  E("(recipes.s4||[]).some(x=>x.p==='p8')")||'de couch roll is meegegaan');
E('closePanel(true)');

g('Monsters van een leverancier');
t('De leverancier biedt er een paar aan',()=>{
  const n=E("supplierProducts.filter(p=>p.sample).length");
  return n>=2||`${n} monsters`;
});
t('Ze staan in de leverancierscatalogus als monster',()=>{
  go('suppliers',"state.supTab='catalog';state.supSupplier='all';state.supCat='all';");
  return /Sample/.test(d.querySelector('#view').textContent)||'niet als monster herkenbaar';
});
t('Aanvragen kan met één knop',()=>{
  const b=d.querySelector('#view [data-sample]');
  if(!b)return 'geen aanvraagknop';
  b.click();
  return E('sampleRequests.length')===1||'er kwam geen aanvraag';
});
t('Twee keer vragen levert geen tweede aanvraag',()=>{
  const id=E("sampleRequests[0].sp");
  E(`requestSample('${id}')`);
  return E('sampleRequests.length')===1||`${E('sampleRequests.length')} aanvragen`;
});
t('Een lopende aanvraag staat bovenaan',()=>{
  go('suppliers',"state.supTab='catalog';");
  return /on the way/.test(d.querySelector('#view').textContent)||'geen overzicht van aanvragen';
});
t('Binnengekomen zetten kan',()=>{
  d.querySelector('#view [data-samplegot]').click();
  return E("sampleRequests[0].status")==='shipped'||`status ${E("sampleRequests[0].status")}`;
});
t('En dan komt hij in Own use terecht',()=>{
  const before=E("products.filter(p=>p.cat===OWN_CAT).length");
  d.querySelector('#view [data-samplein]').click();
  return E("products.filter(p=>p.cat===OWN_CAT).length")===before+1||'niet in de catalogus beland';
});
t('Met een verpakking, zodat hij ook af kan tellen',()=>{
  const p=E("products[products.length-1]");
  return (p.own&&p.size>0&&!!p.unit)||`nieuw product: ${JSON.stringify(p)}`;
});
t('En niet op de kassa',()=>{
  const p=E("products[products.length-1]");
  const on=E(`myLocs().some(l=>prodAt(products[products.length-1],l).pos!==false)`);
  return on===false||`${p.name} staat op de kassa`;
});

g('De kleuren in de agenda');
/* De strook boven de agenda is er op verzoek uit. De kleur zelf blijft
   het draad: de dagweergave zet hem in de kolomkop naast de naam, en
   elk afspraakblok draagt hem plus de voornaam onderin. Wat hier
   getoetst wordt is dus niet meer de strook maar of die twee dragers
   het overnemen. */
t('Er staat geen strook meer boven de agenda',()=>{
  go('calendar',"state.calView='week';state.calEmp='all';");
  return !d.querySelector('#view .cal-legend')||'de strook staat er nog';
});
t('En er is geen opmaak meer die er alleen voor was',()=>{
  const rest=['.cal-legend','.cal-who','.cal-who-dot'].filter(k=>css.includes(k+'{'));
  return rest.length===0||`nog aanwezig: ${rest.join(', ')}`;
});
t('In de dagweergave draagt de kolomkop de kleur',()=>{
  go('calendar',"state.calView='day';state.calEmp='all';state.calDate=TODAY;");
  const heads=qa('#view .cal-head-emp');
  if(!heads.length)return 'geen gekleurde kolomkoppen';
  const bad=heads.filter((h,i)=>{
    const want=E(`empColor(employees.filter(e=>e.locs.some(inScope)&&e.status==='active')[${i}].id)[2]`);
    return !h.getAttribute('style').includes(want);
  });
  return bad.length===0||`${bad.length} koppen met de verkeerde kleur`;
});
t('En de naam staat er gewoon bij',()=>{
  const koppen=qa('#view .cal-head-emp').map(h=>h.textContent.trim());
  const namen=E("employees.filter(e=>e.locs.some(inScope)&&e.status==='active').map(e=>e.name)");
  return namen.every((n,i)=>koppen[i]&&koppen[i].includes(n.split(' ')[0]))
    ||`koppen: ${koppen.join(' | ')}`;
});
t('In de weekweergave draagt het blok zelf de kleur',()=>{
  /* Daar zijn de kolommen dagen, dus er is geen kop die een naam kan
     dragen. Het blok moet het dan alleen doen. */
  go('calendar',"state.calView='week';state.calEmp='all';");
  const ev=qa('#view .event.appointment')[0];
  if(!ev)return 'geen afspraak in beeld';
  const a=E(`appointments.find(x=>x.id==='${ev.dataset.appt}')`);
  return ev.style.getPropertyValue('--ev-bg').trim()===E(`empColor('${a.emp}')[2]`)
    ||`blok draagt ${ev.style.getPropertyValue('--ev-bg')}`;
});
t('Met de voornaam erin, zodat de kleur ergens op slaat',()=>{
  const bron=html.slice(html.indexOf('const emp=(employees.find'));
  return /ev-foot[\s\S]{0,120}\$\{esc\(emp\)\}/.test(bron)
    ||'het blok noemt de medewerker nergens';
});
t('Een kleurwissel komt in het blok terug',()=>{
  E("employees.find(e=>e.id==='e1').color='sky'");
  go('calendar',"state.calView='week';state.calEmp='all';");
  const ev=qa('#view .event.appointment').find(x=>
    E(`appointments.find(a=>a.id==='${x.dataset.appt}').emp`)==='e1');
  if(!ev)return true;
  return ev.style.getPropertyValue('--ev-bg').trim()===E("EMP_COLORS.find(c=>c[0]==='sky')[2]")
    ||'de kleur liep niet mee';
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
