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

// Build a combined regex for fast matching
export function buildSlopRegex(modelType = 'universal') {
    const patterns = [...UNIVERSAL_SLOP];

    if (modelType === 'claude' || modelType === 'all') patterns.push(...CLAUDE_SLOP);
    if (modelType === 'gpt' || modelType === 'all') patterns.push(...GPT_SLOP);
    if (modelType === 'deepseek' || modelType === 'all') patterns.push(...DEEPSEEK_SLOP);
    if (modelType === 'gemini' || modelType === 'all') patterns.push(...GEMINI_SLOP);

    // Escape regex special chars and join
    const escaped = patterns.map(p =>
        p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    );
    return new RegExp(`(${escaped.join('|')})`, 'gi');
}

// Get severity for a slop match (1-3)
export function getSlopSeverity(match) {
    const lower = match.toLowerCase();
    // Corporate language is severity 3 (worst)
    if (UNIVERSAL_SLOP.slice(-10).some(s => lower.includes(s))) return 3;
    // Clichés are severity 2
    if (UNIVERSAL_SLOP.some(s => lower.includes(s))) return 2;
    // Model-specific is severity 1 (mildest)
    return 1;
}
