export type GlowZoneCustomerDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export type GlowZoneCustomerField = "firstName" | "lastName" | "phone";

export function validGlowPhone(value: string) {
  const phone = value.trim();
  return phone.length >= 7 && phone.length <= 25 && /^\+?[0-9][0-9 ()-]*$/.test(phone);
}

export function glowCustomerMissingFields(details: GlowZoneCustomerDetails): GlowZoneCustomerField[] {
  const missing: GlowZoneCustomerField[] = [];
  if (!details.firstName.trim()) missing.push("firstName");
  if (!details.lastName.trim()) missing.push("lastName");
  if (!validGlowPhone(details.phone)) missing.push("phone");
  return missing;
}
