'use client';
import type {ReactNode} from 'react';
import type {ProductPresentation,KitchenPresentation} from '@sm/design-presentation';
import {Artwork,Button,StatusBadge,Surface} from './primitives';
/** renderMedia preserves the existing crop, privacy and media fallback policies. */
export function ProductTile({product,onSelect,renderMedia}:{product:ProductPresentation;onSelect:()=>void;renderMedia?:()=>ReactNode}) {
 return <button type="button" className="sm-product" aria-pressed={product.selected} disabled={!product.available} onClick={onSelect}><span className="sm-product-media">{renderMedia?renderMedia():product.photoUrl?<img src={product.photoUrl} alt="" loading="lazy"/>:product.illustration?<Artwork name={product.illustration}/>:<span>Photo indisponible</span>}</span><span className="sm-product-copy"><strong>{product.name}</strong>{product.description?<span>{product.description}</span>:null}<span className="sm-product-price">{product.priceLabel}{!product.available?<StatusBadge>Indisponible</StatusBadge>:null}</span></span></button>;
}
export function TicketSummary({title,children,totals,actions}:{title:string;children:ReactNode;totals:readonly {label:string;value:string;emphasis?:boolean}[];actions:ReactNode}) {
 return <aside className="sm-ticket"><header><h2>{title}</h2></header><div className="sm-ticket-lines">{children}</div><footer>{totals.map((row,i)=><div className={row.emphasis?'sm-total sm-total--main':'sm-total'} key={i}><span>{row.label}</span><strong>{row.value}</strong></div>)}{actions}</footer></aside>;
}
export function KitchenTicket({ticket,actionLabel,onAction,tone='info'}:{ticket:KitchenPresentation;actionLabel?:string;onAction?:()=>void;tone?:'info'|'warning'|'success'|'danger'}) {
 return <article className={`sm-kitchen-ticket sm-kitchen-ticket--${tone}`}><header><h3>{ticket.numberLabel}</h3><StatusBadge tone={tone}>{ticket.timeLabel}</StatusBadge></header><p>{ticket.statusLabel}</p><ul>{ticket.lines.map(l=><li key={l.id}><strong>{l.quantityLabel}</strong><span><b>{l.name}</b>{l.details?<small>{l.details}</small>:null}</span></li>)}</ul>{ticket.note?<p className="sm-kitchen-note">{ticket.note}</p>:null}{onAction&&actionLabel?<Button phase={ticket.phase} onClick={onAction}>{actionLabel}</Button>:actionLabel?<p className="sm-kitchen-passive">{actionLabel}</p>:null}</article>;
}
export function LoyaltyPass({brandName,balanceLabel,description,code}:{brandName:string;balanceLabel:string;description:string;code:ReactNode}) {
 return <section className="sm-loyalty-pass"><p>{brandName}</p><strong>{balanceLabel}</strong><p>{description}</p><div className="sm-loyalty-code">{code}</div></section>;
}
export function MissionCard({numberLabel,status,address,details,actions}:{numberLabel:string;status:string;address:string;details?:ReactNode;actions:ReactNode}) {
 return <Surface title={numberLabel} actions={<StatusBadge>{status}</StatusBadge>}><div className="sm-mission"><p>{address}</p>{details}<div className="sm-action-row">{actions}</div></div></Surface>;
}
export interface Column<T> {key:string;heading:string;cell:(row:T)=>ReactNode;align?:'left'|'right'}
export function DataTable<T>({caption,columns,rows,rowKey}:{caption:string;columns:readonly Column<T>[];rows:readonly T[];rowKey:(row:T)=>string}) {
 return <div className="sm-table-scroll" tabIndex={0} role="region" aria-label={caption}><table><caption>{caption}</caption><thead><tr>{columns.map(c=><th scope="col" key={c.key} style={{textAlign:c.align??'left'}}>{c.heading}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={rowKey(r)}>{columns.map(c=><td key={c.key} style={{textAlign:c.align??'left'}}>{c.cell(r)}</td>)}</tr>)}</tbody></table>{rows.length===0?<p className="sm-table-empty">Aucun résultat</p>:null}</div>;
}
