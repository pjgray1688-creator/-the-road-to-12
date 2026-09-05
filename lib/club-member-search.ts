import type { ClubCustomer } from "./club-operations";
import type { ClubMemberSummaryRead } from "./club-operational";

export type StaffMemberSearchResult = { id: string; displayName: string; email?: string; phone?: string; userId?: string; linkedCustomerId?: string };

export function searchStaffMemberRecords(organisationId: string, query: string, customers: ClubCustomer[], members: ClubMemberSummaryRead[]): StaffMemberSearchResult[] {
  const needle = query.trim().toLocaleLowerCase(); if (needle.length < 2) return [];
  const scopedCustomers = customers.filter(customer => customer.organisationId === organisationId);
  const scopedMembers = members.filter(member => member.organisationId === organisationId);
  const customerByUser = new Map(scopedCustomers.filter(customer => customer.userId).map(customer => [customer.userId!, customer]));
  const results: StaffMemberSearchResult[] = [];
  for (const member of scopedMembers) { const customer = customerByUser.get(member.userId); const fields = [member.displayName, member.email, customer?.displayName, customer?.email, customer?.phone]; if (!fields.some(field => field?.toLocaleLowerCase().includes(needle))) continue; results.push({ id: customer?.id ?? member.id, displayName: member.displayName, ...(member.email ?? customer?.email ? { email: member.email ?? customer?.email } : {}), ...(customer?.phone ? { phone: customer.phone } : {}), userId: member.userId, ...(customer ? { linkedCustomerId: customer.id } : {}) }); }
  const memberUsers = new Set(scopedMembers.map(member => member.userId));
  for (const customer of scopedCustomers) { if (customer.userId && memberUsers.has(customer.userId)) continue; if (![customer.displayName, customer.email, customer.phone].some(field => field?.toLocaleLowerCase().includes(needle))) continue; results.push({ id: customer.id, displayName: customer.displayName, ...(customer.email ? { email: customer.email } : {}), ...(customer.phone ? { phone: customer.phone } : {}), ...(customer.userId ? { userId: customer.userId, linkedCustomerId: customer.id } : {}) }); }
  return results.slice(0, 20);
}
