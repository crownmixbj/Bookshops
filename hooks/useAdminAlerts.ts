import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

export interface AdminAlerts {
  vendors: number;
  support: number;
  total: number;
}

const NONE: AdminAlerts = { vendors: 0, support: 0, total: 0 };

/**
 * Counts for the admin top bar's alert badge and sidebar badges.
 *
 * Two `count: 'exact', head: true` queries — no rows come back, just the
 * numbers, so this is cheap enough to run on every page an admin opens.
 *
 * Errors resolve to zero on purpose. Until bookshops_admin.sql has been
 * run these tables do not exist, and a badge is not worth an error state
 * in the chrome of every screen.
 */
export function useAdminAlerts(enabled: boolean): AdminAlerts {
  const [alerts, setAlerts] = useState<AdminAlerts>(NONE);

  useEffect(() => {
    if (!enabled) {
      setAlerts(NONE);
      return;
    }
    let active = true;

    (async () => {
      const [pendingVendors, openReports] = await Promise.all([
        supabase
          .from('vendors')
          .select('id', { count: 'exact', head: true })
          .eq('approval_status', 'pending'),
        supabase
          .from('content_reports')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open'),
      ]);
      if (!active) return;
      const vendors = pendingVendors.error ? 0 : (pendingVendors.count ?? 0);
      const support = openReports.error ? 0 : (openReports.count ?? 0);
      setAlerts({ vendors, support, total: vendors + support });
    })().catch(() => {
      if (active) setAlerts(NONE);
    });

    return () => {
      active = false;
    };
  }, [enabled]);

  return alerts;
}
