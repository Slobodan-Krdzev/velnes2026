/* Instellingen: de sectielijst links en het formulier rechts schuiven los
   van elkaar. jsdom rekent geen layout uit, dus toetsen we de opmaak zelf
   plus of de twee vlakken er in de pagina daadwerkelijk staan. */
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
const open=(tab='sales')=>E(`closePanel(true);session.userId='e1';state.route='settings';state.settingsTab='${tab}';render()`);
/* De regel uit de opmaak halen die op deze selector slaat. */
const ruleFor=sel=>{
  const re=/(?:^|\n)([^\n{}]*)\{([^}]*)\}/g;
  const out=[];let m;
  while((m=re.exec(css)))if(m[1].includes(sel))out.push({sel:m[1].trim(),body:m[2]});
  return out;
};

setTimeout(()=>{
g('Twee vlakken, elk met een eigen schuif');
t('Het formulier zit in een vlak met een naam',()=>{
  open();
  return !!d.querySelector('#view .settings-layout > .settings-pane')||'geen .settings-pane in de opmaak';
});
t('De sectielijst staat ernaast',()=>{
  const kids=[...d.querySelector('#view .settings-layout').children].map(x=>x.className.split(' ')[0]);
  return kids.join(',')==='snav,settings-pane'||`kinderen: ${kids.join(', ')}`;
});
t('Allebei schuiven ze zelf',()=>{
  const r=ruleFor('.settings-pane').filter(x=>/overflow-y:auto/.test(x.body));
  if(!r.length)return 'geen schuifregel gevonden';
  return /\.snav/.test(r[0].sel)||`alleen ${r[0].sel} schuift`;
});
t('Allebei blijven ze staan waar ze staan',()=>{
  const r=ruleFor('.settings-pane').find(x=>/position:sticky/.test(x.body));
  return !!r||'geen van beide is plakkend';
});
t('En ze beginnen op dezelfde hoogte',()=>{
  const r=ruleFor('.settings-pane').find(x=>/position:sticky/.test(x.body));
  return /top:var\(--snav-top\)/.test(r.body)||`top leest ${r.body}`;
});
t('Die hoogte staat één keer, op de ouder',()=>{
  const n=(css.match(/--snav-top:/g)||[]).length;
  return n===1||`${n} keer gedefinieerd`;
});
t('De hoogte is wat er onder de balk overblijft',()=>{
  const r=ruleFor('.settings-pane').find(x=>/max-height/.test(x.body));
  return /max-height:calc\(100vh - var\(--snav-top\) - 24px\)/.test(r.body)||`hoogte leest ${r.body}`;
});
t('Een schuivend vlak stopt aan zijn eigen rand',()=>{
  const r=ruleFor('.settings-pane').find(x=>/overflow-y:auto/.test(x.body));
  return /overscroll-behavior:contain/.test(r.body)||'de schuif slaat door naar de pagina';
});
t('Op iOS rekent hij met de zichtbare hoogte',()=>
  /\.snav,\.settings-pane\{max-height:calc\(100dvh/.test(css)||'geen dvh-variant');
t('En die variant geldt alleen boven het breekpunt',()=>{
  /* Hij stond zonder breedtevoorwaarde en zette de hoogtegrens onder het
     breekpunt dus weer terug, waar de pagina juist als geheel schuift. */
  const i=css.indexOf('.snav,.settings-pane{max-height:calc(100dvh');
  const before=css.slice(0,i);
  const lastMedia=before.lastIndexOf('@media(');
  const lastClose=before.lastIndexOf('\n}');
  return (lastMedia>lastClose&&/@media\(min-width:1201px\)/.test(before.slice(lastMedia)))
    ||'de dvh-variant hangt niet onder een breedtevoorwaarde';
});

g('Onder elkaar schuift de pagina weer als geheel');
t('Op een smal scherm staat er één kolom',()=>{
  const m=/@media\(max-width:1200px\)\{([\s\S]*?)\n\}/g;
  const blocks=[...css.matchAll(m)].map(x=>x[1]);
  return blocks.some(b=>/\.settings-layout\{grid-template-columns:1fr\}/.test(b))
    ||'de kolommen blijven naast elkaar';
});
t('En schuift geen van beide vlakken nog zelf',()=>{
  const blocks=[...css.matchAll(/@media\(max-width:1200px\)\{([\s\S]*?)\n\}/g)].map(x=>x[1]);
  return blocks.some(b=>/\.snav,\.settings-pane\{position:static;max-height:none;overflow:visible\}/.test(b))
    ||'de vlakken blijven eigen vensters';
});

g('De secties werken nog gewoon');
t('Elke sectie is nog te openen',()=>{
  const tabs=qa('#view .snav button').map(b=>b.dataset.stab);
  const bad=tabs.filter(tab=>{open(tab);return E('state.settingsTab')!==tab});
  return bad.length===0||`niet te openen: ${bad.join(', ')}`;
});
t('En tekent zijn eigen inhoud in het rechtervlak',()=>{
  const bad=qa('#view .snav button').map(b=>b.dataset.stab).filter(tab=>{
    open(tab);
    const pane=d.querySelector('#view .settings-pane');
    return !pane||!pane.innerHTML.trim();
  });
  return bad.length===0||`leeg gebleven: ${bad.join(', ')}`;
});
t('De actieve knop staat in de lijst gemarkeerd',()=>{
  open('ranking');
  const on=qa('#view .snav button.active').map(b=>b.dataset.stab);
  return on.join(',')==='ranking'||`actief: ${on.join(', ')}`;
});
t('Klikken in de lijst wisselt het rechtervlak',()=>{
  open('general');
  qa('#view .snav button').find(b=>b.dataset.stab==='sales').click();
  if(E('state.settingsTab')!=='sales')return 'de sectie wisselde niet';
  return /Invoice prefix/.test(d.querySelector('#view .settings-pane').textContent)
    ||'het rechtervlak volgde niet';
});
t('Het bijhouden van wijzigingen loopt nog door het vlak heen',()=>{
  open('sales');
  E('state.settingsDirty=false');
  const tog=d.querySelector('#view .settings-pane .toggle');
  if(!tog)return 'geen schakelaar om te toetsen';
  tog.click();
  return E('state.settingsDirty')===true||'de balk merkte de wijziging niet';
});

g('De sectielijst blijft staan waar hij stond');
t('Een sectie kiezen laat de lijst niet terugspringen',()=>{
  open('general');
  E('state.settingsDirty=false;closeModal();render()');
  const nav=d.querySelector('#view .snav');
  /* jsdom meet geen hoogte, dus schuiven kan alleen als we de maat zelf
     opgeven. Daarna is scrollTop wél een gewone eigenschap. */
  Object.defineProperty(nav,'scrollHeight',{value:900,configurable:true});
  Object.defineProperty(nav,'clientHeight',{value:300,configurable:true});
  nav.scrollTop=240;
  if(nav.scrollTop!==240)return 'de proefopstelling schuift niet';
  qa('#view .snav button').find(b=>b.dataset.stab==='sales').click();
  const after=d.querySelector('#view .snav');
  return after.scrollTop===240||`de lijst sprong naar ${after.scrollTop}`;
});
t('En de sectie is wel gewisseld',()=>
  E('state.settingsTab')==='sales'||`staat op ${E('state.settingsTab')}`);
t('Het onthouden zit in render, niet in de knop',()=>{
  /* Ook een tekenbeurt die van elders komt hoort de lijst te laten staan. */
  const nav=d.querySelector('#view .snav');
  Object.defineProperty(nav,'scrollHeight',{value:900,configurable:true});
  Object.defineProperty(nav,'clientHeight',{value:300,configurable:true});
  nav.scrollTop=180;
  E('render()');
  return d.querySelector('#view .snav').scrollTop===180||'een gewone tekenbeurt zet hem terug';
});
t('Buiten de instellingen gaat er niets mis',()=>{
  E("state.route='calendar';render()");
  return !d.querySelector('#view .snav')||'er staat een sectielijst in de agenda';
});

g('Eén Add-knop per instellingenscherm');
[['locations','location'],['team','inviteUser'],['roles','roleNew']].forEach(([tab,panel])=>{
  t(`${tab}: geen tweede knop in de kaart`,()=>{
    open(tab);
    const inCard=qa(`#view .settings-pane [data-panel="${panel}"]`).length;
    return inCard===0||`${inCard} knoppen in de kaart`;
  });
  t(`${tab}: de knop in de balk staat er nog`,()=>{
    open(tab);
    const inBar=qa(`#view .toolbar [data-panel="${panel}"], #view .toolbar [data-addmenu]`).length;
    return inBar>0||'de knop in de balk is ook weg';
  });
});
t('Op die drie staat de knop nu precies één keer',()=>{
  const bad=['locations','team','roles'].filter(tab=>{
    open(tab);
    E('state.settingsDirty=false');
    return qa('#view .btn-primary').length!==1;
  });
  return bad.length===0||`niet precies één op: ${bad.join(', ')}`;
});
t('De kaartkop staat er nog, zonder knop erin',()=>{
  open('roles');
  const head=d.querySelector('#view .settings-pane .card-header');
  return (head&&/Roles/.test(head.textContent)&&!head.querySelector('.btn'))
    ||'de kop is leeg of draagt nog een knop';
});

g('De rechtenmatrix duwt het scherm niet open');
t('De rechterkolom mag krimpen',()=>{
  /* Een rastercel is van zichzelf min-width:auto en groeit mee met de
     breedste tabel erin. Dan schuift de pagina in plaats van de tabel. */
  const m=/\.settings-layout\{([^}]*)\}/.exec(css);
  return (m&&/minmax\(0,1fr\)/.test(m[1]))||`.settings-layout leest ${m&&m[1]}`;
});
t('En het vlak eromheen ook',()=>
  /\.settings-pane\{min-width:0\}/.test(css)||'de pane kan nog openduwen');
t('De tabel schuift zelf',()=>{
  open('roles');
  const wrap=d.querySelector('#view .matrix-wrap');
  if(!wrap)return 'geen schuifvlak om de matrix';
  const m=/\.matrix-wrap\{([^}]*)\}/.exec(css)[1];
  return (/overflow-x:auto/.test(m)&&/max-width:100%/.test(m))||`.matrix-wrap leest ${m}`;
});
t('De kaart eromheen blijft binnen het vlak',()=>
  /\.settings-pane \.card\{max-width:100%\}/.test(css)||'de kaart kan breder worden dan zijn vlak');
t('De groepen boven de matrix schuiven mee',()=>{
  open('roles');
  const tabsEl=d.querySelector('#view .matrix-tabs');
  if(!tabsEl)return 'de groepen staan niet in een schuifstrook';
  return /\.matrix-tabs\{[^}]*overflow-x:auto/.test(css)||'de strook schuift niet';
});

g('Van groep wisselen springt niet naar boven');
t('Het formuliervlak blijft staan waar het stond',()=>{
  open('roles');
  E('state.settingsDirty=false;closeModal();render()');
  const pane=d.querySelector('#view .settings-pane');
  Object.defineProperty(pane,'scrollHeight',{value:1600,configurable:true});
  Object.defineProperty(pane,'clientHeight',{value:400,configurable:true});
  pane.scrollTop=520;
  if(pane.scrollTop!==520)return 'de proefopstelling schuift niet';
  const tab=qa('#view .matrix-tabs [data-matrixgroup]')
    .find(b=>b.dataset.matrixgroup!==E('state.matrixGroup'));
  if(!tab)return 'geen tweede groep om heen te gaan';
  tab.click();
  return d.querySelector('#view .settings-pane').scrollTop===520
    ||`het vlak sprong naar ${d.querySelector('#view .settings-pane').scrollTop}`;
});
t('En de groep is wel gewisseld',()=>
  E('state.matrixGroup')!=='Appointments'||`staat nog op ${E('state.matrixGroup')}`);
t('Naar een ándere sectie begint wél bovenaan',()=>{
  const pane=d.querySelector('#view .settings-pane');
  Object.defineProperty(pane,'scrollHeight',{value:1600,configurable:true});
  Object.defineProperty(pane,'clientHeight',{value:400,configurable:true});
  pane.scrollTop=400;
  E('state.settingsDirty=false');
  qa('#view .snav button').find(b=>b.dataset.stab==='company').click();
  return d.querySelector('#view .settings-pane').scrollTop===0
    ||'een nieuw scherm opent halverwege';
});

g('Onder elkaar is de sectielijst een strook');
t('Hij staat dan naast elkaar in plaats van onder elkaar',()=>{
  const blocks=[...css.matchAll(/@media\(max-width:1200px\)\{([\s\S]*?)\n\}/g)].map(x=>x[1]);
  return blocks.some(b=>/\.snav\{flex-direction:row/.test(b))||'de lijst blijft een kolom';
});
t('En schuift zijwaarts in plaats van door te lopen',()=>{
  const blocks=[...css.matchAll(/@media\(max-width:1200px\)\{([\s\S]*?)\n\}/g)].map(x=>x[1]);
  return blocks.some(b=>/\.snav\{[^}]*overflow-x:auto/.test(b))||'de strook schuift niet';
});
t('De knoppen krimpen niet en breken niet af',()=>{
  const blocks=[...css.matchAll(/@media\(max-width:1200px\)\{([\s\S]*?)\n\}/g)].map(x=>x[1]);
  return blocks.some(b=>/\.snav button\{flex:none;white-space:nowrap/.test(b))||'de knoppen kunnen breken';
});
t('Het kopje wordt een scheiding ernaast',()=>{
  const blocks=[...css.matchAll(/@media\(max-width:1200px\)\{([\s\S]*?)\n\}/g)].map(x=>x[1]);
  return blocks.some(b=>/\.settings-layout \.snav \.snav-label\{/.test(b))||'het kopje blijft een regel erboven';
});
t('En die regel wint van de gewone opmaak verderop',()=>{
  /* Gelijke soortelijkheid zou verliezen op volgorde: de basisregel staat
     later in het bestand. Vandaar de extra klasse ervoor. */
  const strip=css.indexOf('.settings-layout .snav .snav-label{');
  const base=css.indexOf('.snav .snav-label{padding:14px');
  if(strip<0||base<0)return 'een van de twee regels ontbreekt';
  /* Drie klassen tegen twee: die wint, waar hij ook staat. */
  return true;
});
t('Boven het breekpunt blijft het gewoon een kolom',()=>{
  const m=/\n\.snav\{display:flex;flex-direction:column/.test(css);
  return m||'de kolomstand is weg';
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
