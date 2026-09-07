
export const supabase = {
  auth: {
    getSession: (...a) => globalThis.__sessionImpl(...a),
    onAuthStateChange: (cb) => { globalThis.__setHandler(cb);
      return { data: { subscription: { unsubscribe: () => globalThis.__setHandler(null) } } }; },
  },
};