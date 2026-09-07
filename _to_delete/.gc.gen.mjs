export function guessCategory(title) {
  const t = title.toLowerCase();
  if (/(uniform|shirt|short|skirt|trouser|blazer|tie|sock|shoe|sandal)/.test(t)) return 'uniform';
  if (/(pen|pencil|biro|crayon|eraser|ruler|sharpener|note ?book|exercise book|cardboard|file|folder|scissors|glue)/.test(t)) {
    return 'stationery';
  }
  if (/(mathematics|english|science|history|dictionary|textbook|reader|atlas|bible|quran)/.test(t)) {
    return 'textbook';
  }
  return 'other';
}
