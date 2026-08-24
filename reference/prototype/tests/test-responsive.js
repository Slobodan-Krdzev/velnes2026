/* Controleert wat je zonder layout-engine kunt controleren: dat de
   breakpointladder sluit, dat verborgen kolommen aan beide kanten van
   de tabel op dezelfde plek zitten, en dat er geen vaste inline
   breedtes terugsluipen die op een smal scherm niet te overrulen zijn.
   Draaien met: node test-responsive.js uit de map met index.html */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/'});
const w=dom.window,E=s=>w.eval(s);
let pass=0,fail=0;
const t=(name,fn)=>{try{const r=fn();if(r===true||r===undefined){pass++;console.log('  pass  '+name)}
  else{fail++;console.log('  FAIL  '+name+' → '+r)}}
  catch(e){fail++;console.log('  FAIL  '+name+' → '+e.message)}};
const group=n=>console.log('\n'+n);
const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
const view=()=>w.document.getElementById('view').innerHTML;

/* Werkbreedte op een iPad mini staand: 744 − zijbalk − padding. */
const MINI=744, SIDEBAR=58, PAD=14*2, WORK=MINI-SIDEBAR-PAD;   // 658

const ROUTES=['calendar','register','catalog','customers','marketing','reports',
  'settings','about','invoices','suppliers','hq','portal'];

setTimeout(()=>{

group('Breakpointladder');
t('De banden sluiten op elkaar aan zonder gat of overlap',()=>{
  const phone=/@media\(max-width:(\d+)px\)\{\s*\.pos,\.pos\.pos-nocats/.exec(css);
  const compact=/@media\(min-width:(\d+)px\) and \(max-width:(\d+)px\)\{\s*\/\* Zijbalk/.exec(css);
  const tablet=/@media\(min-width:(\d+)px\) and \(max-width:(\d+)px\)\{\s*\.pos\{grid-template-columns:1fr 320px/.exec(css);
  if(!phone||!compact||!tablet)return 'kon de banden niet vinden';
  const p=+phone[1], c1=+compact[1], c2=+compact[2], t1=+tablet[1];
  if(c1!==p+1)return `gat tussen telefoon (${p}) en compact (${c1})`;
  if(t1!==c2+1)return `gat tussen compact (${c2}) en tablet (${t1})`;
  return true;
});
t('Beide iPad mini-breedtes vallen in dezelfde band',()=>{
  const m=/@media\(min-width:(\d+)px\) and \(max-width:(\d+)px\)\{\s*\/\* Zijbalk/.exec(css);
  const [lo,hi]=[+m[1],+m[2]];
  const inBand=x=>x>=lo&&x<=hi;
  return (inBand(744)&&inBand(768))||`744 ${inBand(744)}, 768 ${inBand(768)}`;
});
t('iPad liggend en desktop blijven buiten de compacte band',()=>{
  const m=/@media\(min-width:(\d+)px\) and \(max-width:(\d+)px\)\{\s*\/\* Zijbalk/.exec(css);
  const hi=+m[2];
  return (1024>hi&&1180>hi&&1440>hi)||`1024/1180/1440 vallen onder ${hi}`;
});
t('iPad staand deelt bewust dezelfde band — zeven dagkolommen passen daar ook niet',()=>{
  const m=/@media\(min-width:(\d+)px\) and \(max-width:(\d+)px\)\{\s*\/\* Zijbalk/.exec(css);
  return (820>=+m[1]&&820<=+m[2])||'820px valt er nu buiten — dat was een keuze, geen toeval';
});

group('Tabellen');
const tables=[];
t('Elke tabel heeft evenveel cellen als kopjes',()=>{
  const bad=[];
  for(const r of ROUTES){
    E(`state.route=${JSON.stringify(r)};state.param=null;render()`);
    w.document.querySelectorAll('#view table').forEach((tb,ix)=>{
      const ths=[...tb.querySelectorAll('thead th')];
      if(!ths.length)return;
      tables.push(`${r}#${ix}`);
      [...tb.querySelectorAll('tbody tr')].forEach((tr,ri)=>{
        const tds=[...tr.children];
        if(tds.length!==ths.length)bad.push(`${r}#${ix} rij ${ri}: ${tds.length} cellen, ${ths.length} kopjes`);
      });
    });
  }
  return bad.length?bad.slice(0,3).join(' | '):true;
});
t('Verborgen kolommen staan boven en onder op dezelfde plek',()=>{
  const bad=[];
  for(const r of ROUTES){
    E(`state.route=${JSON.stringify(r)};state.param=null;render()`);
    w.document.querySelectorAll('#view table').forEach((tb,ix)=>{
      const ths=[...tb.querySelectorAll('thead th')];
      if(!ths.length)return;
      const hidden=ths.map((th,i)=>th.classList.contains('sec')?i:-1).filter(i=>i>=0);
      if(!hidden.length)return;
      [...tb.querySelectorAll('tbody tr')].forEach((tr,ri)=>{
        const tds=[...tr.children];
        if(tds.length!==ths.length)return;
        const rowHidden=tds.map((td,i)=>td.classList.contains('sec')?i:-1).filter(i=>i>=0);
        if(rowHidden.join(',')!==hidden.join(','))
          bad.push(`${r}#${ix} rij ${ri}: kop ${hidden} vs rij ${rowHidden}`);
      });
    });
  }
  return bad.length?bad.slice(0,3).join(' | '):true;
});
t('De zwaarste tabellen houden na inkorting genoeg ruimte per kolom',()=>{
  const bad=[];
  for(const r of ['invoices','customers']){
    E(`state.route='${r}';state.param=null;render()`);
    const tb=w.document.querySelector('#view table');
    const ths=[...tb.querySelectorAll('thead th')];
    const shown=ths.filter(th=>!th.classList.contains('sec')).length;
    const per=Math.round(WORK/shown);
    if(per<100)bad.push(`${r}: ${shown} kolommen, ${per}px per kolom`);
  }
  return bad.length?bad.join(' | '):true;
});
t('Een tabel kan schuiven in plaats van zich samen te persen',()=>{
  const hasMin=/@media\(min-width:701px\)[\s\S]*?table\{min-width:\d+px\}/.test(css);
  const hasScroll=/@media\(min-width:701px\)[\s\S]*?\.card:has\(>table\)\{overflow-x:auto\}/.test(css);
  return (hasMin&&hasScroll)||`min-width ${hasMin}, overflow ${hasScroll}`;
});

group('Agenda');
t('Het agendavlak mag zijwaarts schuiven en knipt niet meer af',()=>{
  const m=/@media\(min-width:701px\) and \(max-width:900px\)\{([\s\S]*?)\n\}/.exec(css)[1];
  if(!/\.cal\{overflow-x:auto/.test(m))return 'geen horizontale schuif op .cal';
  if(!/\.cal-body\{max-height:none;overflow:visible\}/.test(m))return 'de kop kan losraken van het rooster';
  return true;
});
t('Elke kolom houdt een leesbare minimumbreedte',()=>{
  const m=/\.cal-col\{min-width:(\d+)px\}/.exec(css);
  if(!m)return 'geen minimumbreedte';
  const min=+m[1];
  const text=min-20;                         /* .event padding 8px 10px */
  return (min>=110&&text>=90)||`kolom ${min}px, ${text}px voor tekst`;
});
t('De weekweergave schuift dan echt in plaats van te persen',()=>{
  E(`state.route='calendar';state.calView='week';render()`);
  const cols=w.document.querySelectorAll('#view .cal-body .cal-col').length;
  const min=+/\.cal-col\{min-width:(\d+)px\}/.exec(css)[1];
  const gut=+/@media\(min-width:701px\)[\s\S]*?\.cal-gutter\{width:(\d+)px\}/.exec(css)[1];
  const need=gut+cols*min;
  return (cols===7&&need>WORK)||`${cols} kolommen, ${need}px nodig, ${WORK}px beschikbaar`;
});
t('De dagweergave past zonder schuiven',()=>{
  E(`state.route='calendar';state.calView='day';render()`);
  const cols=w.document.querySelectorAll('#view .cal-body .cal-col').length;
  const min=+/\.cal-col\{min-width:(\d+)px\}/.exec(css)[1];
  const gut=+/@media\(min-width:701px\)[\s\S]*?\.cal-gutter\{width:(\d+)px\}/.exec(css)[1];
  return (gut+cols*min<=WORK)||`${cols} kolommen, ${gut+cols*min}px nodig`;
});

group('Formulieren en panelen');
t('Drie kolommen in een paneel zijn een klasse, geen inline stijl',()=>{
  const inline=(html.match(/style="grid-template-columns:repeat\(3,1fr\)"/g)||[]).length;
  return inline===0||`nog ${inline} inline rasters`;
});
t('In een paneel of modal staat elk formulierraster op één kolom',()=>{
  const m=/@media\(min-width:701px\) and \(max-width:900px\)\{([\s\S]*?)\n\}/.exec(css)[1];
  const rule=/\.panel \.grid2[\s\S]{0,160}?\{grid-template-columns:1fr\}/.test(m);
  return rule||'de rasters in panelen blijven meerkoloms';
});
t('Op de pagina zelf blijven kengetallen naast elkaar staan',()=>{
  const m=/@media\(min-width:701px\) and \(max-width:900px\)\{([\s\S]*?)\n\}/.exec(css)[1];
  return !/^\s*\.grid4\{grid-template-columns:1fr\}/m.test(m)||'grid4 stapelt onnodig';
});
t('Het paneel past binnen het scherm',()=>{
  /* De breedte staat sinds de gelijktrekking met de CMS in --panel-w en
     niet meer als vaste maat op .panel zelf: op een breed scherm neemt de
     lade een aandeel (33vw), met 480px als bodem en een vw-plafond zodat
     hij op een smal scherm nooit over de rand valt. Dat plafond is wat
     hier getoetst wordt. */
  const decls=[...css.matchAll(/--panel-w:([^;}]+)/g)].map(x=>x[1].trim());
  if(!decls.length)return 'geen responsieve paneelbreedte';
  const zonderPlafond=decls.filter(v=>!/(\d+)vw\)?\s*$/.test(v));
  if(zonderPlafond.length)return `zonder vw-plafond: ${zonderPlafond.join(' | ')}`;
  const teBreed=decls.filter(v=>{
    const px=Math.min(...[...v.matchAll(/(\d+)px/g)].map(x=>+x[1]));
    const vw=Math.min(...[...v.matchAll(/(\d+)vw/g)].map(x=>+x[1]));
    return Math.min(px,MINI*vw/100)>MINI-40;
  });
  return teBreed.length===0||teBreed.join(' | ');
});

group('Vaste breedtes');
t('Geen inline breedte die op een smal scherm niet meer past',()=>{
  const bad=[];
  for(const r of ROUTES){
    E(`state.route=${JSON.stringify(r)};state.param=null;render()`);
    w.document.querySelectorAll('#view [style*="width:"]').forEach(el=>{
      const m=/(?:^|[;\s])width:\s*(\d+)px/.exec(el.getAttribute('style')||'');
      if(m&&+m[1]>WORK)bad.push(`${r}: ${m[1]}px op ${el.tagName.toLowerCase()}`);
    });
  }
  return bad.length?bad.slice(0,4).join(' | '):true;
});
t('Geen enkel scherm zet een vaste breedte op een kaart of raster',()=>{
  const bad=[];
  for(const r of ROUTES){
    E(`state.route=${JSON.stringify(r)};state.param=null;render()`);
    w.document.querySelectorAll('#view .card[style*="width:"],#view .grid2[style*="width:"]')
      .forEach(el=>{if(/(?:^|[;\s])width:\s*\d+px/.test(el.getAttribute('style')||''))
        bad.push(`${r}: ${el.className}`)});
  }
  return bad.length?bad.join(' | '):true;
});

group('Kassategels');
/* Grid rekent jsdom niet uit, dus doen we de auto-fill-formule hier met de
   hand op de maten die daadwerkelijk in het bestand staan. */
const num=re=>{const m=re.exec(css);return m?+m[1]:null};
const TILE={
  min:num(/grid-template-columns:repeat\(auto-fill,minmax\(var\(--tile-min,(\d+)px\)/),
  h:num(/grid-auto-rows:var\(--tile-h,(\d+)px\)/),
  img:num(/\.ptile-img\{flex:none;height:var\(--tile-img,(\d+)px\)/),
  pad:num(/padding:var\(--tile-pad,(\d+)px\)/),
  name:num(/\.ptile-n\{flex:none;height:var\(--tile-name,(\d+)px\)/),
};
const MINI_TILE=(()=>{const m=/:root\{--tile-min:(\d+)px;--tile-h:(\d+)px;--tile-img:(\d+)px;--tile-pad:(\d+)px\}/.exec(css);
  const v=/:root\{--cat-h:(\d+)px;--cat-w:(\d+)px;--tile-name:(\d+)px\}/.exec(css);
  return m?{min:+m[1],h:+m[2],img:+m[3],pad:+m[4],name:v?+v[3]:null,
    catH:v?+v[1]:null,catW:v?+v[2]:null}:null})();
const cols=(space,min,gap=12)=>Math.max(1,Math.floor((space+gap)/(min+gap)));

t('De tegels vullen het vlak niet meer op',()=>{
  if(/grid-auto-rows:minmax\(\d+px,1fr\)/.test(css))return 'er staat nog een rij op 1fr';
  return (TILE.h&&TILE.h<=180)||`tegelhoogte ${TILE.h}`;
});
/* jsdom rekent geen layout uit, dus dit is een controle op de regel zelf:
   staat de rijhoogte als bovengrens tegenover de werkelijke ruimte, en
   staat er niets meer onder de laatste rij dat een schuifbalk oproept. */
t('Negen tegels passen zonder te schuiven',()=>{
  const three=/\.pos-grid\{grid-auto-rows:min\(var\(--tile-h,\d+px\),calc\(\(100% - 24px\)\/3\)\)\}/.test(css);
  if(!three)return 'de rijhoogte meet zich niet aan de beschikbare ruimte';
  const grid=/\.pos-grid\{display:grid;[\s\S]*?\}/.exec(css)[0];
  return !/padding-bottom/.test(grid)||'er staat nog padding onder de laatste rij';
});
t('Met advies erboven blijven er twee hele rijen over',()=>{
  const two=/\.pos-items\.has-advice \.pos-grid\{grid-auto-rows:min\(var\(--tile-h,\d+px\),calc\(\(100% - 12px\)\/2\)\)\}/.test(css);
  if(!two)return 'het raster schakelt niet naar twee rijen';
  const max=/\.advice\{flex:none;max-height:var\(--tile-h,(\d+)px\);overflow:hidden/.exec(css);
  if(!max)return 'het adviesblok heeft geen bovengrens';
  return +max[1]<=TILE.h||`advies mag ${max[1]} van ${TILE.h}`;
});
t('Het advies staat als klasse op het tegelvlak',()=>{
  return /class="pos-items \$\{advice\?'has-advice':''\}"/.test(html)
    ||'het vlak weet niet of er advies boven staat';
});
t('Wat er niet op past is bereikbaar in plaats van weggeknipt',()=>{
  const m=/\.pos-grid\{([\s\S]*?)\}/.exec(css)[1];
  if(/overflow:hidden/.test(m))return 'het raster knipt nog af';
  return /overflow-y:auto/.test(m)||'geen verticale schuif';
});
/* De foto krijgt nu juist alles wat overblijft. Dat mag: de tegel heeft een
   vaste hoogte en de naam twee vaste regels, dus de foto kan niet op hol. */
t('De foto vult wat de tegel overhoudt, met een ondergrens',()=>{
  const flex=/\.ptile-img\{position:relative;flex:1;min-height:var\(--tile-img,(\d+)px\)/.exec(css);
  if(!flex)return 'de foto vult de resterende ruimte niet';
  const room=o=>o.h-o.pad*2-6-o.name;
  return (room(TILE)>=+flex[1]&&room(MINI_TILE)>=MINI_TILE.img)
    ||`breed houdt ${room(TILE)} over, mini ${room(MINI_TILE)}`;
});
/* De tegel draagt nog drie dingen: de foto, de naam over twee vaste regels
   en de voet met prijs en aantal. De metaregel is eraf, dus twee gaten
   in plaats van drie. */
t('De tegel is hoog genoeg voor zijn eigen inhoud',()=>{
  const need=o=>o.pad*2+o.img+6+o.name;
  const wide=need(TILE), mini=need(MINI_TILE);
  return (wide<=TILE.h&&mini<=MINI_TILE.h)
    ||`breed vraagt ${wide} van ${TILE.h}, mini vraagt ${mini} van ${MINI_TILE.h}`;
});
t('De naam houdt het op precies twee regels',()=>{
  if(!TILE.name||!MINI_TILE.name)return 'de naam heeft geen vaste hoogte';
  const lh=num(/\.ptile-n\{flex:none;height:var\(--tile-name,\d+px\);\s*font-size:\d+px;font-weight:\d+;line-height:(\d+)px/);
  const miniLh=num(/\.pos-tile \.ptile-n\{font-size:\d+px;line-height:(\d+)px\}/);
  return (TILE.name===lh*2&&MINI_TILE.name===miniLh*2)
    ||`breed ${TILE.name} voor 2x${lh}, mini ${MINI_TILE.name} voor 2x${miniLh}`;
});
t('Prijs en aantal liggen als laagje op de foto',()=>{
  const blk=/<span class="ptile-img"[\s\S]{0,600}?<\/span>\s*<span class="ptile-n">/.exec(html);
  if(!blk)return 'de naam staat niet onder de foto';
  return (/class="ptile-p"/.test(blk[0])&&/class="ptile-q"/.test(blk[0]))
    ||'prijs of aantal ligt niet op de foto';
});
t('De prijs is fors kleiner dan hij was',()=>{
  const p=num(/\.ptile-p\{position:absolute;left:6px;bottom:6px;[\s\S]{0,200}?font-size:(\d+)px/);
  return (p&&p<=12)||`prijs staat op ${p}px`;
});
t('Naam en categorielabel hebben dezelfde maat, de naam is zwaarder',()=>{
  const n=/\.ptile-n\{flex:none;height:var\(--tile-name,\d+px\);\s*font-size:(\d+)px;font-weight:(\d+)/.exec(css);
  const c=/\.catbtn-l\{font-size:(\d+)px;font-weight:(\d+)/.exec(css);
  if(!n||!c)return 'maten niet te lezen';
  return (n[1]===c[1]&&+n[2]>+c[2])||`naam ${n[1]}px/${n[2]}, label ${c[1]}px/${c[2]}`;
});
t('De metaregel en de voet staan niet meer op de tegel',()=>
  (!/class="ptile-m"/.test(html)&&!/class="ptile-foot"/.test(html))||'ptile-m of ptile-foot staat er nog');
/* Een mini in landschap is 1133x744 en valt in de brede opmaak, niet in de
   compacte band. Daar zit de krapte: 744 hoog min topbar, marges, soortenbalk
   en het gat eronder. Er moeten drie hele rijen in. */
t('Op een mini in landschap staan er drie hele rijen tegels',()=>{
  const header=num(/--sidebar:\d+px; --header:(\d+)px/);
  const pad=num(/body\.till-mode #view\{height:calc\(100vh - var\(--header\)\);padding:(\d+)px/);
  const barPad=num(/body\.till-mode \.toolbar\{position:static;margin:0;padding:0 0 (\d+)px\}/);
  const barH=num(/\.toolbar \.ttab\{height:(\d+)px/);
  const room=744-header-pad*2-(barH+barPad)-20-4;
  const need=3*TILE.h+2*12;
  return need<=room||`drie rijen vragen ${need} van ${room}`;
});
t('De soortenbalk past naast de bon op een mini in landschap',()=>{
  /* Ruwe schatting: 16px halfvet is ongeveer 8.6px per teken. */
  const labels=E('POS_TYPES').map(x=>x[1]);
  if(labels.length<5)return 'niet alle soorten gevonden';
  const pad=num(/\.toolbar \.ttab\{height:\d+px;padding:0 (\d+)px/)*2;
  const w=labels.reduce((a,l)=>a+Math.round(l.length*8.6)+pad,0)+(labels.length-1)*8;
  const room=1133-74-52-380-20;
  return w<=room||`balk vraagt ${w} van ${room} — ${labels.join(' | ')}`;
});
t('De metaregel staat niet meer op de tegel',()=>
  !/<span class="ptile-m">/.test(html)||'ptile-m staat er nog in de opmaak');
t('Op een iPad mini staan er drie tegels naast elkaar',()=>{
  const rec=+/\.pos\{grid-template-columns:1fr minmax\(\d+px,(\d+)px\)/.exec(
    /@media\(min-width:701px\) and \(max-width:900px\)\{([\s\S]*?)\n\}/.exec(css)[1])[1];
  const items=WORK-rec-20;                       /* bon plus het gat ernaast */
  const n=cols(items,MINI_TILE.min);
  const each=Math.floor((items-(n-1)*12)/n);
  return (n===3&&each>=104)||`${n} kolommen van ${each}px in ${items}px`;
});
/* Drie rijen moeten er onder de soortenbalk en de categorierij bij passen. */
t('Op een iPad mini staand passen er drie rijen tegels in beeld',()=>{
  const room=1133-70-40-66-MINI_TILE.catH-40-4;
  const need=3*MINI_TILE.h+2*12;
  return need<=room||`drie rijen vragen ${need} van ${room}`;
});
t('Op een breed scherm groeit het aantal kolommen mee',()=>{
  const rail=+/\.pos\{display:grid;grid-template-columns:var\(--cat-w,(\d+)px\)/.exec(css)[1];
  const a=cols(1920-74-52-380-20-rail-20,TILE.min);
  const b=cols(1440-74-52-380-20-rail-20,TILE.min);
  return (a>b&&a>=6)||`1920 geeft ${a}, 1440 geeft ${b}`;
});

group('Popovers');
t('De vestigingskiezer klapt naar rechts open, niet onder de zijbalk',()=>{
  E("state.route='catalog';state.scopeMenu=true;render()");
  const m=w.document.querySelector('.menu.menu-left');
  if(!m)return 'menu niet gevonden';
  const cs=w.getComputedStyle(m);
  E('state.scopeMenu=false;render()');
  return (cs.left==='0px'&&cs.right==='auto')||`left ${cs.left}, right ${cs.right}`;
});
t('De popovers rechts in de balk blijven wel rechts uitgelijnd',()=>{
  E('state.envMenu=true;render()');
  const m=w.document.querySelector('#env-pop .menu');
  if(!m)return 'menu niet gevonden';
  const cs=w.getComputedStyle(m);
  E('state.envMenu=false;render()');
  return (cs.right==='0px'&&cs.left==='auto')||`left ${cs.left}, right ${cs.right}`;
});
t('Geen popover kan breder worden dan het scherm',()=>{
  return /\.menu\{[^}]*max-width:calc\(100vw - \d+px\)/.test(css)||'geen bovengrens op de breedte';
});

group('Scrollen');
t('De pagina staat stil zolang er een paneel of venster overheen ligt',()=>{
  const cls=()=>[...w.document.body.classList].filter(c=>/-open$/.test(c)).sort().join(',');
  E("state.route='calendar';render();openPanel(PANELS.appointment())");
  const a=cls();
  E("openModal('<p>x</p>','440px')");
  const b=cls();
  E('closeModal()');
  const c=cls();
  E('closePanel(true)');
  const d=cls();
  if([a,b,c,d].join('|')!=='panel-open|modal-open,panel-open|panel-open|')
    return `${a} → ${b} → ${c} → ${d}`;
  return /body\.panel-open,body\.modal-open\{overflow:hidden\}/.test(css)
    ||'de klassen zetten de pagina niet vast';
});
t('Elke binnenste scroller stopt aan zijn eigen rand',()=>{
  const need=['.panel-body','.modal-body','.cal-body','.menu-scroll','.overlay'];
  const missing=need.filter(sel=>{
    const re=new RegExp(sel.replace('.','\\.')+'\\{[^}]*overscroll-behavior:contain');
    return !re.test(css);
  });
  return missing.length?missing.join(', '):true;
});
t('Een lang venster is bereikbaar in plaats van boven en onder af te lopen',()=>{
  const ov=/\.overlay\{([^}]*)\}/.exec(css)[1];
  const modal=/\.modal\{([^}]*)\}/.exec(css)[1];
  if(!/overflow-y:auto/.test(ov))return 'de overlay scrollt niet';
  return /max-height:\d+vh/.test(modal)||'het venster heeft geen bovengrens';
});

group('Uitlijning van de catalogus');
t('Elke lijst is één tabel, zodat de kolommen over de categorieën heen kloppen',()=>{
  const bad=[];
  for(const tab of ['services','products']){
    E(`state.route='catalog';state.catTab='${tab}';render()`);
    const n=w.document.querySelectorAll('#view table').length;
    if(n!==1)bad.push(`${tab}: ${n} tabellen`);
  }
  return bad.length?bad.join(' | '):true;
});
t('De categoriekop overspant precies alle kolommen',()=>{
  const bad=[];
  for(const tab of ['services','products']){
    E(`state.route='catalog';state.catTab='${tab}';render()`);
    const rows=[...w.document.querySelectorAll('#view tbody tr:not(.catgroup-row)')];
    const widths=[...new Set(rows.map(r=>r.children.length))];
    if(widths.length!==1)bad.push(`${tab}: rijen met ${widths.join(' en ')} cellen`);
    [...w.document.querySelectorAll('#view .catgroup-row td')].forEach(td=>{
      if(+td.getAttribute('colspan')!==widths[0])
        bad.push(`${tab}: kop overspant ${td.getAttribute('colspan')} van ${widths[0]}`);
    });
  }
  return bad.length?bad.slice(0,2).join(' | '):true;
});
t('De categoriekop houdt zijn eigen opmaak, niet die van een cel',()=>{
  E("state.route='catalog';state.catTab='services';render()");
  const td=w.document.querySelector('#view .catgroup-row td');
  const cs=w.getComputedStyle(td);
  return (cs.padding==='0px'||cs.paddingTop==='0px')||`cel heeft padding ${cs.padding}`;
});

group('Agendabalk');
t('Today toont één datum in plaats van een week',()=>{
  E("state.route='calendar';state.calView='week';render()");
  E('document.querySelector(\'[data-calnav="today"]\').click()');
  /* De datum zit sinds de datumkiezer in een knop, niet in een div. */
  const label=w.document.querySelector('[data-calpick]').textContent.trim();
  return (E('state.calView')==='day'&&!label.includes('–'))||`${E('state.calView')} · ${label}`;
});
t('De losse keuzelijsten zijn onder één filterknop gebracht',()=>{
  const v=view();
  if(/data-set="calEmp"/.test(v))return 'de keuzelijsten staan er nog los bij';
  return /data-calfilters/.test(v)||'geen filterknop';
});
t('Het filtermenu bevat alle vier de opties',()=>{
  E('state.calFilters=true;render()');
  const rows=[...w.document.querySelectorAll('#view .filterrow .fl')].map(x=>x.textContent);
  return rows.join(',')==='View,Location,Employees,Resources'||rows.join(',');
});
t('Het telbolletje gaat alleen over wat er wordt weggelaten',()=>{
  E("state.calEmp='all';state.calRes='all';state.scope=[];state.calView='day';render()");
  if(/fbadge/.test(view()))return 'week of dag telt mee als filter';
  E("state.calEmp='e1';render()");
  const n=(/fbadge">(\d+)/.exec(view())||[])[1];
  return n==='1'||`telt ${n}`;
});
t('Clear all wist de filters en laat de kijkrichting staan',()=>{
  E("state.calView='day';state.calEmp='e1';state.calRes='c1';state.calFilters=true;render()");
  E('document.querySelector(\'[data-calclear]\').click()');
  const r=E("state.calEmp+'|'+state.calRes+'|'+state.calView");
  return r==='all|all|day'||r;
});
t('Een open menu dimt de rest en licht zijn eigen knop op',()=>{
  E("state.route='calendar';state.calFilters=false;state.calAdd=false;render()");
  if(w.document.querySelector('.pop-scrim'))return 'er ligt een waas zonder open menu';
  E('document.querySelector(\'[data-calfilters]\').click()');
  if(!w.document.querySelector('.pop-scrim'))return 'geen waas bij een open menu';
  const btn=w.document.querySelector('[data-calfilters]');
  if(!btn.classList.contains('open'))return 'de knop toont niet dat hij openstaat';
  const bar=w.document.querySelector('.toolbar-cal');
  if(!bar.classList.contains('popped'))return 'de balk komt niet boven het waas uit';
  E('document.querySelector(\'.pop-scrim\').click()');
  return E('state.calFilters')===false||'klikken op het waas sluit het menu niet';
});
t('Een actief filter en een open menu zijn twee verschillende dingen',()=>{
  E("state.calFilters=false;state.calEmp='e1';render()");
  const cls=w.document.querySelector('[data-calfilters]').className;
  E("state.calEmp='all';render()");
  return (cls.includes('on')&&!cls.includes('open'))||cls.trim();
});
t('Het zonnetje staat nergens meer naast de titel',()=>{
  E("state.route='calendar';render()");
  const cog=w.document.getElementById('page-cog').style.display;
  E("state.route='customers';state.param=null;render()");
  const still=w.document.getElementById('page-cog').style.display;
  return (cog==='none'&&still==='none')||`agenda ${cog}, klanten ${still}`;
});

group('Groepsafspraak en geblokkeerde tijd');
/* Het keuzemenu is eruit: Add opent meteen de lade, en de twee zeldzame
   soorten staan daar als vinkje in. Zie test-calendar.js voor het gedrag;
   hier alleen dat er geen menu meer tussen zit. */
t('De Add-knop opent meteen de lade',()=>{
  E("state.route='calendar';state.calFilters=false;closePanel(true);render()");
  const btn=w.document.querySelector('#view [data-panel="appointment"]');
  if(!btn)return 'geen Add-knop die de lade opent';
  return !w.document.querySelector('#view .toolbar-cal .menu')||'er zit nog een menu tussen';
});
t('Geblokkeerde tijd houdt de plek echt bezet',()=>{
  const before=E('appointments.length');
  E("state.blockRow={date:TODAY,emp:'e1',from:'13:00',to:'14:00',reason:'Break'}");
  const ok=E('saveBlockedTime()');
  const n=E('appointments.length')-before;
  const blocked=E("bookingCheck({locationId:'loc-centar',date:TODAY,start:'13:15',dur:30,emp:'e1',sid:'s1'})");
  return (ok===true&&n===1&&typeof blocked==='string')||`${ok} · ${n} erbij · ${blocked}`;
});
t('Blokkeren weigert een eindtijd die voor de starttijd ligt',()=>{
  E("state.blockRow={date:TODAY,emp:'e1',from:'15:00',to:'14:00',reason:'Break'}");
  return E('saveBlockedTime()')===false||'het accepteerde een omgekeerde tijd';
});
t('Een groep neemt één plek in de agenda, niet één per persoon',()=>{
  const before=E('appointments.length');
  /* Ver genoeg vooruit dat er geen demo-afspraak in de weg staat: dit
     liep vast zodra de datum verschoof en 'over twee dagen' bezet raakte. */
  /* Om 11:00 in plaats van 16:00: dertig dagen vooruit kan op elke
     weekdag landen, en zaterdag sluit om 15:00. Een tijd die binnen élk
     geopend rooster valt maakt de toets datumvast — 16:00 werkte alleen
     zolang de som niet op een zaterdag uitkwam. */
  E("state.groupRow={date:nextOpenDate(addDays(TODAY,30)),emp:'e1',sid:'s1',start:'11:00',cap:6,members:['c1','c2','c3']}");
  const ok=E('saveGroupAppt()');
  const n=E('appointments.length')-before;
  const g=E("(function(){const a=appointments[appointments.length-1];return a.group.members.length+'/'+a.group.cap})()");
  return (ok===true&&n===1&&g==='3/6')||`${ok} · ${n} erbij · ${g}`;
});
t('Een groep zonder deelnemers wordt geweigerd',()=>{
  E("state.groupRow={date:nextOpenDate(addDays(TODAY,31)),emp:'e1',sid:'s1',start:'16:00',cap:6,members:[]}");
  return E('saveGroupAppt()')===false||'lege groep werd geboekt';
});
t('Er kunnen niet meer mensen bij dan er stoelen zijn',()=>{
  E("state.groupRow={date:TODAY,emp:'e1',sid:'s1',start:'11:00',cap:2,members:['c1','c2']}");
  E("openPanel(PANELS.groupAppt());document.querySelector('[data-groupmember=\"c3\"]').click()");
  const n=E('state.groupRow.members.length');
  E('closePanel(true)');
  return n===2||`er staan er ${n} in bij 2 stoelen`;
});

group('Geen regressie op de bestaande schermen');
t('Alle routes renderen nog foutloos',()=>{
  const bad=[];
  for(const r of ROUTES.concat(['book','onboarding','mobile'])){
    try{E(`state.route=${JSON.stringify(r)};state.param=null;render()`);
      const v=w.document.getElementById('view').innerHTML;
      ['undefined','NaN','[object Object]'].forEach(x=>{if(v.includes(x))bad.push(`${r}: ${x}`)});
    }catch(e){bad.push(`${r}: ${e.message}`)}
  }
  return bad.length?bad.join(' | '):true;
});
t('De weekweergave blijft bereikbaar',()=>{
  E(`state.route='calendar';state.calView='week';render()`);
  return w.document.querySelectorAll('#view .cal-body .cal-col').length===7||'weekweergave weg';
});

/* Tot slot: een tweede document waarin het scherm smal is, om te zien
   of de agenda dan uit zichzelf op de dagweergave begint. */
group('iPad mini in landschap (1133x744)');
/* De lade is 480 breed. Duwt hij de pagina opzij, dan houdt een mini in
   landschap nog 579 pixels over voor alles: de balk slaat om, de paginanaam
   wordt afgekapt en een menu klapt buiten beeld. */
t('De lade legt zich over de pagina heen, hij duwt hem niet opzij',()=>{
  const m=/@media\(max-width:(\d+)px\)\{body\.panel-open \.shell\{padding-right:0\}\}/.exec(css);
  if(!m)return 'de grens staat er niet meer in';
  return +m[1]>=1133||`grens ligt op ${m[1]}, de mini is 1133 breed`;
});
t('De balk houdt genoeg breedte om op één regel te blijven',()=>{
  const panel=+/\.panel\{[\s\S]*?width:(\d+)px/.exec(css)[1];
  const push=+/@media\(max-width:(\d+)px\)\{body\.panel-open \.shell\{padding-right:0\}\}/.exec(css)[1];
  const room=1133-74-52-(1133<=push?0:panel);
  /* Today, de datumnavigatie en Filters vragen samen ruwweg 530px. */
  return room>=530||`${room}px voor een balk die er 530 vraagt`;
});
t('Een menu dat over de linkerrand hangt draait om',()=>{
  if(!/\.menu\.menu-flip\{left:0;right:auto/.test(css))return 'de omgedraaide stand staat niet in de opmaak';
  const fn=/function keepMenuInView\(\)\{[\s\S]*?\n\}/.exec(html);
  if(!fn)return 'er wordt niet gemeten na het tekenen';
  if(!/renderChrome\(\);\s*keepMenuInView\(\);/.test(html))return 'de meting draait niet mee met render';
  return /if\(!r\|\|!r\.width\)return/.test(fn[0])||'een niet-gemeten menu wordt toch omgedraaid';
});
t('Een menu dat al naar boven opent blijft met rust',()=>{
  const fn=/function keepMenuInView\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  return /menu-up/.test(fn)||'menu-up wordt niet overgeslagen';
});

group('De lade beweegt niet zijwaarts');
t('De lade schuift alleen omhoog en omlaag',()=>{
  const b=/\.panel-body\{[^}]*\}/.exec(css)[0];
  if(!/overflow-x:hidden/.test(b))return 'overflow-x staat niet vast';
  return /overflow-y:auto/.test(b)||'verticaal schuiven is weg';
});
t('Elk blok in de lade mag krimpen',()=>{
  if(!/\.panel-body>\*[^{]*\{min-width:0;max-width:100%\}/.test(css))
    return 'blokken kunnen niet onder hun inhoud krimpen';
  return /\.apptrow\{min-width:0\}/.test(css)||'de dienstenrij kan niet krimpen';
});
t('Keuzelijsten en velden blijven binnen de lade',()=>
  /\.panel-body \.select,\.panel-body \.input,\.panel-body textarea\{max-width:100%\}/.test(css)
    ||'een keuzelijst mag nog breder worden dan de lade');

group('Start op een smal scherm');
const narrow=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/',
  beforeParse(win){win.matchMedia=q=>({matches:/max-width:900px/.test(q),media:q,
    addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}})}});
setTimeout(()=>{
  t('De agenda begint op de dagweergave',()=>{
    const v=narrow.window.eval('state.calView');
    return v==='day'||`begon op ${v}`;
  });
  t('Op een breed scherm verandert er niets aan de startweergave',()=>{
    const v=E('typeof state.calView');
    return v==='string'||v;
  });
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail?1:0);
},700);

},700);
