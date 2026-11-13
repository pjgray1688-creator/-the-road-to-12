import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import { ClubManagementOrders } from "@/components/club-management-orders";
import type { ManagementOrderRecord } from "@/app/club/shop/actions";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export const dynamic="force-dynamic";
export default async function ClubManagementOrdersPage({searchParams}:{searchParams?:Promise<{org?:string;member?:string}>}){
  const client=await serverSupabase();const {data:{user}}=await client.auth.getUser();if(!user)redirect("/account?app=club&mode=signIn");
  const params=await searchParams;const context=await resolveClubOrganisationContext(client,user.id,params?.org);
  if(!context||!(await context.repository.hasCapability(context.organisation.id,user.id,"finance.manage")))return <AppShell className="module-page club-page"><PageHeader title="Orders &amp; external payments"/><EmptyState title="Management access required">Customer order management is limited to authorised finance managers.</EmptyState><AppNav/></AppShell>;
  const [locationsResult,ordersResult,accountsResult]=await Promise.all([
    context.repository.listLocations(context.organisation.id),
    client.rpc("club_management_list_orders_secure",{p_organisation_id:context.organisation.id,p_search:null,p_status:null,p_location_id:null,p_limit:100}),
    client.rpc("club_management_list_payment_accounts_secure",{p_organisation_id:context.organisation.id}),
  ]);
  const locations=await Promise.all(locationsResult.filter(location=>location.active).map(async location=>{
    const {data,error}=await client.rpc("club_location_authorized",{p_organisation_id:context.organisation.id,p_location_id:location.id});
    return !error&&data===true?location:null;
  }));
  const allowedLocations=locations.filter((location):location is NonNullable<typeof location>=>Boolean(location));
  let initialMember;
  if(params?.member){
    const member=(await context.repository.listMemberSummaries(context.organisation.id)).find(item=>item.userId===params.member&&item.active);
    if(member)initialMember={id:member.id,displayName:member.displayName,...(member.email?{email:member.email}:{}),memberId:member.id};
  }
  const orders=ordersResult.error||!Array.isArray(ordersResult.data)?[]:ordersResult.data.map((raw)=>{
    const row=raw as Record<string,unknown>;const items=Array.isArray(row.items)?row.items:[];const payments=Array.isArray(row.payments)?row.payments:[];
    return{id:String(row.id),reference:String(row.reference),customerId:String(row.customer_id),customerName:String(row.customer_name??"Customer"),...(typeof row.customer_email==="string"?{customerEmail:row.customer_email}:{}),status:String(row.status),financialStatus:String(row.financial_status),totalMinor:Number(row.total_minor),confirmedMinor:Number(row.confirmed_minor),reservedMinor:Number(row.reserved_minor),outstandingMinor:Number(row.outstanding_minor),createdAt:String(row.created_at),...(typeof row.location_id==="string"?{locationId:row.location_id}:{}),...(typeof row.location_name==="string"?{locationName:row.location_name}:{}),items:items.map((item)=>{const value=item as Record<string,unknown>;return{productId:String(value.product_id),name:String(value.name),quantity:Number(value.quantity),unitPriceMinor:Number(value.unit_price_minor),lineTotalMinor:Number(value.line_total_minor)};}),payments:payments.map((payment)=>{const value=payment as Record<string,unknown>;return{id:String(value.id),amountMinor:Number(value.amount_minor),...(Number.isFinite(Number(value.processor_fee_minor))?{processorFeeMinor:Number(value.processor_fee_minor)}:{}),...(Number.isFinite(Number(value.settlement_amount_minor))?{settlementAmountMinor:Number(value.settlement_amount_minor)}:{}),...(typeof value.payment_account_id==="string"?{paymentAccountId:value.payment_account_id}:{}),currency:String(value.currency),method:String(value.method),...(typeof value.external_method==="string"?{externalMethod:value.external_method}:{}),...(typeof value.external_reference==="string"?{externalReference:value.external_reference}:{}),...(typeof value.receiving_account_label==="string"?{receivingAccountLabel:value.receiving_account_label}:{}),...(typeof value.received_at==="string"?{receivedAt:value.received_at}:{}),status:String(value.status),...(typeof value.verification_status==="string"?{verificationStatus:value.verification_status}:{}),...(typeof value.merchant_entity==="string"?{merchantEntity:value.merchant_entity}:{})};})} satisfies ManagementOrderRecord;
  });
  const paymentAccounts=!accountsResult.error&&Array.isArray(accountsResult.data)?accountsResult.data.map(raw=>{const row=raw as Record<string,unknown>;return{id:String(row.id),provider:String(row.provider),purpose:String(row.purpose),...(typeof row.external_account_reference==="string"?{externalAccountReference:String(row.external_account_reference)}:{})};}):[];
  if(!allowedLocations.length)return <AppShell className="module-page club-page"><PageHeader title="Orders & external payments"/><EmptyState title="No authorised venue">Your account has no active venue access for creating orders.</EmptyState><AppNav/></AppShell>;
  return <AppShell className="module-page club-page"><PageHeader title="Orders & external payments"/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>
    {ordersResult.error?<EmptyState title="Orders are unavailable">The secure order reporting operation is missing or unavailable. Apply the reviewed order-management migration before using this workspace.</EmptyState>:<ClubManagementOrders organisationId={context.organisation.id} locations={allowedLocations.map(location=>({id:location.id,name:location.name}))} paymentAccounts={paymentAccounts} products={[]} orders={orders} initialMember={initialMember} today={new Date().toISOString().slice(0,10)}/>}<AppNav/></AppShell>;
}
