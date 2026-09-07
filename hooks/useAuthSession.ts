import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../utils/supabase';
import type { UserRole } from '../types/db';

/**
 * The session plus the signed-in person's role, which is what decides
 * where they land after logging in.
 *
 * The role lives in `public.profiles`, not in the JWT, so it needs a
 * query. That query is the reason `roleResolved` exists separately from
 * `initialized`: routing on a session alone would flash the buyer
 * dashboard at a vendor for as long as the round-trip takes.
 *
 * Deliberately NOT a security boundary. Anything a role protects is
 * enforced by RLS in Postgres — this only decides which screen opens
 * first. A tampered client could route itself to /vendor and would still
 * see an empty queue, because `vendor_request_queue()` checks the caller
 * against `vendors` server-side.
 */

export type LandingRoute = '/vendor' | '/admin/dashboard' | '/';

export const LANDING: Record<UserRole, LandingRoute> = {
  vendor: '/vendor',
  admin: '/admin/dashboard',
  buyer: '/',
};

/**
 * An unknown role lands on the buyer hub rather than anywhere
 * privileged. This is not the security boundary — RLS is — but a
 * routing default should still fail closed.
 */
export function landingRouteFor(role: UserRole | null): LandingRoute {
  return role ? LANDING[role] : '/';
}

export interface AuthSessionState {
  session: Session | null;
  /** Null while unresolved, or when no profile row exists. */
  role: UserRole | null;
  /** True once the role lookup has finished, successfully or not. */
  roleResolved: boolean;
  /** True when the session is valid but no profiles row came back. */
  profileMissing: boolean;
  /** Set when the role lookup itself failed (network, RLS, bad column). */
  roleError: Error | null;
  /** True once the initial getSession() has settled. */
  initialized: boolean;
}

export function useAuthSession(): AuthSessionState & { refreshRole: () => Promise<void> } {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [roleResolved, setRoleResolved] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);
  const [roleError, setRoleError] = useState<Error | null>(null);

  /** Guards against a slow response for a user who has since signed out. */
  const currentUserId = useRef<string | null>(null);

  const fetchRole = useCallback(async (userId: string) => {
    setRoleResolved(false);
    setRoleError(null);
    setProfileMissing(false);
    try {
      // maybeSingle, not single: a missing profile is a state to handle,
      // not an exception. It happens if the handle_new_user trigger is
      // absent, or for an account created before it existed.
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

      if (currentUserId.current !== userId) return; // signed out mid-flight

      if (error) throw error;

      if (!data) {
        setProfileMissing(true);
        setRole(null);
      } else {
        const value = data.role as UserRole | null;
        // An unrecognised value is treated as a buyer rather than
        // trusted: a new enum member should not silently grant a
        // console nobody has reviewed.
        setRole(value === 'vendor' || value === 'admin' || value === 'buyer' ? value : null);
      }
    } catch (e) {
      if (currentUserId.current !== userId) return;
      setRoleError(e as Error);
      setRole(null);
    } finally {
      if (currentUserId.current === userId) setRoleResolved(true);
    }
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const s = data.session ?? null;
      setSession(s);
      currentUserId.current = s?.user.id ?? null;
      setInitialized(true);
      if (s?.user.id) {
        fetchRole(s.user.id);
      } else {
        setRoleResolved(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!active) return;
      setSession(s ?? null);
      const nextId = s?.user.id ?? null;

      // Only re-query when the person actually changed. Token refreshes
      // fire this listener too, and re-fetching on every refresh would
      // put a query on a timer for no reason.
      if (nextId !== currentUserId.current) {
        currentUserId.current = nextId;
        setRole(null);
        setProfileMissing(false);
        setRoleError(null);
        if (nextId) {
          fetchRole(nextId);
        } else {
          setRoleResolved(true);
        }
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [fetchRole]);

  const refreshRole = useCallback(async () => {
    if (currentUserId.current) await fetchRole(currentUserId.current);
  }, [fetchRole]);

  return {
    session,
    role,
    roleResolved,
    profileMissing,
    roleError,
    initialized,
    refreshRole,
  };
}
