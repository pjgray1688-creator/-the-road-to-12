import type { ClubCommerceProduct, ClubOrder } from "./club-commerce";
import type { SupplierCatalogueVariant } from "./club-supplier-catalogue";
export type FulfilmentType = "LOCAL_STOCK" | "MEMBER_SUPPLIER_ORDER";
export type SupplierRequirementLine = { supplierId: string; supplierVariantKey: string; replenishmentQuantity: number; committedMemberQuantity: number; totalRequired: number };
export type CollectionRecord = { id: string; organisationId: string; locationId: string; orderId: string; orderItemId: string; quantity: number; readyAt?: string; collectedAt?: string; status: "awaiting_supplier" | "ready_for_collection" | "collected"; qrReference: string };
export type MemberSupplierOrderLineSnapshot = { fulfilmentType: "MEMBER_SUPPLIER_ORDER"; canonicalProductId: string; canonicalVariantId: string; supplierId: string; supplierVariantReference?: string; barcode?: string; flavour?: string; size?: string; packQuantity?: number; memberFacingProductName: string; retailPriceMinor: number; quantity: number };
export type CollectionLabelData = { memberDisplayName: string; orderReference: string; productName: string; variantSummary?: string; quantity: number; locationName: string; readyDate?: string; qrReference: string };

export function committedMemberDemand(orders: ClubOrder[], memberOrderableVariantKeys: Set<string>) {
  return orders.filter(order => order.channel === "member_app" && order.status === "paid").flatMap(order => order.items.filter(item => memberOrderableVariantKeys.has(item.productId)).map(item => ({ orderId: order.id, orderItemId: item.id, supplierVariantKey: item.productId, quantity: item.quantity })));
}
export function supplierRequirementLines(input: { supplierId: string; replenishment: Array<{ supplierVariantKey: string; quantity: number }>; committed: Array<{ supplierVariantKey: string; quantity: number }> }): SupplierRequirementLine[] {
  const keys = new Set([...input.replenishment.map(x => x.supplierVariantKey), ...input.committed.map(x => x.supplierVariantKey)]);
  return [...keys].sort().map(key => { const replenishmentQuantity = input.replenishment.filter(x => x.supplierVariantKey === key).reduce((n, x) => n + Math.max(0, Math.floor(x.quantity)), 0); const committedMemberQuantity = input.committed.filter(x => x.supplierVariantKey === key).reduce((n, x) => n + Math.max(0, Math.floor(x.quantity)), 0); return { supplierId: input.supplierId, supplierVariantKey: key, replenishmentQuantity, committedMemberQuantity, totalRequired: replenishmentQuantity + committedMemberQuantity }; });
}
export function snapshotMemberSupplierOrderLine(input: Omit<MemberSupplierOrderLineSnapshot, "fulfilmentType">): MemberSupplierOrderLineSnapshot {
  if (!Number.isInteger(input.retailPriceMinor) || input.retailPriceMinor < 0) throw new Error("invalid_retail_price");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new Error("invalid_quantity");
  return { ...input, fulfilmentType: "MEMBER_SUPPLIER_ORDER" };
}
export function availableToSellAfterMemberAllocation(onHand: number, reserved: number, allocatedMemberQuantity: number) {
  return Math.max(0, Math.floor(onHand) - Math.max(0, Math.floor(reserved)) - Math.max(0, Math.floor(allocatedMemberQuantity)));
}
export function allocateReceivedUnits(demands: Array<{ id: string; supplierVariantKey: string; quantityRequired: number; quantityAllocated: number; createdAt: string }>, supplierVariantKey: string, receivedQuantity: number) {
  let remaining = Math.max(0, Math.floor(receivedQuantity)); const allocations: Array<{ demandId: string; quantity: number }> = [];
  for (const demand of demands.filter(d => d.supplierVariantKey === supplierVariantKey).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) { const quantity = Math.min(remaining, Math.max(0, demand.quantityRequired - demand.quantityAllocated)); if (quantity) { allocations.push({ demandId: demand.id, quantity }); remaining -= quantity; } if (!remaining) break; }
  return { allocations, uncommittedQuantity: remaining };
}
export function collectionQrReference(organisationId: string, orderId: string, orderItemId: string) { let hash = 2166136261; for (const value of `${organisationId}:${orderId}:${orderItemId}`) hash = Math.imul(hash ^ value.charCodeAt(0), 16777619); return `r12col_${(hash >>> 0).toString(36)}`; }
export function collectionLabelData(input: Omit<CollectionLabelData, "qrReference"> & { organisationId: string; orderId: string; orderItemId: string }): CollectionLabelData {
  return { memberDisplayName: input.memberDisplayName, orderReference: input.orderReference, productName: input.productName, ...(input.variantSummary ? { variantSummary: input.variantSummary } : {}), quantity: input.quantity, locationName: input.locationName, ...(input.readyDate ? { readyDate: input.readyDate } : {}), qrReference: collectionQrReference(input.organisationId, input.orderId, input.orderItemId) };
}
export function supplierVariantCanBeOrdered(supplier: { memberOrderable: boolean }, variant: SupplierCatalogueVariant, hasRetailPrice: boolean) { return supplier.memberOrderable && variant.stockStatus === "available" && hasRetailPrice; }
export type FulfilmentState = "in_gym_now" | "available_to_order" | "ordered" | "awaiting_delivery" | "ready_for_collection" | "collected";
export function fulfilmentForProduct(product: ClubCommerceProduct, onHand?: number): FulfilmentState { return product.stockTracked && onHand !== undefined && onHand > 0 ? "in_gym_now" : "available_to_order"; }
export function paidSupplierDemand(order: ClubOrder, paid: boolean, supplierProductIds: Set<string>) { return paid && order.status === "paid" ? order.items.filter(item => supplierProductIds.has(item.productId)).map(item => ({ orderId: order.id, orderItemId: item.id, productId: item.productId, quantity: item.quantity })) : []; }
export function collectionReady(quantityRequired: number, quantityReceived: number, quantityAllocated: number) { return quantityRequired > 0 && quantityReceived >= quantityRequired && quantityAllocated >= quantityRequired; }
export type SupplierDemandRecord = { id: string; organisationId: string; supplierId: string; supplierProductId: string; orderId: string; orderItemId: string; userId?: string; collectionLocationId?: string; quantityRequired: number; quantityReceived: number; quantityAllocated: number; status: "outstanding" | "ordered" | "awaiting_delivery" | "ready_for_collection" | "collected" };
export type SupplierOrderBatch = { id: string; organisationId: string; supplierId: string; demandIds: string[]; status: "draft" | "ordered" | "received"; orderedAt?: string; receivedAt?: string };
export class SupplierWorkflow {
 demands: SupplierDemandRecord[] = []; batches: SupplierOrderBatch[] = []; notifications: Array<{ orderId: string; eventType: "order_ready_for_collection" }> = [];
 createDemand(input: Omit<SupplierDemandRecord,"id"|"quantityReceived"|"quantityAllocated"|"status">) { const existing=this.demands.find(item=>item.organisationId===input.organisationId&&item.orderItemId===input.orderItemId); if(existing)return existing; const demand={...input,id:`demand-${this.demands.length+1}`,quantityReceived:0,quantityAllocated:0,status:"outstanding" as const}; this.demands.push(demand); return demand; }
 consolidate(organisationId:string,supplierId:string) { const demandIds=this.demands.filter(item=>item.organisationId===organisationId&&item.supplierId===supplierId&&item.status==="outstanding").map(item=>item.id); const batch={id:`supplier-order-${this.batches.length+1}`,organisationId,supplierId,demandIds,status:"draft" as const}; this.batches.push(batch); return batch; }
 markOrdered(batchId:string) { const batch=this.batches.find(item=>item.id===batchId); if(!batch||batch.status!=="draft")throw new Error("supplier_batch_invalid"); batch.status="ordered"; batch.orderedAt=new Date().toISOString(); this.demands.filter(item=>batch.demandIds.includes(item.id)).forEach(item=>{item.status="ordered";}); return batch; }
 receive(batchId:string,received:Record<string,number>) { const batch=this.batches.find(item=>item.id===batchId); if(!batch||!(["ordered","received"] as string[]).includes(batch.status))throw new Error("supplier_batch_invalid"); batch.status="received"; batch.receivedAt=new Date().toISOString(); this.demands.filter(item=>batch.demandIds.includes(item.id)).forEach(item=>{item.quantityReceived+=Math.max(0,Math.floor(received[item.id]??0)); item.status=item.quantityReceived>=item.quantityRequired?"awaiting_delivery":"ordered";}); return batch; }
 allocate(demandId:string,quantity:number) { const demand=this.demands.find(item=>item.id===demandId); if(!demand||quantity<1||demand.quantityAllocated+quantity>demand.quantityReceived)throw new Error("allocation_invalid"); demand.quantityAllocated+=quantity; if(collectionReady(demand.quantityRequired,demand.quantityReceived,demand.quantityAllocated)){demand.status="ready_for_collection";if(!this.notifications.some(item=>item.orderId===demand.orderId))this.notifications.push({orderId:demand.orderId,eventType:"order_ready_for_collection"});} return demand; }
 collect(demandId:string) { const demand=this.demands.find(item=>item.id===demandId); if(!demand||demand.status!=="ready_for_collection")throw new Error("collection_invalid"); demand.status="collected"; return demand; }
}
