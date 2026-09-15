export const SHOP_PAGE_SIZE = 48;
export function paginateCards<T>(cards: T[], page: number, pageSize = SHOP_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(cards.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  return { items: cards.slice((currentPage - 1) * pageSize, currentPage * pageSize), currentPage, totalPages, total: cards.length, start: cards.length ? (currentPage - 1) * pageSize + 1 : 0, end: Math.min(currentPage * pageSize, cards.length) };
}
