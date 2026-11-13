import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveOrganisationTheme } from "@/lib/club";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { ClubShop } from "@/components/club-shop";
import { ClubStaffCheckout } from "@/components/club-staff-checkout";
import { ClubStockPanel } from "@/components/club-stock-panel";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubShopTabs } from "@/components/club-shop-tabs";
import { ClubDeliveryHistory } from "@/components/club-delivery-history";
import { ClubBalanceTopUp } from "@/components/club-balance-top-up";
import { ClubStockRemoval } from "@/components/club-stock-removal";
import { groupProductFamilies, memberVariantChoices, type ClubProductFamily } from "@/lib/club-product-families";
import { buildClubShopProductUniverse, type DurableSupplierParentRow } from "@/lib/club-supplier-catalogue";
import { mapPromotionRecord } from "@/lib/club-promotions";
import { supplierRowsToDurableRows } from "@/lib/club-supplier-catalogue";
import { isReceptionProductEligible, supplierOrderable } from "@/lib/club-member-availability";
import { productImageUrl, sharedProductImage } from "@/components/club-product-media";
import { isProductOnChannel } from "@/lib/club-commerce";
import { ClubRecentSales, type RecentSale } from "@/components/club-recent-sales";
import { ClubTillClose } from "@/components/club-till-close";
import { ClubCashDeclarationReview } from "@/components/club-cash-declaration-review";
import type { RefundableLine } from "@/lib/club-refund-allocation";

async function loadShop(client: Awaited<ReturnType<typeof serverSupabase>>, userId: string, organisationId: string | undefined, locationId: string | undefined, view: string) {
  const context = await resolveClubOrganisationContext(client, userId, organisationId);
  if (!context) return undefined;
  const { repository, organisation, member } = context;
  const staff = ["trainer", "gym_staff", "gym_admin", "owner"].includes(member.role);
  const catalogueView = view === "sell" || view === "stock";
  const isCashView = view === "cash" || view === "cash-review";
  const [canRecordCash, canReconcile, canIssueRefund, canApproveRefund, canViewTillLog] = staff ? await Promise.all([
    view === "sell" ? repository.hasCapability(organisation.id, userId, "payments.record_cash") : Promise.resolve(false),
    isCashView ? repository.hasCapability(organisation.id, userId, "cash.reconcile") : Promise.resolve(false),
    isCashView ? repository.hasCapability(organisation.id, userId, "refunds.issue") : Promise.resolve(false),
    isCashView ? repository.hasCapability(organisation.id, userId, "refunds.approve") : Promise.resolve(false),
    isCashView ? repository.hasCapability(organisation.id, userId, "members.view") : Promise.resolve(false),
  ]) : [false, false, false, false, false];
  const [localProducts, locations, balance, orders, declarations, customers, deliveries, promotionRows, supplierRows] = await Promise.all([
    catalogueView ? repository.listCommerceProducts(organisation.id) : Promise.resolve([]),
    repository.listLocations(organisation.id),
    !staff && view === "sell" ? repository.getBalanceAccount(organisation.id, userId) : Promise.resolve(undefined),
    !staff && view === "sell" ? repository.listOrders(organisation.id) : Promise.resolve([]),
    canReconcile ? repository.listCashDeclarations(organisation.id, "declared") : Promise.resolve([]),
    staff && view === "sell" ? repository.listCustomers(organisation.id) : Promise.resolve([]),
    staff && view === "stock" ? repository.listInventoryReceipts(organisation.id, locationId) : Promise.resolve([]),
    view === "sell" ? client.from("club_promotions").select("id,status,starts_at,ends_at,location_ids,effects,eligibility").eq("organisation_id", organisation.id).eq("status", "active") : Promise.resolve({ data: [] }),
    catalogueView ? client.rpc("club_list_member_supplier_catalogue", { p_organisation_id: organisation.id, p_location_id: null }) : Promise.resolve({ data: [] }),
  ]);
  const durableRows = Array.isArray(supplierRows.data) ? supplierRows.data as DurableSupplierParentRow[] : [];
  const products = buildClubShopProductUniverse(localProducts, durableRows, organisation.id);
  const salesProducts = products.filter(product => loadedChannelEligible(product, staff));
  const promotions = (Array.isArray(promotionRows.data) ? promotionRows.data : []).map(value => mapPromotionRecord(value as Record<string, unknown>)).filter(rule => new Date(rule.startsAt) <= new Date() && (!rule.endsAt || new Date() < new Date(rule.endsAt)));
  const { data: familyRows } = catalogueView ? await client.from("club_product_families").select("id,organisation_id,name,brand,description,category,active,archived_at,sort_position").eq("organisation_id", organisation.id).eq("active", true) : { data: [] };
  const families = (Array.isArray(familyRows) ? familyRows : []).map((row) => ({ id: String(row.id), organisationId: String(row.organisation_id), name: String(row.name), ...(row.brand ? { brand: String(row.brand) } : {}), ...(row.description ? { description: String(row.description) } : {}), ...(row.category ? { category: String(row.category) } : {}), active: row.active === true, ...(row.archived_at ? { archivedAt: String(row.archived_at) } : {}), sortPosition: Number(row.sort_position ?? 0) })) satisfies ClubProductFamily[];
  const locationAccess = staff && member.role !== "owner" && member.role !== "gym_admin" ? await Promise.all(locations.map(async location => {
    const result = await client.rpc("club_location_authorized", { p_organisation_id: organisation.id, p_location_id: location.id });
    return !result.error && result.data === true ? location.id : null;
  })) : [];
  const assignedIds = new Set(locationAccess.filter((id): id is string => Boolean(id)));
  const authorisedLocations = member.role === "owner" || member.role === "gym_admin" ? locations : staff ? locations.filter(location => assignedIds.has(location.id)) : locations;
  const activeLocation = authorisedLocations.find(location => location.active && location.id === locationId) ?? (authorisedLocations.length === 1 ? authorisedLocations[0] : undefined);
  const stockBalances = staff && (view === "stock" || view === "sell") ? await repository.listStockBalances(organisation.id, activeLocation?.id) : [];
  const canAdjustStock = staff && view === "stock" ? await repository.hasCapability(organisation.id, userId, "inventory.adjust") : false;
  const canRemoveStock = staff && view === "stock" ? await repository.hasCapability(organisation.id, userId, "commerce.stock_remove") : false;
  const canManageCatalogue = member.role === "gym_admin" || member.role === "owner";
  return { organisation, products, salesProducts, localProducts, durableRows, families, locations: authorisedLocations, activeLocation, stockBalances, balance, orders, declarations, customers, deliveries, promotions, staff, canRecordCash, canReconcile, canIssueRefund, canApproveRefund, canViewTillLog, canAdjustStock, canRemoveStock, canManageCatalogue, role: member.role, contexts: context.availableContexts };
}

function loadedChannelEligible(product: import("@/lib/club-commerce").ClubCommerceProduct, staff: boolean) {
  if (staff) return isReceptionProductEligible(product);
  return isProductOnChannel(product,"online");
}

export default async function ClubShopPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string; view?: string; till?: string; supplierDebug?: string }> }) {
  const client = await serverSupabase(); const params = await searchParams; const { data: { user } } = await client.auth.getUser();
  if (!user) {
    const query = new URLSearchParams();
    if (params?.org) query.set("org", params.org);
    if (params?.location) query.set("location", params.location);
    if (params?.view) query.set("view", params.view);
    if (params?.supplierDebug) query.set("supplierDebug", params.supplierDebug);
    const returnTo = `/club/shop${query.toString() ? `?${query.toString()}` : ""}`;
    redirect(`/account?app=club&mode=signIn&next=${encodeURIComponent(returnTo)}`);
  }
  const view = params?.view && ["sell", "stock", "catalogue", "cash", "cash-review", "offers"].includes(params.view) ? params.view : "sell";
  let loaded; try { loaded = await loadShop(client, user.id, params?.org, params?.location, view); } catch { loaded = "error" as const; }
  if (loaded === "error") return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB" title="Shop" description="Commerce is temporarily unavailable." /><EmptyState title="Shop couldn’t be loaded.">Try again shortly.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  if (!loaded) return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB" title="Shop" description="Organisation commerce." /><EmptyState title="Club access required">Your account is not linked to an active Club organisation.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  const theme = resolveOrganisationTheme(loaded.organisation);
  const fulfilmentStates: Record<string, string> = {};
  if (!loaded.staff) {
    const { data: fulfilment } = await client.rpc("club_list_member_supplier_fulfilment", { p_organisation_id: loaded.organisation.id, p_user_id: user.id });
    if (Array.isArray(fulfilment)) for (const item of fulfilment as Array<Record<string, unknown>>) if (item.order_id && item.status) fulfilmentStates[String(item.order_id)] = String(item.status);
  }
  if (loaded.staff && loaded.canManageCatalogue && view === "catalogue") redirect(`/club/products?org=${encodeURIComponent(loaded.organisation.id)}`);
  const offerNow = new Date().getTime();
  const offerRows = loaded.staff && view === "offers" ? await Promise.all([
    client.from("club_promotions").select("id,name,description,status,starts_at,ends_at").eq("organisation_id", loaded.organisation.id).eq("status", "active").order("starts_at", { ascending: false }),
    client.from("club_membership_joining_fee_promotions").select("id,name,status,starts_at,ends_at,timezone").eq("organisation_id", loaded.organisation.id).eq("status", "active").order("starts_at", { ascending: false }),
  ]) : undefined;
  const offerCards = offerRows ? [
    ...(offerRows[0].error ? [] : (offerRows[0].data ?? []).filter(row => new Date(row.starts_at).getTime() <= offerNow && (!row.ends_at || new Date(row.ends_at).getTime() > offerNow)).map(row => ({ id: String(row.id), name: String(row.name), description: typeof row.description === "string" ? row.description : "", status: String(row.status), startsAt: String(row.starts_at), endsAt: row.ends_at ? String(row.ends_at) : null, type: "Shop offer" }))),
    ...(offerRows[1].error ? [] : (offerRows[1].data ?? []).filter(row => new Date(row.starts_at).getTime() <= offerNow && (!row.ends_at || new Date(row.ends_at).getTime() > offerNow)).map(row => ({ id: String(row.id), name: String(row.name), description: "Membership joining-fee offer", status: String(row.status), startsAt: String(row.starts_at), endsAt: row.ends_at ? String(row.ends_at) : null, type: "Membership offer" }))),
  ] : [];
  const offerReadError = Boolean(offerRows?.some(result => result.error));
  const requestedTillView = params?.till === "log" ? "log" : params?.till === "close" ? "close" : undefined;
  const tillView = view === "cash"
    ? requestedTillView === "close" && loaded.canReconcile ? "close" : requestedTillView === "log" && loaded.canViewTillLog ? "log" : loaded.canViewTillLog ? "log" : loaded.canReconcile ? "close" : "unavailable"
    : "close";
  const shopPageTitle = view === "stock" ? "Stock" : view === "offers" ? "Promotions" : view === "cash-review" ? "Cash approvals" : view === "cash" ? tillView === "log" ? "Till Log" : tillView === "close" ? "Till close" : "Cash & till" : view === "catalogue" ? "Supplier Catalogue" : "Shop";
  const tillHistoryResult = loaded.staff && loaded.canReconcile && view === "cash" && tillView === "close"
    ? await client.from("club_till_closes").select("id,location_id,business_date,register_name,expected_cash_minor,counted_cash_minor,variance_minor,notes,closed_at,closed_by").eq("organisation_id", loaded.organisation.id).order("business_date", { ascending: false }).limit(50)
    : { data: [] };
  const tillHistory = Array.isArray(tillHistoryResult.data) ? tillHistoryResult.data as Parameters<typeof ClubTillClose>[0]["history"] : [];
  let recentSales: RecentSale[] = [];
  if (loaded.staff && loaded.canViewTillLog && view === "cash" && tillView === "log") {
    const recentResult = await client.from("club_orders").select("id,created_at,total_minor,currency,status,location_id,customer_id,club_customers(display_name),club_order_items(id,product_name,quantity,line_total_minor,stock_tracked),club_payments(id,method,amount_minor,currency,status)").eq("organisation_id", loaded.organisation.id).eq("channel", "staff_checkout").in("status", ["paid", "fulfilled", "refunded"]).order("created_at", { ascending: false }).limit(20);
    const rows = Array.isArray(recentResult.data) ? recentResult.data as Array<Record<string, unknown>> : [];
    const linePreviews = loaded.canApproveRefund ? await Promise.all(rows.map(async order => {
      const { data } = await client.rpc("club_list_staff_refundable_order_lines", { p_order_id: String(order.id) });
      return [String(order.id), Array.isArray(data) ? data as Array<Record<string, unknown>> : []] as const;
    })) : [];
    const linePreviewByOrder = new Map(linePreviews);
    const paymentIds = rows.flatMap(order => Array.isArray(order.club_payments) ? (order.club_payments as Array<Record<string, unknown>>).map(payment => String(payment.id)) : []);
    const refundResult = paymentIds.length ? await client.from("club_refunds").select("id,payment_id,amount_minor,reason,created_at").eq("organisation_id", loaded.organisation.id).in("payment_id", paymentIds).order("created_at", { ascending: false }) : { data: [] };
    const refundRows = Array.isArray(refundResult.data) ? refundResult.data as Array<Record<string, unknown>> : [];
    const refundIds = refundRows.map(refund => String(refund.id));
    const allocationResult = loaded.canApproveRefund && refundIds.length ? await client.from("club_refund_line_allocations").select("refund_id,order_item_id,quantity,amount_minor").eq("organisation_id", loaded.organisation.id).in("refund_id", refundIds) : { data: [] };
    const allocationRows = Array.isArray(allocationResult.data) ? allocationResult.data as Array<Record<string, unknown>> : [];
    const allocatedItemIds = [...new Set(allocationRows.map(allocation => String(allocation.order_item_id)))];
    const itemNameResult = loaded.canApproveRefund && allocatedItemIds.length ? await client.from("club_order_items").select("id,product_name").eq("organisation_id", loaded.organisation.id).in("id", allocatedItemIds) : { data: [] };
    const itemNames = new Map((Array.isArray(itemNameResult.data) ? itemNameResult.data as Array<Record<string, unknown>> : []).map(item => [String(item.id), String(item.product_name ?? "Item")]));
    const refundedByPayment = new Map<string, number>();
    for (const refund of Array.isArray(refundResult.data) ? refundResult.data as Array<Record<string, unknown>> : []) refundedByPayment.set(String(refund.payment_id), (refundedByPayment.get(String(refund.payment_id)) ?? 0) + Number(refund.amount_minor ?? 0));
    const locationNames = new Map(loaded.locations.map(location => [location.id, location.name]));
    recentSales = rows.filter(order => !order.location_id || locationNames.has(String(order.location_id))).map(order => {
      const customer = order.club_customers && typeof order.club_customers === "object" ? order.club_customers as Record<string, unknown> : {};
      const items = Array.isArray(order.club_order_items) ? order.club_order_items as Array<Record<string, unknown>> : [];
      const payments = Array.isArray(order.club_payments) ? order.club_payments as Array<Record<string, unknown>> : [];
      const previewLines = linePreviewByOrder.get(String(order.id)) ?? [];
      const refundLines: RefundableLine[] = previewLines.map(line => ({
        orderItemId: String(line.order_item_id), productName: String(line.product_name ?? "Item"),
        kind: line.line_kind === "service" ? "service" : "retail", quantity: Number(line.quantity ?? 0),
        lineTotalMinor: Number(line.line_total_minor ?? 0), saleValueMinor: Number(line.sale_value_minor ?? line.line_total_minor ?? 0), refundedQuantity: Number(line.refunded_quantity ?? 0),
        refundedMinor: Number(line.refunded_minor ?? 0), refundableQuantity: Number(line.refundable_quantity ?? 0),
        refundableMinor: Number(line.refundable_minor ?? 0), unit: String(line.unit ?? "item"), originalUnits: Number(line.original_units ?? line.quantity ?? 0), availableUnits: Number(line.available_units ?? line.refundable_quantity ?? 0),
      }));
      const salePaymentIds = new Set(payments.map(payment => String(payment.id)));
      const refunds = refundRows.filter(refund => salePaymentIds.has(String(refund.payment_id))).map(refund => {
        const allocations = allocationRows.filter(allocation => String(allocation.refund_id) === String(refund.id));
        return {
          id: String(refund.id), amountMinor: Number(refund.amount_minor ?? 0), createdAt: String(refund.created_at), reason: String(refund.reason ?? "Reason not recorded"),
          method: String(payments.find(payment => String(payment.id) === String(refund.payment_id))?.method ?? "other"),
          lines: allocations.map(allocation => ({ name: itemNames.get(String(allocation.order_item_id)) ?? "Item", quantity: Number(allocation.quantity ?? 0), unit: refundLines.find(line => line.orderItemId === String(allocation.order_item_id))?.unit ?? "unit", amountMinor: Number(allocation.amount_minor ?? 0) })),
        };
      });
      return {
        id: String(order.id), createdAt: String(order.created_at), totalMinor: Number(order.total_minor ?? 0), currency: String(order.currency ?? "GBP"), status: String(order.status ?? "paid"),
        locationName: locationNames.get(String(order.location_id)) ?? "Location not recorded", customerName: typeof customer.display_name === "string" ? customer.display_name : "Guest sale",
        items: items.map(item => `${String(item.product_name ?? "Item")} × ${Number(item.quantity ?? 1)}`), refundLines, refunds,
        tenders: payments.map(payment => { const amountMinor = Number(payment.amount_minor ?? 0); const refundedMinor = refundedByPayment.get(String(payment.id)) ?? 0; return { id: String(payment.id), method: String(payment.method ?? "other"), status: String(payment.status ?? "paid"), amountMinor, refundedMinor, remainingMinor: Math.max(0, amountMinor - refundedMinor) }; }),
      };
    });
  }
  const supplierDebug = params?.supplierDebug === "1" && (loaded.role === "owner" || loaded.role === "gym_admin");
  const debugNames = new Set(["100% Whey Protein Professional", "100% Whey Isolate", "Radical Whey"]);
  const debugParents = loaded.durableRows.filter(parent => parent.brand === "Scitec Nutrition" && debugNames.has(parent.name));
  const debugLocal = loaded.localProducts.filter(product => product.brand === "Scitec Nutrition" && debugNames.has(product.name));
  const debugFinal = loaded.products.filter(product => product.brand === "Scitec Nutrition" && debugNames.has(product.name));
  const debugProducts = (product: typeof loaded.products[number]) => ({ id: product.id, name: product.name, brand: product.brand, supplierReference: product.supplierReference, familyId: product.familyId, variantOptions: product.variantOptions, supplierAvailabilityStatus: product.supplierAvailabilityStatus, supplierMemberOrderable: product.supplierMemberOrderable, media: product.media, variantImageReference: product.variantImageReference, sellPriceMinor: product.sellPriceMinor, active: product.active, stockTracked: product.stockTracked });
  const imagePipeline = supplierDebug ? (() => {
    const localById = new Map(loaded.localProducts.map(product => [product.id, product]));
    const universeById = new Map(loaded.products.map(product => [product.id, product]));
    const variants = loaded.durableRows.flatMap(parent => parent.variants.map(variant => ({ parent, variant })));
    const activeSportsParents = loaded.durableRows.filter(parent => /active sports/i.test(parent.supplierName));
    const activeSportsVariants = activeSportsParents.flatMap(parent => parent.variants.map(variant => ({ parent, variant })));
    const hasUrl = (value: unknown) => { if (typeof value !== "string") return false; try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } };
    const validSource = ({ parent, variant }: typeof variants[number]) => hasUrl(variant.imageReference) || hasUrl(parent.imageReference);
    const linked = variants.filter(({ variant }) => Boolean(variant.clubProductId));
    const canonicalWithImage = linked.filter(({ variant }) => hasUrl(localById.get(String(variant.clubProductId))?.media?.url));
    const universeWithImage = variants.filter(({ variant }) => hasUrl(universeById.get(String(variant.clubProductId ?? variant.id))?.media?.url));
    const imageLessSamples = variants.filter(item => !validSource(item)).slice(0, 8).map(({ parent, variant }) => ({ parent: parent.name, supplierSku: variant.supplierSku ?? null, variantId: variant.id, linked: Boolean(variant.clubProductId) }));
    const activeSportsProductIds = new Set(activeSportsVariants.map(({ variant }) => String(variant.clubProductId ?? variant.id)));
    const activeSportsLinked = activeSportsVariants.filter(({ variant }) => Boolean(variant.clubProductId));
    return { durableParents: loaded.durableRows.length, parentImages: loaded.durableRows.filter(parent => hasUrl(parent.imageReference)).length, durableVariants: variants.length, variantImages: variants.filter(({ variant }) => hasUrl(variant.imageReference)).length, variantsWithAnySupplierImage: variants.filter(validSource).length, canonicalLinks: linked.length, canonicalProductsWithImage: canonicalWithImage.length, finalUniverseVariants: loaded.products.filter(product => product.supplierReference?.startsWith("supplier_product:")).length, finalUniverseWithImage: universeWithImage.length, sourceImageMissingSamples: imageLessSamples, activeSports: { parents: activeSportsParents.length, parentImages: activeSportsParents.filter(parent => hasUrl(parent.imageReference)).length, variants: activeSportsVariants.length, variantImages: activeSportsVariants.filter(({ variant }) => hasUrl(variant.imageReference)).length, variantsWithAnyImage: activeSportsVariants.filter(validSource).length, canonicalLinks: activeSportsLinked.length, canonicalProductsWithImage: activeSportsLinked.filter(({ variant }) => hasUrl(localById.get(String(variant.clubProductId))?.media?.url)).length, finalUniverseVariants: loaded.products.filter(product => activeSportsProductIds.has(product.id)).length, finalUniverseWithImage: loaded.products.filter(product => activeSportsProductIds.has(product.id) && hasUrl(product.media?.url)).length, sourceImageMissingSamples: activeSportsVariants.filter(item => !validSource(item)).slice(0, 8).map(({ parent, variant }) => ({ parent: parent.name, supplierSku: variant.supplierSku ?? null, variantId: variant.id, linked: Boolean(variant.clubProductId) })) } };
  })() : undefined;
  const debugAvailability = Object.fromEntries(loaded.products.map(product => { const balance = loaded.stockBalances.find(row => row.productId === product.id); const quantity = Math.max(0, balance?.availableToSell ?? ((balance?.onHand ?? 0) - (balance?.reserved ?? 0))); return [product.id, quantity > 0 ? "IN_GYM" : supplierOrderable(product) ? "SUPPLIER_ORDER" : "UNAVAILABLE"]; }));
  const debugCards = groupProductFamilies(loaded.products, loaded.families, loaded.organisation.id, debugAvailability);
  const debugOutput = supplierDebug ? { imagePipeline, rawSupplierDurableData: debugParents.flatMap(parent => parent.variants.map(variant => ({ parentName: parent.name, parentImageReference: parent.imageReference, variantId: variant.id, clubProductId: variant.clubProductId, size: variant.size, flavour: variant.flavour, stockStatus: variant.stockStatus, supplierSku: variant.supplierSku, barcode: variant.barcode, variantImageReference: variant.imageReference }))), rawLocalCommerceData: debugLocal.map(debugProducts), finalUniverseData: debugFinal.map(debugProducts), availability: debugFinal.map(product => ({ id: product.id, size: product.variantOptions?.size, flavour: product.variantOptions?.flavour, supplierAvailabilityStatus: product.supplierAvailabilityStatus, supplierMemberOrderable: product.supplierMemberOrderable, supplierOrderableResult: supplierOrderable(product) })), familyOutput: debugCards.filter(card => card.family?.name && debugNames.has(card.family.name)).map(card => ({ label: card.label, familyId: card.family?.id, variants: card.variants.map(variant => ({ id: variant.id, size: variant.variantOptions?.size, flavour: variant.variantOptions?.flavour, availability: debugAvailability[variant.id], mediaUrl: productImageUrl(variant) })), cardImageUrl: productImageUrl(card.variants.find(variant => productImageUrl(variant)) ?? card.variants[0]), sharedImageUrl: sharedProductImage(card.variants) })), professional780gFlavours: (() => { const card = debugCards.find(item => item.family?.name === "100% Whey Protein Professional"); if (!card) return []; return memberVariantChoices(card.variants, { size: "780g" }, product => debugAvailability[product.id] !== "UNAVAILABLE").controls.find(control => control.key === "flavour")?.values ?? []; })() } : undefined;
  if (debugOutput) console.info("R12_SUPPLIER_DEBUG", debugOutput);
  const staffSellView = loaded.staff && view === "sell";
  return <AppShell className={`${loaded.staff ? "module-page club-page club-shop-page" : "module-page club-shop-page"}${staffSellView ? " club-shop-sell-page" : ""}`}>{!staffSellView ? <PageHeader eyebrow="R12 CLUB · COMMERCE" title={loaded.staff ? shopPageTitle : "Shop"} description={!loaded.staff ? "Browse products and manage your purchases." : undefined} /> : null}{debugOutput ? <pre aria-label="Supplier diagnostics" style={{ whiteSpace: "pre-wrap", overflowX: "auto", padding: 16, background: "#160f22", color: "#f4ecff", borderRadius: 8 }}>{JSON.stringify(debugOutput, null, 2)}</pre> : null}<ClubSectionNav organisation={loaded.organisation} role={loaded.role} contexts={loaded.contexts} locations={loaded.locations} locationId={loaded.activeLocation?.id} /><>{loaded.staff ? <ClubShopTabs organisationId={loaded.organisation.id} locationId={loaded.activeLocation?.id} view={view} canManage={loaded.canManageCatalogue} canReconcile={loaded.canReconcile} canIssueRefund={loaded.canIssueRefund} canViewTillLog={loaded.canViewTillLog} /> : null}</><>{loaded.staff && view === "offers" ? <section className="club-shop-offers" aria-label="Current offers">{offerReadError ? <EmptyState title="Offers are temporarily unavailable">Current offers could not be loaded. No offer has been changed.</EmptyState> : offerCards.length ? offerCards.map(offer => <article key={`${offer.type}:${offer.id}`}><div><span>{offer.type}</span><h2>{offer.name}</h2>{offer.description ? <p>{offer.description}</p> : null}</div><div><strong data-status={offer.status}>{offer.status.replaceAll("_", " ")}</strong><small>{new Date(offer.startsAt).toLocaleDateString("en-GB")}{offer.endsAt ? ` – ${new Date(offer.endsAt).toLocaleDateString("en-GB")}` : ""}</small></div></article>) : <p>No offers are available to display.</p>}</section> : null}{loaded.staff && view === "sell" ? <ClubStaffCheckout organisationId={loaded.organisation.id} products={loaded.salesProducts} families={loaded.families} locations={loaded.locations} customers={loaded.customers} canRecordCash={loaded.canRecordCash} currentLocationId={loaded.activeLocation?.id} stockBalances={loaded.stockBalances} /> : null}{!loaded.staff && view === "sell" ? <ClubShop organisationId={loaded.organisation.id} userId={user.id} products={loaded.salesProducts} locations={loaded.locations} balance={loaded.balance} orders={loaded.orders.filter(order => order.userId === user.id)} declarations={[]} staff={false} canReconcile={false} accent={theme.primaryAccent} currentLocationId={loaded.activeLocation?.id} fulfilmentStates={fulfilmentStates} promotions={loaded.promotions} showCashReview={false} /> : null}{loaded.staff && view === "stock" ? <><ClubStockPanel organisationId={loaded.organisation.id} products={loaded.products} locations={loaded.locations} balances={loaded.stockBalances} locationId={loaded.activeLocation?.id} canAdjust={loaded.canAdjustStock} />{loaded.canRemoveStock ? <ClubStockRemoval organisationId={loaded.organisation.id} products={loaded.products} locationId={loaded.activeLocation?.id} /> : null}<ClubDeliveryHistory receipts={loaded.deliveries} locations={loaded.locations} /></> : null}{loaded.staff && view === "cash-review" ? loaded.canReconcile ? <ClubCashDeclarationReview organisationId={loaded.organisation.id} declarations={loaded.declarations} locations={loaded.locations} /> : <EmptyState title="Cash review access required">Your existing permissions do not allow cash declaration review.</EmptyState> : null}{loaded.staff && view === "cash" ? <>{tillView === "log" && loaded.canViewTillLog ? <ClubRecentSales organisationId={loaded.organisation.id} sales={recentSales} canApproveRefund={loaded.canApproveRefund} /> : null}{tillView === "close" && loaded.canReconcile ? <><ClubTillClose organisationId={loaded.organisation.id} locations={loaded.locations} initialLocationId={loaded.activeLocation?.id} history={tillHistory} /></> : null}</> : null}</>{!loaded.staff ? <BackButton href={`/club?org=${encodeURIComponent(loaded.organisation.id)}`}>Back to Club</BackButton> : null}<AppNav /></AppShell>;
}
