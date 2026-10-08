import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const deviceId=request.headers.get("x-r12-device-id"); const nonce=request.headers.get("x-r12-request-nonce"); const presentedAt=request.headers.get("x-r12-presented-at"); const authorization=request.headers.get("authorization");
  if(!deviceId||!nonce||!presentedAt||!authorization?.startsWith("Bearer "))return NextResponse.json({error:"Device authentication required"},{status:401,headers:noStore});
  let body:{credential?:unknown;credentialType?:unknown}; try{body=await request.json()}catch{return NextResponse.json({error:"Invalid request"},{status:400,headers:noStore})}
  if(typeof body.credential!=="string"||body.credential.length<1||body.credential.length>256||!(["legacy_member_reference","barcode","qr"] as unknown[]).includes(body.credentialType??"legacy_member_reference"))return NextResponse.json({error:"Invalid credential"},{status:400,headers:noStore});
  const {data,error}=await adminSupabase().rpc("club_device_access_decision",{p_device_id:deviceId,p_secret:authorization.slice(7),p_nonce:nonce,p_presented_at:presentedAt,p_credential:body.credential,p_credential_type:body.credentialType??"legacy_member_reference"});
  if(error){const status=error.code==="42501"?401:error.code==="23505"?409:error.code==="54000"?429:400;return NextResponse.json({error:status===429?"Too many requests":"Access request rejected"},{status,headers:noStore});}
  return NextResponse.json(data,{headers:noStore});
}
