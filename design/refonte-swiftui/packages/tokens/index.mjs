
/** A presentation system; no cart, persistence, permissions or API rules. */
export const provenance=Object.freeze({repo:'GLWebDevAgency/snack-manager',ref:'2c879899adc0e7c3b98817ef76cf026ea5d22bf8',source:'packages/client-core/src/theme.ts'});
export const brand=Object.freeze({snackManager:'#c9a15a',preview:'#ed612e'});
export const functional=Object.freeze({ready:'#3fae4a',urgent:'#c94b3f',preparing:'#e0973f'});
export const light=Object.freeze({canvas:'#f5f5f3',surface:'#ffffff',secondary:'#eeefeb',ink:'#252723',muted:'#62685d',line:'#dfe2db',focus:'#245dc1',success:'#246936',successSoft:'#e8f5eb',warning:'#80500b',warningSoft:'#fff3dd',danger:'#aa3026',dangerSoft:'#fff0eb',info:'#285dab',infoSoft:'#eaf1fe',scrim:'rgba(20,24,20,.38)',glass:'rgba(255,255,255,.92)'});
export const dark=Object.freeze({canvas:'#161916',surface:'#232723',secondary:'#2e342d',ink:'#f5f7f2',muted:'#b2b9ac',line:'#4a5345',focus:'#a5c5ff',success:'#8fe2a0',successSoft:'#193722',warning:'#f1cb80',warningSoft:'#382c17',danger:'#ffb0a7',dangerSoft:'#402420',info:'#b5d0ff',infoSoft:'#1d2d45',scrim:'rgba(0,0,0,.64)',glass:'rgba(35,39,35,.96)'});
export const space=Object.freeze({xs:4,sm:8,md:12,lg:16,xl:24,xxl:32,xxxl:48});
export const radius=Object.freeze({field:12,button:12,card:20,sheet:28,pill:999});
export const density=Object.freeze({compact:Object.freeze({target:44,gap:8}),comfortable:Object.freeze({target:48,gap:12}),kitchen:Object.freeze({target:56,gap:16})});
export const typography=Object.freeze({web:'-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',native:'System',display:32,title:24,heading:20,body:16,label:14,caption:12});
export const motion=Object.freeze({press:90,hover:120,state:160,sheet:240,celebration:600,curve:'cubic-bezier(.2,.8,.2,1)'});
export function motionFor(reduced=false){return {...motion,...Object.fromEntries(Object.entries(motion).filter(([,v])=>typeof v==='number').map(([k,v])=>[k,reduced?0:v]))};}
export function rgb(hex){if(typeof hex!=='string'||!/^#[0-9a-f]{6}$/i.test(hex))throw new TypeError('Couleur attendue : #RRGGBB');return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);}
export function luminance(hex){const c=rgb(hex).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
export function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function onColor(hex){return contrast(hex,'#000000')>=contrast(hex,'#ffffff')?'#000000':'#ffffff';}
export function theme(mode='light',accent=brand.snackManager){if(!['light','dark'].includes(mode))throw new RangeError('Thème inconnu');rgb(accent);return {...(mode==='dark'?dark:light),accent,onAccent:onColor(accent)};}
export function cssVariables(mode='light',accent=brand.snackManager){return Object.entries(theme(mode,accent)).map(([k,v])=>`--sm-${k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}:${v}`).join(';');}
/** Adapter only; the existing client-core timer thresholds are untouched. */
export function legacyPalette(existing,mode,accent){const t=theme(mode,accent);return {...existing,bg:t.canvas,surface:t.surface,surface2:t.secondary,text:t.ink,mut:t.muted,line:t.line,green:functional.ready,red:functional.urgent,amber:functional.preparing,greenText:t.success,redText:t.danger,amberText:t.warning};}
