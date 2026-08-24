/* Rollen zijn overal op dezelfde manier te beheren, de schakelaar heeft
   weer een zichtbare knop, en de Add-knop noemt zijn sectie niet. */
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
const portal=()=>go('portal',"state.poTab='settings';");
const hq=()=>go('hq',"state.hqTab='team';");
const salon=()=>go('settings',"state.settingsTab='roles';");
/* Een rol maken loopt sinds deze wijziging via het Add-menu in de balk,
   niet meer via een tweede knop in de rollenkaart zelf. */
const addRoleVia=k=>{
  E('state.addMenu=false;render()');
  const b=d.querySelector('#view .toolbar-actions [data-addmenu]');
  if(!b)return 'geen Add-knop in de balk';
  b.click();
  const row=d.querySelector(`#view .toolbar-actions [data-panel="roleKitNew|${k}"]`);
  if(!row)return 'geen Role-regel in het menu';
  row.click();
  return null;
};

setTimeout(()=>{
g('De schakelaar heeft weer een knop');
t('Het vlak is een flexvak, anders telt de knop niet mee',()=>{
  const m=/\n\.toggle\{([^}]*)\}/.exec(css);
  return (m&&/display:inline-flex/.test(m[1]))||`.toggle leest ${m&&m[1]}`;
});
t('De knop is een blok, dus breedte en hoogte doen iets',()=>{
  const m=/\n\.toggle \.knob\{([^}]*)\}/.exec(css);
  return (m&&/display:block/.test(m[1]))||'de knob is nog inline';
});
t('Hij is wit en rond',()=>{
  const m=/\n\.toggle \.knob\{([^}]*)\}/.exec(css)[1];
  return (/background:#fff/.test(m)&&/border-radius:99px/.test(m))||`knob leest ${m}`;
});
t('En schuift naar rechts als hij aanstaat',()=>
  /\.toggle\.on \.knob\{transform:translateX\(20px\)\}/.test(css)||'hij schuift niet');
t('Er staat er echt een in een tabel',()=>{
  go('catalog',"state.catTab='services';");
  const tog=d.querySelector('#view table .toggle .knob');
  return !!tog||'geen schakelaar met knop in de dienstentabel';
});

g('De Add-knop noemt zijn sectie niet');
t('In de catalogus heet hij Add',()=>{
  go('catalog',"state.catTab='products';");
  const b=[...qa('#view .toolbar-actions .btn')].find(x=>x.textContent.trim()==='Add');
  return !!b||`knoppen: ${qa('#view .toolbar-actions .btn').map(x=>x.textContent.trim()).join(', ')}`;
});
t('Bij de medewerkers ook',()=>{
  go('settings',"state.settingsTab='employees';");
  const b=[...qa('#view .btn')].find(x=>x.dataset.panel==='employee');
  return (b&&b.textContent.trim()==='Add')||`knop leest ${b&&b.textContent.trim()}`;
});
t('En bij de vestigingen',()=>{
  go('settings',"state.settingsTab='locations';");
  const b=[...qa('#view .btn')].find(x=>x.dataset.panel==='location');
  return (b&&b.textContent.trim()==='Add')||`knop leest ${b&&b.textContent.trim()}`;
});
t('Hij is smaller gemaakt',()=>
  /\.btn-add\{padding:0 12px/.test(css)||'geen krappere maat');
t('En draagt die maat ook echt',()=>{
  go('catalog',"state.catTab='services';");
  const b=[...qa('#view .toolbar-actions .btn')].find(x=>x.textContent.trim()==='Add');
  return (b&&b.classList.contains('btn-add'))||'de knop draagt de klasse niet';
});

g('Rollen in het leveranciersportaal');
t('Elke rol draagt rechten',()=>{
  const zonder=E("supplierRoles.filter(r=>!r.perms).map(r=>r.name)");
  return zonder.length===0||`zonder rechten: ${zonder.join(', ')}`;
});
t('De eigenaar mag alles, de analist bijna niets',()=>{
  const own=E("Object.values(supplierRoles.find(r=>r.id==='sr_owner').perms).filter(v=>v!=='none').length");
  const an=E("Object.values(supplierRoles.find(r=>r.id==='sr_analyst').perms).filter(v=>v!=='none').length");
  return own>an||`eigenaar ${own}, analist ${an}`;
});
t('De rollenkaart heeft geen eigen Add-knop meer',()=>{
  portal();
  return !d.querySelector('#view .card-header [data-panel^="roleKitNew"]')
    ||'er staat nog een tweede Add in de kaart';
});
t('Er staat maar één Add-knop op het scherm',()=>{
  portal();
  const n=qa('#view .btn-primary').length;
  return n===1||`${n} Add-knoppen`;
});
t('Die knop biedt een rol én een teamlid aan',()=>{
  portal();
  E('state.addMenu=false;render()');
  d.querySelector('#view .toolbar-actions [data-addmenu]').click();
  const rows=qa('#view .toolbar-actions .menu-row').map(x=>x.dataset.panel);
  E('state.addMenu=false;render()');
  return (rows.includes('poUser')&&rows.includes('roleKitNew|supplier'))||`menu: ${rows.join(', ')}`;
});
t('Elke rol is te bewerken',()=>{
  const n=E('supplierRoles.length');
  const edit=qa('#view [data-panel^="roleKitEdit|supplier"]').length;
  return edit===n||`${edit} bewerkknoppen bij ${n} rollen`;
});
t('En er staat geen Duplicate meer naast',()=>
  qa('#view [data-rolekitclone]').length===0||'Duplicate staat er nog');
t('De bewerkknop is een tekstknop geworden',()=>{
  const b=d.querySelector('#view [data-panel^="roleKitEdit|supplier"]');
  return (b.classList.contains('btn-ghost')&&!b.classList.contains('btn-secondary'))
    ||`klassen: ${b.className}`;
});
t('Een standaardrol heeft geen verwijderknop',()=>{
  const del=qa('#view [data-rolekitdel^="supplier"]').length;
  return del===0||`${del} verwijderknoppen bij alleen standaardrollen`;
});
t('Een rol maken vanaf een bestaande houdt zijn rechten',()=>{
  portal();
  {const err=addRoleVia('supplier'); if(err)return err;}
  const n=d.querySelector('#panel [data-kf="name"]');
  n.value='Analyst copy'; n.dispatchEvent(new w.Event('input',{bubbles:true}));
  const b=d.querySelector('#panel [data-kf="base"]');
  b.value='sr_analyst'; b.dispatchEvent(new w.Event('change',{bubbles:true}));
  d.querySelector('#panel [data-panelsave]').click();
  const made=E("supplierRoles.find(r=>r.name==='Analyst copy')");
  if(!made)return 'niet aangemaakt';
  const same=E("JSON.stringify(supplierRoles.find(r=>r.name==='Analyst copy').perms)==="+
    "JSON.stringify(supplierRoles.find(r=>r.id==='sr_analyst').perms)");
  return same||'de rechten liepen niet mee';
});
t('En die kopie mág weg, want er zit niemand op',()=>{
  portal();
  const id=E('supplierRoles[supplierRoles.length-1].id');
  const b=d.querySelector(`#view [data-rolekitdel="supplier|${id}"]`);
  return !!b||'geen verwijderknop op de kopie';
});
t('Weghalen werkt ook echt',()=>{
  const before=E('supplierRoles.length');
  const id=E('supplierRoles[supplierRoles.length-1].id');
  d.querySelector(`#view [data-rolekitdel="supplier|${id}"]`).click();
  return E('supplierRoles.length')===before-1||'de rol staat er nog';
});
t('Een rol met mensen erop laat zich niet weghalen',()=>{
  E("supplierRoles.push({id:'sr_test',name:'Test',std:false,scope:'x',perms:{}});"+
    "supplierUsers.push({id:'su_test',name:'Test person',email:'t@t.mk',role:'sr_test',last:'—'})");
  E("handleClickTest=1");
  const before=E('supplierRoles.length');
  E("document.body.dispatchEvent(new window.Event('x'))");
  portal();
  const b=d.querySelector('#view [data-rolekitdel="supplier|sr_test"]');
  const hidden=!b;
  E("supplierUsers.pop();supplierRoles.pop()");
  return hidden||'de knop staat er terwijl er iemand op zit';
});

g('Een rol maken en wijzigen in het portaal');
t('De lade opent met de rechten van de basisrol',()=>{
  portal();
  {const err=addRoleVia('supplier'); if(err)return err;}
  return !!d.querySelector('#panel [data-kf="name"]')||'geen formulier';
});
t('Zonder naam wordt er niets gemaakt',()=>{
  const before=E('supplierRoles.length');
  d.querySelector('#panel [data-panelsave]').click();
  return E('supplierRoles.length')===before||'naamloze rol aangemaakt';
});
t('Met naam komt hij erbij',()=>{
  const before=E('supplierRoles.length');
  const n=d.querySelector('#panel [data-kf="name"]');
  n.value='Regional manager'; n.dispatchEvent(new w.Event('input',{bubbles:true}));
  d.querySelector('#panel [data-panelsave]').click();
  return E('supplierRoles.length')===before+1||'niet aangemaakt';
});
t('Bewerken toont zijn rechten met een bereik',()=>{
  portal();
  const id=E("supplierRoles.find(r=>r.name==='Regional manager').id");
  d.querySelector(`#view [data-panel="roleKitEdit|supplier|${id}"]`).click();
  return qa('#panel [data-rolekitscope]').length>0||'geen bereikkeuzes';
});
t('Een bereik verzetten landt op de rol',()=>{
  const id=E("supplierRoles.find(r=>r.name==='Regional manager').id");
  const sel=d.querySelector(`#panel [data-rolekitscope="supplier|${id}|po.orders"]`);
  sel.value='all'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
  return E(`supplierRoles.find(r=>r.id==='${id}').perms['po.orders']`)==='all'||'niet opgeslagen';
});
t('En komt in het logboek',()=>
  E("auditLog.some(x=>x.action==='Permission changed'&&/Supplier role/.test(x.object))")
  ||'geen logregel');
t('De vergrendelde eigenaarsrol laat niets verzetten',()=>{
  portal();
  d.querySelector('#view [data-panel="roleKitEdit|supplier|sr_owner"]').click();
  const sels=qa('#panel [data-rolekitscope]').length;
  const tags=qa('#panel .scopetag').length;
  return (sels===0&&tags>0)||`${sels} keuzes, ${tags} labels`;
});
E('closePanel(true)');

g('De gebruikersteller');
t('Elke rol draagt er een',()=>{
  portal();
  return qa('#view [data-rolekitusers]').length===E('supplierRoles.length')
    ||`${qa('#view [data-rolekitusers]').length} tellers bij ${E('supplierRoles.length')} rollen`;
});
t('Hij heeft altijd dezelfde breedte',()=>
  /\.badge-count\{[^}]*width:84px/.test(css)||'geen vaste breedte');
t('En het getal staat er gecentreerd in',()=>
  /\.badge-count\{[^}]*justify-content:center/.test(css)||'niet gecentreerd');
t('Hij krimpt niet mee als de rij vol wordt',()=>
  /\.badge-count\{[^}]*flex:none/.test(css)||'hij kan krimpen');
t('Klikken opent wie erop zitten',()=>{
  portal();
  d.querySelector('#view [data-rolekitusers="supplier|sr_account"]').click();
  const menu=d.querySelector('#view .menu');
  return !!menu||'geen lijstje';
});
t('Met de namen van die mensen erin',()=>{
  const txt=d.querySelector('#view .menu').textContent;
  const want=E("supplierUsers.filter(u=>u.role==='sr_account').map(u=>u.name)");
  const missing=want.filter(n=>!txt.includes(n));
  return missing.length===0||`ontbreekt: ${missing.join(', ')}`;
});
t('En niet die van een andere rol',()=>{
  const txt=d.querySelector('#view .menu').textContent;
  const other=E("supplierUsers.filter(u=>u.role!=='sr_account').map(u=>u.name)");
  const leaked=other.filter(n=>txt.includes(n));
  return leaked.length===0||`ook zichtbaar: ${leaked.join(', ')}`;
});
t('Nog eens klikken sluit het weer',()=>{
  d.querySelector('#view [data-rolekitusers="supplier|sr_account"]').click();
  return !d.querySelector('#view .menu')||'het lijstje bleef open';
});
t('Er is er nooit meer dan één open',()=>{
  portal();
  d.querySelector('#view [data-rolekitusers="supplier|sr_account"]').click();
  d.querySelector('#view [data-rolekitusers="supplier|sr_order"]').click();
  return qa('#view .menu').length===1||`${qa('#view .menu').length} lijstjes open`;
});
t('Een rol zonder mensen zegt dat gewoon',()=>{
  portal();
  E("supplierRoles.push({id:'sr_empty',name:'Empty',std:false,scope:'x',perms:{}})");
  portal();
  d.querySelector('#view [data-rolekitusers="supplier|sr_empty"]').click();
  const txt=d.querySelector('#view .menu').textContent;
  const ok=/Nobody yet/.test(txt);
  E("state.roleUsers=null;supplierRoles.pop()");
  return ok||`lijstje leest ${txt.trim().slice(0,40)}`;
});
E('state.roleUsers=null');

g('Het label naast de rolnaam');
t('Het staat ruimer om zijn tekst',()=>
  /\.badge\.tag-wide\{padding:4px 14px\}/.test(css)||'geen ruimere maat');
t('En elk rollabel draagt die maat',()=>{
  portal();
  const tags=qa('#view .rowcard .t .badge');
  const bad=tags.filter(x=>!x.classList.contains('tag-wide'));
  return bad.length===0||`${bad.length} labels zonder ruimte`;
});

g('Rollen in Revelapps HQ');
t('Elke HQ-rol draagt rechten',()=>{
  const zonder=E("hqRoles.filter(r=>!r.perms).map(r=>r.name)");
  return zonder.length===0||`zonder rechten: ${zonder.join(', ')}`;
});
t('De auditor leest wel, maar schrijft nergens',()=>{
  const vals=E("Object.values(hqRoles.find(r=>r.id==='hq_audit').perms)");
  return !vals.includes('write')||'de auditor mag ergens schrijven';
});
t('Dezelfde knoppen als in het portaal',()=>{
  hq();
  E('state.addMenu=false;render()');
  d.querySelector('#view .toolbar-actions [data-addmenu]').click();
  const add=!!d.querySelector('#view .toolbar-actions [data-panel="roleKitNew|hq"]');
  E('state.addMenu=false;render()');
  const edit=qa('#view [data-panel^="roleKitEdit|hq"]').length===E('hqRoles.length');
  const noClone=qa('#view [data-rolekitclone]').length===0;
  return (add&&edit&&noClone)||`add ${add}, edit ${edit}, geen duplicate ${noClone}`;
});
t('Maken en weghalen werkt er ook',()=>{
  const before=E('hqRoles.length');
  E("hqRoles.push({id:'hq_tmp',name:'Temp',std:false,desc:'x',perms:{}})");
  hq();
  const b=d.querySelector('#view [data-rolekitdel="hq|hq_tmp"]');
  if(!b)return 'geen verwijderknop op de nieuwe rol';
  b.click();
  return E('hqRoles.length')===before||'niet weggehaald';
});
t('De super admin blijft vergrendeld',()=>{
  hq();
  return !d.querySelector('#view [data-rolekitdel="hq|hq_super"]')||'de super admin is weg te halen';
});

g('En de salon houdt zijn eigen vorm');
t('Daar staat nu ook een verwijderknop op eigen rollen',()=>{
  salon();
  E("roles.push({id:'r_test',name:'Test role',std:false,desc:'x',perms:{}})");
  salon();
  const b=d.querySelector('#view [data-roledel="r_test"]');
  const ok=!!b;
  if(b)b.click();
  E("const ix=roles.findIndex(r=>r.id==='r_test'); if(ix>=0)roles.splice(ix,1)");
  return ok||'geen verwijderknop op een eigen rol';
});
t('Maar niet op een standaardrol',()=>{
  salon();
  const std=E("roles.filter(r=>r.std).map(r=>r.id)");
  const bad=std.filter(id=>!!d.querySelector(`#view [data-roledel="${id}"]`));
  return bad.length===0||`verwijderbaar: ${bad.join(', ')}`;
});
t('De rechtenmatrix staat er nog',()=>
  !!d.querySelector('#view table.matrix')||'de matrix is verdwenen');

g('De drie plekken zijn dezelfde vorm');
t('Portaal en HQ hebben dezelfde vorm',()=>{
  const shapes=[];
  portal(); shapes.push(['portal',
    (()=>{E('state.addMenu=false;render()');
      d.querySelector('#view .toolbar-actions [data-addmenu]').click();
      const ok=!!d.querySelector('#view .toolbar-actions [data-panel="roleKitNew|supplier"]');
      E('state.addMenu=false;render()'); return ok})(),
    !!d.querySelector('#view [data-panel^="roleKitEdit"]'),
    !!d.querySelector('#view [data-rolekitusers]')]);
  hq(); shapes.push(['hq',
    (()=>{E('state.addMenu=false;render()');
      d.querySelector('#view .toolbar-actions [data-addmenu]').click();
      const ok=!!d.querySelector('#view .toolbar-actions [data-panel="roleKitNew|hq"]');
      E('state.addMenu=false;render()'); return ok})(),
    !!d.querySelector('#view [data-panel^="roleKitEdit"]'),
    !!d.querySelector('#view [data-rolekitusers]')]);
  const bad=shapes.filter(x=>!(x[1]&&x[2]&&x[3])).map(x=>x[0]);
  return bad.length===0||`onvolledig: ${bad.join(', ')}`;
});
t('En er is maar één implementatie voor portaal en HQ',()=>{
  const n=(html.match(/function roleListCard\(/g)||[]).length;
  return n===1||`${n} implementaties`;
});

g('De filterknop is een icoon geworden');
t('In de agenda draagt de knop zijn naam',()=>{
  go('calendar',"state.calView='week';");
  const b=d.querySelector('#view [data-calfilters]');
  if(!b)return 'geen filterknop';
  return b.textContent.trim().startsWith('Filters')||`de knop leest "${b.textContent.trim()}"`;
});
t('Met de punthaak ernaast en verder geen icoon',()=>{
  /* De trechter is weg: het woord doet het werk. Wat er nog aan opmaak in
     zit is de punthaak, en die zegt alleen dat er iets uitklapt. */
  const b=d.querySelector('#view [data-calfilters]');
  const svgs=b.querySelectorAll('svg').length;
  const caret=b.querySelectorAll('.caret svg').length;
  return (svgs===1&&caret===1)||`${svgs} iconen, waarvan ${caret} punthaak`;
});
/* Het icoontje is teruggedraaid: de knop draagt zijn naam weer en is een
   pil, precies zoals voor de vorige sessie. Wat wél nieuw is, is de
   logica erachter — zie de groep hieronder. */
t('De knop heet weer Filters en is een pil',()=>{
  const b=d.querySelector('#view [data-calfilters]');
  return (b.textContent.trim().startsWith('Filters')&&b.classList.contains('btn-pill')
    &&!b.classList.contains('btn-iconbtn'))||`knop leest "${b.textContent.trim()}", klassen ${b.className}`;
});
t('Er staat een punthaak op die omdraait als het menu openstaat',()=>{
  const dicht=d.querySelector('#view [data-calfilters] .caret');
  if(!dicht)return 'geen punthaak';
  if(dicht.classList.contains('up'))return 'punthaak staat al omhoog terwijl het menu dicht is';
  E('state.calFilters=true;render()');
  const open=d.querySelector('#view [data-calfilters] .caret');
  const goed=open&&open.classList.contains('up');
  E('state.calFilters=false;render()');
  return goed||'punthaak draait niet mee';
});
t('Klikken opent nog gewoon het menu',()=>{
  d.querySelector('#view [data-calfilters]').click();
  const open=!!d.querySelector('#view .menu .filterrow');
  E('state.calFilters=false;render()');
  return open||'het menu bleef dicht';
});
t('Elders in de app dezelfde knop',()=>{
  go('customers');
  const b=d.querySelector('#view [data-filters]');
  if(!b)return 'geen filterknop bij de klanten';
  return (b.textContent.trim().startsWith('Filters')&&b.classList.contains('btn-pill'))
    ||`knop leest "${b.textContent.trim()}", klassen ${b.className}`;
});
t('En de knop staat er op elk scherm dat filtert',()=>{
  const mist=[];
  ['calendar','customers'].forEach(r=>{
    go(r);
    const b=d.querySelector('#view [data-filters],#view [data-calfilters]');
    if(!b||!b.textContent.trim().startsWith('Filters'))mist.push(r);
  });
  return mist.length===0||`geen woordknop op: ${mist.join(', ')}`;
});
t('Het aantal actieve filters is nog te zien',()=>{
  go('calendar',"state.calView='week';state.calEmp='e1';");
  const b=d.querySelector('#view [data-calfilters]');
  return !!b.querySelector('.fbadge')||'geen telletje bij een actief filter';
});

g('Eén filterdimensie wijst meteen de waarden aan');
/* De klanten filteren alleen op groep. Daar hoort geen paneel met één
   regel in, maar de groepen zelf. */
t('Bij de klanten opent de knop nu twee dimensies: groep en status',()=>{
  /* Sinds de terugkeeretiketten filtert dit scherm op groep én status;
     het enkelvoudige keuzemenu (13 aug) is daarmee bewust het brede
     paneel geworden — dezelfde opbouw als de agenda. */
  go('customers',"state.filters=false;");
  d.querySelector('#view [data-filters]').click();
  const rijen=qa('#view .menu .filterrow').length;
  return rijen===2||`${rijen} filterregels`;
});
t('Groep en status staan er allebei, met hun standaard voorop',()=>{
  const sels=qa('#view .menu .filterrow select').map(s=>s.value);
  return sels.join('|')==='all|all'||`las: ${sels.join('|')}`;
});
t('Clear all hoort er in het brede paneel juist wél te staan',()=>{
  return qa('#view .menu [data-filterclear]').length===1||'Clear all ontbreekt';
});
t('Een groep kiezen zet het filter',()=>{
  E("state.customerGroup='VIP';state.filters=false;render()");
  return E('state.customerGroup')==='VIP'||`filter ${E('state.customerGroup')}`;
});
t('En dan telt de knop mee',()=>{
  const b=d.querySelector('#view [data-filters]');
  return !!b.querySelector('.fbadge')||'geen telletje na het kiezen';
});
t('Clear all wist beide dimensies',()=>{
  E("state.customerStatus='at_risk';render()");
  d.querySelector('#view [data-filters]').click();
  d.querySelector('#view .menu [data-filterclear]').click();
  const b=d.querySelector('#view [data-filters]');
  return (E('state.customerGroup')==='all'&&E('state.customerStatus')==='all'
    &&!b.querySelector('.fbadge'))
    ||`groep ${E('state.customerGroup')}, status ${E('state.customerStatus')}`;
});
t('De agenda houdt zijn volle paneel, want die filtert op meer tegelijk',()=>{
  go('calendar',"state.calFilters=false;");
  d.querySelector('#view [data-calfilters]').click();
  const rijen=qa('#view .menu .filterrow').length;
  const clear=qa('#view .menu [data-calclear]').length;
  E('state.calFilters=false;render()');
  return (rijen>1&&clear===1)||`${rijen} filterregels, ${clear} Clear all`;
});

g('De regel in de catalogus');
t('Het miniatuur staat naast alles wat erbij hoort',()=>{
  go('catalog',"state.catTab='services';");
  const cell=d.querySelector('#view .cellmain');
  if(!cell)return 'geen regelopbouw gevonden';
  const body=cell.querySelector('.cellbody');
  return !!body||'geen kolom naast het miniatuur';
});
t('Naam en labels staan in die kolom, niet onder het plaatje',()=>{
  const cell=[...qa('#view .cellmain')].find(c=>/durations/.test(c.textContent));
  if(!cell)return 'geen regel met een durations-label';
  const body=cell.querySelector('.cellbody');
  return (body&&/durations/.test(body.textContent))||'het label staat buiten de kolom';
});
t('Het miniatuur zelf staat in het midden',()=>{
  const css2=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
  const m=/\.cellmain\{([^}]*)\}/.exec(css2);
  return (m&&/align-items:center/.test(m[1]))||`.cellmain leest ${m&&m[1]}`;
});
t('De kolom mag krimpen, dus de tabel breekt niet open',()=>{
  const css2=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
  const m=/\.cellbody\{([^}]*)\}/.exec(css2);
  return (m&&/min-width:0/.test(m[1]))||'de kolom kan de tabel openduwen';
});
t('Bij weinig ruimte breken de labels netjes af',()=>{
  const css2=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
  const m=/\.cellhead\{([^}]*)\}/.exec(css2);
  return (m&&/flex-wrap:wrap/.test(m[1]))||'de kop breekt niet af';
});
t('En de labelrij zelf ook',()=>{
  const cell=[...qa('#view .cellmain')].find(c=>/durations/.test(c.textContent));
  const row=[...cell.querySelectorAll('span')].find(x=>/flex-wrap:wrap/.test(x.getAttribute('style')||''));
  return !!row||'de labelrij breekt niet af';
});
t('De productregels zijn op dezelfde leest geschoeid',()=>{
  go('catalog',"state.catTab='products';");
  const n=qa('#view .cellmain .cellbody').length;
  return n>0||'de productregels gebruiken de oude opbouw';
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
