export function guessCategory(t){const s=String(t).toLowerCase();
if(/(uniform|shirt|sock|shoe|sandal)/.test(s))return 'uniform';
if(/(pen|pencil|note ?book|exercise book)/.test(s))return 'stationery';
return 'other';}