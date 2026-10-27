export type GlowZoneCustomerDetails = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
};

export type GlowZoneCustomerField = "firstName" | "lastName" | "phone" | "dateOfBirth";

export function validGlowPhone(value: string) {
  const phone = value.trim();
  return phone.length >= 7 && phone.length <= 25 && /^\+?[0-9][0-9 ()-]*$/.test(phone);
}

export function validGlowDateOfBirth(value: string, today = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 1900) return false;
  const todayKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  return value < todayKey;
}

export function glowCustomerMissingFields(details: GlowZoneCustomerDetails): GlowZoneCustomerField[] {
  const missing: GlowZoneCustomerField[] = [];
  if (!details.firstName.trim()) missing.push("firstName");
  if (!details.lastName.trim()) missing.push("lastName");
  if (!validGlowPhone(details.phone)) missing.push("phone");
  if (!validGlowDateOfBirth(details.dateOfBirth)) missing.push("dateOfBirth");
  return missing;
}

export function glowCustomerIsUnder18(dateOfBirth: string, today = new Date()) {
  if (!validGlowDateOfBirth(dateOfBirth, today)) return false;
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  return dateOfBirth > cutoff.toISOString().slice(0, 10);
}
