/* Rangschikking van medewerkers: wie het scherm ziet, wat er standaard
   aanstaat, en of aanvinken ergens landt. */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/'});
const w=dom.window,d=w.document,E=s=>w.eval(s);
let pass=0,fail=0;
const t=(n,fn)=>{try{const r=fn();if(r===true||r===undefined){pass++;console.log('  pass  '+n)}
  else{fail++;console.log('  FAIL  '+n+' → '+r)}}catch(e){fail++;console.log('  FAIL  '+n+' → '+e.message)}};
const g=n=>console.log('\n'+n);
const qa=s=>[...d.querySelectorAll(s)];
/* e1 = eigenaar, e2/e3 = medewerker, e4 = balie. De boekhoudrol zit
   niet op een medewerker, dus die zetten we er los op. */
const as=(who,extra='')=>E(`session.userId='${who}';state.route='settings';${extra}render()`);
const stabs=()=>qa('.snav button').map(b=>b.textContent.trim());
const rows=()=>qa('#view .rankrow');

setTimeout(()=>{
g('De zes maatstaven, met de juiste standaard');
t('Er staan er precies zes',()=>E('RANK_CRITERIA.length')===6||`${E('RANK_CRITERIA.length')} maatstaven`);
t('De namen staan er zoals gevraagd',()=>{
  const want=['Reviews of customers','Upsell amount of products','Total turnover',
    'Turnover upsell','Upsell % of the total','Total appointments'];
  const got=E('RANK_CRITERIA.map(c=>c[1])');
  return got.join(' | ')===want.join(' | ')||`gevonden: ${got.join(' | ')}`;
});
t('Reviews en bijverkoop staan standaard aan',()=>{
  const on=E('rankChosen().map(c=>c[0])');
  return on.join(',')==='rank_reviews,rank_upsellcount'||`aan: ${on.join(', ')}`;
});
t('De andere vier staan standaard uit',()=>{
  const off=E("RANK_CRITERIA.filter(c=>!rankOn(c[0])).map(c=>c[0])");
  return off.length===4||`${off.length} uit`;
});
t('Uit is echt uit, niet onbekend',()=>{
  const undef=E("RANK_KEYS.filter(k=>state.checks[k]===undefined)");
  return undef.length===0||`niet gezet: ${undef.join(', ')}`;
});

g('Wie het scherm mag zien');
t('De eigenaar ziet Ranking settings staan',()=>{
  as('e1');
  return stabs().includes('Ranking settings')||`secties: ${stabs().join(', ')}`;
});
t('Het staat onder het kopje People',()=>{
  as('e1');
  const nodes=qa('.snav > *').map(x=>x.tagName==='SPAN'?'#'+x.textContent.trim():x.textContent.trim());
  const i=nodes.indexOf('Ranking settings');
  if(i<0)return 'staat er niet';
  const head=nodes.slice(0,i).filter(x=>x.startsWith('#')).slice(-1)[0];
  return head==='#People'||`staat onder ${head}`;
});
t('Het staat achter Schedules & services',()=>{
  const b=stabs();
  return b.indexOf('Ranking settings')===b.indexOf('Schedules & services')+1||`volgorde: ${b.join(', ')}`;
});
t('Een manager ziet het ook',()=>{
  E("employees.find(e=>e.id==='e2').roleId='r_manager'");
  as('e2');
  return stabs().includes('Ranking settings')||`secties: ${stabs().join(', ')}`;
});
t('De balie ziet het niet',()=>{
  as('e4');
  return !stabs().includes('Ranking settings')||'de balie ziet het toch';
});
t('Een medewerker ziet het niet',()=>{
  as('e3');
  return !stabs().includes('Ranking settings')||'een medewerker ziet het toch';
});
t('De boekhoudrol ziet het niet — die leest cijfers, hij weegt ze niet',()=>{
  E("employees.find(e=>e.id==='e2').roleId='r_finance'");
  as('e2');
  const seen=stabs().includes('Ranking settings');
  E("employees.find(e=>e.id==='e2').roleId='r_employee'");
  return !seen||'de boekhouding ziet het toch';
});
t('Het adres rechtstreeks openen helpt een medewerker niet',()=>{
  E("session.userId='e3';applyHash('settings/ranking');render()");
  return E('state.settingsTab')!=='ranking'||'hij belandt er alsnog';
});

g('Het scherm zelf');
const open=()=>as('e1',"state.settingsTab='ranking';");
t('Zes aanvinkbare rijen',()=>{open();return rows().length===6||`${rows().length} rijen`});
t('Twee ervan staan aangevinkt',()=>{
  const on=qa('#view .rankrow .check.on').length;
  return on===2||`${on} aangevinkt`;
});
t('Er staat uitleg over het model',()=>{
  const txt=d.querySelector('#view').textContent;
  return /AI model/.test(txt)||'geen uitleg over het model gevonden';
});
t('De uitleg zegt waar de ranglijst terechtkomt',()=>{
  const txt=d.querySelector('#view').textContent;
  return /employee app/i.test(txt)||'de medewerkers-app wordt niet genoemd';
});
t('De teller in de kop klopt',()=>
  /2 of 6 in use/.test(d.querySelector('#view').textContent)||'de teller leest anders');
t('De balk draagt de naam van de sectie',()=>{
  const v=d.querySelector('#view .toolbar-context .v');
  return (v&&v.textContent.trim()==='Ranking settings')||`balk leest ${v&&v.textContent.trim()}`;
});
t('En een opslaanknop, niet een toevoegknop',()=>
  !!d.querySelector('#view [data-settingssave]')||'geen opslaanknop');

g('Aanvinken landt ergens');
t('Een derde maatstaf aanzetten telt mee',()=>{
  open();
  qa('#view [data-check="rank_turnover"]')[0].click();
  if(E("rankOn('rank_turnover')")!==true)return 'niet aangezet';
  return /3 of 6 in use/.test(d.querySelector('#view').textContent)||'de teller liep niet mee';
});
t('En de rij zelf laat zien dat hij aanstaat',()=>{
  const row=qa('#view [data-check="rank_turnover"]')[0];
  return (row.classList.contains('on')&&!!row.querySelector('.check.on'))||'de rij ziet er nog uit als uit';
});
t('Weer uitzetten kan ook',()=>{
  qa('#view [data-check="rank_turnover"]')[0].click();
  return E("rankOn('rank_turnover')")===false||'bleef aanstaan';
});
t('Aanvinken zet de sectie op onopgeslagen',()=>{
  open();
  E('state.settingsDirty=false');
  qa('#view [data-check="rank_appointments"]')[0].click();
  const dirty=E('state.settingsDirty');
  qa('#view [data-check="rank_appointments"]')[0].click();
  return dirty===true||'de balk merkte de wijziging niet';
});

g('De vorm van het scherm');
t('De maatstaven staan twee op een rij',()=>{
  open();
  const grid=d.querySelector('#view .grid2');
  if(!grid)return 'geen raster gevonden';
  const inside=[...grid.children].filter(x=>x.classList.contains('rankrow')).length;
  return inside===6||`${inside} van de zes staan in het raster`;
});
t('Het raster is twee kolommen breed',()=>{
  const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
  return /\.grid2\{display:grid;grid-template-columns:1fr 1fr/.test(css)||'grid2 is geen twee kolommen';
});
t('De vakken naast elkaar zijn even hoog',()=>{
  const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
  return /\.grid2>\.rankrow\{height:100%\}/.test(css)||'de rijen kunnen rafelen';
});
t('De samenvattingskaart is weg',()=>{
  open();
  return !/What your team will see/.test(d.querySelector('#view').textContent)
    ||'de kaart staat er nog';
});
t('Er staan nog twee kaarten: uitleg en keuze',()=>{
  const heads=qa('#view .card-header h2').map(h=>h.textContent.trim());
  return heads.join(' | ')==='How the ranking works | What counts'||`kaarten: ${heads.join(', ')}`;
});

g('De laatste maatstaf blijft staan');
t('Vijf uitzetten lukt, de zesde niet',()=>{
  open();
  E("RANK_KEYS.forEach(k=>state.checks[k]=true);render()");
  const keys=E('RANK_KEYS');
  keys.forEach(k=>{const b=qa(`#view [data-check="${k}"]`)[0];if(b)b.click()});
  const left=E('rankChosen().map(c=>c[0])');
  return left.length===1||`er bleven er ${left.length} over`;
});
t('Er wordt uitgelegd waarom dat niet kan',()=>{
  const b=qa(`#view [data-check="${E('rankChosen()[0][0]')}"]`)[0];
  b.click();
  const to=d.querySelector('#toast');
  return (to&&/at least one criterion/i.test(to.textContent))||`melding: ${to&&to.textContent}`;
});
t('Daarna staat die ene er nog steeds',()=>
  E('rankChosen().length')===1||`${E('rankChosen().length')} over`);

g('Het recht zit in de rechtenmatrix');
t('ranking.manage is een echt recht',()=>
  E("PERM_KEYS.includes('ranking.manage')")||'het recht bestaat niet');
t('Het staat onder Administration',()=>{
  const grp=E("PERM_GROUPS.find(g=>g[1].some(p=>p[0]==='ranking.manage'))[0]");
  return grp==='Administration'||`staat onder ${grp}`;
});
t('Er valt niets kleiners dan het bedrijf te kiezen',()=>{
  const c=E("scopeChoices('ranking.manage')");
  return c.join(',')==='none,business'||`bereiken: ${c.join(', ')}`;
});
t('De eigenaar heeft het, de medewerker niet',()=>{
  const o=E("roles.find(r=>r.id==='r_owner').perms['ranking.manage']");
  const e=E("roles.find(r=>r.id==='r_employee').perms['ranking.manage']");
  return (o!=='none'&&e==='none')||`eigenaar ${o}, medewerker ${e}`;
});
E("session.userId='e1';state.settingsTab='general';RANK_CRITERIA.forEach(c=>state.checks[c[0]]=c[3]);render()");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
