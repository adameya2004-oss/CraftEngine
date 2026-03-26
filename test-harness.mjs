/**
 * Craft Engine — Test Harness
 * Tests all pure JS modules: analyzer, craft-rules, slop-data
 * Run: node test-harness.mjs
 */

import {
    SENSORY_WORDS, ALL_SENSORY, SCENE_PATTERNS, BENCHMARKS, STYLE_PRESETS,
    resolvePreset, buildCraftInjection, detectSceneType, getBenchmarks
} from './craft-rules.js';

import {
    buildSlopRegex, ECHO_STARTERS, BAD_ENDINGS, OVERUSED_TAGS,
    getSlopSeverity, getSlopFrequencyRatio, BALL_THROWING_PATTERNS,
    PROTAGONIST_GRAVITY_PATTERNS, UNIVERSAL_SLOP, CLAUDE_SLOP, GPT_SLOP
} from './slop-data.js';

import { analyzeResponse, quickScore, getCharacterSlopProfile, clearCharacterSlop } from './analyzer.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
    if (condition) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        failures.push(name);
        console.log(`  ✗ FAIL: ${name}`);
    }
}

function section(name) {
    console.log(`\n━━━ ${name} ━━━`);
}

// ─── Sample Texts ────────────────────────────────────────────────────

const GOOD_ACTION = `The blade caught firelight as Kael ducked under the swing. Steel shrieked against stone where his head had been a heartbeat before. He rolled, gravel biting into his palms, tasting copper and dust. The air stank of hot metal and sweat.

"Stay down," Voss growled, but Kael was already moving.

Short lunge. Feint left. The real strike came low — a vicious slash across the thigh that opened leather and skin alike. Voss staggered. Blood splattered dark across the flagstones, warm and sharp-scented in the cold air.

Kael didn't wait. He drove his shoulder into the bigger man's chest, felt ribs give beneath the impact, heard the wet crack echo off the courtyard walls. They went down together in a tangle of limbs and iron. The cobblestones were slick with rain and blood. His fingers found the knife at his belt, drew it, pressed the edge against the thick column of Voss's throat.

"Yield," Kael said. His voice was steady. His hands were not.`;

const SLOPPY_TEXT = `Her breath hitched as she gazed into his obsidian eyes. A shiver ran down her spine. The palpable tension hung heavy in the air between them, a comfortable silence that spoke volumes.

He navigated the landscape of her emotions with practiced ease, his wolfish grin sending electricity through her veins. Her heart pounded. Her knees went weak. Time seemed to stop.

"I've been waiting for you," he said, his voice dripping with desire, a feral grin playing across his chiseled jaw.

She found herself drawn to his predatory grace. Something akin to longing filled her chest. She couldn't help but notice how the world seemed to revolve around him. It was nothing short of magical.

Needless to say, they were meant to be. Little did they know what fate had in store. The weight of the world seemed to lift from their shoulders as they delved into the landscape of their newfound love. Your call.`;

const DIALOGUE_HEAVY = `"Get out," Marcus said.

"You don't mean that." Elena set down her glass. The ice clinked against crystal.

"I do," he said. "I've meant it for weeks."

She laughed — a short, brittle sound that cracked against the silence of the kitchen. "Weeks. And you're telling me now. At two in the morning. In your underwear."

"I didn't plan the timing," he said.

"No," she said, "you never plan anything."

Marcus pulled the chair out and sat. The wood groaned under him. He picked at a scratch on the table — the one from when Danny had tried to cut his own birthday cake at four years old.

"I found the messages," he said.

Elena went still.

"All of them," he said. "Going back to March."

She reached for her glass again and drank. The kitchen clock ticked. Somewhere outside, a dog barked twice and went quiet. She turned toward the window.`;

const ECHOING_TEXT = `He walked to the door. He opened it slowly. He peered into the darkness. He took a deep breath. He stepped forward.

She looked at the sky. She noticed the clouds. She felt the wind. She heard the thunder. She smelled the rain.

The man reached for his weapon. The man gripped it tightly. The man raised it high. The man swung with all his might.`;

const BALL_THROWING = `The stranger stepped forward, shadows pooling around her boots. She held out a sealed envelope, the wax still warm and crimson against the yellowed paper.

"This changes everything," she said, and something in her voice made the hairs on your arms stand on end.

What do you do?`;

// ─── Tests ───────────────────────────────────────────────────────────

section('CRAFT RULES — Data Integrity');
assert(SENSORY_WORDS.visual instanceof Set, 'SENSORY_WORDS.visual is a Set');
assert(SENSORY_WORDS.olfactory instanceof Set, 'SENSORY_WORDS.olfactory is a Set');
assert(ALL_SENSORY.size > 100, `ALL_SENSORY has ${ALL_SENSORY.size} words (>100)`);
assert(ALL_SENSORY.has('gleam'), 'ALL_SENSORY includes "gleam"');
assert(ALL_SENSORY.has('stench'), 'ALL_SENSORY includes "stench"');
assert(ALL_SENSORY.has('rough'), 'ALL_SENSORY includes "rough"');
assert(Object.keys(SCENE_PATTERNS).length >= 4, 'SCENE_PATTERNS has 4+ types');
assert(Object.keys(BENCHMARKS).length >= 4, 'BENCHMARKS has 4+ types');
assert(Object.keys(STYLE_PRESETS).length >= 9, `STYLE_PRESETS has ${Object.keys(STYLE_PRESETS).length} presets`);

section('CRAFT RULES — Scene Detection');
assert(detectSceneType(GOOD_ACTION) === 'action', `Action text detected as: ${detectSceneType(GOOD_ACTION)}`);
assert(detectSceneType(DIALOGUE_HEAVY) === 'dialogue', `Dialogue text detected as: ${detectSceneType(DIALOGUE_HEAVY)}`);
assert(detectSceneType('The sunset was beautiful and they walked home.') === 'general', 'Generic text detected as general');

const romanceText = `She kissed his lips, tongue tracing the seam of his mouth. His skin burned under her touch, desire pooling low. She needed him, ached for him, longing like fire in her body. They fell onto the bed, sheets tangling around bare legs.`;
assert(detectSceneType(romanceText) === 'romance', `Romance text detected as: ${detectSceneType(romanceText)}`);

section('CRAFT RULES — Preset Resolution');
const preset = resolvePreset('abercrombie-action');
assert(preset.name === 'Abercrombie Action', 'Resolves abercrombie-action');
assert(preset.benchmarks.sensoryDensity === 1.18, 'Correct sensory density benchmark');

const fallback = resolvePreset('nonexistent-preset');
assert(fallback.name === 'Abercrombie Action', 'Falls back to abercrombie-action for unknown presets');

const customPresets = [{ presetName: 'test', craftPrompt: 'Write like a robot.', benchmarks: { avgSentenceLength: 20 } }];
const custom = resolvePreset('custom_0', customPresets);
assert(custom.craftPrompt === 'Write like a robot.', 'Resolves custom preset');

section('CRAFT RULES — Craft Injection');
const injection = buildCraftInjection({ activePreset: 'miller-literary', slopDetection: 'moderate', customRules: 'No purple prose.' });
assert(injection.includes('[Craft Engine'), 'Injection has header');
assert(injection.includes('flowing, literary rhythm'), 'Injection includes preset prompt');
assert(injection.includes('breath hitched'), 'Injection includes slop avoidance');
assert(injection.includes('SENSORY GROUNDING'), 'Injection includes sensory rules');
assert(injection.includes('No purple prose'), 'Injection includes custom rules');

section('SLOP DATA — Regex Building');
const universalRegex = buildSlopRegex('universal');
assert(universalRegex instanceof RegExp, 'buildSlopRegex returns RegExp');
// Use .match() instead of .test() to avoid lastIndex issues with global regex
assert('her breath hitched in surprise'.match(universalRegex) !== null, 'Catches "breath hitched"');
assert('the palpable tension was overwhelming'.match(universalRegex) !== null, 'Catches "palpable tension"');
assert('The cat sat on the mat.'.match(universalRegex) === null, 'Clean text has no matches');

const claudeRegex = buildSlopRegex('claude');
assert('I should note that this is important'.match(claudeRegex) !== null, 'Claude regex catches "I should note"');
assert('a testament to their courage'.match(claudeRegex) !== null, 'Claude regex catches "a testament to"');

section('SLOP DATA — Whitelist');
const whitelistedRegex = buildSlopRegex('universal', ['breath hitched']);
assert(!whitelistedRegex.test('her breath hitched softly'), 'Whitelist filters "breath hitched"');
assert(whitelistedRegex.test('palpable tension between them'), 'Whitelist does not affect other patterns');

section('SLOP DATA — Severity & Frequency');
assert(getSlopSeverity('delve into') === 3, 'Corporate slop = severity 3');
assert(getSlopSeverity('breath hitched') === 2, 'Cliché slop = severity 2');
assert(getSlopSeverity('certainly') === 1, 'Model-specific = severity 1');
assert(getSlopFrequencyRatio('breath hitched') === 1200, 'breath hitched ratio = 1200');
assert(getSlopFrequencyRatio('obsidian eyes') === 1500, 'obsidian eyes ratio = 1500');
assert(getSlopFrequencyRatio('some random phrase') === 100, 'Unknown phrase = default 100');

section('SLOP DATA — Structural Patterns');
assert(BALL_THROWING_PATTERNS.some(p => p.test('Your call.')), 'Ball-throwing catches "Your call."');
assert(BALL_THROWING_PATTERNS.some(p => p.test('What do you do?')), 'Ball-throwing catches "What do you do?"');
assert(BALL_THROWING_PATTERNS.some(p => p.test("It's up to you.")), 'Ball-throwing catches "It\'s up to you."');
assert(PROTAGONIST_GRAVITY_PATTERNS.some(p => p.test('All eyes turned to you')), 'Protagonist gravity catches "All eyes turned to you"');
assert(PROTAGONIST_GRAVITY_PATTERNS.some(p => p.test('something about you')), 'Protagonist gravity catches "something about you"');

section('ANALYZER — Good Action Scene');
const goodResult = analyzeResponse(GOOD_ACTION, { modelType: 'all' });
console.log(`  Score: ${goodResult.overallScore} (${goodResult.grade}) | Scene: ${goodResult.sceneType}`);
assert(goodResult.overallScore >= 60, `Good action scores ${goodResult.overallScore} >= 60`);
assert(goodResult.grade !== 'F', `Good action not grade F (got ${goodResult.grade})`);
assert(goodResult.sceneType === 'action', `Detected as action scene`);
assert(goodResult.categories.slop.totalMatches <= 3, `Low slop: ${goodResult.categories.slop.totalMatches} matches`);
assert(goodResult.categories.sensory.density > 0.3, `Sensory density ${goodResult.categories.sensory.density} > 0.3`);
assert(goodResult.categories.sensory.sensesUsed >= 3, `${goodResult.categories.sensory.sensesUsed} senses used`);
assert(goodResult.categories.rhythm.stdev > 5, `Rhythm stdev ${goodResult.categories.rhythm.stdev} > 5`);

section('ANALYZER — Sloppy Text');
const slopResult = analyzeResponse(SLOPPY_TEXT, { modelType: 'all' });
console.log(`  Score: ${slopResult.overallScore} (${slopResult.grade}) | Scene: ${slopResult.sceneType}`);
assert(slopResult.overallScore < goodResult.overallScore, `Sloppy (${slopResult.overallScore}) < Good (${goodResult.overallScore})`);
assert(slopResult.categories.slop.totalMatches >= 10, `High slop count: ${slopResult.categories.slop.totalMatches}`);
assert(slopResult.categories.slop.score < 50, `Slop score ${slopResult.categories.slop.score} < 50`);
assert(slopResult.categories.structural.ballThrows > 0, `Ball-throwing detected: ${slopResult.categories.structural.ballThrows}`);
assert(slopResult.suggestions.length > 3, `${slopResult.suggestions.length} suggestions generated`);

section('ANALYZER — Dialogue Heavy');
const dialogueResult = analyzeResponse(DIALOGUE_HEAVY, { modelType: 'all' });
console.log(`  Score: ${dialogueResult.overallScore} (${dialogueResult.grade}) | Scene: ${dialogueResult.sceneType}`);
assert(dialogueResult.sceneType === 'dialogue', `Detected as dialogue scene`);
assert(dialogueResult.categories.dialogue.score >= 0, 'Dialogue analysis ran');
assert(dialogueResult.categories.dialogue.dialogueLines >= 8, `${dialogueResult.categories.dialogue.dialogueLines} dialogue lines`);
assert(dialogueResult.categories.dialogue.saidPct > 0.4, `"said" at ${(dialogueResult.categories.dialogue.saidPct * 100).toFixed(0)}%`);
assert(dialogueResult.categories.slop.totalMatches === 0, `Clean dialogue: ${dialogueResult.categories.slop.totalMatches} slop`);

section('ANALYZER — Echo Detection');
const echoResult = analyzeResponse(ECHOING_TEXT, { modelType: 'all' });
console.log(`  Score: ${echoResult.overallScore} (${echoResult.grade})`);
assert(echoResult.categories.rhythm.echoCount >= 3, `Echo starters: ${echoResult.categories.rhythm.echoCount}`);
assert(echoResult.categories.rhythm.tripleEcho > 0, `Triple echo: ${echoResult.categories.rhythm.tripleEcho}`);
assert(echoResult.categories.rhythm.score < 70, `Rhythm score penalized: ${echoResult.categories.rhythm.score}`);

section('ANALYZER — Ball-Throwing');
const ballResult = analyzeResponse(BALL_THROWING, { modelType: 'all' });
console.log(`  Structural score: ${ballResult.categories.structural.score}`);
assert(ballResult.categories.structural.ballThrows > 0, `Ball-throwing detected: ${ballResult.categories.structural.ballThrows}`);
assert(ballResult.categories.structural.score < 100, `Structural score penalized: ${ballResult.categories.structural.score}`);

section('ANALYZER — Echoing (User Message)');
const userMsg = 'I walk through the ancient crumbling fortress courtyard looking for the mysterious hooded stranger who stole the enchanted medallion from the sacred temple';
const echoingResponse = `You walk through the ancient crumbling fortress courtyard, searching for the mysterious hooded stranger who stole the enchanted medallion from the sacred temple. The fortress courtyard stretches before you, ancient stones crumbling beneath your boots. Somewhere in this crumbling fortress, the mysterious hooded stranger lurks with the enchanted medallion they stole from the sacred temple.`;
const echoingResult = analyzeResponse(echoingResponse, { modelType: 'all', userMessage: userMsg });
console.log(`  Structural issues: ${echoingResult.categories.structural.issues.map(i => i.type).join(', ') || 'none'}`);
assert(echoingResult.categories.structural.issues.some(i => i.type === 'echoing'), 'Echoing detected with user message');

section('ANALYZER — Whitelist / Blacklist');
const wlResult = analyzeResponse(SLOPPY_TEXT, { modelType: 'all', whitelist: ['breath hitched'] });
const noWlResult = analyzeResponse(SLOPPY_TEXT, { modelType: 'all' });
assert(wlResult.categories.slop.totalMatches <= noWlResult.categories.slop.totalMatches, 'Whitelist reduces slop matches');

const blResult = analyzeResponse('The cat sat on the mat and purred contentedly.', { modelType: 'all', blacklist: ['purred contentedly'] });
assert(blResult.categories.slop.totalMatches >= 1, `Blacklist catches custom phrase: ${blResult.categories.slop.totalMatches}`);

section('ANALYZER — Per-Character Slop Tracking');
clearCharacterSlop(); // Reset
analyzeResponse(SLOPPY_TEXT, { modelType: 'all', characterName: 'TestNPC' });
analyzeResponse(SLOPPY_TEXT, { modelType: 'all', characterName: 'TestNPC' });
analyzeResponse(SLOPPY_TEXT, { modelType: 'all', characterName: 'TestNPC' });
const profile = getCharacterSlopProfile('TestNPC');
const profileEntries = Object.entries(profile);
assert(profileEntries.length > 0, `Character profile has ${profileEntries.length} tracked phrases`);
const highUse = profileEntries.filter(([_, count]) => count >= 3);
assert(highUse.length > 0, `${highUse.length} phrases flagged as overused (3+ uses)`);
clearCharacterSlop('TestNPC');
assert(Object.keys(getCharacterSlopProfile('TestNPC')).length === 0, 'Character slop cleared');

section('ANALYZER — quickScore');
const quick = quickScore(GOOD_ACTION, { modelType: 'all' });
assert(typeof quick.score === 'number', 'quickScore returns number');
assert(['A', 'B', 'C', 'D', 'F'].includes(quick.grade), `quickScore grade: ${quick.grade}`);
assert(typeof quick.slopCount === 'number', `quickScore slopCount: ${quick.slopCount}`);
assert(quick.sceneType, `quickScore sceneType: ${quick.sceneType}`);

section('ANALYZER — Edge Cases');
const emptyResult = analyzeResponse('', { modelType: 'all' });
assert(typeof emptyResult.overallScore === 'number', 'Empty text returns numeric score');
assert(!isNaN(emptyResult.overallScore), 'Empty text score is not NaN');

const shortResult = analyzeResponse('Hi.', { modelType: 'all' });
assert(typeof shortResult.overallScore === 'number', 'Very short text returns numeric score');

const longText = GOOD_ACTION.repeat(20);
const longResult = analyzeResponse(longText, { modelType: 'all' });
assert(typeof longResult.overallScore === 'number', 'Very long text returns numeric score');
assert(longResult.wordCount > 2000, `Long text word count: ${longResult.wordCount}`);

// ─── Summary ─────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) {
        console.log(`  ✗ ${f}`);
    }
}
console.log('═'.repeat(50));
process.exit(failed > 0 ? 1 : 0);
