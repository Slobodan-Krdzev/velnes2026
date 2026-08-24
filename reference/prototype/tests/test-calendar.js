/* Rode nu-lijn en het medewerkersfilter in de agenda. */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/#calendar'});
const w=dom.window,d=w.document,E=s=>w.eval(s);
let pass=0,fail=0;
const t=(n,fn)=>{try{const r=fn();if(r===true||r===undefined){pass++;console.log('  pass  '+n)}
  else{fail++;console.log('  FAIL  '+n+' → '+r)}}catch(e){fail++;console.log('  FAIL  '+n+' → '+e.message)}};
const g=n=>console.log('\n'+n);
const qa=s=>[...d.querySelectorAll(s)];
const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));

setTimeout(()=>{
g('Startweergave');
t('De agenda begint op de dagweergave',()=>{
  const v=E('state.calView');
  return v==='day'||`begon op ${v}`;
});
t('Een kaal adres laat de standaard staan',()=>{
  E("state.calView='day'");
  E("SCREENS.calendar.apply([])");
  const v=E('state.calView');
  return v==='day'||`#calendar zette hem op ${v}`;
});
t('Een adres met kijkrichting wint wel',()=>{
  E("SCREENS.calendar.apply(['week'])");
  const a=E('state.calView');
  E("SCREENS.calendar.apply(['day'])");
  return (a==='week'&&E('state.calView')==='day')||`#calendar/week gaf ${a}`;
});
t('De week is nog gewoon te kiezen',()=>{
  E("state.calView='week';render()");
  const heads=[...d.querySelectorAll('.cal-head .dow')].map(x=>x.textContent.trim());
  return heads.slice(0,3).join(',')==='MON,TUE,WED'||`koppen: ${heads.slice(0,3).join(',')}`;
});

g('De rode lijn');
E("state.route='calendar';state.calView='week';state.calEmp='all';render()");
const open=E('nowTop()!==null');

t('De lijn staat in de kolom van vandaag, en nergens anders',()=>{
  const cols=qa('.cal-body .cal-col');
  const withLine=cols.filter(c=>c.querySelector('[data-nowline]'));
  if(!open)return withLine.length===0||'buiten openingstijd maar toch een lijn';
  if(withLine.length!==1)return `${withLine.length} kolommen met een lijn`;
  return withLine[0].classList.contains('today')||'de lijn staat niet in de kolom van vandaag';
});
t('De lijn hangt op de hoogte die bij de klok hoort',()=>{
  /* In procenten van de dag, niet in pixels: de rijhoogte hangt sinds
     deze wijziging van de schermhoogte af, dus een positie in pixels zou
     alleen bij één schermhoogte kloppen. */
  if(!open)return true;
  const el=d.querySelector('[data-nowline]');
  return el.style.top===E('nowTop()')+'%'||`top is ${el.style.top}, verwacht ${E('nowTop()')}%`;
});
t('En dat percentage komt overeen met de klok',()=>{
  if(!open)return true;
  const m=E('nowMins()');
  const want=Math.round(((m-E('DAY_START'))/E('DAY_MINUTES'))*100*1000)/1000;
  return E('nowTop()')===want||`nowTop ${E('nowTop()')}, verwacht ${want}`;
});
t('De tijdkolom draagt de echte klok, geen vast blokje',()=>{
  if(/const now=m===555|now=m===555/.test(html))return 'de vaste marker op 09:15 staat er nog';
  if(!open)return !d.querySelector('[data-nowlabel]')||'label buiten openingstijd';
  const l=d.querySelector('[data-nowlabel]');
  if(!l)return 'geen tijdlabel in de kolom';
  return /^\d{2}:\d{2}$/.test(l.textContent.trim())||`label leest ${l.textContent}`;
});
t('De lijn vangt geen tikken af',()=>{
  const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
  return /\.cal-now\{[^}]*pointer-events:none/.test(css)||'de lijn ligt over de slots heen';
});
t('Buiten de openingstijden is er niets te zien',()=>{
  const src=/const nowTop=\(\)=>\{const m=nowMins\(\);\s*return \(m<DAY_START\|\|m>=DAY_END\)\?null/.test(html);
  return src||'nowTop kent de openingstijden niet';
});

g('De agenda vult de hoogte die er is');
t('Nergens staat nog een vaste agendahoogte',()=>{
  /* calc(100vh - 320px) was een gok naar balk plus strook plus marges.
     Bij één schermhoogte klopte hij; eronder liep de agenda buiten
     beeld, erboven bleef er wit staan. */
  const bad=css.match(/\.cal-body\{[^}]*max-height:calc\([^)]*\)/g);
  return !bad||`nog een vast getal: ${bad.join(' | ')}`;
});
t('De agenda is het rekbare vak in een kolom die het scherm vult',()=>{
  const view=/body\.cal-mode #view\{([^}]*)\}/.exec(css);
  if(!view)return 'geen hoogteketen op het agendascherm';
  if(!/display:flex/.test(view[1])||!/flex-direction:column/.test(view[1]))
    return `#view leest ${view[1]}`;
  const body=/\n\.cal-body\{([^}]*)\}/.exec(css);
  return (/flex:1/.test(body[1])&&/min-height:0/.test(body[1]))||`.cal-body leest ${body[1]}`;
});
t('De balk krimpt niet mee',()=>{
  /* De strook met wie-wie-is en de capaciteitskaart stonden hier ook
     in; beide zijn er op verzoek uit — de kaart woont nu op de
     flightdeck. Wat overblijft is de balk, en die moet zijn eigen
     hoogte houden zodra het rooster ruimte opeist. */
  return /body\.cal-mode #view>\.toolbar\{flex:none\}/.test(css)
    ||'de balk kan worden platgedrukt';
});
t('De agenda draagt geen capaciteitskaart meer',()=>{
  E("session.userId='e1';go('calendar')");
  return (!d.querySelector('#view .capcard')&&!/\.capcard\{/.test(css))
    ||'de kaart of zijn opmaak staat er nog';
});
t('De rijen verdelen de ruimte, met een ondergrens',()=>{
  const m=/body\.cal-mode \.cal-time,body\.cal-mode \.cal-cell\{([^}]*)\}/.exec(css);
  if(!m)return 'de rijen rekken niet mee';
  return (/flex:1 1 0/.test(m[1])&&/min-height:var\(--slot\)/.test(m[1]))||`rijen lezen ${m[1]}`;
});
t('Het rooster vult de lade minstens helemaal',()=>{
  return /body\.cal-mode \.cal-body>\.cal-row\{min-height:100%\}/.test(css)
    ||'het rooster laat onderin wit staan';
});
t('Er komt geen tijdvak bij om wit op te vullen',()=>{
  /* De dag loopt van openingstijd tot sluitingstijd, hoe hoog het
     scherm ook is. Ruimte verdelen is iets anders dan uren verzinnen. */
  const n=qa('#view .cal-body .cal-time').length;
  return n===(E('DAY_END')-E('DAY_START'))/E('SLOT')
    ||`${n} tijdvakken bij een dag van ${(E('DAY_END')-E('DAY_START'))/E('SLOT')}`;
});
t('De pagina zelf schuift niet, het rooster erbinnen wel',()=>{
  E("state.route='calendar';render()");
  if(!d.body.classList.contains('cal-mode'))return 'de agenda draagt zijn eigen stand niet';
  const view=/body\.cal-mode #view\{([^}]*)\}/.exec(css)[1];
  const body=/\n\.cal-body\{([^}]*)\}/.exec(css)[1];
  return (/overflow:hidden/.test(view)&&/overflow-y:auto/.test(body))
    ||`#view ${view}, .cal-body ${body}`;
});
t('En die stand geldt alleen op de agenda',()=>{
  E("state.route='catalog';render()");
  const weg=!d.body.classList.contains('cal-mode');
  E("state.route='calendar';state.calView='day';state.calDate=TODAY;render()");
  return weg||'cal-mode blijft hangen op andere schermen';
});
t('De hoogteketen geldt alleen vanaf 901px',()=>{
  /* Onder die grens loopt de agenda met de pagina mee. Dat is hier geen
     terugdraaiing verderop maar een grens vooraf: een blok dat cal-mode
     weer uitzet, wint op soortelijkheid ook van de marges die de smalle
     schermen zelf zetten. */
  const m=/@media\(min-width:901px\)\{([\s\S]*?)\n\}/.exec(css);
  const blok=m&&m[1];
  if(!blok||!/body\.cal-mode #view\{height:calc/.test(blok))
    return 'de hoogteketen staat niet achter een breedtegrens';
  const buiten=css.replace(/@media\(min-width:901px\)\{[\s\S]*?\n\}/g,'');
  return !/body\.cal-mode #view\{height:calc\(100vh/.test(buiten)
    ||'de keten staat ook buiten de breedtegrens';
});
t('En de balk plakt daar niet, want de pagina schuift niet',()=>{
  /* Sticky met top:var(--header) in een vak dat zelf niet schuift, duwt
     de balk juist de hoogte van de kopregel omlaag en legt met zijn
     achtergrond de strook en de kolomkoppen eronder toe. */
  const m=/@media\(min-width:901px\)\{([\s\S]*?)\n\}/.exec(css)[1];
  return /body\.cal-mode \.toolbar\{position:static/.test(m)
    ||'de balk plakt nog in een scherm dat niet schuift';
});
t('Maar op smalle schermen plakt hij gewoon weer',()=>{
  const buiten=css.replace(/@media\(min-width:901px\)\{[\s\S]*?\n\}/g,'');
  return !/body\.cal-mode \.toolbar/.test(buiten)
    ||'er staat een cal-mode-balkregel buiten de breedtegrens';
});
t('Een afspraak staat op een percentage van de dag, niet op pixels',()=>{
  E("state.calView='day';state.calDate=TODAY;state.calEmp='all';render()");
  const ev=qa('#view .event');
  if(!ev.length)return true;
  const bad=ev.filter(e=>!/%$/.test(e.style.top)||!/%$/.test(e.style.height));
  return bad.length===0||`${bad.length} blokken staan nog in pixels`;
});
t('En houdt een leesbare minimumhoogte',()=>{
  return /\n\.event\{min-height:28px\}/.test(css)||'een kort blok kan onleesbaar dun worden';
});

g('De agenda begint bij nu');
t('Naar beneden afgerond op het halve uur',()=>{
  const cases=[[13*60+58,13*60+30],[9*60+1,9*60],[10*60+29,10*60],[10*60+30,10*60+30]];
  const bad=cases.filter(([m,want])=>Math.floor(m/30)*30!==want);
  return bad.length===0||`afronding klopt niet: ${JSON.stringify(bad)}`;
});
/* jsdom legt niets op: scrollHeight is er nul, dus de agenda kan de
   werkelijke roosterhoogte niet aflezen. Die ene meting zetten we hier
   neer; de rekensom eromheen is wél van ons en wordt wel getoetst. */
const metHoogte=(px,fn)=>{
  const body=d.querySelector('.cal-body');
  Object.defineProperty(body,'scrollHeight',{value:px,configurable:true});
  const r=fn(body);
  delete body.scrollHeight;
  return r;
};
t('Vandaag begint de agenda niet bovenaan de dag',()=>{
  E("state.calView='day';state.calDate=TODAY;state.calEmp='all';render()");
  const m=E('nowMins()');
  return metHoogte(2000,body=>{
    E('calScrollToNow()');
    if(m<=E('DAY_START'))return body.scrollTop===0||'voor openingstijd hoort hij bovenaan';
    const want=Math.round(2000*((Math.max(E('DAY_START'),Math.floor(m/30)*30)-E('DAY_START'))/E('DAY_MINUTES')));
    return body.scrollTop===want||`scrollTop ${body.scrollTop}, verwacht ${want}`;
  });
});
t('Op een hoger scherm schuift hij evenredig verder',()=>{
  /* Dezelfde tijd, een hoger rooster, dus een grotere sprong \u2014 maar
     dezelfde plek in de dag. Dat is wat er misging toen de hoogte nog
     vastlag. */
  const m=E('nowMins()');
  if(m<=E('DAY_START'))return true;
  const a=metHoogte(2000,b=>{E('calScrollToNow()');return b.scrollTop});
  const b2=metHoogte(4000,b=>{E('calScrollToNow()');return b.scrollTop});
  return Math.abs(b2-2*a)<=1||`${a} bij 2000, ${b2} bij 4000`;
});
t('De rode lijn valt binnen de eerste twee slots',()=>{
  const line=d.querySelector('[data-nowline]');
  if(!line)return true;
  /* Alles in procenten van de dag: waar de agenda naartoe schuift en
     waar de lijn hangt zijn nu dezelfde eenheid. */
  const m=E('nowMins()');
  const naar=((Math.max(E('DAY_START'),Math.floor(m/30)*30)-E('DAY_START'))/E('DAY_MINUTES'))*100;
  const off=parseFloat(line.style.top)-naar;
  const tweeSlots=(2*E('SLOT')/E('DAY_MINUTES'))*100;
  /* nowTop() rondt op drie decimalen af, de verwachting hier niet; een
     duizendste procent speelmarge scheelt een schijnbare afwijking. */
  return (off>=-0.001&&off<=tweeSlots)||`de lijn hangt ${off.toFixed(3)}% onder de bovenrand`;
});
t('Een andere dag begint gewoon bij openingstijd',()=>{
  E("state.calDate=addDays(TODAY,3);render()");
  const body=d.querySelector('.cal-body');
  Object.defineProperty(body,'scrollHeight',{value:2000,configurable:true});
  E('calScrollToNow()');
  const top=body.scrollTop;
  delete body.scrollHeight;
  E("state.calDate=TODAY;render()");
  return top===0||`een andere dag begon op ${top}`;
});
t('Een week zonder vandaag begint bovenaan',()=>{
  E("state.calView='week';state.weekStart=weekStartOf(addDays(TODAY,21));render()");
  const body=d.querySelector('.cal-body');
  Object.defineProperty(body,'scrollHeight',{value:2000,configurable:true});
  E('calScrollToNow()');
  const top=body.scrollTop;
  delete body.scrollHeight;
  E("state.weekStart=weekStartOf(TODAY);state.calView='day';state.calDate=TODAY;render()");
  return top===0||`een andere week begon op ${top}`;
});

g('Eén medewerker kiezen');
const staff=E('employees.filter(e=>e.locs.some(inScope)&&e.status===\'active\').map(e=>e.id)');
E("state.calView='day';state.calEmp='all';render()");
const allCols=qa('.cal-body .cal-col').length;
t('Alle medewerkers geven meer dan één kolom',()=>
  allCols===staff.length||`${allCols} kolommen voor ${staff.length} medewerkers`);

E(`state.calEmp='${staff[0]}';render()`);
t('Eén medewerker geeft precies één kolom',()=>{
  const n=qa('.cal-body .cal-col').length;
  return n===1||`${n} kolommen in plaats van 1`;
});
t('De kop toont de naam van die ene medewerker',()=>{
  const heads=qa('.cal-head .dow').map(x=>x.textContent.trim());
  const name=E(`employees.find(e=>e.id==='${staff[0]}').name`);
  return (heads.length===1&&heads[0]===name)||`koppen: ${heads.join(', ')}`;
});
t('Alleen afspraken van die medewerker staan er nog',()=>{
  const ids=qa('.event').map(e=>e.dataset.appt);
  const wrong=ids.filter(id=>E(`(appointments.find(a=>a.id==='${id}')||{}).emp`)!==staff[0]);
  return wrong.length===0||`${wrong.length} afspraken van iemand anders`;
});
t('De weekweergave laat dezelfde medewerker over',()=>{
  E("state.calView='week';render()");
  const ids=qa('.event').map(e=>e.dataset.appt);
  const wrong=ids.filter(id=>E(`(appointments.find(a=>a.id==='${id}')||{}).emp`)!==staff[0]);
  return wrong.length===0||`${wrong.length} afspraken van iemand anders`;
});
t('Het filter telt mee in het bolletje',()=>{
  const n=E('calFilterCount()');
  return n>=1||`telling staat op ${n}`;
});
t('Terug naar alle medewerkers geeft de kolommen terug',()=>{
  E("state.calView='day';state.calEmp='all';render()");
  const n=qa('.cal-body .cal-col').length;
  return n===allCols||`${n} kolommen in plaats van ${allCols}`;
});
t('Een medewerker die hier niet werkt geeft een uitleg, geen leeg raster',()=>{
  E("state.calView='day';state.calEmp='__niemand__';render()");
  const empty=d.querySelector('#view .empty');
  const cols=qa('.cal-body .cal-col').length;
  return (cols===0&&!!empty)||`${cols} kolommen, uitleg: ${!!empty}`;
});

g('Afspraakblokken');
E("state.calView='week';state.calEmp='all';state.calDate=TODAY;render()");
const evs=()=>[...d.querySelectorAll('.event')];

t('Elk blok draagt een toon uit de vaste set',()=>{
  const tones=['assess','manual','rehab','recovery','other','off','chore','note'];
  const bad=evs().filter(e=>!tones.some(t2=>e.classList.contains('ev-'+t2)));
  return bad.length===0||`${bad.length} blokken zonder toon`;
});
/* De kleur volgt sinds deze wijziging de medewerker, niet de behandeling:
   in een dagweergave met vier kolommen wil je zien van wie een blok is.
   Het icoon blijft wel van de behandelsoort — vandaar dat de oude
   toonklasse er nog op staat. */
t('De kleur volgt de medewerker',()=>{
  const bad=evs().filter(e=>e.classList.contains('appointment')).filter(e=>{
    const a=E(`appointments.find(x=>x.id==='${e.dataset.appt}')`);
    if(!a)return false;
    const want=E(`empColor('${a.emp}')`);
    return e.style.getPropertyValue('--ev-bg').trim()!==want[2]
        || e.style.getPropertyValue('--ev-ink').trim()!==want[3];
  });
  return bad.length===0||`${bad.length} blokken met de verkeerde kleur`;
});
t('Twee afspraken van dezelfde persoon zien er hetzelfde uit',()=>{
  const byEmp={};
  evs().filter(e=>e.classList.contains('appointment')).forEach(e=>{
    const a=E(`appointments.find(x=>x.id==='${e.dataset.appt}')`);
    if(!a)return;
    (byEmp[a.emp]=byEmp[a.emp]||[]).push(e.style.getPropertyValue('--ev-bg').trim());
  });
  const bad=Object.entries(byEmp).filter(([,v])=>new Set(v).size>1).map(([k])=>k);
  return bad.length===0||`wisselende kleur bij: ${bad.join(', ')}`;
});
t('Verschillende medewerkers krijgen verschillende kleuren',()=>{
  const tints=new Set(evs().filter(e=>e.classList.contains('appointment'))
    .map(e=>e.style.getPropertyValue('--ev-bg').trim()));
  return tints.size>=2||`maar ${tints.size} tint(en) in beeld`;
});
t('De behandelsoort bepaalt niet langer het vlak',()=>{
  /* Twee behandelingen uit dezelfde categorie bij verschillende mensen
     horen uit elkaar te lopen, niet samen te vallen. */
  const seen={};
  let split=false;
  evs().filter(e=>e.classList.contains('appointment')).forEach(e=>{
    const a=E(`appointments.find(x=>x.id==='${e.dataset.appt}')`);
    if(!a||!a.sid)return;
    const cat=E(`(services.find(s=>s.id==='${a.sid}')||{}).cat`);
    const bg=e.style.getPropertyValue('--ev-bg').trim();
    if(seen[cat]&&seen[cat]!==bg)split=true;
    seen[cat]=bg;
  });
  return split||'elke categorie heeft nog precies één kleur';
});
t('Een kleurwissel in Instellingen komt in de agenda terug',()=>{
  const was=E("employees.find(e=>e.id==='e1').color");
  E("employees.find(e=>e.id==='e1').color='sky';state.route='calendar';render()");
  const ev=[...d.querySelectorAll('.event.appointment')]
    .find(e=>E(`(appointments.find(x=>x.id==='${e.dataset.appt}')||{}).emp`)==='e1');
  const got=ev&&ev.style.getPropertyValue('--ev-bg').trim();
  E(`employees.find(e=>e.id==='e1').color='${was}';render()`);
  return got===E("EMP_COLORS.find(c=>c[0]==='sky')[2]")||`het blok bleef ${got}`;
});
t('Wat geen afspraak is krijgt geen medewerkerskleur',()=>{
  const bad=evs().filter(e=>['absence','blocked','chore','note'].some(k=>e.classList.contains(k)))
    .filter(e=>e.classList.contains('ev-emp'));
  return bad.length===0||`${bad.length} blokken toch ingekleurd`;
});
t('Wat geen behandeling is blijft kleurloos',()=>{
  const bad=evs().filter(e=>['absence','blocked','chore'].some(k=>e.classList.contains(k)))
    .filter(e=>!e.classList.contains('ev-off')&&!e.classList.contains('ev-chore'));
  return bad.length===0||`${bad.length} afwezigheden of klussen met een pastel`;
});
t('De behandeling staat bovenaan, met een icoon ervoor',()=>{
  const bad=evs().filter(e=>{
    const head=e.querySelector('.ev-head');
    return !head||!head.querySelector('.ev-ic svg')||!head.querySelector('.ev-t');
  });
  return bad.length===0||`${bad.length} blokken zonder kop`;
});
t('De kop noemt de behandeling, niet de klant',()=>{
  const bad=evs().filter(e=>{
    const a=E(`appointments.find(x=>x.id==='${e.dataset.appt}')`);
    if(!a||!a.service)return false;
    return !e.querySelector('.ev-t').textContent.trim().startsWith(a.service);
  });
  return bad.length===0||`${bad.length} blokken met de klant bovenaan`;
});
/* De regels komen erbij naarmate het blok hoger is. Een blok van een
   kwartier krijgt geen vier regels die er toch niet in passen. */
t('Regels komen er pas bij als het blok hoog genoeg is',()=>{
  const bad=[];
  evs().forEach(e=>{
    const h=parseInt(e.style.height,10);
    const app=e.classList.contains('appointment');
    const has=c=>!!e.querySelector(c);
    const time=[...e.querySelectorAll('.ev-line')].some(l=>/\d\d:\d\d/.test(l.textContent));
    if(h<54&&time)bad.push(`${h}px heeft al een tijdregel`);
    if(h>=54&&!time)bad.push(`${h}px mist de tijdregel`);
    if(app&&h>=72&&!has('.ev-line .ev-clip'))bad.push(`${h}px mist de klantregel`);
    if(h<124&&has('.ev-foot'))bad.push(`${h}px heeft al een voetregel`);
    if(app&&h>=124&&!has('.ev-foot'))bad.push(`${h}px mist de voetregel`);
  });
  return bad.length===0||bad.slice(0,3).join(' | ');
});
t('Een blok dat niet over een klant gaat krijgt geen klantregel',()=>{
  const bad=evs().filter(e=>!e.classList.contains('appointment'))
    .filter(e=>[...e.querySelectorAll('.ev-line')]
      .some(l=>l.querySelector('.ev-clip')&&!/^(after|then) /.test(l.textContent.trim())));
  return bad.length===0||`${bad.length} afwezigheden met een klantregel`;
});
t('Niets loopt buiten zijn blok',()=>{
  const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
  return /\.event\{[^}]*overflow:hidden/.test(css)||'het blok knipt niet af';
});

g('Vervolg- en combinatiebehandeling');
/* Twee behandelingen tegen elkaar aan op dezelfde klant. */
const seed=E(`(function(){
  const a=appointments.find(x=>x.kind==='appointment'&&x.cust);
  const b={...a,id:'chain-test',start:a.end,end:hhmm(mins(a.end)+30),
    service:'Blow dry',sid:'s3'};
  appointments.push(b); state.calDate=a.date; state.weekStart=weekStartOf(a.date);
  render(); return [a.id,b.id];
})()`);
t('Het eerste blok noemt wat erna komt',()=>{
  const e=d.querySelector(`[data-appt="${seed[0]}"] .ev-chain`);
  const first=d.querySelector(`[data-appt="${seed[0]}"]`);
  if(parseInt(first.style.height,10)<104)return true;   /* te klein voor die regel */
  return (e&&/then Blow dry/.test(e.textContent))||`regel leest ${e&&e.textContent.trim()}`;
});
t('Het vervolgblok noemt waar het bij hoort',()=>{
  const b=d.querySelector(`[data-appt="${seed[1]}"]`);
  if(!b)return 'het vervolg staat niet in de agenda';
  if(parseInt(b.style.height,10)<104)return true;
  const e=b.querySelector('.ev-chain');
  return (e&&/^after /.test(e.textContent.trim()))||`regel leest ${e&&e.textContent.trim()}`;
});
t('Beide blokken zijn als geschakeld gemarkeerd',()=>{
  const bad=seed.filter(id=>{
    const el=d.querySelector(`[data-appt="${id}"]`);
    return el&&!el.classList.contains('ev-linked');
  });
  return bad.length===0||`${bad.length} blokken zonder markering`;
});
t('Een losse afspraak is niet geschakeld',()=>{
  const solo=evs().find(e=>{
    const a=E(`appointments.find(x=>x.id==='${e.dataset.appt}')`);
    return a&&a.kind==='appointment'&&!seed.includes(a.id);
  });
  return !solo||!solo.classList.contains('ev-linked')||'een losse afspraak heet geschakeld';
});
E("appointments.splice(appointments.findIndex(a=>a.id==='chain-test'),1);render()");

g('De pagina onder de lade');
t('Er ligt een schaduw over de pagina zodra de lade opengaat',()=>{
  E("state.route='calendar';closePanel(true);render()");
  const sc=d.querySelector('#scrim');
  if(!sc)return 'geen schaduw in de opmaak';
  if(w.getComputedStyle(sc).opacity!=='0')return 'de schaduw ligt er al voordat de lade opengaat';
  d.querySelector('[data-panel="appointment"]').click();
  return w.getComputedStyle(sc).opacity==='1'||'de schaduw komt niet op';
});
t('Hij ligt onder de lade en boven de balken',()=>{
  const z=+w.getComputedStyle(d.querySelector('#scrim')).zIndex;
  const p=+w.getComputedStyle(d.querySelector('#panel')).zIndex;
  if(!(z<p))return `schaduw z${z}, lade z${p}`;
  return z>20||`schaduw z${z} ligt onder de bovenbalk`;
});
t('Hij vangt de klikken die voor de pagina bedoeld waren',()=>
  w.getComputedStyle(d.querySelector('#scrim')).pointerEvents==='auto'
    ||'je klikt er dwars doorheen');
t('Ernaast klikken sluit de lade',()=>{
  d.querySelector('#scrim').click();
  if(d.body.classList.contains('panel-open'))return 'de lade bleef open';
  return w.getComputedStyle(d.querySelector('#scrim')).opacity==='0'||'de schaduw bleef liggen';
});
t('Hij hoort bij elke lade, niet alleen bij de agenda',()=>{
  E("go('catalog');openPanel(PANELS.service(),'service')");
  const on=w.getComputedStyle(d.querySelector('#scrim')).opacity==='1';
  E("closePanel(true);go('calendar')");
  return on||'in de catalogus blijft de pagina onverlicht';
});

g('Add opent meteen de lade');
E("state.route='calendar';state.calView='day';closePanel(true);render()");
const add=()=>d.querySelector('[data-panel="appointment"]');
t('Er zit geen keuzemenu meer tussen',()=>{
  if(!add())return 'geen Add-knop';
  add().click();
  if(d.querySelector('.toolbar-cal .menu'))return 'het menu staat er nog';
  return d.body.classList.contains('panel-open')||'de lade ging niet open';
});
t('Eén klik en je staat in het formulier',()=>{
  const h=d.querySelector('.panel-head h2');
  if(!h||h.textContent.trim()!=='New appointment')return `kop leest ${h&&h.textContent.trim()}`;
  return !!d.querySelector('[data-af="cust"]')||'geen klantveld';
});
t('De twee zeldzame soorten staan als vinkje in de lade',()=>{
  const m=[...d.querySelectorAll('.appt-mode .t')].map(x=>x.textContent.trim());
  return m.join(' | ')==='Group appointment | Blocked time'||`vinkjes: ${m.join(', ')}`;
});
t('Een groep aanvinken wisselt het formulier om',()=>{
  d.querySelector('[data-apptmode="group"]').click();
  if(E("state.apptMode")!=='group')return `stand is ${E("state.apptMode")}`;
  if(!d.querySelector('[data-groupfield="cap"]'))return 'geen zitplaatsen';
  return !d.querySelector('[data-af="cust"]')||'het klantveld staat er nog';
});
t('Kop en knop lopen mee met de stand',()=>{
  const h=d.querySelector('.panel-head h2').textContent.trim();
  const b=d.querySelector('[data-panelsave]').textContent.trim();
  return (h==='Group appointment'&&b==='Book the group')||`kop ${h}, knop ${b}`;
});
t('De twee vinkjes sluiten elkaar uit',()=>{
  d.querySelector('[data-apptmode="blocked"]').click();
  if(E("state.apptMode")!=='blocked')return `stand is ${E("state.apptMode")}`;
  if(d.querySelector('[data-apptmode="group"]').checked)return 'beide vinkjes staan aan';
  return !!d.querySelector('[data-blockfield="reason"]')||'geen redenveld';
});
t('Uitvinken brengt je terug bij een gewone afspraak',()=>{
  d.querySelector('[data-apptmode="blocked"]').click();
  if(E("state.apptMode")!=='single')return `stand is ${E("state.apptMode")}`;
  return !!d.querySelector('[data-af="cust"]')||'het klantveld kwam niet terug';
});
t('Een nieuwe lade begint weer als gewone afspraak',()=>{
  d.querySelector('[data-apptmode="group"]').click();
  E('closePanel(true)');
  add().click();
  return E("state.apptMode")==='single'||`begon op ${E("state.apptMode")}`;
});
E('closePanel(true)');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},600);
