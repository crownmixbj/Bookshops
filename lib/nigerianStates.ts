/**
 * Nigeria's 36 states plus the Federal Capital Territory.
 *
 * Stored as the plain state name, not a code: there is no universally
 * used code scheme for Nigerian states, and every downstream consumer of
 * this field — a courier's form, a shop's WhatsApp message — wants the
 * name anyway.
 *
 * "Federal Capital Territory" rather than "Abuja": Abuja is the city
 * inside it, and a delivery form that offers both invites two spellings
 * of the same place.
 */
export const NIGERIAN_STATES = [
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bauchi',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Edo',
  'Ekiti',
  'Enugu',
  'Federal Capital Territory',
  'Gombe',
  'Imo',
  'Jigawa',
  'Kaduna',
  'Kano',
  'Katsina',
  'Kebbi',
  'Kogi',
  'Kwara',
  'Lagos',
  'Nasarawa',
  'Niger',
  'Ogun',
  'Ondo',
  'Osun',
  'Oyo',
  'Plateau',
  'Rivers',
  'Sokoto',
  'Taraba',
  'Yobe',
  'Zamfara',
] as const;

export type NigerianState = (typeof NIGERIAN_STATES)[number];
