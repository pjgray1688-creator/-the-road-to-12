"use client";
/* eslint-disable @next/next/no-img-element -- staff avatar hosts are dynamic; keep the optional photo path independent of remote-image configuration. */
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { browserSupabase } from "@/lib/supabase-browser";
import styles from "./club-identity-control.module.css";
export function ClubIdentityControl({firstName,fullName,photoUrl}:{firstName:string;fullName:string;photoUrl?:string}){
  const [open,setOpen]=useState(false);const pathname=usePathname();const [busy,setBusy]=useState(false);
  const endSession=async(mode:"lock"|"switch"|"signout")=>{setBusy(true);const clubSignIn="/account?app=club&mode=signIn&next=%2Fclub";try{await browserSupabase()?.auth.signOut({scope:"local"}).catch(()=>undefined);const response=await fetch("/api/club/session/end",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mode})});if(!response.ok)throw new Error();const result=await response.json();window.location.replace(result.locked?"/club/lock":clubSignIn);}catch{const client=browserSupabase();await client?.auth.signOut({scope:"local"}).catch(()=>undefined);window.location.replace(clubSignIn);}finally{setBusy(false);}};
  if(pathname==="/club/lock")return null;
  const initials=fullName.trim().split(/\s+/).slice(0,2).map(name=>name[0]?.toUpperCase()??"").join("")||firstName.slice(0,1).toUpperCase();
  return <div className={`${styles.host} club-native-identity-control`}><details open={open} onToggle={event=>setOpen(event.currentTarget.open)} className={styles.menu}><summary aria-label={`Signed in as ${fullName}`}><span className={styles.avatar}>{photoUrl?<img src={photoUrl} alt=""/>:initials}</span><span className={styles.name}>{firstName}</span><span aria-hidden="true" className={styles.chevron}>⌄</span></summary><div className={styles.popover}><p>Signed in as <strong>{fullName}</strong></p><button className="club-native-station-action" type="button" disabled={busy} onClick={()=>void endSession("lock")}>Lock Club</button><button className="club-native-station-action" type="button" disabled={busy} onClick={()=>void endSession("switch")}>Switch staff</button><Link href="/club/account" onClick={()=>setOpen(false)}>Account</Link><button type="button" disabled={busy} onClick={()=>void endSession("signout")}>Sign out</button></div></details></div>;
}
