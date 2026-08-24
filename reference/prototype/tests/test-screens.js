/* Loopt de schermregistry af: unieke naam, uniek adres, en of een adres
   uit de hash terugleidt naar hetzelfde scherm. */
const fs=require('fs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const src=html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>'));

let hash='';
const el=()=>({style:{},classList:{add(){},remove(){},toggle(){},contains:()=>false},
  setAttribute(k,v){this[k]=v},getAttribute(k){return this[k]},removeAttribute(){},
  addEventListener(){},querySelector:()=>el(),querySelectorAll:()=>[],
  focus(){},closest:()=>null,innerHTML:'',textContent:'',dataset:{},hidden:true,children:[],
  appendChild(){},remove(){},insertBefore(){},contains:()=>false});
const doc={body:el(),documentElement:el(),
  querySelector:()=>el(),querySelectorAll:()=>[],getElementById:()=>el(),
  createElement:()=>el(),addEventListener(){},cookie:'',head:el()};
const win={addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}}),
  scrollTo(){},innerWidth:1440,localStorage:{getItem:()=>null,setItem(){}},
  location:{get hash(){return hash},set hash(v){hash=v.replace(/^#/,'')}}};
global.setTimeout=()=>{}; global.setInterval=()=>{}; global.clearTimeout=()=>{};
global.requestAnimationFrame=()=>{};

const fn=new Function('document','window','location','navigator','self','globalThis2',
  src+'\n;return {state,SCREENS,OVERLAYS,screenParts,screenHash,applyHash,render,go,'+
  'PANELS,openPanel,closePanel,openModal,closeModal,employees,customers,startBooking};');
const app=fn(doc,win,win.location,{userAgent:'node'},win,global);

const {state,SCREENS,OVERLAYS,screenParts,screenHash,applyHash}=app;

let pass=0,fail=0;
const ok=(c,m)=>{c?pass++:(fail++,console.log('  FAIL: '+m))};

/* Alle basisschermen die de registry kan aannemen. */
const cases=[];
const add=(setup,expectKey,expectName)=>cases.push({setup,expectKey,expectName});

/* De flightdeck stond nergens in deze lijst en is dus nooit door een
   toets gezien — precies zo kon hij ongemerkt in het bestand belanden.
   Vanaf nu telt hij gewoon mee. */
add(()=>{state.route='home'},'home','Overview');
add(()=>{state.route='calendar';state.calView='week'},'calendar/week','Calendar / Week');
add(()=>{state.route='calendar';state.calView='day'},'calendar/day','Calendar / Day');
add(()=>{state.route='invoices'},'invoices','Invoices');
add(()=>{state.route='about'},'about','About');
add(()=>{state.route='catimport'},'catimport/import','Catalog / Import');
['services','products','categories','combos'].forEach(t=>
  add(()=>{state.route='catalog';state.catTab=t},'catalog/'+t,null));
['discounts','offers','waiting','loyalty','premium','reviews','campaigns'].forEach(t=>
  add(()=>{state.route='marketing';state.marketingTab=t},'marketing/'+t,null));
['locations','sources','services','products','employees','vat'].forEach(t=>
  add(()=>{state.route='reports';state.reportTab=t},'reports/'+t,null));
['general','company','locations','team','roles','employees','calendar','booking',
 'marketplace','customers','sales','audit'].forEach(t=>
  add(()=>{state.route='settings';state.settingsTab=t;state.widgetId=null},'settings/'+t,null));
['customers','suppliers','team','search','audit'].forEach(t=>
  add(()=>{state.route='hq';state.hqTab=t},'hq/'+t,null));
['dashboard','customers','catalog','orders','promotions','academy','reports','settings'].forEach(t=>
  add(()=>{state.route='portal';state.poTab=t},'portal/'+t,null));
['suppliers','catalog','orders','deliveries','academy'].forEach(t=>
  add(()=>{state.route='suppliers';state.supTab=t;state.orderDraft=null;state.receiveId=null;
    state.orderView=null},'suppliers/'+t,null));
[1,2,3,4,5,6].forEach(n=>add(()=>{state.route='book';state.book={step:n};},null,null));
['source','accepted','reading','marketplace','widget','dashboard','ready','claim','verify','welcome']
  .forEach(st=>add(()=>{state.route='onboarding';state.ob=state.ob||{};state.ob.paused=false;state.ob.stage=st},
    'onboarding/'+st,null));
add(()=>{state.route='customers';state.param=null},'customers/list','Customers / List');
add(()=>{state.route='customers';state.param='c1';state.profileTab='sales'},
  'customers/profile/sales','Customers / Profile / Sales');
add(()=>{state.route='customers';state.param='c4';state.profileTab='activity'},
  'customers/profile/activity','Customers / Profile / Activity');
add(()=>{state.route='mobile';state.mobileUser=null},'mobile/login','Employee app / Sign in');
/* Nieuwe-vestiging-wizard: bewust geregistreerd — vijf stappen, elk met
   eigen sleutel en adres, net als de registratiewizard. */
[1,2,3,4,5].forEach(n=>add(()=>{state.route='newloc';
  state.nloc=state.nloc||{step:1};state.nloc.step=n},'newloc/'+n,null));
['agenda','pos','rank'].forEach(t=>add(()=>{state.route='mobile';
  state.mobileUser='e1';state.moSale=null;state.mobileTab=t},'mobile/'+t,null));

console.log('— Schermen: sleutel, naam en heen-en-weer via het adres —');
const seenKey=new Map(), seenName=new Map();
cases.forEach(c=>{
  c.setup();
  const p=screenParts();
  if(c.expectKey)ok(p.key===c.expectKey,`sleutel ${p.key} ≠ ${c.expectKey}`);
  if(c.expectName)ok(p.name===c.expectName,`naam "${p.name}" ≠ "${c.expectName}"`);
  ok(p.name.indexOf('/')>0||p.name.split(' / ').length>=1,'naam leeg: '+p.key);
  ok(!!p.name.trim(),'lege naam bij '+p.key);
  /* uniek */
  ok(!seenKey.has(p.key)||seenKey.get(p.key)===p.name,'sleutel dubbel: '+p.key);
  ok(!seenName.has(p.name)||seenName.get(p.name)===p.key,'naam dubbel: '+p.name);
  seenKey.set(p.key,p.name); seenName.set(p.name,p.key);
  /* adres terug */
  const h=screenHash();
  state.route='about'; state.param=null;
  applyHash(h);
  const back=screenParts();
  ok(back.key===p.key,`adres ${h} komt terug als ${back.key} i.p.v. ${p.key}`);
});

console.log('— Panelen en modals hebben een naam —');
Object.keys(app.PANELS).forEach(k=>{
  ok(!!OVERLAYS[k],'paneel zonder naam: '+k);
});
const names=Object.values(OVERLAYS);
ok(new Set(names).size===names.length,'dubbele overlaynaam');
ok(names.every(n=>n.indexOf(' / ')>0),'overlaynaam zonder hiërarchie');

console.log(`\n${pass}/${pass+fail} geslaagd — ${Object.keys(seenKey).length||seenKey.size} basisschermen, ${Object.keys(OVERLAYS).length} overlays`);
process.exit(fail?1:0);
