/* Registratie & inloggen — de klassieke voordeur. Toetst: de start
   blijft onaangeraakt (geen inlogpoort voor de demo), beide routes
   bereikbaar, de wizard stap voor stap met eerlijke weigeringen,
   waarden die heen-en-terug overleven, de speldenprik via het lichte
   pad, indienen dat de intakerij compleet schrijft (met de
   gereserveerde SMTP-stoelen), en de verplichte HQ-verificatie met
   auditregel. */
const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync('/home/claude/velnes/index.html','utf8'),{runScripts:'dangerously',url:'http://x/',pretendToBeVisual:true});
const w=dom.window,d=w.document,E=x=>w.eval(x);
const q=s=>d.querySelector(s),qa=s=>[...d.querySelectorAll(s)];
const click=el=>el.dispatchEvent(new w.Event('click',{bubbles:true}));
const setF=(sel,v)=>{const el=q(sel);el.value=v;el.dispatchEvent(new w.Event('change',{bubbles:true}))};
let pass=0,fail=0;
const ok=(c,msg)=>{if(c){pass++}else{fail++;console.log('  FAIL ',msg)}};
setTimeout(()=>{try{

console.log('— De start is onaangeraakt: de demo opent gewoon —');
ok(E('state.route')!=='login','geen inlogpoort voor de demo bij openen');
ok(!!q('#view'),'de app hoort gewoon getekend te zijn');

console.log('— Beide routes bereikbaar, per adres en per menu —');
E(`lastHash=null;applyHash('login');render()`);
ok(q('#view').textContent.includes('Sign in to your salon workspace'),'#login hoort het inlogscherm te zijn');
ok(d.body.classList.contains('auth-mode'),'zonder schil: geen zijbalk om een loginscherm heen');
click(q('#view [data-gohash="registersalon"]'));
ok(E('state.route')==='registersalon'&&q('#view').textContent.includes('Create your salon'),
  'de wizard hoort vanaf het inlogscherm bereikbaar te zijn');
E(`lastHash=null;applyHash('home');render()`);
E(`state.envMenu=true;render()`);
ok(!!q('[data-gohash="login"]'),'Uitloggen hoort in het gebruikersmenu te staan');
E(`state.envMenu=false`);
E(`lastHash=null;applyHash('onboarding');state.ob=null;render()`);
ok(!!q('[data-gohash="registersalon"]'),'de AI-onboarding hoort de klassieke vorm te kennen');

console.log('— Inloggen: eerlijk prototype, echte controle —');
E(`lastHash=null;applyHash('login');render()`);
setF('[data-set="loginEmail"]','niemand@nergens.mk');
click(q('[data-loginsubmit]'));
ok(E('state.route')==='login','een onbekend adres hoort niet binnen te komen');
const knownEmail=E(`(employees.find(e=>e.status==='active'&&e.email)||{}).email`);
setF('[data-set="loginEmail"]',knownEmail);
click(q('[data-loginsubmit]'));
ok(E('state.route')==='home','een bekend adres hoort binnen te komen');
ok(E(`(employees.find(e=>e.id===session.userId)||{}).email`)===knownEmail,'en als zichzelf');

console.log('— De wizard: eerlijke weigeringen, stap voor stap —');
E(`state.reg=null;lastHash=null;applyHash('registersalon');render()`);
click(q('[data-regnext]'));
ok(q('#view').textContent.includes('name is missing'),'stap 1 hoort te weigeren met de reden erbij');
setF('[data-regf="acct.name"]','Test Eigenaar');
setF('[data-regf="acct.email"]','geengeldigadres');
setF('[data-regf="acct.pass"]','wachtwoord1');
click(q('[data-regnext]'));
ok(q('#view').textContent.includes('does not look right'),'een kapot e-mailadres hoort benoemd te worden');
setF('[data-regf="acct.email"]',knownEmail);
click(q('[data-regnext]'));
ok(q('#view').textContent.includes('already has an account'),'een bestaand adres hoort naar inloggen te wijzen');
setF('[data-regf="acct.email"]','nieuw@salonproef.mk');
click(q('[data-regnext]'));
ok(E('state.reg.step')===2,'met alles op orde hoort stap 2 open te gaan');
setF('[data-regf="salon.name"]','Salon Proef');
click(q('[data-regnext]'));
setF('[data-regf="legal.name"]','Salon Proef DOOEL Skopje');
setF('[data-regf="legal.taxId"]','MK4030099911223');
click(q('[data-regnext]'));
ok(E('state.reg.step')===4,'de juridische stap hoort de entiteit-intake te zijn en door te laten');

console.log('— De speld: adres is waarheid, de prik verfijnt — via het lichte pad —');
setF('[data-regf="loc.street"]','Proefstraat');
setF('[data-regf="loc.no"]','12');
setF('[data-regf="loc.city"]','Skopje');
click(q('[data-regnext]'));
ok(q('#view').textContent.includes('Place the pin'),'zonder prik hoort de stap te weigeren');
const dotBefore=q('[data-regpindot]');
E(`regPin(30,60);regPinLight()`);
ok(q('[data-regpindot]')===dotBefore,'het lichte pad hoort de speld te verplaatsen, niet te vervangen');
ok(q('[data-regpindot]').style.left==='30%'&&q('[data-regpindot]').style.top==='60%','en wel naar de prikplek');
ok(E('state.reg.loc.pinned')===true&&E('state.reg.loc.lat')>41&&E('state.reg.loc.lng')>21,
  'de prik hoort coördinaten af te leiden');
ok(q('[data-regcoords]').textContent.includes(String(E('state.reg.loc.lat'))),'de uitlezing hoort live mee te lopen');
click(q('[data-regnext]'));
ok(E('state.reg.step')===5,'mét prik hoort de stap door te laten');

console.log('— De catalogus: echt, gegroepeerd, doorzoekbaar via het lichte pad —');
click(q('[data-regnext]'));
ok(q('#view').textContent.includes('at least one service'),'zonder vinkje hoort stap 5 te weigeren');
ok(q('#view').textContent.includes('Manual therapy')&&q('#view').textContent.includes('Assessment'),
  'de échte categorieën horen er te staan');
ok(qa('[data-regpick]').length===E(`services.filter(s=>s.status==='active').length`),
  'elke actieve dienst hoort aan te vinken te zijn');
const sq=q('[data-regsvcq]');
sq.value='rehab tr'; sq.dispatchEvent(new w.Event('input',{bubbles:true}));
ok(q('[data-regsvcq]')===sq,'zoeken hoort het zoekveld te laten staan (het lichte pad)');
ok(qa('[data-regpick]').length===1,'spatie-ongevoelig zoeken hoort te filteren: '+qa('[data-regpick]').length);
sq.value=''; sq.dispatchEvent(new w.Event('input',{bubbles:true}));
{const cb=q('[data-regpick]');cb.checked=true;cb.dispatchEvent(new w.Event('change',{bubbles:true}))}
click(q('[data-regnext]'));

console.log('— De galerij: optioneel nu, nooit definitief —');
ok(E('state.reg.step')===6&&q('#view').textContent.includes('Add a photo'),'stap 6 hoort de galerij te zijn');
E(`reg().gallery.push({name:'wachtkamer.jpg',img:null});render()`);
ok(q('#view').textContent.includes('wachtkamer.jpg'),'een toegevoegde foto hoort als tegel te staan');
click(q('[data-reggaldel="0"]'));
ok(E('state.reg.gallery.length')===0,'weghalen hoort weg te halen');
click(q('[data-regnext]'));

console.log('— Team via e-mail, uren met gespleten diensten —');
ok(E('state.reg.step')===7,'stap 7 hoort team & uren te zijn');
ok(q('#view').textContent.includes('registers through their own e-mail'),
  'de uitnodiging-per-e-mail hoort benoemd te worden');
setF('[data-regf="team.0.name"]','Collega Een');
setF('[data-regf="team.0.email"]','geen-adres');
click(q('[data-regnext]'));
ok(q('#view').textContent.includes('does not look like an e-mail'),'een kapot uitnodigingsadres hoort te weigeren');
setF('[data-regf="team.0.email"]','collega@salonproef.mk');
click(q('[data-regteamadd]'));
ok(qa('[data-regf^="team."]').length===4,'een extra teamregel hoort erbij te komen');
click(qa('[data-regsplit]').find(b=>b.dataset.regsplit==='mon'));
ok(E('state.reg.hours.mon.split')===true&&!!q('[data-regf="hours.mon.open2"]'),
  'de gespleten dienst hoort een tweede blok te openen — zoals in de app');
setF('[data-regf="hours.mon.close"]','13:00');
setF('[data-regf="hours.mon.open2"]','15:30');
click(q('[data-regback]'));click(q('[data-regback]'));click(q('[data-regback]'));
ok(E('state.reg.step')===4&&q('[data-regf="loc.street"]').value==='Proefstraat',
  'terug hoort terug te zijn — mét de ingevulde waarden');
click(q('[data-regnext]'));click(q('[data-regnext]'));click(q('[data-regnext]'));click(q('[data-regnext]'));
ok(E('state.reg.step')===8,'de rit naar de samenvatting hoort vrij te zijn');
ok(q('#view').textContent.includes('invited by e-mail'),'de samenvatting hoort de e-mailuitnodiging te dragen');
click(qa('[data-regstep]').find(b=>b.dataset.regstep==='3'));
ok(E('state.reg.step')===3,'een Edit-link hoort op de juiste stap te landen');
E(`state.reg.step=8;render()`);

console.log('— Indienen: de intakerij compleet, met de gereserveerde SMTP-stoelen —');
const regB=E('registrations.length');
click(q('[data-regsubmit]'));
ok(E('registrations.length')===regB+1,'er hoort één registratie bij te komen');
const row=E(`JSON.parse(JSON.stringify(registrations[0]))`);
ok(row.status==='pending_review','de rij hoort op verificatie te wachten — HQ is de poort');
ok(row.emailToken&&row.emailSentAt===null&&row.emailVerifiedAt===null,
  'het e-mailtoken is gemunt; verzenden wacht op SMTP (de gereserveerde stoelen)');
ok(row.legal.name==='Salon Proef DOOEL Skopje'&&row.legal.taxId==='MK4030099911223',
  'de juridische entiteit hoort compleet in de intake te zitten');
ok(row.loc.lat&&row.loc.lng&&row.services.length>=1&&row.team.length===1,
  'prik, diensten en team horen mee te komen');
ok(E(`services.some(s=>s.id==='${row.services[0]}')`),'de gekozen dienst hoort een échte catalogus-id te zijn');
ok(row.team[0].inviteToken&&row.team[0].sentAt===null,
  'de uitnodiging hoort gemunt te zijn en op SMTP te wachten');
ok(row.hours.mon.split===true&&row.hours.mon.open2==='15:30',
  'de gespleten dienst hoort in de intake te zitten');
ok(q('#view').textContent.includes('HQ review')&&q('#view').textContent.includes('verifies every new'),
  'de bevestiging hoort de HQ-poort te benoemen');

console.log('— De poort: HQ verifieert elke salon, met auditregel —');
E(`lastHash=null;applyHash('home');go('hq');state.hqTab='customers';state.hqBiz=null;render()`);
ok(q('#view').textContent.includes('New registrations'),'de registraties horen bovenaan HQ-klanten te staan');
ok(q('#view').textContent.includes('Salon Proef')&&q('#view').textContent.includes('Awaiting SMTP'),
  'met de eerlijke e-mailstatus');
const auditB=E('auditLog.length');
click(q(`[data-regact="${row.id}"]`));
ok(E(`registrations.find(r=>r.id==='${row.id}').status`)==='active','activeren hoort te activeren');
ok(E('auditLog.length')===auditB+1&&E('auditLog[0].action')==='Salon registration activated',
  'en in het auditlog te staan');
ok(!q('#view').textContent.includes('New registrations'),'een lege wachtrij hoort te verdwijnen');

console.log('— De galerij in de werkplaats: altijd zichtbaar, altijd te bewerken —');
E(`lastHash=null;applyHash('home');go('settings');state.settingsTab='company';render()`);
ok(q('#view').textContent.includes('Gallery')&&q('#view').textContent.includes('Treatment room'),
  'de galerij hoort op Instellingen › Bedrijf te staan, gevuld');
const gb=E('salonGallery.length');
click(q('[data-galdel="g2"]'));
ok(E('salonGallery.length')===gb-1&&!q('#view').textContent.includes('Reception'),
  'weghalen hoort meteen zichtbaar te zijn');
ok(!!q('#view [data-galfile]'),'en toevoegen hoort er altijd te staan');

console.log(`\n${pass}/${pass+fail} geslaagd`);
process.exit(fail?1:0);
}catch(e){console.log('CRASH',e);process.exit(1)}},400);
