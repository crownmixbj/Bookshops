
import { MOCK_CATEGORIES } from '/sessions/rcw-01nxvu91ldivpkyxb3xsnua9/mnt/BookShops/.cat2.gen.mjs';
export function decide(queryError, data) {
  if (queryError?.code === '42P01' || queryError?.code === 'PGRST205') return { source: 'builtin', categories: MOCK_CATEGORIES };
  if (queryError) throw queryError;
  const rows = data ?? [];
  if (rows.length === 0) return { source: 'builtin', categories: MOCK_CATEGORIES };
  const decoration = new Map(MOCK_CATEGORIES.map((c) => [c.slug, c]));
  return { source: 'database', categories: rows.map((row) => ({ ...row, accent: decoration.get(row.slug)?.accent, icon: decoration.get(row.slug)?.icon })) };
}