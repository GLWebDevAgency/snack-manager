import {createContext,useContext,useMemo,useEffect,useState,useRef,useId,type ReactNode} from 'react';
import {AccessibilityInfo,Animated,Image,Pressable,ScrollView,Text,TextInput,View,useColorScheme,type PressableProps,type TextInputProps,type ViewStyle,type StyleProp} from 'react-native';
import {SvgXml} from 'react-native-svg';
import {theme,space,radius,motion,type Mode} from '@sm/design-tokens';
import {renderIcon,type IconName} from '@sm/design-icons';
import {renderArtwork} from '@sm/design-assets';
import {actionPresentation,type PresentationPhase,type ProductPresentation,type KitchenPresentation} from '@sm/design-presentation';

type Theme=ReturnType<typeof theme>;
const ThemeContext=createContext<Theme>(theme());
export function ThemeProvider({mode,accent,children}:{mode?:Mode;accent?:string;children:ReactNode}) {
 const system=useColorScheme();const value=useMemo(()=>theme(mode??(system==='dark'?'dark':'light'),accent),[mode,system,accent]);
 return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(){return useContext(ThemeContext);}
export function useReducedMotion(){
 const [reduced,setReduced]=useState(true);
 useEffect(()=>{let active=true;AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(active)setReduced(v);}).catch(()=>{});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);return()=>{active=false;sub.remove();};},[]);
 return reduced;
}
export function Icon({name,size=20,color,label}:{name:IconName;size?:number;color?:string;label?:string}) {
 const t=useTheme();return <View accessible={Boolean(label)} accessibilityRole={label?'image':undefined} accessibilityLabel={label} importantForAccessibility={label?'auto':'no-hide-descendants'}><SvgXml xml={renderIcon(name)} width={size} height={size} color={color??t.ink}/></View>;
}
export function Artwork({name,label,height=140}:{name:string;label?:string;height?:number}) {
 const id='art-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');const xml=useMemo(()=>renderArtwork(name,id),[name,id]);
 return <View accessible={Boolean(label)} accessibilityRole={label?'image':undefined} accessibilityLabel={label} importantForAccessibility={label?'auto':'no-hide-descendants'} style={{height,alignItems:'center'}}><SvgXml xml={xml} width="100%" height="100%"/></View>;
}
export interface ButtonProps extends Omit<PressableProps,'children'|'style'> {label:string;tone?:'primary'|'secondary'|'danger'|'quiet';phase?:PresentationPhase;icon?:IconName;style?:StyleProp<ViewStyle>;minHeight?:number}
export function Button({label,tone='secondary',phase='idle',icon,disabled,style,minHeight=48,onPressIn,onPressOut,...props}:ButtonProps) {
 const t=useTheme(),reduced=useReducedMotion(),scale=useRef(new Animated.Value(1)).current;const p=actionPresentation(phase),blocked=Boolean(disabled||p.disabled);
 const background=tone==='primary'?t.accent:tone==='danger'?t.dangerSoft:tone==='quiet'?'transparent':t.surface;
 const color=tone==='primary'?t.onAccent:tone==='danger'?t.danger:t.ink;
 const animate=(value:number)=>{scale.stopAnimation();Animated.timing(scale,{toValue:value,duration:reduced?0:motion.press,useNativeDriver:true}).start();};
 useEffect(()=>()=>scale.stopAnimation(),[scale]);
 return <Pressable {...props} disabled={blocked} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel??label} accessibilityState={{...props.accessibilityState,disabled:blocked,busy:p.busy}} onPressIn={e=>{animate(.985);onPressIn?.(e);}} onPressOut={e=>{animate(1);onPressOut?.(e);}} style={style}><Animated.View style={{minHeight:Math.max(44,minHeight),paddingHorizontal:16,paddingVertical:12,borderRadius:radius.button,borderCurve:'continuous',backgroundColor:background,borderWidth:tone==='primary'||tone==='quiet'?0:1,borderColor:t.line,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center',opacity:blocked?.55:1,transform:[{scale}]}}>{icon?<Icon name={icon} color={color}/>:null}<Text style={{color,fontSize:14,fontWeight:'600',flexShrink:1,textAlign:'center'}}>{label}</Text></Animated.View></Pressable>;
}
export function Surface({children,style}:{children:ReactNode;style?:StyleProp<ViewStyle>}) {
 const t=useTheme();return <View style={[{backgroundColor:t.surface,borderRadius:radius.card,borderCurve:'continuous',borderWidth:1,borderColor:t.line,padding:space.lg},style]}>{children}</View>;
}
export function StatusBadge({label,tone='info'}:{label:string;tone?:'info'|'warning'|'danger'|'success'}) {
 const t=useTheme();return <View style={{paddingHorizontal:10,paddingVertical:5,borderRadius:8,backgroundColor:t[`${tone}Soft`],alignSelf:'flex-start'}}><Text style={{color:t[tone],fontSize:12,fontWeight:'600'}}>{label}</Text></View>;
}
export function Notice({title,message,tone='info'}:{title:string;message:string;tone?:'info'|'warning'|'danger'|'success'}) {
 const t=useTheme();return <View accessibilityRole="alert" accessibilityLiveRegion={tone==='danger'?'assertive':'polite'} style={{backgroundColor:t[`${tone}Soft`],borderRadius:12,padding:16,gap:6}}><Text selectable style={{color:t[tone],fontSize:16,fontWeight:'600'}}>{title}</Text><Text selectable style={{color:t[tone],fontSize:14,lineHeight:21}}>{message}</Text></View>;
}
export function TextField({label,error,hint,style,...props}:TextInputProps&{label:string;error?:string;hint?:string}) {
 const t=useTheme();return <View style={{gap:6}}><Text style={{fontSize:14,fontWeight:'600',color:t.ink}}>{label}</Text><TextInput {...props} accessibilityLabel={props.accessibilityLabel??label} accessibilityHint={error??hint??props.accessibilityHint} placeholderTextColor={t.muted} style={[{minHeight:48,fontSize:16,color:t.ink,backgroundColor:t.surface,borderWidth:1,borderColor:error?t.danger:t.line,borderRadius:12,padding:12},style]}/>{error||hint?<Text selectable style={{fontSize:12,color:error?t.danger:t.muted}}>{error??hint}</Text>:null}</View>;
}
export function SegmentedControl({label,options,value,onChange}:{label:string;options:readonly {value:string;label:string;disabled?:boolean}[];value:string;onChange:(v:string)=>void}) {
 const t=useTheme();return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{flexDirection:'row',gap:4,padding:4,borderRadius:14,backgroundColor:t.secondary}}>{options.map(o=><Pressable key={o.value} disabled={o.disabled} accessibilityRole="radio" accessibilityState={{checked:value===o.value,disabled:o.disabled}} onPress={()=>onChange(o.value)} style={{flex:1,minHeight:44,justifyContent:'center',alignItems:'center',paddingHorizontal:8,paddingVertical:10,borderRadius:10,backgroundColor:value===o.value?t.surface:'transparent',opacity:o.disabled?.5:1}}><Text style={{color:t.ink,fontSize:14,fontWeight:value===o.value?'600':'400',textAlign:'center'}}>{o.label}</Text></Pressable>)}</View>;
}
export function Stepper({label,value,onDecrement,onIncrement,canDecrement=true,canIncrement=true,disabled=false}:{label:string;value:string;onDecrement:()=>void;onIncrement:()=>void;canDecrement?:boolean;canIncrement?:boolean;disabled?:boolean}) {
 const t=useTheme();return <View style={{flexDirection:'row',alignItems:'center',gap:12}}><Button label="−" accessibilityLabel={`Diminuer ${label}`} onPress={onDecrement} disabled={disabled||!canDecrement}/><Text style={{fontVariant:['tabular-nums'],fontSize:16,color:t.ink}}>{value}</Text><Button label="+" accessibilityLabel={`Augmenter ${label}`} onPress={onIncrement} disabled={disabled||!canIncrement}/></View>;
}
/** Presentation frame only: keep existing Modal/Drawer focus, back and safe-area controllers. */
export function SheetFrame({title,children,footer,onClose,blockDismiss=false,bottomInset=0}:{title:string;children:ReactNode;footer?:ReactNode;onClose:()=>void;blockDismiss?:boolean;bottomInset?:number}) {
 const t=useTheme();return <View style={{maxHeight:'100%',backgroundColor:t.surface,borderRadius:radius.sheet,borderCurve:'continuous',overflow:'hidden'}}><View style={{padding:20,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:1,borderColor:t.line}}><Text accessibilityRole="header" style={{flex:1,color:t.ink,fontSize:24,fontWeight:'600'}}>{title}</Text><Button label="Fermer" onPress={onClose} disabled={blockDismiss}/></View><ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{padding:20,gap:16}}>{children}</ScrollView>{footer?<View style={{padding:20,paddingBottom:Math.max(20,bottomInset),borderTopWidth:1,borderColor:t.line}}>{footer}</View>:null}</View>;
}
export function EmptyState({title,description,action}:{title:string;description:string;action?:ReactNode}) {
 const t=useTheme();return <View style={{padding:32,alignItems:'center',gap:16}}><Icon name="box" size={32}/><Text accessibilityRole="header" style={{color:t.ink,fontSize:20,fontWeight:'600',textAlign:'center'}}>{title}</Text><Text selectable style={{color:t.muted,fontSize:16,lineHeight:24,textAlign:'center'}}>{description}</Text>{action}</View>;
}
export function Skeleton({label='Chargement'}:{label?:string}) {
 const t=useTheme();return <View accessibilityRole="progressbar" accessibilityLabel={label} style={{gap:10,padding:20}}>{[90,65,80].map((w,i)=><View key={i} style={{width:`${w}%`,height:18,backgroundColor:t.secondary,borderRadius:8}}/>)}</View>;
}
export function ProductTile({product,onSelect,renderMedia}:{product:ProductPresentation;onSelect:()=>void;renderMedia?:()=>ReactNode}) {
 const t=useTheme();return <Pressable onPress={onSelect} disabled={!product.available} accessibilityRole="button" accessibilityLabel={`${product.name}, ${product.priceLabel}${product.available?'':', indisponible'}`} accessibilityState={{selected:product.selected,disabled:!product.available}}><Surface style={{padding:8,opacity:product.available?1:.6}}>{renderMedia?renderMedia():product.photoUrl?<Image source={{uri:product.photoUrl}} style={{height:140,width:'100%',borderRadius:12}} resizeMode="contain"/>:product.illustration?<Artwork name={product.illustration}/>:<Text style={{color:t.muted}}>Photo indisponible</Text>}<View style={{padding:8,gap:6}}><Text style={{color:t.ink,fontSize:16,fontWeight:'600'}}>{product.name}</Text>{product.description?<Text style={{color:t.muted,fontSize:13}}>{product.description}</Text>:null}<Text style={{color:t.ink,fontSize:18,fontWeight:'600',fontVariant:['tabular-nums']}}>{product.priceLabel}</Text></View></Surface></Pressable>;
}
export function KitchenTicket({ticket,actionLabel,onAction,tone='info'}:{ticket:KitchenPresentation;actionLabel?:string;onAction?:()=>void;tone?:'info'|'warning'|'danger'|'success'}) {
 const t=useTheme();return <Surface style={{gap:16}}><View style={{flexDirection:'row',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><Text style={{color:t.ink,fontSize:28,fontWeight:'700',fontVariant:['tabular-nums']}}>{ticket.numberLabel}</Text><StatusBadge label={ticket.timeLabel} tone={tone}/></View><Text style={{color:t.muted,fontSize:14}}>{ticket.statusLabel}</Text>{ticket.lines.map(l=><View key={l.id} style={{flexDirection:'row',gap:12}}><Text style={{color:t.ink,fontSize:18,fontWeight:'700'}}>{l.quantityLabel}</Text><View style={{flex:1,gap:4}}><Text style={{color:t.ink,fontSize:18,fontWeight:'600'}}>{l.name}</Text>{l.details?<Text style={{color:t.muted,fontSize:14}}>{l.details}</Text>:null}</View></View>)}{ticket.note?<Notice title="Note" message={ticket.note} tone="warning"/>:null}{onAction&&actionLabel?<Button label={actionLabel} onPress={onAction} phase={ticket.phase} minHeight={56}/>:actionLabel?<Text style={{color:t.muted,fontSize:16}}>{actionLabel}</Text>:null}</Surface>;
}
export function TicketSummary({title,children,totals,actions}:{title:string;children:ReactNode;totals:readonly {label:string;value:string;emphasis?:boolean}[];actions:ReactNode}) {
 const t=useTheme();return <View style={{flex:1,backgroundColor:t.surface}}><Text accessibilityRole="header" style={{padding:20,color:t.ink,fontSize:24,fontWeight:'600'}}>{title}</Text><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:20,gap:12}}>{children}</ScrollView><View style={{padding:20,gap:14,borderTopWidth:1,borderColor:t.line}}>{totals.map((r,i)=><View key={i} style={{flexDirection:'row',justifyContent:'space-between',gap:12}}><Text style={{color:t.ink,fontSize:r.emphasis?20:14}}>{r.label}</Text><Text style={{color:t.ink,fontSize:r.emphasis?24:14,fontWeight:'600',fontVariant:['tabular-nums']}}>{r.value}</Text></View>)}{actions}</View></View>;
}

/** No synthetic balance, QR payload or mission state is produced by these frames. */
export function LoyaltyPass({brandName,balanceLabel,description,code}:{brandName:string;balanceLabel:string;description:string;code:ReactNode}) {
 const t=useTheme();return <Surface style={{gap:16,padding:24}}><Text style={{color:t.muted,fontSize:16}}>{brandName}</Text><Text selectable style={{color:t.ink,fontSize:40,fontWeight:'700',fontVariant:['tabular-nums']}}>{balanceLabel}</Text><Text selectable style={{color:t.muted,fontSize:16,lineHeight:24}}>{description}</Text><View>{code}</View></Surface>;
}
export function MissionCard({numberLabel,status,address,details,actions}:{numberLabel:string;status:string;address:string;details?:ReactNode;actions:ReactNode}) {
 const t=useTheme();return <Surface style={{gap:16}}><View style={{flexDirection:'row',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><Text accessibilityRole="header" style={{fontSize:24,fontWeight:'700',color:t.ink}}>{numberLabel}</Text><StatusBadge label={status}/></View><Text selectable style={{fontSize:18,lineHeight:26,color:t.ink}}>{address}</Text>{details}<View style={{gap:12}}>{actions}</View></Surface>;
}
