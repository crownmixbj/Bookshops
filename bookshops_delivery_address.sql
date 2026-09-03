-- Bookshops — a delivery address a Nigerian courier can actually find
--
-- profiles stores address, city and phone. That is enough for a form and
-- not enough for a delivery: outside the main estates, an address here is
-- located by state and LGA, and found by landmark. "Behind Zenith Bank,
-- opposite the filling station" is not a nicety, it is how the rider
-- arrives.
--
-- Three nullable columns beside the existing three. Additive: no row
-- changes, and every select that names an explicit column list keeps
-- working untouched.

begin;

alter table public.profiles
  add column if not exists default_delivery_state text
    check (default_delivery_state is null or length(default_delivery_state) <= 60),
  add column if not exists default_delivery_lga text
    check (default_delivery_lga is null or length(default_delivery_lga) <= 80),
  add column if not exists default_delivery_landmark text
    check (default_delivery_landmark is null or length(default_delivery_landmark) <= 200);

comment on column public.profiles.default_delivery_state is
  'One of Nigeria''s 36 states or the FCT. Free text rather than an enum: '
  'the client offers a picker, and a constrained type would need a migration '
  'every time the list is revised.';

comment on column public.profiles.default_delivery_lga is
  'Local Government Area. Not validated against the state — there are 774 of '
  'them and no authoritative list ships with this app.';

comment on column public.profiles.default_delivery_landmark is
  'Nearest landmark, e.g. "opposite Ikeja City Mall". How a rider actually '
  'finds the place.';

commit;

-- orders.delivery_* deliberately stays as it is. Those columns are the
-- record of where one order actually went; these are only the defaults
-- that prefill the next checkout. Snapshotting the new fields onto an
-- order is a separate change to the checkout flow, not to this table.

notify pgrst, 'reload schema';
