
export type PresentationPhase='idle'|'loading'|'pending'|'uncertain'|'success'|'error'|'stale'|'denied'|'empty';
export interface ActionPresentation {disabled:boolean;busy:boolean;announcement:string}
export declare const phases:readonly PresentationPhase[];
export declare function actionPresentation(phase:PresentationPhase):ActionPresentation;
export declare function safeArtworkSource(input:{photoUrl?:string|null;illustration?:string|null}):{kind:'photo'|'illustration'|'empty';value:string|null};
export declare function boundedIndex(index:number,length:number,delta:number):number;
export interface ProductPresentation {id:string;name:string;description?:string;priceLabel:string;photoUrl?:string;illustration?:string;available:boolean;selected?:boolean}
export interface KitchenPresentation {id:string;numberLabel:string;statusLabel:string;timeLabel:string;lines:readonly {id:string;quantityLabel:string;name:string;details?:string}[];note?:string;phase:PresentationPhase}
