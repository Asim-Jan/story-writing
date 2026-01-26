/**
 * RPG Converter - Transforms book data into RPG game elements
 */

/**
 * Converts book characters to RPG characters (NPCs or PCs)
 * @param {Array} characters - Book characters
 * @param {Object} settings - Game settings (ruleSystem, difficulty, etc.)
 * @returns {Array} RPG characters with stats
 */
export function convertCharactersToRPG(characters, settings) {
  const { ruleSystem, difficultyLevel } = settings;

  return characters.map(char => {
    const rpgChar = {
      id: char.id,
      name: char.name,
      originalData: {
        role: char.role,
        background: char.background,
        personality: char.personality,
        motivations: char.motivations,
        fears: char.fears
      },
      imageUrl: char.imageUrl,
      type: determineCharacterType(char.role), // 'pc' or 'npc'
    };

    // Apply rule system specific stats
    if (ruleSystem === 'd20') {
      Object.assign(rpgChar, generateD20Stats(char, difficultyLevel));
    } else if (ruleSystem === 'fate') {
      Object.assign(rpgChar, generateFateStats(char));
    } else if (ruleSystem === 'pbta') {
      Object.assign(rpgChar, generatePbtaStats(char));
    } else {
      Object.assign(rpgChar, generateCustomStats(char));
    }

    return rpgChar;
  });
}

/**
 * Determines if a character should be a player character or NPC
 */
function determineCharacterType(role) {
  const pcRoles = ['protagonist', 'main character', 'hero', 'heroine', 'main'];
  const roleText = (role || '').toLowerCase();
  return pcRoles.some(r => roleText.includes(r)) ? 'pc' : 'npc';
}

/**
 * Generate D&D 5e / d20 system stats
 */
function generateD20Stats(char, difficulty) {
  const isPC = determineCharacterType(char.role) === 'pc';
  const baseLevel = isPC ? 3 : (difficulty === 'easy' ? 1 : difficulty === 'medium' ? 3 : 5);

  // Generate ability scores based on character description
  const strength = generateAbilityScore(char.background, ['strong', 'warrior', 'fighter', 'soldier'], 14);
  const dexterity = generateAbilityScore(char.personality, ['agile', 'quick', 'nimble', 'rogue'], 12);
  const constitution = generateAbilityScore(char.background, ['hardy', 'tough', 'resilient'], 12);
  const intelligence = generateAbilityScore(char.personality, ['smart', 'clever', 'wise', 'scholar'], 12);
  const wisdom = generateAbilityScore(char.personality, ['perceptive', 'insightful', 'intuitive'], 12);
  const charisma = generateAbilityScore(char.personality, ['charming', 'persuasive', 'leader'], 12);

  const charClass = determineClass(char.role, char.background, char.personality);
  const hitDie = getHitDieForClass(charClass);
  const maxHp = hitDie + Math.floor((constitution - 10) / 2) + (baseLevel - 1) * (Math.floor(hitDie / 2) + 1);

  return {
    class: charClass,
    level: baseLevel,
    stats: {
      strength,
      dexterity,
      constitution,
      intelligence,
      wisdom,
      charisma
    },
    hp: maxHp,
    maxHp,
    armorClass: 10 + Math.floor((dexterity - 10) / 2),
    proficiencyBonus: Math.ceil(baseLevel / 4) + 1,
    speed: 30,
    initiative: Math.floor((dexterity - 10) / 2)
  };
}

/**
 * Generate ability score based on character traits
 */
function generateAbilityScore(text, keywords, baseScore) {
  const lowerText = (text || '').toLowerCase();
  const matches = keywords.filter(kw => lowerText.includes(kw)).length;
  return Math.min(20, baseScore + matches * 2 + Math.floor(Math.random() * 3));
}

/**
 * Determine D&D class from character traits
 */
function determineClass(role, background, personality) {
  const traits = `${role} ${background} ${personality}`.toLowerCase();

  if (traits.includes('magic') || traits.includes('wizard') || traits.includes('sorcerer')) return 'Wizard';
  if (traits.includes('warrior') || traits.includes('fighter') || traits.includes('soldier')) return 'Fighter';
  if (traits.includes('rogue') || traits.includes('thief') || traits.includes('assassin')) return 'Rogue';
  if (traits.includes('priest') || traits.includes('healer') || traits.includes('holy')) return 'Cleric';
  if (traits.includes('ranger') || traits.includes('archer') || traits.includes('hunter')) return 'Ranger';
  if (traits.includes('bard') || traits.includes('musician') || traits.includes('performer')) return 'Bard';
  if (traits.includes('monk') || traits.includes('martial artist')) return 'Monk';
  if (traits.includes('paladin') || traits.includes('knight') || traits.includes('champion')) return 'Paladin';
  if (traits.includes('druid') || traits.includes('nature')) return 'Druid';
  if (traits.includes('barbarian') || traits.includes('savage')) return 'Barbarian';
  if (traits.includes('warlock') || traits.includes('pact')) return 'Warlock';

  return 'Fighter'; // Default class
}

/**
 * Get hit die for class
 */
function getHitDieForClass(charClass) {
  const hitDice = {
    'Barbarian': 12,
    'Fighter': 10,
    'Paladin': 10,
    'Ranger': 10,
    'Cleric': 8,
    'Druid': 8,
    'Monk': 8,
    'Rogue': 8,
    'Bard': 8,
    'Warlock': 8,
    'Wizard': 6,
  };
  return hitDice[charClass] || 8;
}

/**
 * Generate Fate Core stats
 */
function generateFateStats(char) {
  const aspects = [];

  if (char.personality) aspects.push({ type: 'High Concept', value: char.personality.substring(0, 50) });
  if (char.motivations) aspects.push({ type: 'Trouble', value: char.motivations.substring(0, 50) });
  if (char.background) aspects.push({ type: 'Background', value: char.background.substring(0, 50) });

  return {
    aspects,
    skills: generateFateSkills(char),
    stunts: [],
    refresh: 3,
    fatePoints: 3
  };
}

/**
 * Generate Fate skills from character traits
 */
function generateFateSkills(char) {
  const skills = [
    'Fight', 'Shoot', 'Athletics', 'Physique', 'Notice', 'Stealth',
    'Empathy', 'Rapport', 'Deceive', 'Contacts', 'Resources', 'Will',
    'Lore', 'Crafts', 'Investigate', 'Provoke', 'Burglary', 'Drive'
  ];

  // Randomly assign skill ratings (Great +4, Good +3, Fair +2, Average +1)
  const selectedSkills = {};
  skills.slice(0, 10).forEach((skill, idx) => {
    if (idx < 1) selectedSkills[skill] = 4; // 1 Great
    else if (idx < 3) selectedSkills[skill] = 3; // 2 Good
    else if (idx < 6) selectedSkills[skill] = 2; // 3 Fair
    else selectedSkills[skill] = 1; // 4 Average
  });

  return selectedSkills;
}

/**
 * Generate PBTA stats
 */
function generatePbtaStats(char) {
  return {
    cool: Math.floor(Math.random() * 3) - 1,
    hard: Math.floor(Math.random() * 3) - 1,
    hot: Math.floor(Math.random() * 3) - 1,
    sharp: Math.floor(Math.random() * 3) - 1,
    weird: Math.floor(Math.random() * 3) - 1,
    harm: 0,
    maxHarm: 6,
    experience: 0,
    moves: []
  };
}

/**
 * Generate custom stats
 */
function generateCustomStats(char) {
  return {
    health: 100,
    maxHealth: 100,
    energy: 50,
    maxEnergy: 50,
    customAttributes: {}
  };
}

/**
 * Convert book locations to game locations/maps
 */
export function convertLocationsToRPG(locations, settings) {
  return locations.map(loc => ({
    id: loc.id,
    name: loc.name,
    type: loc.type || 'area',
    description: loc.description,
    atmosphere: loc.atmosphere,
    imageUrl: loc.imageUrl,
    mapData: {
      connections: [],
      pointsOfInterest: [],
      hiddenSecrets: [],
      npcs: [],
      loot: generateLoot(loc, settings.difficultyLevel),
      dangers: generateDangers(loc, settings.difficultyLevel)
    },
    significance: loc.significance
  }));
}

/**
 * Generate loot for a location
 */
function generateLoot(location, difficulty) {
  const lootTable = [
    { name: 'Gold coins', value: difficulty === 'easy' ? 50 : difficulty === 'medium' ? 100 : 200 },
    { name: 'Healing potion', value: 50, effect: 'Restores 2d4+2 HP' },
    { name: 'Magic scroll', value: 100, effect: 'Random spell' }
  ];

  const lootCount = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3;
  return lootTable.slice(0, lootCount);
}

/**
 * Generate dangers/encounters for a location
 */
function generateDangers(location, difficulty) {
  const dangers = [];
  const locText = `${location.description} ${location.atmosphere}`.toLowerCase();

  if (locText.includes('dark') || locText.includes('danger') || locText.includes('hostile')) {
    dangers.push({
      type: 'combat',
      description: 'Hostile creatures lurk here',
      difficulty
    });
  }

  if (locText.includes('trap') || locText.includes('hidden')) {
    dangers.push({
      type: 'trap',
      description: 'Mechanical or magical trap',
      difficulty
    });
  }

  return dangers;
}

/**
 * Convert plotlines to quests
 */
export function convertPlotlinesToQuests(plotlines, characters, locations) {
  return plotlines.map(plot => ({
    id: plot.id,
    title: plot.title,
    type: plot.type || 'main',
    description: plot.description,
    status: plot.status === 'resolved' ? 'completed' : 'active',
    objectives: generateObjectives(plot),
    rewards: generateRewards(plot),
    prerequisites: [],
    linkedQuests: plot.linkedPlotlines || [],
    npcsInvolved: findRelatedCharacters(plot, characters),
    locationsInvolved: findRelatedLocations(plot, locations),
    branches: [] // For branching storylines
  }));
}

/**
 * Generate quest objectives from plotline
 */
function generateObjectives(plotline) {
  const objectives = [];

  if (plotline.description) {
    // Simple objective generation - can be enhanced with AI
    objectives.push({
      id: 1,
      description: `Investigate ${plotline.title}`,
      completed: false
    });
  }

  if (plotline.conflicts) {
    objectives.push({
      id: 2,
      description: `Resolve the conflict: ${plotline.conflicts}`,
      completed: false
    });
  }

  return objectives;
}

/**
 * Generate quest rewards
 */
function generateRewards(plotline) {
  const baseXP = plotline.type === 'main' ? 1000 : 500;
  return {
    experience: baseXP,
    gold: baseXP / 10,
    items: [],
    reputation: plotline.type === 'main' ? 10 : 5
  };
}

/**
 * Find characters related to a plotline
 */
function findRelatedCharacters(plotline, characters) {
  // Simple name matching - can be enhanced
  const plotText = `${plotline.title} ${plotline.description}`.toLowerCase();
  return characters
    .filter(char => plotText.includes(char.name.toLowerCase()))
    .map(char => char.id);
}

/**
 * Find locations related to a plotline
 */
function findRelatedLocations(plotline, locations) {
  const plotText = `${plotline.title} ${plotline.description}`.toLowerCase();
  return locations
    .filter(loc => plotText.includes(loc.name.toLowerCase()))
    .map(loc => loc.id);
}

/**
 * Generate encounters from chapters
 */
export function generateEncountersFromChapters(chapters, characters, locations, settings) {
  const encounters = [];

  chapters.forEach((chapter, idx) => {
    if (!chapter.content) return;

    const chapterText = chapter.content.toLowerCase();

    // Detect combat scenarios
    if (chapterText.includes('fight') || chapterText.includes('battle') || chapterText.includes('attack')) {
      encounters.push({
        id: `encounter-${idx}-combat`,
        chapterId: chapter.id,
        type: 'combat',
        title: `Combat in ${chapter.title}`,
        description: `A combat encounter from chapter: ${chapter.title}`,
        difficulty: settings.difficultyLevel,
        enemies: generateEnemies(settings.difficultyLevel, settings.partySize),
        location: null // Could be linked to location
      });
    }

    // Detect social encounters
    if (chapterText.includes('negotiate') || chapterText.includes('convince') || chapterText.includes('persuade')) {
      encounters.push({
        id: `encounter-${idx}-social`,
        chapterId: chapter.id,
        type: 'social',
        title: `Negotiation in ${chapter.title}`,
        description: `A social encounter from chapter: ${chapter.title}`,
        difficulty: settings.difficultyLevel,
        npcs: [],
        outcomes: ['success', 'partial', 'failure']
      });
    }

    // Detect puzzle/exploration
    if (chapterText.includes('puzzle') || chapterText.includes('riddle') || chapterText.includes('investigate')) {
      encounters.push({
        id: `encounter-${idx}-puzzle`,
        chapterId: chapter.id,
        type: 'puzzle',
        title: `Mystery in ${chapter.title}`,
        description: `A puzzle or investigation from chapter: ${chapter.title}`,
        difficulty: settings.difficultyLevel,
        hints: [],
        solution: null
      });
    }
  });

  return encounters;
}

/**
 * Generate enemy stat blocks for combat encounters
 */
function generateEnemies(difficulty, partySize) {
  const enemies = [];
  const count = difficulty === 'easy' ? partySize - 1 : difficulty === 'medium' ? partySize : partySize + 2;

  for (let i = 0; i < count; i++) {
    enemies.push({
      name: `Enemy ${i + 1}`,
      hp: difficulty === 'easy' ? 10 : difficulty === 'medium' ? 20 : 30,
      maxHp: difficulty === 'easy' ? 10 : difficulty === 'medium' ? 20 : 30,
      ac: difficulty === 'easy' ? 12 : difficulty === 'medium' ? 14 : 16,
      attackBonus: difficulty === 'easy' ? 3 : difficulty === 'medium' ? 5 : 7,
      damage: difficulty === 'easy' ? '1d6' : difficulty === 'medium' ? '1d8+2' : '1d10+4'
    });
  }

  return enemies;
}
