import { TrainingPreviewClient } from "./preview-client";

type SearchParams = Promise<{ occurrence?: string | string[] }>;

export default async function TrainingPreviewPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const occurrenceId = Array.isArray(params.occurrence) ? params.occurrence[0] : params.occurrence;
  return <TrainingPreviewClient occurrenceId={occurrenceId} />;
}
