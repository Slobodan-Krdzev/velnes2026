/* Zwevende schuifbalk: geen inheemse balk die breedte inneemt, één duimpje
   dat verschijnt tijdens het schuiven en vanzelf wegtrekt. */
const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const css=html.slice(html.indexOf('<style>'),html.indexOf('</style>'));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x.test/#calendar/day'});
const w=dom.window,d=w.document,q=s=>d.querySelector(s);
let pass=0,fail=0;
const t=(n,fn)=>{try{const r=fn();if(r===true||r===undefined){pass++;console.log('  pass  '+n)}
  else{fail++;console.log('  FAIL  '+n+' → '+r)}}catch(e){fail++;console.log('  FAIL  '+n+' → '+e.message)}};
const g=n=>console.log('\n'+n);

/* Een vlak dat schuift nabootsen: jsdom rekent geen layout uit. */
const fake=(el,{view,full,top,right,scrollTop})=>{
  Object.defineProperty(el,'scrollHeight',{value:full,configurable:true});
  Object.defineProperty(el,'clientHeight',{value:view,configurable:true});
  el.getBoundingClientRect=()=>({top,right,height:view,left:right-800,bottom:top+view,width:800});
  el.scrollTop=scrollTop;
  el.dispatchEvent(new w.Event('scroll'));
};

setTimeout(()=>{
g('Geen inheemse balk meer');
t('De balk neemt nergens breedte in',()=>{
  if(/::-webkit-scrollbar\{width:10px/.test(css))return 'de oude balk van 10px staat er nog';
  return /::-webkit-scrollbar\{width:0;height:0/.test(css)||'de balk is niet op nul gezet';
});
t('Ook Firefox en Edge krijgen er geen',()=>
  /\*\{scrollbar-width:none;-ms-overflow-style:none\}/.test(css)||'alleen webkit is afgedekt');
t('Er is geen strook meer gereserveerd langs de pagina',()=>
  !/scrollbar-gutter:stable/.test(css)||'scrollbar-gutter:stable staat er nog');

g('Het zwevende duimpje');
const body=q('.cal-body');
fake(body,{view:500,full:1200,top:200,right:1400,scrollTop:350});
const th=q('.sb-thumb');
t('Het verschijnt zodra er geschoven wordt',()=>
  (!!th&&th.classList.contains('on'))||'geen zichtbaar duimpje');
t('Er is er één, niet één per vlak',()=>
  d.querySelectorAll('.sb-thumb').length===1||`${d.querySelectorAll('.sb-thumb').length} duimpjes`);
t('De hoogte volgt hoeveel er in beeld past',()=>{
  const h=parseInt(th.style.height,10);
  const want=Math.round((500-8)*500/1200);
  return Math.abs(h-want)<=1||`${h}px, verwacht ${want}px`;
});
t('Het staat op de plek waar je gebleven bent',()=>{
  const m=/translate\((-?\d+)px,(-?\d+)px\)/.exec(th.style.transform);
  if(!m)return 'geen positie';
  const track=500-8, h=parseInt(th.style.height,10);
  const want=200+4+Math.round((track-h)*(350/(1200-500)));
  return (+m[2]===want)||`op ${m[2]}, verwacht ${want}`;
});
t('Het hangt tegen de rechterrand van dat vlak',()=>{
  const m=/translate\((-?\d+)px,/.exec(th.style.transform);
  return (+m[1]===1400-9)||`op ${m[1]}, verwacht ${1400-9}`;
});
t('Je kunt er dwars doorheen klikken',()=>
  w.getComputedStyle(th).pointerEvents==='none'||'het duimpje vangt de muis');
t('Het trekt vanzelf weg',()=>{
  if(!/hideTimer=setTimeout\(\(\)=>t\.classList\.remove\('on'\),\d+\)/.test(html))
    return 'er staat geen wegtrekker';
  return /transition:opacity/.test(css)||'het verdwijnt zonder overgang';
});
t('Past alles in beeld, dan blijft het weg',()=>{
  th.classList.remove('on');
  const side=q('.sidebar');
  fake(side,{view:400,full:400,top:0,right:74,scrollTop:0});
  return !th.classList.contains('on')||'het wijst naar een vlak dat niet schuift';
});
t('Het verhuist naar het vlak dat je schuift',()=>{
  fake(body,{view:500,full:1200,top:200,right:1400,scrollTop:0});
  const a=th.style.transform;
  fake(q('#view'),{view:600,full:2000,top:70,right:900,scrollTop:500});
  return a!==th.style.transform||'het bleef op het vorige vlak staan';
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
},700);
