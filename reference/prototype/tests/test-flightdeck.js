/* De flightdeck: het eigenaarsscherm dat zegt hoe de zaak ervoor staat,
   wat aandacht verdient en wat de beste eerstvolgende handeling is.

   De kern die hier bewaakt wordt: de heldkaart is geen plaatje maar de
   echte aanbiedingsmotor — de cijfers komen uit openCapacity en de knop
   opent de bestaande lade voorgeconfigureerd. En het scherm blijft
   rustig: vier polssignalen, hoogstens drie kansen, geen KPI-muur. */
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
const openFd=()=>E("closePanel(true);session.userId='e1';go('home')");

setTimeout(()=>{

g('Het scherm bestaat en draagt zijn naam');
t('De eigenaar heeft een Overview in de zijbalk, en wel bovenaan',()=>{
  E("session.userId='e1'");
  const nav=E("NAV.filter(n=>allowedRoute(n.id)).map(n=>n.id)");
  return nav[0]==='home'||`de zijbalk begint met ${nav[0]}`;
});
t('Het scherm rendert en heet Overview',()=>{
  openFd();
  return (!!d.querySelector('#view .fd')
    &&d.querySelector('#view').getAttribute('data-screen-name')==='Overview')
    ||`naam: ${d.querySelector('#view').getAttribute('data-screen-name')}`;
});
t('Een medewerker ziet hem niet en wordt eraf gestuurd',()=>{
  E("session.userId='e3';go('home')");
  const route=E('state.route');
  const nav=E("NAV.filter(n=>allowedRoute(n.id)).map(n=>n.id)");
  E("session.userId='e1'");
  return (route!=='home'&&!nav.includes('home'))
    ||`route ${route}, zijbalk ${nav.join(',')}`;
});

g('De pols: oriëntatie, geen KPI-muur');
t('Precies vier signalen',()=>{
  openFd();
  return qa('#view .fd-pulse .stat').length===4
    ||`${qa('#view .fd-pulse .stat').length} vakken`;
});
t('Capaciteit rekent met de echte agenda',()=>{
  const loc=E('oneLoc()||myLocs()[0]');
  const caps=E(`openCapacity('${loc}',TODAY).length`);
  const booked=E(`appointments.filter(a=>a.date===TODAY&&a.kind==='appointment'&&a.locationId==='${loc}').length`);
  const txt=norm(qa('#view .fd-pulse .stat')[0].textContent);
  return txt.includes(`${booked} of ${booked+caps}`)
    ||`las "${txt}" bij ${booked} geboekt en ${caps} gaten`;
});

g('De heldkaart is de aanbiedingsmotor, geen plaatje');
t('Hij noemt het bedrag dat openCapacity echt vindt',()=>{
  const loc=E('oneLoc()||myLocs()[0]');
  const morgen=E('addDays(TODAY,1)');
  const caps=E(`openCapacity('${loc}','${morgen}')`);
  if(!caps.length)return true;   /* stille stand, verderop getoetst */
  /* money() plakt met een vaste spatie; beide kanten door norm(), anders
     vergelijk je twee soorten spatie met elkaar. */
  const waarde=norm(E(`money(capacityValue(openCapacity('${loc}','${morgen}')))`));
  /* De Velnes Premium-aanbeveling mag ervóór staan; dit gaat over de
     capaciteitskaart zelf. */
  return norm(d.querySelector('#view .fd-hero:not([data-fdrec])').textContent).includes(waarde)
    ||`de kaart noemt ${waarde} niet`;
});
t('De knop opent de bestaande lade, voorgeconfigureerd',()=>{
  const btn=d.querySelector('#view .fd-hero [data-offernew]');
  if(!btn)return 'geen knop op de heldkaart';
  btn.click();
  const secties=qa('#panel .ed-sectitle').map(x=>norm(x.textContent).replace(/^\d+\. /,''));
  const goed=secties.length===3&&/^Capacity/.test(secties[0]);
  E("closePanel(true);go('home')");
  return goed||`lade: ${secties.join(' | ')}`;
});
t('Met alle gevonden plekken al aangevinkt',()=>{
  d.querySelector('#view .fd-hero [data-offernew]').click();
  const dr=E('state.offerDraft');
  const goed=dr&&dr.picked.length===dr.caps.length&&dr.caps.length>0;
  E("closePanel(true);go('home')");
  return goed||'niet alles staat aangevinkt';
});
t('View reasoning klapt de uitleg open en dicht',()=>{
  const zonder=!d.querySelector('#view .fd-why');
  d.querySelector('#view [data-fdwhy]').click();
  const met=!!d.querySelector('#view .fd-why');
  d.querySelector('#view [data-fdwhy]').click();
  return (zonder&&met&&!d.querySelector('#view .fd-why'))||'de uitleg klapt niet om';
});
t('Zonder gaten zegt de kaart dat er niets brandt',()=>{
  /* Iedereen even onboekbaar: geen capaciteit, dus geen kans — en dan
     hoort de kaart dat te zéggen in plaats van er een te verzinnen. */
  E("window._bk=employees.map(e=>e.bookable);employees.forEach(e=>e.bookable=false);render()");
  const stil=d.querySelector('#view .fd-hero-quiet');
  const tekst=stil?norm(stil.textContent):'';
  E("employees.forEach((e,i)=>e.bookable=window._bk[i]);render()");
  return (!!stil&&/Nothing is on fire/.test(tekst))||'de stille stand ontbreekt';
});

g('Hoogstens drie kansen, elk met opbrengst en handeling');
t('Er staan er precies drie',()=>{
  return qa('#view .fd-opp').length===3||`${qa('#view .fd-opp').length} kansen`;
});
t('Elk draagt een bedrag en een knop die ergens heen gaat',()=>{
  const kaal=qa('#view .fd-opp').filter(o=>
    !/\+/.test(norm(o.querySelector('.v').textContent))||!o.querySelector('[data-go]'));
  return kaal.length===0||`${kaal.length} kansen zonder bedrag of knop`;
});

g('De rangorde van het scherm');
t('Pols boven held, held boven kansen, Kumo onderaan',()=>{
  /* Sinds de tweekolomsopbouw zegt de volgorde ín de linkerkolom wat de
     rangorde is, en staat Kumo als laatste kind van .fd. Op de vlakke
     kinderlijst van .fd afgaan werkt dus niet meer. */
  const links=[...d.querySelector('#view .fd-left').children].map(c=>c.className);
  const idx=c=>links.findIndex(k=>k.includes(c));
  /* Tussen pols en kansen mogen één of twee heldkaarten staan: de
     Velnes Premium-aanbeveling (als er een kans wacht) en de
     capaciteitskaart. Alles ertussen hoort een held te zijn. */
  const last=links.length-1;
  const goed=idx('fd-pulse')===0&&idx('fd-opps')===last
    &&links.slice(1,last).length>=1&&links.slice(1,last).every(k=>k.includes('fd-hero'));
  const meer=d.querySelector('#view .fd-more');
  const kumoLaatst=meer&&[...meer.children].pop().classList.contains('fd-kumo');
  const actieRechts=d.querySelectorAll('#view .fd-side .fd-card').length===1;
  return (goed&&!!kumoLaatst&&actieRechts)
    ||`links: ${links.join(' | ')} — Kumo laatst: ${kumoLaatst}`;
});

g('De vouw: directe impact eerst, goed-om-te-weten eronder');
t('Het eerste beeld draagt de pols, de handeling, de kansen en de voorraad',()=>{
  openFd();
  const vouw=d.querySelector('#view .fd-fold');
  if(!vouw)return 'geen vouw';
  return (!!vouw.querySelector('.fd-pulse')&&!!vouw.querySelector('.fd-hero')
    &&!!vouw.querySelector('.fd-opps')&&!!vouw.querySelector('.fd-side .fd-card'))
    ||'er mist iets boven de vouw';
});
t('Het staatje en de bijverkoop wonen eronder, met Kumo als laatste',()=>{
  const meer=d.querySelector('#view .fd-more');
  if(!meer)return 'geen goed-om-te-weten-laag';
  const kaarten=meer.querySelectorAll('.fd-more-grid .fd-card').length;
  const laatste=[...meer.children].pop();
  return (kaarten===2&&laatste.classList.contains('fd-kumo'))
    ||`${kaarten} kaarten, laatste is ${laatste.className}`;
});
t('En die laag kondigt zichzelf aan',()=>{
  const k=d.querySelector('#view .fd-more-k');
  return (k&&norm(k.textContent)==='Good to know')||'geen kopje boven de tweede laag';
});
t('De vouw vult de kijkhoogte zonder het scherm dicht te zetten',()=>{
  /* Geen overflow:hidden meer: dat bracht een scrollende kaart met een
     plakkende kop mee, en die schoof over de voorraadregels heen. De
     vouw krijgt een minimumhoogte en de pagina scrollt gewoon. */
  const m=/\.fd-fold\{min-height:calc\(100vh - var\(--header\)[^}]*\}/.test(css);
  const dicht=/body\.fd-mode/.test(css);
  return (m&&!dicht)||(m?'fd-mode staat nog in de opmaak':'de vouw heeft geen minimumhoogte');
});
t('Geen scrollende kaart met plakkende kop meer',()=>{
  return (!/fd-card\{[^}]*overflow-y:auto/.test(css)
    &&!/fd-card h3\{[^}]*position:sticky/.test(css))
    ||'de kaart-truc staat er nog';
});
t('De kansen rekken mee, ze vermenigvuldigen zich niet',()=>{
  const m=/\n  \.fd-opp\{([^}]*)\}/.exec(css);
  return (qa('#view .fd-opp').length===3&&m&&/flex:1 1 0/.test(m[1]))
    ||`${qa('#view .fd-opp').length} kansen, regel ${m&&m[1]}`;
});
t('Onder 1200px loopt alles in één kolom',()=>{
  return /@media\(max-width:1199px\)\{\s*\.fd-main,\.fd-more-grid\{grid-template-columns:1fr\}/.test(css)
    ||'de kolommen klappen niet samen op smalle schermen';
});
t('Uitverkocht heet uitverkocht, niet over een week op',()=>{
  /* "0 left · out in ~1 weeks" beloofde een week aan iets dat al weg
     was. Nul voorraad krijgt zijn eigen regel, met nadruk. */
  E("window._st=prodById('p4').stock;myLocs().forEach(l=>setStock(prodById('p4'),l,0));render()");
  const rij=[...qa('#view .fd-side .fd-emp')].find(r=>/Sold out/.test(norm(r.textContent)));
  const goed=rij&&rij.querySelector('.x.danger')&&!/out in/.test(norm(rij.textContent));
  E("setStock(prodById('p4'),myLocs()[0],window._st);render()");
  return !!goed||'de uitverkochte regel klopt niet';
});
t('Online bookings telt echte afspraken, geen verzonnen negen',()=>{
  const loc=E('oneLoc()||myLocs()[0]');
  const online=E(`appointments.filter(a=>a.date===TODAY&&a.kind==='appointment'`
    +`&&a.locationId==='${loc}'&&(a.source==='widget'||a.source==='marketplace')).length`);
  const booked=E(`appointments.filter(a=>a.date===TODAY&&a.kind==='appointment'&&a.locationId==='${loc}').length`);
  const rij=[...qa('#view .fd-more .fd-row')].find(r=>/Online bookings/.test(r.textContent));
  return norm(rij.textContent).includes(`${online} of ${booked}`)
    ||`las "${norm(rij.textContent)}" bij ${online} online van ${booked}`;
});

g('Mensen en producten hebben een gezicht');
t('Elke medewerker in het staatje draagt een foto',()=>{
  const rijen=qa('#view .fd-emp .fd-face');
  const met=rijen.filter(f=>f.querySelector('img[src^="https://images.unsplash.com"]'));
  return (rijen.length>0&&met.length>=4)||`${met.length} van ${rijen.length} met foto`;
});
t('En valt een foto weg, dan staat de initiaal klaar — geen grijs vak',()=>{
  const bad=qa('#view .fd-face').filter(f=>
    f.querySelector('img')&&(!f.querySelector('img').getAttribute('onerror')
      ||!f.querySelector('.fd-init')));
  return bad.length===0||`${bad.length} gezichten zonder vangnet`;
});
t('De voorraadkaart toont alleen wat op raakt',()=>{
  const rijen=qa('#view .fd-card .fd-emp .fd-shot').length;
  const laag=E("products.filter(p=>!p.own&&p.stock<=8).slice(0,3).length");
  return rijen===laag||`${rijen} rijen bij ${laag} lage voorraden`;
});

g('Kumo staat erbij als mentor');
t('Eén inzicht, met uitleg en één knop',()=>{
  const k=d.querySelector('#view .fd-kumo');
  return (!!k&&qa('#view .fd-kumo').length===1&&!!k.querySelector('[data-go]'))
    ||'Kumo ontbreekt of staat er dubbel';
});

g('Opmaak binnen het bestaande stelsel');
t('Geen eigen kleurenwereld: de kaart leunt op de bestaande accenten',()=>{
  const m=/\.fd-hero\{([^}]*)\}/.exec(css);
  return (m&&/var\(--accent/.test(m[1]))||`.fd-hero leest ${m&&m[1]}`;
});
t('Geen donkere missiecontrole, geen gloed',()=>{
  const fdCss=css.match(/\.fd[^{]*\{[^}]*\}/g).join('');
  return !/#0|#1[0-9a-f]|glow|linear-gradient/i.test(fdCss)
    ||'er zit donker of gloeiend werk in de flightdeck-opmaak';
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode=fail?1:0;
},400);
