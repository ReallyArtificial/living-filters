import weekendFixes from './weekend-fixes/filter.mjs';
import stackBreakers from './stack-breakers/filter.mjs';

export const filters = { [weekendFixes.kind]: weekendFixes, [stackBreakers.kind]: stackBreakers };
