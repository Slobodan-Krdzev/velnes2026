/* De catalogus-lade in secties: kopanatomie, getrapte onthulling en het
   kladmodel. Wat hier getoetst wordt is gedrag en opmaaktekst — jsdom
   rekent geen cascade uit en meet geen geometrie. */
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
const openSvc=(id='s1')=>{
  E("closePanel(true);session.userId='e1';state.route='catalog';state.catTab='services';"
    +"state.edView='sections';state.edOpen={};render()");
  E(`openPanel(PANELS.serviceEdit('${id}'),'serviceEdit','${id}')`);
};
const openProd=(id='p1')=>{
  E("closePanel(true);state.route='catalog';state.catTab='products';"
    +"state.edView='sections';state.edOpen={};render()");
  E(`openPanel(PANELS.productEdit('${id}'),'productEdit','${id}')`);
};
const secs=()=>qa('#panel .ed-sec');
const heads=()=>qa('#panel .ed-sechead');

setTimeout(()=>{

g('De kop scheidt drie dingen die vaak op één hoop gaan');
t('De opslagstand staat er en is geen knop',()=>{
  openSvc();
  const st=d.querySelector('#panel .panel-topbar [data-panelstatus]');
  if(!st)return 'geen opslagstand in de kop';
  return (norm(st.textContent)==='All changes saved'&&st.tagName!=='BUTTON')
    ||`las "${norm(st.textContent)}" op een <${st.tagName.toLowerCase()}>`;
});
t('De titel staat in de kop, want daar landt het oog',()=>{
  return norm(d.querySelector('#panel .panel-head').textContent).includes('Physiotherapy session')
    ||'de titel staat niet in de kop';
});
t('Met het kenmerk en het soort eronder',()=>{
  const sub=d.querySelector('#panel .panel-ident .sub');
  return (sub&&norm(sub.textContent)==='ID: S1 · Service')||`las "${sub&&norm(sub.textContent)}"`;
});
t('Actief staat rechtsboven bij de identiteit, niet in een sectie',()=>{
  const live=d.querySelector('#panel .panel-ident .panel-live');
  return !!(live&&/Active/.test(norm(live.textContent))&&live.querySelector('.toggle'))
    ||'geen actiefschakelaar in het identiteitsblok';
});
t('Opslaan en sluiten zitten aan elkaar vast, als in de CMS',()=>{
  const g=d.querySelector('#panel .panel-endgroup');
  if(!g)return 'geen gekoppelde eindgroep';
  const kinderen=[...g.children].map(c=>c.className.split(' ')[0]);
  return kinderen.join('|')==='btn|panel-x'||`groep bevat: ${kinderen.join('|')}`;
});
t('Het kruis is een gevuld vlak, geen kaal icoontje',()=>{
  const m=/\n\.panel-x\{([^}]*)\}/.exec(css);
  return (m&&/background:var\(--accent-deep\)/.test(m[1])&&/color:#fff/.test(m[1]))
    ||`.panel-x leest ${m&&m[1]}`;
});
t('En de uitstaande opslagknop is gedempte olijf, geen grijs',()=>{
  const m=/\.panel-endgroup \.btn-primary:disabled\{([^}]*)\}/.exec(css);
  return (m&&/--accent-soft/.test(m[1])&&/opacity:1/.test(m[1]))||`las ${m&&m[1]}`;
});
t('Sluiten staat als laatste in zijn eigen knoppengroep',()=>{
  const close=d.querySelector('#panel .panel-actions [data-panelclose]');
  const groep=[...close.parentElement.children].filter(c=>c.matches('button'));
  return groep[groep.length-1]===close||`sluiten staat op plek ${groep.indexOf(close)+1} van ${groep.length}`;
});
t('En draagt een naam voor wie hem niet ziet',()=>{
  return d.querySelector('#panel [data-panelclose]').getAttribute('aria-label')==='Close'
    ||'geen aria-label';
});
t('Er is precies één hoofdknop',()=>{
  const n=qa('#panel .panel-head .btn-primary').length;
  return n===1||`${n} hoofdknoppen in de kop`;
});
t('En die zegt wat hij doet, niet Done',()=>{
  const b=d.querySelector('#panel [data-panelsave]');
  return norm(b.textContent)==='Save changes'||`de knop leest "${norm(b.textContent)}"`;
});
t('Naast de titel staat een potlood',()=>{
  return !!d.querySelector('#panel [data-panelrename]')||'geen hernoemknop';
});
t('Dat de eerste sectie openklapt en de cursor in het naamveld zet',()=>{
  E("state.edOpen={};renderPanel()");
  d.querySelector('#panel [data-edsec$="|general"]').click();      /* eerst dicht */
  d.querySelector('#panel [data-panelrename]').click();
  const open=d.querySelector('#panel .ed-sec').classList.contains('open');
  const focus=d.activeElement&&d.activeElement.getAttribute('data-inline');
  return (open&&focus==='s1|name')||`open: ${open}, focus op ${focus}`;
});
t('Onderin staat waar het vandaan komt',()=>{
  const p=d.querySelector('#panel .panel-foot .ed-prov');
  return (p&&/Last modified/.test(norm(p.textContent)))||'geen herkomstregel';
});

g('Getrapte onthulling: alleen de eerste sectie staat open');
t('De dienst heeft vijf genummerde secties',()=>{
  const titels=heads().map(h=>norm(h.querySelector('.ed-sectitle').textContent));
  return titels.length===5||`${titels.length} secties: ${titels.join(' | ')}`;
});
t('In de volgorde die is afgesproken',()=>{
  const titels=heads().map(h=>norm(h.querySelector('.ed-sectitle').textContent).replace(/^\d+\. /,''));
  const want=['General','Durations and prices','Availability and booking','Memberships','Advanced settings'];
  return want.every((n,i)=>titels[i].startsWith(n))||`las: ${titels.join(' | ')}`;
});
t('Alleen de eerste staat open',()=>{
  const open=secs().filter(x=>x.classList.contains('open'));
  return (open.length===1&&open[0]===secs()[0])||`${open.length} secties open`;
});
t('En de dichte secties hebben geen inhoud in de DOM',()=>{
  const bodies=qa('#panel .ed-secbody').length;
  return bodies===1||`${bodies} sectielichamen terwijl er één open staat`;
});

g('Elke kop zegt zelf hoe hij ervoor staat');
t('Alle vijf de secties dragen een statuslabel',()=>{
  const zonder=heads().filter(h=>!h.querySelector('.ed-pill'))
    .map(h=>norm(h.querySelector('.ed-sectitle').textContent));
  return zonder.length===0||`zonder label: ${zonder.join(', ')}`;
});
t('Het label beantwoordt de vraag zonder uitklappen',()=>{
  /* "All locations" en "3 plans" zijn antwoorden. "Availability" alleen
     is dat niet — dan moet je alsnog openklappen om iets te weten. */
  const pills=heads().map(h=>norm(h.querySelector('.ed-pill').textContent));
  return (pills[0]==='Required'&&/locations/.test(pills[2])&&/plan/.test(pills[3]))
    ||`labels: ${pills.join(' | ')}`;
});
t('De abonnementensectie zegt eerlijk dat de plannen weg zijn',()=>{
  E("openPanel(PANELS.serviceEdit('s5'),'serviceEdit','s5')");
  const pill=norm(heads()[3].querySelector('.ed-pill').textContent);
  const body=E("svcMembershipBody('s5')");
  return (pill==='Not in a plan'&&/retired/.test(body)&&/Velnes Premium/.test(body))
    ||`las "${pill}"`;
});
t('En een lege voorraad slaat alarm op de kop',()=>{
  openProd('p1');
  E("myLocs().forEach(l=>setStock(prodById('p1'),l,0));renderPanel()");
  const pill=heads()[1].querySelector('.ed-pill');
  return pill.classList.contains('warn')||`label "${norm(pill.textContent)}" zonder waarschuwtoon`;
});

g('Open- en dichtklappen');
t('Een kop klikken opent zijn sectie',()=>{
  openSvc();
  heads()[3].click();
  return secs()[3].classList.contains('open')||'de sectie bleef dicht';
});
t('En de eerste blijft gewoon open staan — het is geen accordeon',()=>{
  return secs()[0].classList.contains('open')||'de eerste sectie klapte dicht';
});
t('Nog eens klikken sluit hem weer',()=>{
  heads()[3].click();
  return !secs()[3].classList.contains('open')||'de sectie bleef open';
});
t('aria-expanded loopt mee',()=>{
  const dicht=heads()[3].getAttribute('aria-expanded');
  heads()[3].click();
  const open=heads()[3].getAttribute('aria-expanded');
  heads()[3].click();
  return (dicht==='false'&&open==='true')||`dicht: ${dicht}, open: ${open}`;
});

g('Alles uitklappen');
t('De knop klapt alles open',()=>{
  openSvc();
  d.querySelector('#panel [data-edexpand]').click();
  const open=secs().filter(x=>x.classList.contains('open')).length;
  return open===5||`${open} van de 5 open`;
});
t('En heet dan Collapse all',()=>{
  const b=d.querySelector('#panel [data-edexpand]');
  return (/Collapse all/.test(norm(b.textContent))&&b.dataset.edexpand==='collapse')
    ||`de knop leest "${norm(b.textContent)}"`;
});
t('Waarmee alles weer dichtgaat',()=>{
  d.querySelector('#panel [data-edexpand]').click();
  const open=secs().filter(x=>x.classList.contains('open')).length;
  return open===0||`${open} secties bleven open`;
});

g('Per section en Full overview tonen dezelfde gegevens');
t('De schakelaar staat er met twee standen',()=>{
  openSvc();
  const b=qa('#panel .ed-seg button').map(x=>norm(x.textContent));
  return b.join('|')==='Per section|Full overview'||`las: ${b.join('|')}`;
});
t('Full overview zet alles open',()=>{
  d.querySelector('#panel [data-edview="full"]').click();
  const open=secs().filter(x=>x.classList.contains('open')).length;
  return open===5||`${open} van de 5 open`;
});
t('En laat Alles uitklappen weg, want daar valt niets meer uit te klappen',()=>{
  return qa('#panel [data-edexpand]').length===0||'de knop staat er nog';
});
t('Het aantal velden verandert niet van de weergave',()=>{
  /* GX-02c: de schakelaar verandert de presentatie, nooit welke velden
     er zijn of wat erin staat. */
  const volle=qa('#panel .ed-secbody input,#panel .ed-secbody select').length;
  d.querySelector('#panel [data-edview="sections"]').click();
  d.querySelector('#panel [data-edexpand]').click();
  const perSectie=qa('#panel .ed-secbody input,#panel .ed-secbody select').length;
  return volle===perSectie||`${volle} velden vol, ${perSectie} per sectie`;
});

g('Het kladmodel: opslaan betekent iets');
t('Schoon staat de opslagknop uit',()=>{
  openSvc();
  return d.querySelector('#panel [data-panelsave]').disabled===true||'de knop staat meteen aan';
});
t('Een wijziging zet de kop op Unsaved changes',()=>{
  const inp=d.querySelector('#panel [data-inline$="|name"]');
  inp.value='Physio session, long';
  inp.dispatchEvent(new w.Event('input',{bubbles:true}));
  const st=d.querySelector('#panel [data-panelstatus]');
  return (norm(st.textContent)==='Unsaved changes'&&st.classList.contains('warn'))
    ||`las "${norm(st.textContent)}"`;
});
t('En zet de opslagknop aan',()=>{
  return d.querySelector('#panel [data-panelsave]').disabled===false||'de knop bleef uit';
});
t('Sluiten vraagt eerst, in plaats van stil weg te gooien',()=>{
  d.querySelector('#panel [data-panelclose]').click();
  return !!d.querySelector('[data-panelconfirm]')||'de lade sloot zonder te vragen';
});
t('Weggooien zet de dienst terug zoals hij was',()=>{
  E("services.find(x=>x.id==='s1').name='Physiotherapy session'");
  E("const n='X'+Date.now();services.find(x=>x.id==='s1').name=n;window._n=n");
  d.querySelector('[data-panelconfirm]').click();
  return E("services.find(x=>x.id==='s1').name")!==E('window._n')
    ||'de wijziging bleef staan na weggooien';
});
t('Opslaan houdt de wijziging juist wel',()=>{
  openSvc();
  const inp=d.querySelector('#panel [data-inline$="|name"]');
  inp.value='Physio, 45 min';
  inp.dispatchEvent(new w.Event('input',{bubbles:true}));
  inp.dispatchEvent(new w.Event('change',{bubbles:true}));
  d.querySelector('#panel [data-panelsave]').click();
  const naam=E("services.find(x=>x.id==='s1').name");
  E("services.find(x=>x.id==='s1').name='Physiotherapy session'");
  return naam==='Physio, 45 min'||`de naam bleef "${naam}"`;
});

g('Een nieuw record bestaat pas na opslaan');
t('De nieuwe dienst toont dezelfde vijf secties',()=>{
  E("closePanel(true);state.route='catalog';state.edOpen={};state.edView='sections';render();"
   +"openPanel(PANELS.service(),'service')");
  return secs().length===5||`${secs().length} secties`;
});
t('Maar vier ervan zeggen dat ze op het opslaan wachten',()=>{
  const later=heads().filter(h=>/Available after saving/.test(norm(h.textContent))).length;
  return later===4||`${later} secties in de wacht`;
});
t('En de herkomstregel zegt dat er nog niets staat',()=>{
  return norm(d.querySelector('#panel .panel-foot .ed-prov').textContent)==='Not saved yet'
    ||'geen eerlijke herkomstregel';
});
t('Het product heeft er twee, want stock hoort bij een vestiging',()=>{
  E("closePanel(true);state.catTab='products';state.edOpen={};render();openPanel(PANELS.product(),'product')");
  return secs().length===2||`${secs().length} secties`;
});

g('Opmaak die de secties overeind houdt');
t('Een dichte sectie draait zijn punthaak pas bij open',()=>{
  return /\.ed-sec\.open \.ed-secchev\{transform:rotate\(90deg\)\}/.test(css)
    ||'geen draairegel voor de punthaak';
});
t('De sectiekop is een flexvak, zodat het label naast de titel past',()=>{
  const m=/\n\.ed-sectitle\{([^}]*)\}/.exec(css);
  return (m&&/display:flex/.test(m[1])&&/flex-wrap:wrap/.test(m[1]))||`.ed-sectitle leest ${m&&m[1]}`;
});
t('De kop van de lade staat onder elkaar, niet naast elkaar',()=>{
  const m=/\n\.panel-head\{([^}]*)\}/.exec(css);
  return (m&&/flex-direction:column/.test(m[1]))||`.panel-head leest ${m&&m[1]}`;
});
t('De oude platte kop houdt zijn eigen regel',()=>{
  return /\.panel-head\.plain\{/.test(css)||'geen aparte regel voor de platte kop';
});

g('De lade neemt hetzelfde aandeel van het scherm als de CMS');
t('De breedte is een aandeel, geen vaste maat',()=>{
  const m=/:root\{--panel-w:([^}]*)\}/.exec(css);
  return (m&&/33vw/.test(m[1]))||`--panel-w leest ${m&&m[1]}`;
});
t('Met 480px als bodem, zodat een laptop niets inlevert',()=>{
  const m=/:root\{--panel-w:([^}]*)\}/.exec(css);
  return (m&&/max\(480px,33vw\)/.test(m[1]))||`--panel-w leest ${m&&m[1]}`;
});
t('En min(max(..)) in plaats van clamp, anders wordt hij breder dan de telefoon',()=>{
  /* clamp(480px,33vw,94vw) geeft bij een smal scherm de ondergrens terug,
     want daar zakt 94vw ónder 480px. Dat is precies de lade die over de
     rand valt. */
  const m=/:root\{--panel-w:([^}]*)\}/.exec(css);
  return (m&&/^min\(/.test(m[1].trim()))||`--panel-w leest ${m&&m[1]}`;
});
t('De pagina eronder schuift met dezelfde maat op',()=>{
  return /body\.panel-open \.shell\{padding-right:var\(--panel-w\)\}/.test(css)
    ||'de opvulling van de pagina loopt niet mee met de lade';
});
t('De lade zelf leest die maat ook echt',()=>{
  const m=/\n\.panel\{([^}]*)\}/.exec(css);
  return (m&&/width:var\(--panel-w\)/.test(m[1]))||`.panel leest ${m&&m[1]}`;
});
t('Op de compacte tablet blijft hij smal',()=>{
  return /:root\{--panel-w:min\(460px,92vw\)\}/.test(css)
    ||'geen eigen maat in de tabletband';
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode=fail?1:0;
},400);
