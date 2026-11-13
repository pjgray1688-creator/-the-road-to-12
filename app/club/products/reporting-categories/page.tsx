import {redirect} from "next/navigation";
import {AppNav} from "@/components/app-nav";
import {ClubSectionNav} from "@/components/club-shell";
import {AppShell,EmptyState,PageHeader} from "@/components/ui";
import {ClubProductReportingCategories} from "@/components/club-product-reporting-categories";
import {serverSupabase} from "@/lib/supabase-server";
import {resolveClubOrganisationContext} from "@/lib/club-server-context";
import type {ProductReportingCategory} from "@/app/club/shop/actions";

export const dynamic="force-dynamic";
export default async function ProductReportingCategoriesPage({searchParams}:{searchParams?:Promise<{org?:string}>}){
 const client=await serverSupabase();const{data:{user}}=await client.auth.getUser();if(!user)redirect("/account?app=club&mode=signIn");const params=await searchParams;const context=await resolveClubOrganisationContext(client,user.id,params?.org);
 if(!context||!(await context.repository.hasCapability(context.organisation.id,user.id,"commerce.pricing_manage")))return <AppShell className="module-page club-page"><PageHeader title="Product reporting categories"/><EmptyState title="Product pricing access required">Only authorised catalogue managers can classify products.</EmptyState><AppNav/></AppShell>;
 const {data,error}=await client.rpc("club_management_list_reporting_products_secure",{p_organisation_id:context.organisation.id,p_search:null,p_limit:100});
 const products=!error&&Array.isArray(data)?data.map(raw=>{const row=raw as Record<string,unknown>;return{id:String(row.id),name:String(row.name),...(typeof row.sku==="string"?{sku:row.sku}:{}),category:String(row.reporting_category??"uncategorized") as ProductReportingCategory};}):[];
 return <AppShell className="module-page club-page"><PageHeader title="Product reporting categories"/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>{error?<EmptyState title="Catalogue unavailable">Secure product reporting categories are not available. Apply the reviewed Finance breakdown migration before editing categories.</EmptyState>:<ClubProductReportingCategories organisationId={context.organisation.id} initialProducts={products}/>}<AppNav/></AppShell>;
}
