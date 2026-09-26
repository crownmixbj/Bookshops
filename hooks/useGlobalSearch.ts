import { useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getSessionUserId } from '../lib/loadState';

/**
 * The header search, across the three things a buyer looks for:
 *
 *   booklists  their own lists, by school, class or child's name
 *   items      a book or item on one of their lists, by title or author
 *   shops      any approved shop, by name or city
 *
 * Guests get shops only — the other two are a buyer's own data.
 *
 * Every read is RLS-scoped (requests_select_visible, items_select_via_request,
 * vendors_select_active), so the buyer_id filters below narrow the query
 * rather than secure it. Debounced, and a slower earlier query can never
 * overwrite a newer one's results.
 */

export interface SearchHit {
  kind: 'booklist' | 'item' | 'shop';
  id: string;
  title: string;
  subtitle: string;
  /** Where tapping it goes. Always an in-app route. */
  route: string;
}

export interface SearchResults {
  booklists: SearchHit[];
  items: SearchHit[];
  shops: SearchHit[];
}

const EMPTY: SearchResults = { booklists: [], items: [], shops: [] };
const PER_GROUP = 5;

/**
 * PostgREST's or=() filter is a tiny grammar of its own: commas separate
 * clauses and parentheses group them. A buyer typing "Basic 4 (2nd ed.)"
 * would otherwise break the filter, or worse, add a clause. Wildcards are
 * ours to place, so the buyer's own % and _ are dropped too.
 */
function safePattern(term: string): string {
  return `%${term.replace(/[%_,()*\\"]/g, ' ').replace(/\s+/g, ' ').trim()}%`;
}

export function useGlobalSearch(query: string) {
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const run = useRef(0);

  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) {
      run.current++;
      setResults(EMPTY);
      setLoading(false);
      return;
    }

    const id = ++run.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const pattern = safePattern(term);
      const uid = await getSessionUserId();

      const shopsQuery = supabase
        .from('vendors')
        .select('id, store_name, city')
        .or(`store_name.ilike.${pattern},city.ilike.${pattern}`)
        .eq('is_active', true)
        .limit(PER_GROUP);

      const listsQuery = uid
        ? supabase
            .from('book_requests')
            .select('id, school_name, class_level, status')
            .eq('buyer_id', uid)
            .or(`school_name.ilike.${pattern},class_level.ilike.${pattern}`)
            .order('created_at', { ascending: false })
            .limit(PER_GROUP)
        : null;

      // Inner join on the parent so the buyer filter applies to the item.
      const itemsQuery = uid
        ? supabase
            .from('book_request_items')
            .select('id, title, request_id, book_requests!inner ( id, school_name, class_level, buyer_id )')
            .eq('book_requests.buyer_id', uid)
            .ilike('title', pattern)
            .limit(PER_GROUP)
        : null;

      // Child names live on their own table; matching one surfaces that
      // child's lists. Fails quietly if the household migration is not in.
      const childrenQuery = uid
        ? supabase.from('children').select('id, full_name').eq('parent_id', uid).ilike('full_name', pattern).limit(5)
        : null;

      const [shopsRes, listsRes, itemsRes, childrenRes] = await Promise.all([
        shopsQuery,
        listsQuery ?? Promise.resolve({ data: [], error: null }),
        itemsQuery ?? Promise.resolve({ data: [], error: null }),
        childrenQuery ?? Promise.resolve({ data: [], error: null }),
      ]);

      let childLists: any[] = [];
      const childRows = (childrenRes.error ? [] : childrenRes.data ?? []) as { id: string; full_name: string }[];
      if (uid && childRows.length) {
        const { data } = await supabase
          .from('book_requests')
          .select('id, school_name, class_level, status, child_id')
          .eq('buyer_id', uid)
          .in('child_id', childRows.map((c) => c.id))
          .order('created_at', { ascending: false })
          .limit(PER_GROUP);
        childLists = (data ?? []).map((r: any) => ({
          ...r,
          childName: childRows.find((c) => c.id === r.child_id)?.full_name,
        }));
      }

      if (id !== run.current) return;

      const seen = new Set<string>();
      const booklists: SearchHit[] = [...childLists, ...((listsRes.data ?? []) as any[])]
        .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
        .slice(0, PER_GROUP)
        .map((r) => ({
          kind: 'booklist' as const,
          id: r.id,
          title: r.school_name || 'Booklist',
          subtitle: [r.childName, r.class_level, statusWord(r.status)].filter(Boolean).join(' · '),
          route: `/booklists/${r.id}`,
        }));

      const items: SearchHit[] = ((itemsRes.data ?? []) as any[]).map((r) => {
        const parent = Array.isArray(r.book_requests) ? r.book_requests[0] : r.book_requests;
        return {
          kind: 'item' as const,
          id: r.id,
          title: r.title,
          subtitle: ['On', parent?.school_name, parent?.class_level].filter(Boolean).join(' '),
          route: `/booklists/${r.request_id}`,
        };
      });

      const shops: SearchHit[] = ((shopsRes.data ?? []) as any[]).map((r) => ({
        kind: 'shop' as const,
        id: r.id,
        title: r.store_name,
        subtitle: r.city || 'Bookshop',
        route: `/shops/${r.id}`,
      }));

      setResults({ booklists, items, shops });
      setLoading(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [term]);

  const total = results.booklists.length + results.items.length + results.shops.length;
  return { results, loading, total, active: term.length >= 2 };
}

function statusWord(status: string | null | undefined): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'pending_quote':
      return 'Awaiting quotes';
    case 'quoted':
      return 'Quoted';
    case 'ordered':
      return 'Ordered';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}
