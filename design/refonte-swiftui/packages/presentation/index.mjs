
/** No network, money calculation, persistence or business transitions. */
export const phases=Object.freeze(['idle','loading','pending','uncertain','success','error','stale','denied','empty']);
export function actionPresentation(phase){
 if(!phases.includes(phase))throw new RangeError('État de présentation inconnu');
 return {disabled:['loading','pending','uncertain','denied'].includes(phase),busy:['loading','pending'].includes(phase),announcement:{uncertain:'Résultat à vérifier. Ne relancez pas une nouvelle opération.',pending:'Opération en cours.',error:'L’opération a échoué.',stale:'Informations à actualiser.',denied:'Action non autorisée.'}[phase]??''};
}
export function safeArtworkSource({photoUrl,illustration}){
 if(photoUrl)return{kind:'photo',value:photoUrl};
 return illustration?{kind:'illustration',value:illustration}:{kind:'empty',value:null};
}
export function boundedIndex(index,length,delta){if(!Number.isInteger(length)||length<1)throw new RangeError('Choix vides');return((index+delta)%length+length)%length;}
