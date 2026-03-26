/**
 * Craft Engine — Slop Detection Data
 * Model-specific slop patterns + banned phrases from community research
 * and the Antislop academic paper (arxiv.org/pdf/2510.15061)
 */

// Universal AI slop — appears across all models
export const UNIVERSAL_SLOP = [
    // Sensory clichés
    'breath hitched', 'shivers down', 'shiver down', 'sent shivers',
    'electricity through', 'electric shock', 'jolt of electricity',
    'heart pounded', 'heart hammered', 'heart raced', 'pulse quickened',
    'blood ran cold', 'stomach dropped', 'stomach churned',
    'knees went weak', 'knees buckled', 'world seemed to stop',
    'time seemed to slow', 'time stood still',

    // Visual clichés
    'obsidian eyes', 'piercing eyes', 'pools of', 'orbs',
    'chiseled jaw', 'sculpted features', 'impossibly beautiful',
    'ethereal beauty', 'otherworldly', 'preternatural',

    // Smell clichés (the ozone problem)
    'scent of ozone', 'smell of ozone', 'ozone and',
    'petrichor', 'sandalwood and', 'musk and pine',

    // Action clichés
    'with practiced ease', 'with fluid grace', 'like a coiled spring',
    'predatory grace', 'feral grin', 'wolfish grin', 'sardonic smile',
    'knowing smirk', 'arched an eyebrow', 'raised an eyebrow',

    // Emotional clichés
    'a mix of emotions', 'conflicting emotions', 'warring emotions',
    'palpable tension', 'thick with tension', 'hung heavy in the air',
    'comfortable silence', 'pregnant pause', 'weight of the world',

    // Corporate AI language
    'delve into', 'navigate', 'landscape', 'robust', 'leverage',
    'streamline', 'cutting-edge', 'innovative', 'seamless', 'empower',
    'paradigm', 'synergy', 'holistic', 'proactive', 'stakeholder',

    // Romance slop
    'claimed his lips', 'claimed her lips', 'captured his lips',
    'feathered kisses', 'trailed kisses', 'peppered kisses',
    'possessively grabbed', 'grabbed her chin', 'grabbed his chin',
    'tilted her chin', 'tilted his chin',
    'growl from his chest', 'rumble in his chest', 'chest rumbled',
    'gravelly register', 'husky voice', 'voice dripping with',
    'whispering in your ear', 'hot breath against',

    // Meta/narrative slop
    'little did they know', 'unbeknownst to',
    'if only they knew', 'the irony was not lost',
    'needless to say', 'suffice to say',
    'it was then that', 'it was at that moment',
    'and just like that', 'before they knew it'
];

// Claude-specific patterns
export const CLAUDE_SLOP = [
    'I should note', 'it\'s worth noting', 'it bears mentioning',
    'I want to emphasize', 'I should mention',
    'certainly', 'indeed', 'furthermore', 'moreover', 'nevertheless',
    'whilst', 'amongst', 'upon', 'thus', 'hence',
    'a testament to', 'spoke volumes', 'was not lost on',
    'couldn\'t help but', 'found himself', 'found herself',
    'something akin to', 'nothing short of', 'the very essence of'
];

// GPT-specific patterns
export const GPT_SLOP = [
    'Eldoria', 'Princess Elara', 'tapestry of',
    'crucible of', 'beacon of hope', 'testament to',
    'in the annals of', 'forged in the fires of',
    'a dance of', 'symphony of', 'canvas of',
    'etched into', 'woven into the fabric',
    'the weight of responsibility', 'the burden of leadership'
];

// DeepSeek-specific patterns
export const DEEPSEEK_SLOP = [
    'somewhere,', 'somewhere in the distance',
    'as if the universe itself', 'as if fate itself',
    'the cosmos seemed to', 'reality itself seemed to',
    'a knowing smile played', 'eyes that held centuries',
    'ancient wisdom', 'timeless beauty'
];

// Gemini-specific patterns
export const GEMINI_SLOP = [
    'a kaleidoscope of', 'myriad of', 'plethora of',
    'a surge of', 'a wave of', 'a rush of',
    'deep breath', 'let out a breath', 'exhaled slowly'
];

// Repetitive sentence starters (echo detection)
export const ECHO_STARTERS = [
    /^(he|she|they|it|the|his|her|their|its)\s/i,
    /^(and then|then|but then|so then)\s/i,
    /^(with a|with the|with his|with her)\s/i,
    /^(there was|there were|it was|it seemed)\s/i
];

// Banned ending patterns
export const BAD_ENDINGS = [
    /\.\s*(almost|nearly|not quite|perhaps|maybe)\.\s*$/i,
    /\?\s*$/,  // Questions at end
    /\.{3}\s*$/,  // Trailing ellipsis
    /\b(normal|ordinary|routine)\b.*\.\s*$/i,  // Meta-commentary about normalcy
    /^[A-Z][a-z]+\.\s*$/m  // Single-word fragment ending
];

// Overused dialogue tags (not "said")
export const OVERUSED_TAGS = [
    'muttered', 'murmured', 'whispered', 'breathed',
    'hissed', 'growled', 'purred', 'cooed'
];

// ─── Frequency-vs-Human Baselines ────────────────────────────────────
// How many times more frequently each phrase appears in AI text vs human text.
// Based on Antislop paper (arxiv.org/pdf/2510.15061) + community data.
// Higher = worse. A ratio of 500 means AI uses it 500x more than human writers.
export const SLOP_FREQUENCY_RATIO = {
    // 1000x+ (extreme AI fingerprint)
    'breath hitched': 1200, 'shivers down': 800, 'shiver down': 800,
    'sent shivers': 600, 'electricity through': 900, 'jolt of electricity': 1100,
    'heart pounded': 500, 'heart hammered': 700, 'pulse quickened': 900,
    'knees went weak': 600, 'knees buckled': 400, 'world seemed to stop': 800,
    'time seemed to slow': 700, 'time stood still': 300,
    'obsidian eyes': 1500, 'piercing eyes': 400, 'orbs': 350,
    'with practiced ease': 1000, 'with fluid grace': 1200, 'predatory grace': 900,
    'feral grin': 800, 'wolfish grin': 700, 'sardonic smile': 500,
    'a mix of emotions': 600, 'conflicting emotions': 500, 'warring emotions': 700,
    'palpable tension': 800, 'thick with tension': 600, 'hung heavy in the air': 500,
    'comfortable silence': 400, 'weight of the world': 300,
    'scent of ozone': 1500, 'petrichor': 400,
    // 100-500x (strong AI signal)
    'delve into': 450, 'landscape': 200, 'robust': 250, 'leverage': 300,
    'paradigm': 350, 'synergy': 400, 'holistic': 300,
    'claimed his lips': 600, 'claimed her lips': 600, 'feathered kisses': 700,
    'peppered kisses': 500, 'gravelly register': 800, 'voice dripping with': 400,
    'a testament to': 350, 'spoke volumes': 300, 'couldn\'t help but': 250,
    'found himself': 200, 'found herself': 200, 'something akin to': 400,
    // 50-100x (moderate AI signal)
    'certainly': 50, 'indeed': 60, 'furthermore': 70, 'moreover': 80,
    'nevertheless': 60, 'thus': 50, 'hence': 55,
    'little did they know': 100, 'unbeknownst to': 150, 'needless to say': 80,
    // Default for unlisted patterns
    '_default': 100
};

/**
 * Get the AI-vs-human frequency ratio for a slop phrase.
 * Higher = worse (more exclusively AI behavior).
 */
export function getSlopFrequencyRatio(phrase) {
    const lower = phrase.toLowerCase();
    for (const [pattern, ratio] of Object.entries(SLOP_FREQUENCY_RATIO)) {
        if (pattern === '_default') continue;
        if (lower.includes(pattern)) return ratio;
    }
    return SLOP_FREQUENCY_RATIO._default;
}

// ─── Structural Slop Patterns ────────────────────────────────────────
// Beyond phrase-level: detect AI behavioral patterns

// Ball-throwing: AI ends responses pushing action back to user
export const BALL_THROWING_PATTERNS = [
    /\b(your (?:call|move|choice|turn|decision))[.,!?\s]*$/im,
    /\b(what (?:do you|will you|would you) (?:do|say|think|decide))\??[.\s]*$/im,
    /\b(the (?:choice|decision|ball) (?:is|was) (?:yours|in your court))[.\s]*$/im,
    /\b(it(?:'s| is) up to you)[.\s]*$/im,
    /\b(deal\??|so\?|well\??)\s*$/im,
    /\b(what('s| is) (?:it gonna|it going to) be)\??[.\s]*$/im,
    /\b(over to you)[.\s]*$/im
];

// Protagonist gravity: everything gravitates toward the user character
export const PROTAGONIST_GRAVITY_PATTERNS = [
    /\b(all eyes (?:turned|were|fell) (?:on|to|toward) you)\b/i,
    /\b(everyone (?:turned|looked|stared|gazed) (?:at|toward) you)\b/i,
    /\b(the (?:room|crowd|group|world) (?:seemed to |)(?:revolve|center|focus) (?:around|on) you)\b/i,
    /\b((?:as if|like) (?:the (?:universe|world|cosmos|fate) (?:itself |)(?:had|was) (?:conspir|align|arrang)))/i,
    /\b(couldn't (?:help but (?:notice|watch|stare|admire|be drawn to)))\b/i,
    /\b(something about (?:you|your))\b/i,
    /\b(there was something (?:about|in|different))\b/i
];

// Build a combined regex for fast matching
export function buildSlopRegex(modelType = 'universal', whitelist = []) {
    const patterns = [...UNIVERSAL_SLOP];

    if (modelType === 'claude' || modelType === 'all') patterns.push(...CLAUDE_SLOP);
    if (modelType === 'gpt' || modelType === 'all') patterns.push(...GPT_SLOP);
    if (modelType === 'deepseek' || modelType === 'all') patterns.push(...DEEPSEEK_SLOP);
    if (modelType === 'gemini' || modelType === 'all') patterns.push(...GEMINI_SLOP);

    // Filter out whitelisted terms
    const whitelistLower = whitelist.map(w => w.toLowerCase());
    const filtered = patterns.filter(p =>
        !whitelistLower.some(w => p.toLowerCase().includes(w) || w.includes(p.toLowerCase()))
    );

    // Escape regex special chars and join
    const escaped = filtered.map(p =>
        p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    if (escaped.length === 0) return new RegExp('(?!)', 'gi'); // match nothing
    return new RegExp(`(${escaped.join('|')})`, 'gi');
}

// Get severity for a slop match (1-3)
const CORPORATE_SLOP = [
    'delve into', 'navigate', 'landscape', 'robust', 'leverage',
    'streamline', 'cutting-edge', 'innovative', 'seamless', 'empower',
    'paradigm', 'synergy', 'holistic', 'proactive', 'stakeholder'
];

export function getSlopSeverity(match) {
    const lower = match.toLowerCase();
    // Corporate language is severity 3 (worst)
    if (CORPORATE_SLOP.some(s => lower.includes(s))) return 3;
    // Clichés are severity 2
    if (UNIVERSAL_SLOP.some(s => lower.includes(s))) return 2;
    // Model-specific is severity 1 (mildest)
    return 1;
}
