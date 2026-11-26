// Picks the comment shown in the result window from the rules in public/phrases.js (window.DOUDIZHU_PHRASES).
// The rules are checked from top to bottom; the first one whose condition holds is used, and one of its words is
// picked at random. Returns null when there is nothing to show (no file, no rule matches, ...).

const VARIABLES = [
    'win',
    'lose',
    'landlord',
    'peasant',
    'bomb',
    'self_bomb',
    'other_bomb',
    'spring',
    'reverse_spring',
    'hand_left',
    'base',
    'multiplier',
    'concede',
];

export function pickPhrase(values, config = typeof window !== 'undefined' ? window.DOUDIZHU_PHRASES : null, random = Math.random) {
    if (!config || !Array.isArray(config.rules)) return null;
    const args = VARIABLES.map((name) => values[name]);
    for (const rule of config.rules) {
        if (!rule || !Array.isArray(rule.say) || rule.say.length === 0) continue;
        // after a concession only the rules that mention "concede" are used (otherwise a "lose" rule would match)
        if (values.concede && !/\bconcede\b/.test(String(rule.when))) continue;
        let ok = false;
        try {
            // eslint-disable-next-line no-new-func
            ok = !!new Function(...VARIABLES, 'return (' + rule.when + ');')(...args);
        } catch (e) {
            console.warn('phrases.js: cannot evaluate the condition "' + rule.when + '"', e);
        }
        if (ok) {
            const word = rule.say[Math.floor(random() * rule.say.length)];
            return String(word);
        }
    }
    return null;
}
