
export const supabase = { functions: { invoke: (...a) => globalThis.__invoke(...a) } };