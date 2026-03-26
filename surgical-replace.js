/**
 * Craft Engine — Surgical Replace
 * Zero-LLM-cost slop removal via targeted find/replace.
 * Inspired by unkarelian's final-response-processor approach from Reddit.
 *
 * Instead of rewriting the entire message (expensive LLM call), this does
 * precise regex replacements on detected slop phrases. Users can also
 * export the patterns as SillyTavern regex scripts for zero-cost processing.
 */

import { buildSlopRegex, getSlopFrequencyRatio } from './slop-data.js';

// ─── Replacement Database ────────────────────────────────────────────
// Maps slop phrases to concrete, specific alternatives.
// Multiple alternatives per phrase — picked randomly for variety.

const REPLACEMENTS = {
    // Sensory clichés → specific alternatives
    'breath hitched': ['breathing faltered', 'caught a sharp breath', 'inhaled through teeth'],
    'heart pounded': ['pulse kicked up', 'chest thumped', 'heartbeat hammered in their ears'],
    'heart hammered': ['pulse slammed', 'blood pounded in their temples', 'ribs ached from the drumming'],
    'heart raced': ['pulse spiked', 'blood rushed', 'adrenaline surged'],
    'pulse quickened': ['blood ran faster', 'pulse ticked up', 'heart rate climbed'],
    'shivers down': ['cold raced down', 'goosebumps prickled along', 'skin crawled down'],
    'shiver down': ['cold traced down', 'a chill crawled down', 'ice slid down'],
    'sent shivers': ['raised goosebumps', 'prickled skin', 'set nerves tingling'],
    'electricity through': ['heat through', 'a jolt through', 'a spark through'],
    'jolt of electricity': ['sharp spark', 'sudden heat', 'a crack of sensation'],
    'blood ran cold': ['stomach iced over', 'dread pooled', 'everything went still inside'],
    'stomach dropped': ['gut lurched', 'insides hollowed', 'a pit opened in their belly'],
    'stomach churned': ['gut twisted', 'nausea crawled up', 'bile burned'],
    'knees went weak': ['legs buckled', 'knees threatened to fold', 'balance wavered'],
    'knees buckled': ['legs gave', 'knees folded', 'weight shifted dangerously'],
    'world seemed to stop': ['everything went still', 'sound dropped away', 'the moment stretched'],
    'time seemed to slow': ['seconds stretched', 'the moment elongated', 'everything moved through syrup'],
    'time stood still': ['the clock stopped', 'seconds froze', 'the world paused'],

    // Visual clichés
    'obsidian eyes': ['dark eyes', 'near-black eyes', 'deep brown eyes'],
    'piercing eyes': ['sharp eyes', 'intent eyes', 'focused gaze'],
    'pools of': ['depths of', 'the color of', 'wide with'],
    'orbs': ['eyes', 'gaze', 'stare'],
    'chiseled jaw': ['square jaw', 'hard jaw', 'angled jaw'],
    'sculpted features': ['sharp features', 'defined features', 'angular face'],

    // Smell clichés
    'scent of ozone': ['smell of copper', 'sharp tang', 'burnt metal smell'],
    'smell of ozone': ['copper tang', 'scorched air', 'metallic sharpness'],
    'petrichor': ['wet earth', 'rain-soaked dirt', 'damp stone smell'],

    // Action clichés
    'with practiced ease': ['smoothly', 'without hesitation', 'like muscle memory'],
    'with fluid grace': ['smoothly', 'in one motion', 'without wasted movement'],
    'like a coiled spring': ['wound tight', 'tensed to move', 'ready to snap'],
    'predatory grace': ['dangerous ease', 'lethal calm', 'controlled menace'],
    'feral grin': ['sharp grin', 'wild grin', 'too-wide smile'],
    'wolfish grin': ['crooked grin', 'sharp smile', 'hungry grin'],
    'sardonic smile': ['wry smile', 'dry smirk', 'one-sided grin'],
    'knowing smirk': ['half-smile', 'slanted grin', 'quiet smirk'],
    'arched an eyebrow': ['raised a brow', 'lifted an eyebrow', 'cocked a brow'],
    'raised an eyebrow': ['lifted a brow', 'one brow went up', 'gave a skeptical look'],

    // Emotional clichés
    'a mix of emotions': ['conflicted', 'torn', 'too many feelings at once'],
    'conflicting emotions': ['warring impulses', 'contradictory urges', 'a tangle of feelings'],
    'warring emotions': ['competing impulses', 'a war inside', 'pulling in two directions'],
    'palpable tension': ['thick silence', 'charged air', 'the weight of the unspoken'],
    'thick with tension': ['heavy with silence', 'tight with unease', 'dense with the unsaid'],
    'hung heavy in the air': ['settled over them', 'pressed down', 'lingered'],
    'comfortable silence': ['easy quiet', 'the kind of quiet that didn\'t need filling', 'a silence that felt shared'],
    'weight of the world': ['crushing weight', 'too much gravity', 'the load of it all'],

    // Corporate AI language
    'delve into': ['dig into', 'explore', 'look at'],
    'navigate': ['handle', 'deal with', 'work through'],
    'landscape': ['field', 'terrain', 'territory'],
    'robust': ['solid', 'strong', 'sturdy'],
    'leverage': ['use', 'take advantage of', 'apply'],
    'streamline': ['simplify', 'speed up', 'cut down'],
    'cutting-edge': ['latest', 'newest', 'sharpest'],
    'innovative': ['new', 'fresh', 'original'],
    'seamless': ['smooth', 'clean', 'unbroken'],
    'empower': ['enable', 'give power to', 'strengthen'],

    // Romance slop
    'claimed his lips': ['kissed him', 'pressed their mouth to his', 'caught his mouth'],
    'claimed her lips': ['kissed her', 'pressed their mouth to hers', 'caught her mouth'],
    'feathered kisses': ['light kisses', 'soft brushes of lips', 'barely-there kisses'],
    'peppered kisses': ['scattered kisses', 'pressed quick kisses', 'dotted kisses'],
    'voice dripping with': ['voice thick with', 'voice heavy with', 'voice low with'],
    'gravelly register': ['low rasp', 'rough voice', 'sandpaper tone'],

    // Meta/narrative slop
    'little did they know': ['they didn\'t know yet', 'what they couldn\'t see', 'unknown to them'],
    'unbeknownst to': ['without knowing', 'hidden from', 'beyond the knowledge of'],
    'needless to say': ['obviously', 'of course', ''],
    'suffice to say': ['simply put', 'in short', ''],
    'it was then that': ['that was when', 'then,', 'at that moment,'],
    'it was at that moment': ['right then', 'in that instant', 'that second,'],

    // Claude-specific
    'I should note': ['', 'note:', 'worth knowing:'],
    'it\'s worth noting': ['note that', 'importantly,', ''],
    'a testament to': ['proof of', 'evidence of', 'a sign of'],
    'spoke volumes': ['said everything', 'told the whole story', 'made it clear'],
    'couldn\'t help but': ['', 'had to', 'found themselves'],
    'found himself': ['', 'caught himself', 'realized he was'],
    'found herself': ['', 'caught herself', 'realized she was'],
    'something akin to': ['something like', 'close to', 'near to'],
    'nothing short of': ['truly', 'completely', 'absolutely']
};

/**
 * Apply surgical replacements to text.
 * Returns { text, replacements: [{original, replacement, index}], count }
 */
export function surgicalReplace(text, options = {}) {
    const {
        modelType = 'all',
        whitelist = [],
        customReplacements = {}
    } = options;

    const allReplacements = { ...REPLACEMENTS, ...customReplacements };
    const regex = buildSlopRegex(modelType, whitelist);
    const applied = [];
    let result = text;

    // Find all matches first, then replace from end to start to preserve indices
    const matches = [];
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
        matches.push({ phrase: match[0], index: match.index, length: match[0].length });
    }

    // Replace from end to start
    for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        const key = m.phrase.toLowerCase();
        const alternatives = allReplacements[key];

        if (alternatives && alternatives.length > 0) {
            // Pick a random alternative (filter out empty strings unless it's the only option)
            const nonEmpty = alternatives.filter(a => a.length > 0);
            const pool = nonEmpty.length > 0 ? nonEmpty : alternatives;
            const replacement = pool[Math.floor(Math.random() * pool.length)];

            // Preserve original capitalization
            let finalReplacement = replacement;
            if (m.phrase[0] === m.phrase[0].toUpperCase() && replacement.length > 0) {
                finalReplacement = replacement[0].toUpperCase() + replacement.slice(1);
            }

            result = result.substring(0, m.index) + finalReplacement + result.substring(m.index + m.length);
            applied.push({ original: m.phrase, replacement: finalReplacement, index: m.index });
        }
    }

    return {
        text: result,
        replacements: applied.reverse(), // Return in forward order
        count: applied.length
    };
}

/**
 * Export slop patterns as a SillyTavern-compatible regex script.
 * ST regex scripts are JSON arrays of {scriptName, findRegex, replaceString, ...}
 */
export function exportAsSTRegex(options = {}) {
    const {
        modelType = 'all',
        whitelist = [],
        scriptName = 'CraftEngine Anti-Slop',
        minSeverity = 1
    } = options;

    const allReplacements = { ...REPLACEMENTS };
    const entries = [];

    for (const [phrase, alternatives] of Object.entries(allReplacements)) {
        const ratio = getSlopFrequencyRatio(phrase);
        // Only export phrases above minimum severity threshold
        if (ratio < (minSeverity === 3 ? 400 : minSeverity === 2 ? 100 : 50)) continue;

        const nonEmpty = alternatives.filter(a => a.length > 0);
        if (nonEmpty.length === 0) continue;

        // ST regex format: use the first alternative as the replacement
        // For variety, users can edit these
        entries.push({
            scriptName: `${scriptName}: ${phrase}`,
            findRegex: phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            replaceString: nonEmpty[0],
            trimStrings: [],
            placement: [1], // 1 = AI output
            disabled: false,
            markdownOnly: false,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: false,
            minDepth: null,
            maxDepth: null
        });
    }

    return {
        scriptName,
        entries,
        count: entries.length,
        // Full JSON for import into ST
        json: JSON.stringify(entries, null, 2)
    };
}

/**
 * Quick surgical fix — apply to a message and return the cleaned version.
 * Returns null if no changes were made.
 */
export function quickFix(text, options = {}) {
    const result = surgicalReplace(text, options);
    if (result.count === 0) return null;
    return result;
}
