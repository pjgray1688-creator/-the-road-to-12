export type GlowZoneSaleRecord = {
  amount_minor: number;
  location_id: string;
  status: string;
  created_at: string;
  id?: string;
  tender_type?: string;
  minutes?: number;
};

export function summarizeCompletedGlowSales(
  records: readonly GlowZoneSaleRecord[],
  range: { from: string; to: string; locationId?: string },
) {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const completed = records.filter((record) => {
    const createdAt = Date.parse(record.created_at);
    const amount = Number(record.amount_minor);
    return record.status === "completed"
      && Number.isSafeInteger(amount)
      && amount >= 0
      && Number.isFinite(createdAt)
      && createdAt >= from
      && createdAt <= to
      && (!range.locationId || record.location_id === range.locationId);
  });
  return {
    amountMinor: completed.reduce((sum, record) => sum + Number(record.amount_minor), 0),
    count: completed.length,
    records: completed,
  };
}
