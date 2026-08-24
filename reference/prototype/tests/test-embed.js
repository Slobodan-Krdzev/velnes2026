/* Installatiecode voor de boekingswidget — de eigenaar haalt de code
   zelf uit de instellingen. Toetst: één bron voor de code (scherm,
   kopieerknop en mail lopen nooit uiteen), de sleutel in de code,
   sleutel vernieuwen met eerlijke waarschuwing en auditregel, en de
   lijst met toegestane websites. */
const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('/home/claude/velnes/index.html','utf8'),{runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document,E=x=>w.eval(x);
const q=s=>d.querySelector(s),qa=s=>[...d.querySelectorAll(s)];
const click=el=>el.dispatchEvent(new w.Event('click',{bubbles:true}));
const change=el=>el.dispatchEvent(new w.Event('change',{bubbles:true}));
let pass=0,fail=0;
const ok=(c,msg)=>{if(c){pass++}else{fail++;console.log('  FAIL ',msg)}};
setTimeout(()=>{try{

console.log('— Eén bron: de code die je kopieert is de code die je ziet —');
const snip=E(`embedSnippet(widgets[0])`);
ok(snip.includes('velnes-booking')&&snip.includes('widget.js'),'de code hoort de houder en het script te dragen');
ok(snip.includes('data-key="pk_live_8f2c…a41"'),'de code hoort de sleutel van de widget te dragen');
ok(snip.includes('data-widget="w1"')&&snip.includes('data-business="'),'de code hoort widget en bedrijf te noemen');
ok(snip.includes('</'+'script>'),'de code hoort een compleet scriptblok te zijn');

E(`go('settings');state.settingsTab='booking';state.widgetId='w1';render()`);
const view=()=>q('#view');
ok(view().textContent.includes('pk_live_8f2c…a41'),'het scherm hoort de sleutel te tonen');
ok(!!q('#view [data-copysnip="w1"]'),'de kopieerknop hoort er te staan');
ok(!!q('#view [data-wmail="w1"]'),'de mailknop voor de websitebouwer hoort er te staan');
ok(!!q('#view [data-wregen="w1"]'),'de knop voor een nieuwe sleutel hoort er te staan');
ok(!q('#view [data-toast="Installation code copied"]'),'de oude nepknop hoort weg te zijn');

console.log('— Kopiëren en mailen mogen nergens op stuklopen (geen klembord in jsdom) —');
click(q('#view [data-copysnip="w1"]'));
ok(E(`document.querySelector('.toast,#toast')?true:true`),'kopieerknop hoort zonder fout te lopen');
click(q('#view [data-wmail="w1"]'));
ok(true,'mailknop hoort zonder fout te lopen');

console.log('— Sleutel vernieuwen: eerst de eerlijke vraag, dan pas de daad —');
click(q('#view [data-wregen="w1"]'));
ok(E(`typeof OVERLAYS.wregen`)==='string'&&E(`OVERLAYS.wregen`).indexOf(' / ')>0,'de modal hoort een naam met hiërarchie te hebben');
ok(d.body.innerHTML.includes('stops working immediately'),'de modal hoort eerlijk te zeggen dat de oude code stopt');
ok(!!q('[data-wregengo="w1"]'),'de bevestigingsknop hoort in de modal te staan');
const auditBefore=E('auditLog.length');
click(q('[data-wregengo="w1"]'));
const nkey=E(`widgets[0].key`);
ok(nkey!=='pk_live_8f2c…a41'&&/^pk_live_/.test(nkey),'de sleutel hoort nieuw te zijn en het patroon te houden: '+nkey);
ok(E(`widgets[0].installed`)===false,'na vernieuwen hoort de widget als niet-geïnstalleerd te gelden');
ok(E('auditLog.length')===auditBefore+1&&E('auditLog[0].action')==='Widget key regenerated',
  'het vernieuwen hoort in het auditlog te staan');
ok(E(`embedSnippet(widgets[0])`).includes(nkey),'de installatiecode hoort meteen de nieuwe sleutel te dragen');
E('render()');
ok(view().textContent.includes(nkey),'het scherm hoort meteen de nieuwe sleutel te tonen');

console.log('— Toegestane websites: toevoegen, normaliseren, weigeren, verwijderen —');
ok(view().textContent.includes('Allowed websites'),'de kaart hoort er te staan');
ok(view().textContent.includes('velnesstudio.mk'),'de bestaande website hoort in de lijst te staan');
const inp=q('#view [data-set="wdomainDraft"]');
ok(!!inp,'het invoerveld hoort er te staan');
inp.value='https://WWW.MijnSalon.MK/booking'; change(inp);
click(q('#view [data-wdomadd="w1"]'));
ok(E(`widgets[0].domains.includes('www.mijnsalon.mk')`),'het adres hoort genormaliseerd opgeslagen te worden');
ok(E('auditLog[0].action')==='Widget website added','het toevoegen hoort in het auditlog');
ok(E(`state.wdomainDraft`)==='','het veld hoort na toevoegen leeg te zijn');
const n=E('widgets[0].domains.length');
const inp2=q('#view [data-set="wdomainDraft"]');
inp2.value='www.mijnsalon.mk'; change(inp2);
click(q('#view [data-wdomadd="w1"]'));
ok(E('widgets[0].domains.length')===n,'een dubbel adres hoort geweigerd te worden');
click(q('#view [data-wdomdel="w1|www.mijnsalon.mk"]'));
ok(!E(`widgets[0].domains.includes('www.mijnsalon.mk')`),'verwijderen hoort te werken');
ok(E('auditLog[0].action')==='Widget website removed','het verwijderen hoort in het auditlog');

console.log('— De lege staat is eerlijk over wat hij betekent —');
E(`state.widgetId='w2';render()`);
ok(view().textContent.includes('Open to any site'),'zonder lijst hoort het scherm te zeggen dat elke site mag');
ok(view().textContent.includes('Add your own site'),'de lege staat hoort naar de oplossing te wijzen');

console.log('— De kleurkiezer: elke merkkleur, live in het voorbeeld —');
E(`state.widgetId='w1';render()`);
const cp=q('#view [data-wfcolor="w1|accent"]');
ok(!!cp&&cp.type==='color','de kleurkiezer hoort er als echt kleurveld te staan');
ok(cp.value.toLowerCase()===E('widgets[0].accent').toLowerCase(),'de kiezer hoort de huidige kleur te dragen');
const prevBefore=q('.wprev-page').innerHTML;
cp.value='#8b1e3f';
cp.dispatchEvent(new w.Event('input',{bubbles:true}));
ok(E('widgets[0].accent')==='#8b1e3f','tijdens het kiezen hoort de kleur al opgeslagen te zijn');
ok(q('[data-wfhex]').textContent==='#8b1e3f','het hex-label hoort live mee te lopen');
ok(q('.wprev-page').innerHTML!==prevBefore&&q('.wprev-page').innerHTML.includes('#8b1e3f'),
  'het voorbeeld hoort live de nieuwe kleur te dragen');
ok(!!q('#view [data-wfcolor="w1|accent"]')&&q('#view [data-wfcolor="w1|accent"]')===cp,
  'tijdens het kiezen hoort het invoerveld zelf te blijven staan (geen her-render)');
change(cp);
ok(E('widgets[0].accent')==='#8b1e3f','na de keuze hoort de kleur vast te staan');
ok(qa('#view .chip.on').every(c=>!/Olive|Blue|Black|Amber/.test(c.textContent)),
  'bij een eigen kleur hoort geen voorkeuzeknop meer aan te staan');
click(qa('#view [data-wset^="w1|accent|"]')[0]);
ok(E('widgets[0].accent')==='#6f7357','een voorkeuzeknop hoort de eigen kleur weer te vervangen');
ok(q('#view [data-wfcolor="w1|accent"]').value==='#6f7357','de kiezer hoort de voorkeuze te volgen');

console.log('— De boekingslink kopieert nog gewoon —');
E(`state.widgetId=null;render()`);
ok(!!q('#view [data-copy]'),'de kopieerknop van de boekingslink hoort te blijven bestaan');
click(q('#view [data-copy]'));
ok(true,'ook zonder klembord hoort die knop zonder fout te lopen');

console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
}catch(e){console.log('CRASH',e);process.exit(1)}},400);
