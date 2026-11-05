"use client";

import { useState,useTransition } from "react";
import { updateMadhouseApparelOrder } from "@/app/club/website-shop/orders/actions";
import styles from "./club-madhouse-apparel-orders.module.css";

type Dict=Record<string,unknown>;
export type ClubApparelOrder={order?:Dict;details?:Dict;items?:Dict[];activity?:Dict[]};
const money=(value:unknown)=>`£${(Number(value??0)/100).toFixed(2)}`;
const date=(value:unknown)=>typeof value==="string"?new Date(value).toLocaleString("en-GB"):"—";
const statusLabel=(value:unknown)=>String(value??"unknown").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());
const address=(value:unknown)=>{if(!value||typeof value!=="object")return "—";const x=value as Dict;return [x.line1,x.line2,x.town,x.county,x.postcode,"United Kingdom"].filter(Boolean).join(", ");};

export function ClubMadhouseApparelOrders({organisationId,orders,initialOrderId}:{organisationId:string;orders:ClubApparelOrder[];initialOrderId?:string}){
  const [message,setMessage]=useState("");
  const newCount=orders.filter(x=>x.details?.fulfilment_status==="new_order").length;
  return <section className={styles.orders}>
    <header className={styles.summary}><div><strong>{orders.length}</strong><span>Total Apparel orders</span></div><div><strong>{newCount}</strong><span>New orders to action</span></div><p>Payments are marked paid only after the signed Stripe webhook confirms them.</p></header>
    {!orders.length?<div className={styles.empty}><h2>No website orders yet</h2><p>Paid Madhouse Apparel orders will appear here after Stripe sends a verified payment event.</p></div>:orders.map((entry,index)=>{
      const order=entry.order??{};const detail=entry.details??{};const items=Array.isArray(entry.items)?entry.items:[];const activity=Array.isArray(entry.activity)?entry.activity:[];
      const id=String(order.id??detail.order_id??index);const status=String(detail.fulfilment_status??"new_order");
      return <OrderCard key={id} organisationId={organisationId} order={order} detail={detail} items={items} payments={Array.isArray(entry.payments)?entry.payments:[]} activity={activity} status={status} onMessage={setMessage} initiallyOpen={id===initialOrderId}/>;
    })}
    {message&&<p role="status" className={styles.feedback}>{message}</p>}
  </section>;
}

function OrderCard({organisationId,order,detail,items,payments,activity,status,onMessage,initiallyOpen}:{organisationId:string;order:Dict;detail:Dict;items:Dict[];payments:Dict[];activity:Dict[];status:string;onMessage:(v:string)=>void;initiallyOpen:boolean}){
  const [open,setOpen]=useState(initiallyOpen);const [next,setNext]=useState(status==="new_order"?"in_production":status);const [courier,setCourier]=useState("");const [tracking,setTracking]=useState("");const [url,setUrl]=useState("");const [pending,start]=useTransition();
  const id=String(order.id??detail.order_id??"");
  const save=()=>start(async()=>{const result=await updateMadhouseApparelOrder({organisationId,orderId:id,status:next,courier,trackingNumber:tracking,trackingUrl:url});onMessage(result.ok?"Order status updated.":result.error);});
  return <article className={styles.card} id={id}>
    <button className={styles.cardHead} type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><span><strong>{String(detail.order_number??"Madhouse order")}</strong><small>{String(detail.customer_first_name??"")} {String(detail.customer_surname??"")} · {date(order.created_at)}</small></span><span><b>{money(order.total_minor)}</b><small>{statusLabel(detail.fulfilment_status)}</small></span><span className={styles.payment}>{statusLabel(order.status)}</span><span className={styles.itemCount}>{items.reduce((n,item)=>n+Number(item.quantity??0),0)} items</span><i aria-hidden="true">{open?"−":"+"}</i></button>
    {open&&<div className={styles.detail}>
      <div className={styles.columns}><section><h3>Customer</h3><p>{String(detail.customer_first_name??"")} {String(detail.customer_surname??"")}<br/><a href={`mailto:${String(detail.customer_email??"")}`}>{String(detail.customer_email??"")}</a><br/>{String(detail.customer_phone??"")}</p></section><section><h3>Delivery</h3><p>{address(detail.delivery_address)}</p></section><section><h3>Billing</h3><p>{detail.billing_same_as_delivery===true?"Same as delivery":address(detail.billing_address)}</p></section></div>
      <h3>Purchased garments</h3><div className={styles.lines}>{items.map((item,i)=><div key={String(item.id??i)}><span><strong>{String(item.product_name??"Apparel")}</strong><small>{String(item.variant_colour??"")} · {String(item.variant_size??"")} · Qty {String(item.quantity??0)}{Number(item.discount_minor)>0?` · Offer −${money(item.discount_minor)}`:""}</small></span><span>{money(item.line_total_minor)}</span></div>)}</div>
      <div className={styles.paymentDetails}><span>Subtotal <b>{money(order.subtotal_minor)}</b></span><span>Promotion <b>{Number(order.discount_minor)>0?`−${money(order.discount_minor)}`:"—"}</b></span><span>UK delivery <b>{money(detail.delivery_minor)}</b></span><span>Total paid <b>{money(order.total_minor)}</b></span><span>Stripe reference <b>{String(payments[0]?.external_reference??"Unavailable")}</b></span></div>
      {(detail.courier||detail.tracking_number||detail.tracking_url)&&<p className={styles.tracking}>Tracking: {[detail.courier,detail.tracking_number].filter(Boolean).join(" · ")} {typeof detail.tracking_url==="string"&&detail.tracking_url.startsWith("https://")?<a href={detail.tracking_url} target="_blank" rel="noreferrer">Open tracking</a>:null}</p>}
      {!['cancelled','refunded'].includes(status)&&<section className={styles.fulfilment}><h3>Update fulfilment</h3><div><label>Status<select value={next} onChange={e=>setNext(e.target.value)}>{[["in_production","In production"],["ready_to_dispatch","Produced / ready to dispatch"],["dispatched","Dispatched"],["delivered","Delivered"]].map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>{next==="dispatched"&&<><label>Courier<input value={courier} onChange={e=>setCourier(e.target.value)} required/></label><label>Tracking number<input value={tracking} onChange={e=>setTracking(e.target.value)} required/></label><label>Tracking URL<input type="url" value={url} onChange={e=>setUrl(e.target.value)} required placeholder="https://…"/></label></>}<button type="button" className="primary" onClick={save} disabled={pending}>{pending?"Saving…":"Save status"}</button></div></section>}
      <section className={styles.history}><h3>Order history</h3>{activity.map((event,i)=><p key={String(event.id??i)}><strong>{statusLabel(event.activity_type)}</strong><span>{statusLabel(event.from_status)}{event.from_status?" → ":""}{statusLabel(event.to_status)} · {date(event.created_at)}</span></p>)}</section>
    </div>}
  </article>;
}
