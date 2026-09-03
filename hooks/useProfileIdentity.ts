import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

/**
 * The signed-in person's display name, for the header badge.
 *
 * Fallback order, most trustworthy first:
 *
 *   1. profiles.full_name — the one they can edit in Settings
 *   2. user_metadata.full_name — what they typed at sign-up, which is
 *      present even before the profiles row is readable
 *   3. 'User' — so the badge reads "Admin: User" rather than
 *      "Admin: undefined" or a bare "Admin:"
 *
 * It also returns null while the first fetch is in flight, so a caller
 * can hold the previous value instead of flashing the fallback.
 */
export function useProfileIdentity() {
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setName(null);
      setLoading(false);
      return;
    }

    const metaName =
      typeof user.user_metadata?.full_name === 'string'
        ? user.user_metadata.full_name.trim()
        : '';

    const { data, error } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    const profileName = !error && typeof data?.full_name === 'string' ? data.full_name.trim() : '';

    setName(profileName || metaName || 'User');
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(() => {
      // A failed lookup is not worth an error state in the chrome of
      // every screen; the fallback name is enough.
      setName('User');
      setLoading(false);
    });
  }, [load]);

  /**
   * Re-read after the name is changed in Settings.
   *
   * The shell never unmounts — that is the point of it — so nothing
   * would otherwise cause this to run again, and the header would keep
   * showing the old name until a full reload.
   */
  return { name, loading, refresh: load };
}
