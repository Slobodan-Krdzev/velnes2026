/* Het bronscherm: twee vlakken, één balk, en een merkteken dat de
   voortgang toont. */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/#onboarding'});
const w=dom.window,d=w.document,E=s=>w.eval(s);
let pass=0,fail=0;
const t=(n,fn)=>{try{const r=fn();if(r===true||r===undefined){pass++;console.log('  pass  '+n)}
  else{fail++;console.log('  FAIL  '+n+' → '+r)}}catch(e){fail++;console.log('  FAIL  '+n+' → '+e.message)}};
const g=n=>console.log('\n'+n);
const q=s=>d.querySelector(s), qa=s=>[...d.querySelectorAll(s)];
const src=()=>E("state.ob.stage='source';state.ob.paused=false;render()");

const OB_ALL=E('OB_ORDER');
setTimeout(()=>{
E("obClearFlow();state.ob=null;ob();obSeed('salonbella.mk')");
src();
g('Het kader en het veld eromheen');
/* Het veld hangt aan het venster en niet aan #view, main of de shell.
   Zolang het daarin meedraait bepaalt die keten waar het midden ligt, en
   dan staat het kader scheef zodra één schakel anders uitpakt. */
t('Het veld hangt aan het venster, niet aan de pagina eronder',()=>{
  const wrap=q('.obw');
  if(!wrap)return 'geen veld';
  const c=w.getComputedStyle(wrap);
  if(c.position!=='fixed')return `veld staat op position:${c.position}`;
  const sides=[c.top,c.right,c.bottom,c.left];
  return sides.every(v=>v==='0px')||`randen staan op ${sides.join(' ')}`;
});
t('Geen voorouder breekt die verankering',()=>{
  /* transform, filter en verwanten maken een eigen containing block; dan
     hangt position:fixed daaraan in plaats van aan het venster. */
  const risky=['transform','filter','backdrop-filter','perspective','will-change','contain'];
  const bad=[];
  for(let el=q('.obw').parentElement;el;el=el.parentElement){
    const c=w.getComputedStyle(el);
    risky.forEach(k=>{const v=c[k]||c.getPropertyValue(k);
      if(v&&v!=='none'&&v!=='auto'&&v!=='')bad.push(`${el.tagName.toLowerCase()}${el.id?'#'+el.id:''}: ${k}=${v}`)});
  }
  return bad.length===0||bad.slice(0,2).join(' | ');
});
t('Het kader staat in het midden en blijft bereikbaar',()=>{
  const card=q('.obs');
  if(!card||card.parentElement!==q('.obw'))return 'het kader ligt niet in het veld';
  const c=w.getComputedStyle(card);
  /* margin:auto en niet align-items:center — anders loopt een te groot
     kader er aan de bovenkant uit zonder dat je erheen kunt scrollen. */
  if(c.margin!=='auto')return `kader heeft margin ${c.margin}`;
  if(/\.obw\{[^}]*(place-items:center|align-items:center)/.test(css))
    return 'het veld centreert ook zelf nog; dan snijdt de bovenkant af';
  return /\.obw\{[^}]*overflow:auto/.test(css)||'een te groot kader kan niet schuiven';
});
t('Het kader kan nooit groter worden dan het veld',()=>{
  const r=/\.obs\{[\s\S]{0,120}?width:min\((\d+)px,100%\);height:min\((\d+)px,100%\)/.exec(css);
  if(!r)return 'de maten rekenen niet tegen het veld';
  return (+r[1]<=1280&&+r[2]<=900)||`kader ${r[1]}x${r[2]}`;
});
t('Het veld draagt ons teken, eindeloos herhaald',()=>{
  const bg=q('.obw').getAttribute('style')||'';
  if(!/background-image:url\('data:image\/svg\+xml/.test(bg))return 'geen patroon';
  const url=decodeURIComponent(bg.replace(/.*utf8,/,'').replace(/'\)$/,''));
  if((url.match(/<path/g)||[]).length<2)return 'maar één teken per tegel';
  return /background-repeat:repeat/.test(css)||'het patroon herhaalt niet';
});
t('Het patroon is heel licht',()=>{
  const bg=q('.obw').getAttribute('style')||'';
  const url=decodeURIComponent(bg.replace(/.*utf8,/,'').replace(/'\)$/,''));
  const op=+/fill-opacity="([\d.]+)"/.exec(url)[1];
  return op<=0.2||`dekking staat op ${op}`;
});
t('Patroon en logo tekenen dezelfde vorm',()=>
  E('LOGO_MARK(20).indexOf(MARK_PATH)>0')||'het logo gebruikt een ander pad dan het patroon');

g('De twee vlakken');
t('Links de vraag, rechts het bewegende vlak',()=>
  (!!q('.obs-left')&&!!q('.obs-right'))||'het splitscherm staat er niet');
t('Het logo staat linksboven, teken plus naam',()=>{
  const l=q('.obs-logo');
  if(!l)return 'geen logo linksboven';
  return l.querySelectorAll('svg').length===2||`${l.querySelectorAll('svg').length} svg in plaats van 2`;
});
t('Uit de rechterbovenhoek is een hap genomen',()=>{
  const m=/\.obs-right\{[\s\S]{0,400}?mask-image:radial-gradient\(circle (\d+)px at calc\(100% - (\d+)px\) (\d+)px,\s*transparent/.exec(css);
  if(!m)return 'het beeldvlak is niet uitgehapt';
  return (+m[2]===+m[3])||`de hap staat op ${m[2]} van rechts en ${m[3]} van boven`;
});
t('Het merkteken ligt in die hap, niet erop',()=>{
  const r=q('.obs-ring');
  if(!r)return 'geen merkteken';
  /* Een masker geldt ook voor de inhoud: in het beeldvlak zou het teken
     mee weggesneden worden. Het hoort dus naast het beeldvlak te staan. */
  if(q('.obs-right .obs-ring'))return 'het teken staat in het uitgehapte vlak';
  if(!r.parentElement.classList.contains('obs'))return `het teken hangt aan .${r.parentElement.className}`;
  const c=w.getComputedStyle(r);
  return (c.position==='absolute'&&c.top==='30px'&&c.right==='30px')
    ||`teken op ${c.top} / ${c.right}`;
});
t('Het middelpunt van teken en hap valt samen',()=>{
  const m=/mask-image:radial-gradient\(circle \d+px at calc\(100% - (\d+)px\)/.exec(css);
  const marge=+/\.obs-right\{position:relative;margin:(\d+)px/.exec(css)[1];
  const c=w.getComputedStyle(q('.obs-ring'));
  const mid=parseInt(c.right,10)+parseInt(c.width,10)/2;
  return (marge+ +m[1])===mid||`hap op ${marge + +m[1]}, teken op ${mid}`;
});
t('Er hangt geen glazen plaatje meer onder het teken',()=>{
  const c=w.getComputedStyle(q('.obs-ring'));
  return c.boxShadow==='none'||c.boxShadow===''||`schaduw: ${c.boxShadow}`;
});
t('Er staat geen sluitknop meer in die hoek',()=>
  !q('.obs-right [data-obexit]')||'er staat nog een sluitknop in de hoek');

g('De kop');
t('Er staat een label boven de kop',()=>{
  const b=q('.obs-badge');
  if(!b)return 'geen label';
  if(!/ai onboarding/i.test(b.textContent))return `label leest ${b.textContent.trim()}`;
  if(!b.querySelector('svg'))return 'geen sparkle in het label';
  return w.getComputedStyle(b).textTransform==='uppercase'||'het label staat niet in kapitalen';
});
t('De kop staat op twee regels, de tweede in kleur',()=>{
  const h=q('.obs-mid h1');
  if(!h)return 'geen kop';
  if(h.querySelectorAll('br').length!==1)return 'de kop staat niet op twee regels';
  const em=h.querySelector('em');
  if(!em)return 'de tweede regel is niet apart gezet';
  return /Everything, ready/.test(em.textContent)||`tweede regel: ${em.textContent}`;
});
t('De kop staat in een schreefletter',()=>{
  const f=w.getComputedStyle(q('.obs-mid h1')).fontFamily;
  if(!/Playfair|serif/i.test(f))return `font is ${f}`;
  return /family=Playfair\+Display/.test(html)||'de letter wordt niet geladen';
});
t('De belofte noemt alle drie de oppervlakken',()=>{
  const txt=q('.obs-mid .lead').textContent;
  const missing=['Marketplace','Widget','Dashboard'].filter(x=>!txt.includes(x));
  return missing.length===0||`mist: ${missing.join(', ')}`;
});
t('De oude salonkop staat er niet meer',()=>
  !/salon page/i.test(q('.obs-mid').textContent)||'"salon page" staat er nog');

g('Eén balk voor alles');
t('Link, bijlage en verzenden zitten in dezelfde balk',()=>{
  const bar=q('.obq');
  if(!bar)return 'geen balk';
  const has=c=>!!bar.querySelector(c);
  return (has('.obq-clip[data-obfiles]')&&has('.obq-in[data-obfield="url"]')&&has('.obq-go[data-obgo]'))
    ||'niet alle drie zitten in de balk';
});
t('De upload staat niet meer als losse rij eronder',()=>
  (!/class="ob-add"/.test(html)&&!/class="ob-addbtn"/.test(html))||'de oude uploadrij staat er nog');
t('Het invoerveld staat er maar één keer',()=>{
  const n=qa('[data-obfield="url"]').length;
  return n===1||`${n} url-velden`;
});
t('De twee knoppen in de balk zijn even groot',()=>{
  const a=w.getComputedStyle(q('.obq-clip')), b=w.getComputedStyle(q('.obq-go'));
  if(a.width!==b.width||a.height!==b.height)
    return `+ is ${a.width}x${a.height}, verzenden is ${b.width}x${b.height}`;
  return a.borderRadius===b.borderRadius||`ronding ${a.borderRadius} tegen ${b.borderRadius}`;
});
t('De verzendknop draagt een sparkle, geen pijl',()=>{
  const go=q('.obq-go');
  if(!go)return 'geen verzendknop';
  const paths=go.querySelectorAll('path');
  if(paths.length<2)return `${paths.length} vormen — een sparkle heeft er twee`;
  /* Een pijl is een open lijn, een ster een gesloten vorm. */
  return /z\s*$/i.test(paths[0].getAttribute('d')||'')||'de eerste vorm is niet gesloten';
});
t('De balk werpt geen schaduw',()=>{
  const sh=w.getComputedStyle(q('.obq')).boxShadow;
  return (!sh||sh==='none')||`schaduw: ${sh}`;
});

t('De uitwijkroutes staan klein onder de balk',()=>{
  const a=q('.obs-alt');
  if(!a)return 'geen alternatiefregel';
  return (!!a.querySelector('[data-obtell]')&&!!a.querySelector('[data-obnosite]'))
    ||'typen of zelf invullen ontbreekt';
});
t('Een bijlage komt als plaatje in beeld, niet als formulier',()=>{
  E("state.ob.files.push({id:'zz',name:'prijzen.csv',kind:'table',line:'12 rows read',warn:false,thumb:null,services:[]});render()");
  const c=q('.obs-chip');
  const ok=!!c&&/prijzen\.csv/.test(c.textContent)&&!!c.querySelector('[data-obdropfile="zz"]');
  E("state.ob.files=[];render()");
  return ok||'de bijlage staat er niet als plaatje';
});

g('Het merkteken toont de voortgang');
t('Op het bronscherm staat de ring leeg',()=>{
  src();
  const arc=q('.obs-ring .arc');
  return (+arc.getAttribute('stroke-dashoffset')===+arc.getAttribute('stroke-dasharray'))
    ||'de ring staat niet op nul';
});
t('Onderweg loopt hij mee met het scherm waar je bent',()=>{
  E("state.ob.stage='dashboard';render()");
  const arc=q('.obs-ring .arc');
  const c=+arc.getAttribute('stroke-dasharray'), off=+arc.getAttribute('stroke-dashoffset');
  const want=c*(1-E('obPct(state.ob)')/100);
  return Math.abs(off-want)<1||`offset ${off}, verwacht ${want.toFixed(1)}`;
});
t('Aan het eind is de ring vol',()=>{
  E("state.ob.stage='welcome';render()");
  return +q('.obs-ring .arc').getAttribute('stroke-dashoffset')===0||'de ring is niet vol';
});
t('Elke stap draagt hetzelfde teken',()=>{
  const missing=OB_ALL.filter(st=>{
    E(`state.ob.stage='${st}';state.ob.paused=false;render()`);
    return !q('.obs-ring');
  });
  return missing.length===0||`geen teken bij: ${missing.join(', ')}`;
});
/* De run loopt van 0 naar 100 binnen zijn eigen stap; daarna neemt de
   vaste reeks het over. Hier meten we de reeks, dus staat de run op
   een tussenstand. */
t('De voortgang loopt alleen omhoog',()=>{
  const seq=OB_ALL.map(st=>{
    E(`state.ob.stage='${st}';render()`);
    return E('obPct(state.ob)');
  });
  return seq.every((v,i)=>i===0||v>=seq[i-1])||`verloop: ${seq.join(' → ')}`;
});

g('Het bewegende vlak');
src();
t('Er staan mensen achter het vlak, geen kleurvlek',()=>{
  const ph=qa('.obs-right .obs-photo');
  if(ph.length<3)return `${ph.length} foto's`;
  const bad=ph.filter(p=>!/background-image:url\('data:image\/(webp|jpeg|png);base64,/.test(p.getAttribute('style')||''));
  if(bad.length)return `${bad.length} lagen zonder beeld`;
  /* In het bestand zelf, niet als los plaatje ernaast. */
  return /const OB_FACES=\[/.test(html)||'de foto\'s staan niet in dit bestand';
});
t('De foto\'s vloeien in elkaar over in plaats van te springen',()=>{
  if(!/@keyframes obFace/.test(css))return 'geen overvloeier';
  const d=qa('.obs-right .obs-photo').map(p=>w.getComputedStyle(p).animationDelay);
  return new Set(d).size===3||`vertragingen: ${d.join(', ')}`;
});
t('Een sluier houdt de kaartjes leesbaar boven de foto',()=>{
  if(!q('.obs-veil'))return 'geen sluier';
  const html2=q('.obs-right').innerHTML;
  return html2.indexOf('obs-cards')>html2.indexOf('obs-veil')||'de kaartjes liggen onder de sluier';
});
t('De kaartjes zweven over de foto',()=>{
  const html2=q('.obs-right').innerHTML;
  if(qa('.obs-cards .obs-card').length<3)return 'geen kaartjes';
  return html2.indexOf('obs-cards')>html2.indexOf('obs-photos')||'de kaartjes staan achter de foto';
});
t('Wie beweging liever niet ziet krijgt hem niet',()=>{
  const m=/@media\(prefers-reduced-motion:reduce\)\{([\s\S]{0,300}?)\}\s*\n/.exec(css);
  if(!m)return 'er is geen uitzondering voor minder beweging';
  if(!/\.obs-photo/.test(m[1]))return 'de foto blijft dan toch overvloeien';
  return /\.obs-photo\.f1\{opacity:1\}/.test(css)||'zonder beweging blijft het vlak leeg';
});
t('Op een smal scherm valt het sierlijke vlak weg',()=>
  /\.obs-right\{display:none\}/.test(css)||'het rechtervlak blijft ook smal staan');

g('De flow blijft werken');
src();
t('Een link versturen start de bouw',()=>{
  src();
  const inp=q('.obq-in'); inp.value='salonbella.mk';
  inp.dispatchEvent(new w.Event('input',{bubbles:true}));
  q('[data-obgo]').click();
  if(E("state.ob.stage")!=='accepted')return `bleef op ${E("state.ob.stage")}`;
  /* De zaak achter de link is meteen ingelezen. */
  if(E('state.ob.salon')!=='Salon Bella')return `naam werd ${E('state.ob.salon')}`;
  return E('state.ob.services.length')>0||'er zijn geen behandelingen ingelezen';
});
t('Elke stap tekent nog zonder gaten',()=>{
  const bad=OB_ALL.filter(st=>{
    E(`state.ob.stage='${st}';state.ob.paused=false;render()`);
    const h=q('#view').innerHTML;
    return h.length<1500||/undefined|\bNaN\b/.test(h);
  });
  return bad.length===0||`stuk bij: ${bad.join(', ')}`;
});

g('Na de import: drie oppervlakken');
E("state.ob.stage='preview';state.ob.paused=false;state.ob.surface='page';"
 +"state.ob.services=[{name:'Physiotherapy session',cat:'Manual therapy',price:1800,dur:45,conf:.96},"
 +"{name:'Rehab training',cat:'Rehab',price:1500,dur:60,conf:.94}];"
 +"state.ob.staff=[{name:'Marija',role:'Physiotherapist',conf:.72}];"
 +"state.ob.photos=[{t:'Treatment room'}];state.ob.host='fizio.mk';render()");

t('Er staan drie knoppen',()=>{
  const b=qa('.ob-surf').map(x=>x.dataset.obsurface);
  return b.join(',')==='page,widget,workspace'||`knoppen: ${b.join(', ')}`;
});
t('Elke knop beeldt uit wat erachter zit',()=>{
  const bad=qa('.ob-surf').filter(b=>!b.querySelector('.thumb svg')||!b.querySelector('.t').textContent.trim());
  if(bad.length)return `${bad.length} knoppen zonder miniatuur of naam`;
  /* Drie verschillende plattegrondjes, geen drie keer hetzelfde. */
  const shapes=new Set(qa('.ob-surf .thumb').map(x=>x.innerHTML));
  return shapes.size===3||`${shapes.size} verschillende miniaturen`;
});
t('Precies één knop is actief',()=>{
  const on=qa('.ob-surf.on');
  return on.length===1||`${on.length} actief`;
});
t('De marktplaats staat voorop',()=>
  qa('.ob-surf.on')[0].dataset.obsurface==='page'||'iets anders staat voorop');

const pick=k=>{q(`[data-obsurface="${k}"]`).click();return q('#view').textContent};
t('De widget toont de gevonden behandelingen op een eigen site',()=>{
  const txt=pick('widget');
  if(!q('.ob-browser'))return 'geen browserkader';
  if(!/fizio\.mk/.test(txt))return 'het eigen adres staat er niet';
  return /Physiotherapy session/.test(txt)||'de behandelingen staan er niet in';
});
t('De widget zegt dat hij nu al mag',()=>
  /needs no approval/.test(q('#view').textContent)||'dat staat er niet bij');
t('De werkomgeving is een telling, geen lege kassa',()=>{
  const txt=pick('workspace');
  if(!q('.ob-counts'))return 'geen telling';
  const n=qa('.ob-count').length;
  return n===4||`${n} tellers`;
});
t('De checklist blijft naast alle drie staan',()=>{
  const missing=['page','widget','workspace'].filter(k=>{pick(k);return !q('.ob-side')});
  return missing.length===0||`checklist weg bij: ${missing.join(', ')}`;
});
t('De keuze blijft staan tussen twee tekeningen door',()=>{
  pick('widget'); E('render()');
  return E("state.ob.surface")==='widget'||`viel terug op ${E("state.ob.surface")}`;
});
E("state.ob.surface='page';state.ob.stage='source';render()");

g('De tien schermen, één kader');
E("obSeed('salonbella.mk')");
const at=st=>{E(`obClearFlow();state.ob.stage='${st}';`
  +`state.ob.found=${JSON.stringify(['details','treatments','prices','photos','hours'])};`
  +`state.ob.surface=${JSON.stringify({widget:'widget',dashboard:'dashboard'})}['${st}']||'page';render()`)};

t('Elk scherm speelt zich af binnen hetzelfde kader',()=>{
  const bad=OB_ALL.filter(st=>{at(st);return !q('.obw')||!q('.obs')||!q('.obs-left')});
  return bad.length===0||`buiten het kader bij: ${bad.join(', ')}`;
});
t('Het kader houdt overal dezelfde maat',()=>{
  const sizes=new Set(OB_ALL.map(st=>{at(st);const c=w.getComputedStyle(q('.obs'));return c.width+'x'+c.height}));
  return sizes.size===1||`${sizes.size} verschillende maten`;
});
t('De eerste twee schermen tonen het sfeerbeeld, daarna het echte werk',()=>{
  at('accepted');
  if(!q('.obs-right .obs-photo'))return 'geen sfeerbeeld op scherm 2';
  at('marketplace');
  return (!!q('.ob-canvas')&&!q('.obs-photo'))||'scherm 4 toont nog het sfeerbeeld';
});
t('De marktplaats bouwt zich op in plaats van ineens te staan',()=>{
  E("obClearFlow();state.ob.stage='reading';state.ob.found=['details'];render()");
  const early=!!q('.ob-skel');
  E("state.ob.found=['details','treatments','prices','photos','hours'];render()");
  return (early&&!q('.ob-skel')&&!!q('.ob-mk-grid'))||'de behandelingen staan er meteen';
});
t('De drie tabbladen verschijnen pas bij de widget',()=>{
  at('marketplace');
  if(q('.ob-tab'))return 'de tabbladen staan er al bij de marktplaats';
  at('widget');
  return qa('.ob-tab').length===3||`${qa('.ob-tab').length} tabbladen`;
});
t('Pas als alles klaar is mag je vrij wisselen',()=>{
  at('widget');
  if(qa('.ob-tab:not([disabled])').length)return 'je kunt al wisselen tijdens de bouw';
  at('ready');
  return qa('.ob-tab:not([disabled])').length===3||'niet alle drie zijn vrij';
});
t('De drie previews tonen elk iets anders',()=>{
  at('ready');
  E("state.ob.surface='page';render()"); const a=!!q('.ob-mk-grid');
  E("state.ob.surface='widget';render()"); const b=!!q('.ob-wsite');
  E("state.ob.surface='dashboard';render()"); const c=!!q('.ob-db');
  return (a&&b&&c)||`marktplaats ${a}, widget ${b}, werkomgeving ${c}`;
});
t('De widget staat op de eigen site, niet los',()=>{
  at('widget');
  if(!q('.ob-browser'))return 'geen browserkader';
  return /salonbella\.mk/.test(q('.ob-browser').textContent)||'het eigen adres staat er niet';
});
t('De werkomgeving verzint geen omzet of klanten',()=>{
  at('dashboard');
  const v=qa('.ob-db-stat .v').map(x=>x.textContent.trim());
  if(v[0]!=='0')return `afspraken staat op ${v[0]}`;
  if(v[1]!=='—'||v[2]!=='—')return `omzet ${v[1]}, klanten ${v[2]}`;
  return v[3]===String(E('state.ob.services.length'))||`behandelingen ${v[3]}`;
});
t('Er wordt pas om een e-mailadres gevraagd als alles klaar is',()=>{
  const early=OB_ALL.slice(0,6).filter(st=>{at(st);return !!q('[data-obfield="email"]')});
  if(early.length)return `te vroeg gevraagd bij: ${early.join(', ')}`;
  at('claim');
  return !!q('[data-obfield="email"]')||'op het opeisscherm staat geen e-mailveld';
});
t('Het heet opeisen, geen account aanmaken',()=>{
  at('claim');
  const txt=q('.obs-mid').textContent;
  const bad=['Create account','Sign up','Register'].filter(x=>txt.includes(x));
  if(bad.length)return `staat er nog: ${bad.join(', ')}`;
  return /Claim my Velnes/.test(txt)||'de knop heet niet "Claim my Velnes"';
});
t('De code heeft zes losse vakjes',()=>{
  at('verify');
  return qa('.ob-otp-in').length===6||`${qa('.ob-otp-in').length} vakjes`;
});
t('Het resultaat blijft in beeld terwijl er om de code gevraagd wordt',()=>{
  at('verify');
  return !!q('.ob-canvas')||'de beloning verdwijnt tijdens het verifiëren';
});
t('Er wordt nergens meer om een wachtwoord gevraagd',()=>{
  const bad=OB_ALL.filter(st=>{at(st);return !!q('[data-obfield="pwd"]')});
  return bad.length===0||`wachtwoord gevraagd bij: ${bad.join(', ')}`;
});
g('De drie manieren om te beginnen');
const fresh=()=>E("obClearFlow();state.ob=null;ob();render()");
t('Een link leest de zaak in',()=>{
  fresh();
  const inp=q('.obq-in'); inp.value='salonbella.mk';
  inp.dispatchEvent(new w.Event('input',{bubbles:true}));
  q('[data-obgo]').click();
  if(E('state.ob.stage')!=='accepted')return `bleef op ${E('state.ob.stage')}`;
  return E('state.ob.services.length')>0||'er is niets ingelezen';
});
t('Uitgetypt komt in dezelfde flow terecht',()=>{
  fresh();
  q('[data-obtell]').click();
  const ta=q('[data-obfield="told"]');
  ta.value='Hydra facial 1800, 50 min\nRelax massage 1500, 60 min';
  ta.dispatchEvent(new w.Event('input',{bubbles:true}));
  q('[data-obgo]').click();
  if(!OB_ALL.includes(E('state.ob.stage')))return `viel in de oude flow: ${E('state.ob.stage')}`;
  return E('state.ob.services.length')===2||`${E('state.ob.services.length')} behandelingen gelezen`;
});
t('Niets online bouwt de schillen alsnog, maar leeg',()=>{
  fresh();
  q('[data-obnosite]').click();
  if(!OB_ALL.includes(E('state.ob.stage')))return `viel in de oude flow: ${E('state.ob.stage')}`;
  return E('state.ob.services.length')===0||'er is iets verzonnen';
});
t('De vondsten tellen wat er echt is',()=>{
  E("obClearFlow();state.ob.stage='reading';"
   +"state.ob.found=['details','treatments','prices','photos','hours'];render()");
  const rows=qa('.ob-find').map(x=>x.textContent.trim());
  if(!rows.some(x=>/No treatments found/.test(x)))return `regels: ${rows.join(' | ')}`;
  return qa('.ob-find.miss').length>0||'ontbrekende gegevens zien er hetzelfde uit als gevonden';
});
t('De samenvatting belooft niets dat er niet is',()=>{
  E("state.ob.stage='ready';render()");
  const txt=q('.ob-sum').textContent;
  return !/\d+ treatments/.test(txt)||`samenvatting claimt: ${txt.trim()}`;
});
E("obClearFlow();state.ob=null;ob();obSeed('salonbella.mk');state.ob.stage='source';render()");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
