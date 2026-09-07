
const chain = () => { const o = { select: () => o, order: () => o, then: (res, rej) => globalThis.__q().then(res, rej) }; return o; };
export const supabase = { from: () => chain() };