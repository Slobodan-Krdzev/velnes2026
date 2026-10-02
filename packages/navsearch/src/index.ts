export type { Labels, Lang, NavEntry, NavResult, NavTarget } from './types.js';
export { canon, editDistance, queryTokens, tokens, typoBudget } from './normalize.js';
export { buildIndex, MAX_RESULTS, MIN_QUERY, quickLinks, search, type NavIndex } from './rank.js';
export { NavSearch, useNavSearchHotkey } from './NavSearch.js';
export { labelsFromDictionaries } from './labels.js';
