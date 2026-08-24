/* Elke overzichtsbalk heeft dezelfde vorm: links wat het beeld beperkt of
   waar je staat, rechts wat je kunt doen, en niets eronder. */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/'});
const w=dom.window,d=w.document,E=s=>w.eval(s);
let pass=0,fail=0;
const t=(n,fn)=>{try{const r=fn();if(r===true||r===undefined){pass++;console.log('  pass  '+n)}
  else{fail++;console.log('  FAIL  '+n+' → '+r)}}catch(e){fail++;console.log('  FAIL  '+n+' → '+e.message)}};
const g=n=>console.log('\n'+n);

setTimeout(()=>{
g('Eén naam voor één balk');
t('De oude balknamen bestaan niet meer',()=>{
  const left=['toolbar-cat','toolbar-tabs'].filter(c=>
    new RegExp('class="toolbar[^"]*\\\\b'+c+'\\\\b').test(html)||new RegExp('\\\\.'+c+'\\\\s*[.{,]').test(css));
  return left.length===0||`nog in gebruik: ${left.join(', ')}`;
});
t('De regels staan maar één keer in de opmaak',()=>{
  const n=(css.match(/\.toolbar-row \.filters\{flex:1;min-width:0;flex-wrap:nowrap/g)||[]).length;
  return n===1||`${n} keer dezelfde regel`;
});

g('Geen kruimelpad meer');
t('De kruimelopmaak is weg',()=>
  !/\.crumb\{/.test(css)||'.crumb staat nog in de opmaak');
t('Geen enkel scherm tekent er nog een',()=>{
  if(/class="crumb"/.test(html))return 'er staat nog een crumb in de opmaak';
  return !/supCrumb\s*\(/.test(html)||'supCrumb wordt nog aangeroepen';
});

g('Elke lijstbalk volgt hetzelfde patroon');
/* Route, en waar nodig het tabblad, zodat elke lijst één keer langskomt. */
const screens=[
  ['catalog',"state.catTab='services'"],['catalog',"state.catTab='products'"],
  ['catalog',"state.catTab='categories'"],['catalog',"state.catTab='combos'"],
  ['customers',''],['invoices',''],['marketing',"state.marketingTab='discounts'"],
  ['reports',''],
  ['suppliers',"state.supTab='suppliers'"],['suppliers',"state.supTab='catalog'"],
  ['suppliers',"state.supTab='orders'"],['suppliers',"state.supTab='deliveries'"],
  ['suppliers',"state.supTab='academy'"],
];
screens.forEach(([route,setup])=>{
  t(`${route}${setup?' · '+setup.split("='")[1].replace("'",''):''}`,()=>{
    E(`state.route='${route}';state.param=null;${setup};render()`);
    const bar=d.querySelector('#view .toolbar');
    if(!bar)return 'geen actiebalk';
    if(!bar.classList.contains('toolbar-row'))return `balk mist toolbar-row: ${bar.className}`;
    if(!bar.querySelector('.filters'))return 'geen linkergroep';
    if(d.querySelector('#view .crumb'))return 'er staat nog een kruimelpad onder';
    /* Een rechtergroep is niet verplicht — de Academy heeft niets toe te
       voegen, die lijst komt van de leverancier. Staat hij er wel, dan
       hoort hij na de linkergroep. */
    const kids=[...bar.children].map(x=>x.className.split(' ')[0]);
    if(!kids.includes('toolbar-actions'))return true;
    return kids.indexOf('toolbar-actions')>kids.indexOf('filters')
      ||`volgorde: ${kids.join(', ')}`;
  });
});

g('Add volgt het tabblad waar je staat');
/* Het keuzemenu onder Add stelde een vraag die het tabblad al beantwoordt.
   Zoals bij de agenda: één klik en je staat in het formulier. */
const btns=()=>[...d.querySelectorAll('#view .toolbar-actions .btn')].map(b=>b.textContent.trim());
const at=(route,setup)=>E(`state.route='${route}';${setup};closePanel(true);render()`);

/* De knop heet overal "Add": je staat al in de sectie waar hij aan
   toevoegt. Wát hij toevoegt blijkt uit de lade die opengaat. */
[['services','service'],['products','product'],
 ['categories','category'],['combos','combo']].forEach(([tab,panel])=>{
  t(`catalogus · ${tab} → ${panel}`,()=>{
    at('catalog',`state.catTab='${tab}'`);
    if(d.querySelector('#view .toolbar-actions .menu'))return 'er zit nog een keuzemenu onder Add';
    const b=btns();
    if(!b.includes('Add'))return `knoppen: ${b.join(', ')}`;
    const add=[...d.querySelectorAll('#view .toolbar-actions .btn')]
      .find(x=>x.textContent.trim()==='Add');
    if(!add)return 'geen Add-knop';
    if(add.dataset.panel!==panel)return `Add opent ${add.dataset.panel}`;
    /* De AI-import staat ernaast, niet onderin een menu. */
    return b.some(x=>/Import with AI/.test(x))||'de AI-import is verdwenen';
  });
});
t('De knop noemt de sectie niet nog een keer',()=>{
  const bad=['services','products','categories','combos'].filter(tab=>{
    at('catalog',`state.catTab='${tab}'`);
    return btns().some(x=>/^Add .+/.test(x));
  });
  return bad.length===0||`nog een lange naam op: ${bad.join(', ')}`;
});
t('De catalogusknop opent meteen het juiste formulier',()=>{
  at('catalog',"state.catTab='combos'");
  d.querySelector('#view .toolbar-actions .btn-primary').click();
  const h=d.querySelector('.panel-head h2');
  return (h&&/combo/i.test(h.textContent))||`kop leest ${h&&h.textContent.trim()}`;
});

[['discounts','Add discount code'],['waiting','Add to waiting list']].forEach(([tab,label])=>{
  t(`marketing · ${tab} → ${label}`,()=>{
    at('marketing',`state.marketingTab='${tab}'`);
    if(d.querySelector('#view .toolbar-actions .menu'))return 'er zit nog een keuzemenu onder Add';
    return btns().join(',')===label||`knoppen: ${btns().join(', ')}`;
  });
});
t('Waar niets toe te voegen valt staat geen knop',()=>{
  const bad=['loyalty','reviews','campaigns'].filter(tab=>{
    at('marketing',`state.marketingTab='${tab}'`);
    return btns().length>0;
  });
  return bad.length===0||`nog een knop bij: ${bad.join(', ')}`;
});
/* De overgebleven keuzemenu's — leveranciers, HQ, portaal — lieten zich
   niet sluiten zodra ze een lade openden: openPanel tekent alleen de lade
   opnieuw, dus het menu bleef eronder staan tot de volgende tekenbeurt. */
t('Een menu dat een lade opent sluit zichzelf',()=>{
  at('suppliers',"state.supTab='suppliers'");
  E('state.addMenu=true;render()');
  const row=d.querySelector('#view .menu [data-panel]')||d.querySelector('#view [data-panel]');
  if(!row)return 'geen ingang om te toetsen';
  E('state.addMenu=true');
  row.click();
  return E('state.addMenu')===false||'het menu bleef openstaan achter de lade';
});
E('closePanel(true)');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
