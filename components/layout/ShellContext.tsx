import { createContext, useContext } from 'react';
import type { Vendor } from '../../types/db';

export interface ShellValue {
  /**
   * The top bar's search box. It lives in the shell, so the text a
   * person types survives navigation — the whole point of hoisting the
   * chrome out of the screens. Screens read it to filter their own
   * lists.
   */
  search: string;
  setSearch: (value: string) => void;
  /** The signed-in vendor's shop row, or null for other roles. */
  vendor: Vendor | null;
  /**
   * Opens the support chat, optionally pre-filled — the orders screen
   * uses it to raise a dispute with the order's details already typed.
   * The drawer itself lives in the shell, so a screen can no longer
   * render one of its own.
   */
  openSupportChat: (initialMessage?: string) => void;
  /**
   * The signed-in role, so a screen can refuse to render for the wrong
   * one. 'buyer' is the safe default: it is the role with the fewest
   * rights, so defaulting to it can never open something up.
   */
  role: 'buyer' | 'vendor' | 'admin';
  /**
   * The signed-in person's display name, as shown in the header. Null
   * only while the first lookup is in flight.
   */
  displayName: string | null;
  /**
   * Re-reads the name from profiles. Settings calls this after a save,
   * because the shell never unmounts and so never refetches on its own.
   */
  refreshProfile: () => void;
  /**
   * False when a screen renders with no shell around it — a public info
   * page opened by a signed-out visitor. Those screens have to supply
   * their own safe-area padding, which the shell would otherwise own.
   */
  insideShell: boolean;
}

const ShellContext = createContext<ShellValue>({
  search: '',
  setSearch: () => {},
  vendor: null,
  openSupportChat: () => {},
  role: 'buyer',
  displayName: null,
  refreshProfile: () => {},
  insideShell: false,
});

export const ShellProvider = ShellContext.Provider;

/** Chrome state shared by every screen under the shell. */
export function useShell(): ShellValue {
  return useContext(ShellContext);
}
