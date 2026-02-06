/**
 * Prompt Templates Library
 * Pre-built prompts for common writing scenarios with variable substitution
 */

export const promptTemplates = {
  dialogue: [
    {
      id: 'confrontation',
      name: 'Confrontation Scene',
      description: 'Two characters confront each other about a conflict',
      template: '[CHARACTER A] confronts [CHARACTER B] about [ISSUE]. The tension is [TENSION]. Setting: [LOCATION]. [CHARACTER A] feels [EMOTION A] while [CHARACTER B] feels [EMOTION B].',
      variables: ['CHARACTER A', 'CHARACTER B', 'ISSUE', 'TENSION', 'LOCATION', 'EMOTION A', 'EMOTION B'],
      category: 'Dialogue'
    },
    {
      id: 'reveal',
      name: 'Secret Reveal',
      description: 'A character reveals an important secret',
      template: '[CHARACTER] reveals to [CHARACTER 2] that [SECRET]. The revelation happens at [LOCATION] and [CHARACTER 2] reacts with [REACTION].',
      variables: ['CHARACTER', 'CHARACTER 2', 'SECRET', 'LOCATION', 'REACTION'],
      category: 'Dialogue'
    },
    {
      id: 'negotiation',
      name: 'Negotiation Scene',
      description: 'Characters negotiate or bargain',
      template: '[CHARACTER A] and [CHARACTER B] negotiate about [TOPIC]. [CHARACTER A] wants [GOAL A] while [CHARACTER B] wants [GOAL B]. The stakes are [STAKES].',
      variables: ['CHARACTER A', 'CHARACTER B', 'TOPIC', 'GOAL A', 'GOAL B', 'STAKES'],
      category: 'Dialogue'
    },
    {
      id: 'argument',
      name: 'Heated Argument',
      description: 'Two characters have a heated disagreement',
      template: '[CHARACTER A] and [CHARACTER B] argue about [SUBJECT]. [CHARACTER A] believes [POSITION A] while [CHARACTER B] believes [POSITION B]. The argument escalates when [TRIGGER].',
      variables: ['CHARACTER A', 'CHARACTER B', 'SUBJECT', 'POSITION A', 'POSITION B', 'TRIGGER'],
      category: 'Dialogue'
    }
  ],

  descriptions: [
    {
      id: 'character-intro',
      name: 'Character Introduction',
      description: 'Introduce a character for the first time',
      template: 'Describe [CHARACTER NAME] as they enter [LOCATION] for the first time. Focus on their [PHYSICAL/EMOTIONAL] appearance. Tone: [TONE]. Highlight their most distinctive feature: [FEATURE].',
      variables: ['CHARACTER NAME', 'LOCATION', 'PHYSICAL/EMOTIONAL', 'TONE', 'FEATURE'],
      category: 'Descriptions'
    },
    {
      id: 'setting',
      name: 'Setting Description',
      description: 'Describe a location or environment',
      template: 'Describe [LOCATION] at [TIME OF DAY]. Atmosphere: [MOOD]. Include sensory details: [SENSES]. The place is significant because [SIGNIFICANCE].',
      variables: ['LOCATION', 'TIME OF DAY', 'MOOD', 'SENSES', 'SIGNIFICANCE'],
      category: 'Descriptions'
    },
    {
      id: 'object',
      name: 'Object Description',
      description: 'Describe an important object',
      template: 'Describe [OBJECT NAME] in detail. It looks [APPEARANCE] and feels [TEXTURE]. Its history: [HISTORY]. It\'s important because [IMPORTANCE].',
      variables: ['OBJECT NAME', 'APPEARANCE', 'TEXTURE', 'HISTORY', 'IMPORTANCE'],
      category: 'Descriptions'
    },
    {
      id: 'atmosphere',
      name: 'Atmospheric Description',
      description: 'Create a mood or atmosphere',
      template: 'Create a [MOOD] atmosphere at [LOCATION]. Focus on [ELEMENT] that contributes to the feeling. The air feels [QUALITY] and there\'s a sense of [EMOTION].',
      variables: ['MOOD', 'LOCATION', 'ELEMENT', 'QUALITY', 'EMOTION'],
      category: 'Descriptions'
    }
  ],

  action: [
    {
      id: 'chase',
      name: 'Chase Scene',
      description: 'An intense pursuit sequence',
      template: '[CHARACTER] is being chased by [PURSUER] through [LOCATION]. Obstacles: [OBSTACLES]. The chase ends when [RESOLUTION]. Stakes: [STAKES].',
      variables: ['CHARACTER', 'PURSUER', 'LOCATION', 'OBSTACLES', 'RESOLUTION', 'STAKES'],
      category: 'Action'
    },
    {
      id: 'fight',
      name: 'Fight Scene',
      description: 'Physical combat between characters',
      template: '[CHARACTER A] fights [CHARACTER B] using [WEAPON/STYLE A] against [WEAPON/STYLE B]. Location: [LOCATION]. The fight turns when [TURNING POINT]. Winner: [OUTCOME].',
      variables: ['CHARACTER A', 'CHARACTER B', 'WEAPON/STYLE A', 'WEAPON/STYLE B', 'LOCATION', 'TURNING POINT', 'OUTCOME'],
      category: 'Action'
    },
    {
      id: 'escape',
      name: 'Escape Scene',
      description: 'Character(s) escaping from danger',
      template: '[CHARACTER] must escape from [DANGER] at [LOCATION]. They have [TIME LIMIT] and only [RESOURCES] to help them. The escape succeeds/fails because [REASON].',
      variables: ['CHARACTER', 'DANGER', 'LOCATION', 'TIME LIMIT', 'RESOURCES', 'REASON'],
      category: 'Action'
    },
    {
      id: 'heist',
      name: 'Heist/Infiltration',
      description: 'Sneaking into a secure location',
      template: '[CHARACTER] infiltrates [LOCATION] to [OBJECTIVE]. Security: [SECURITY MEASURES]. The plan involves [STRATEGY]. Complications: [COMPLICATIONS].',
      variables: ['CHARACTER', 'LOCATION', 'OBJECTIVE', 'SECURITY MEASURES', 'STRATEGY', 'COMPLICATIONS'],
      category: 'Action'
    }
  ],

  characters: [
    {
      id: 'backstory',
      name: 'Character Backstory',
      description: 'Develop a character\'s history',
      template: 'Create a backstory for [CHARACTER NAME], a [AGE]-year-old [OCCUPATION]. Key trauma: [TRAUMATIC EVENT]. This event shaped them to become [PERSONALITY TRAIT]. Current motivation: [GOAL]. They fear [FEAR].',
      variables: ['CHARACTER NAME', 'AGE', 'OCCUPATION', 'TRAUMATIC EVENT', 'PERSONALITY TRAIT', 'GOAL', 'FEAR'],
      category: 'Characters'
    },
    {
      id: 'motivation',
      name: 'Character Motivation',
      description: 'Define what drives a character',
      template: '[CHARACTER NAME] is driven by [PRIMARY MOTIVATION] because [REASON]. Their ultimate goal is [GOAL]. They will go as far as [LIMIT] to achieve it. Their motivation conflicts with [OBSTACLE].',
      variables: ['CHARACTER NAME', 'PRIMARY MOTIVATION', 'REASON', 'GOAL', 'LIMIT', 'OBSTACLE'],
      category: 'Characters'
    },
    {
      id: 'relationship',
      name: 'Character Relationship',
      description: 'Define relationship between two characters',
      template: '[CHARACTER A] and [CHARACTER B] have a [RELATIONSHIP TYPE] relationship. They met when [MEETING]. [CHARACTER A] sees [CHARACTER B] as [PERCEPTION A] while [CHARACTER B] sees [CHARACTER A] as [PERCEPTION B]. Their relationship changes when [TURNING POINT].',
      variables: ['CHARACTER A', 'CHARACTER B', 'RELATIONSHIP TYPE', 'MEETING', 'PERCEPTION A', 'PERCEPTION B', 'TURNING POINT'],
      category: 'Characters'
    },
    {
      id: 'arc',
      name: 'Character Arc',
      description: 'Plan a character\'s development',
      template: '[CHARACTER NAME] starts the story as [INITIAL STATE]. Through [EVENTS], they learn [LESSON] and become [FINAL STATE]. The key moment of change is [CLIMAX MOMENT].',
      variables: ['CHARACTER NAME', 'INITIAL STATE', 'EVENTS', 'LESSON', 'FINAL STATE', 'CLIMAX MOMENT'],
      category: 'Characters'
    }
  ],

  plot: [
    {
      id: 'conflict',
      name: 'Plot Conflict',
      description: 'Create a central conflict',
      template: '[CHARACTER/GROUP A] wants [GOAL A] but [CHARACTER/GROUP B] wants [GOAL B]. They cannot both succeed because [INCOMPATIBILITY]. The conflict escalates when [ESCALATION]. Stakes: [CONSEQUENCES].',
      variables: ['CHARACTER/GROUP A', 'GOAL A', 'CHARACTER/GROUP B', 'GOAL B', 'INCOMPATIBILITY', 'ESCALATION', 'CONSEQUENCES'],
      category: 'Plot'
    },
    {
      id: 'twist',
      name: 'Plot Twist',
      description: 'Design a surprising revelation',
      template: 'The characters believe [ASSUMPTION] but the truth is actually [REALITY]. This is revealed when [REVELATION MOMENT]. The twist is foreshadowed by [HINTS]. This changes everything because [IMPACT].',
      variables: ['ASSUMPTION', 'REALITY', 'REVELATION MOMENT', 'HINTS', 'IMPACT'],
      category: 'Plot'
    },
    {
      id: 'subplot',
      name: 'Subplot Development',
      description: 'Create a secondary storyline',
      template: 'While the main plot focuses on [MAIN PLOT], [CHARACTER] deals with [SUBPLOT ISSUE]. This subplot involves [ELEMENTS] and connects to the main plot when [CONNECTION]. Resolution: [RESOLUTION].',
      variables: ['MAIN PLOT', 'CHARACTER', 'SUBPLOT ISSUE', 'ELEMENTS', 'CONNECTION', 'RESOLUTION'],
      category: 'Plot'
    },
    {
      id: 'climax',
      name: 'Climactic Scene',
      description: 'Design the story\'s climax',
      template: 'The climax happens at [LOCATION] where [CHARACTER] must [CHALLENGE]. The odds are [ODDS]. The outcome depends on [DECISION]. If they succeed, [SUCCESS OUTCOME]. If they fail, [FAILURE OUTCOME].',
      variables: ['LOCATION', 'CHARACTER', 'CHALLENGE', 'ODDS', 'DECISION', 'SUCCESS OUTCOME', 'FAILURE OUTCOME'],
      category: 'Plot'
    }
  ],

  worldbuilding: [
    {
      id: 'culture',
      name: 'Culture/Society',
      description: 'Develop a culture or society',
      template: 'The [CULTURE NAME] people live in [LOCATION TYPE]. They value [VALUES] above all else. Their society is organized by [SOCIAL STRUCTURE]. A unique custom: [CUSTOM]. They are known for [SPECIALTY].',
      variables: ['CULTURE NAME', 'LOCATION TYPE', 'VALUES', 'SOCIAL STRUCTURE', 'CUSTOM', 'SPECIALTY'],
      category: 'Worldbuilding'
    },
    {
      id: 'magic-system',
      name: 'Magic/Power System',
      description: 'Design a magic or power system',
      template: 'The [POWER NAME] system works by [MECHANISM]. Users can [ABILITIES]. Limitations: [LIMITATIONS]. Cost/risk: [COST]. Only [WHO CAN USE] can access this power.',
      variables: ['POWER NAME', 'MECHANISM', 'ABILITIES', 'LIMITATIONS', 'COST', 'WHO CAN USE'],
      category: 'Worldbuilding'
    },
    {
      id: 'history',
      name: 'Historical Event',
      description: 'Create a significant historical event',
      template: '[EVENT NAME] happened [TIME] ago when [WHAT HAPPENED]. This was caused by [CAUSE]. The consequences were [CONSEQUENCES]. It changed [WORLD/SOCIETY] by [CHANGE]. People remember it as [LEGACY].',
      variables: ['EVENT NAME', 'TIME', 'WHAT HAPPENED', 'CAUSE', 'CONSEQUENCES', 'WORLD/SOCIETY', 'CHANGE', 'LEGACY'],
      category: 'Worldbuilding'
    },
    {
      id: 'technology',
      name: 'Technology/Innovation',
      description: 'Design a technology or innovation',
      template: '[TECH NAME] is a [TYPE] that [FUNCTION]. It was invented by [INVENTOR] for [PURPOSE]. It works by [MECHANISM]. Drawbacks: [DRAWBACKS]. It has changed society by [IMPACT].',
      variables: ['TECH NAME', 'TYPE', 'FUNCTION', 'INVENTOR', 'PURPOSE', 'MECHANISM', 'DRAWBACKS', 'IMPACT'],
      category: 'Worldbuilding'
    }
  ],

  scenes: [
    {
      id: 'opening',
      name: 'Opening Scene',
      description: 'Start a story or chapter',
      template: 'Open with [CHARACTER] in [LOCATION] doing [ACTIVITY]. The mood is [MOOD]. Immediately establish [HOOK]. The scene hints at [FORESHADOWING].',
      variables: ['CHARACTER', 'LOCATION', 'ACTIVITY', 'MOOD', 'HOOK', 'FORESHADOWING'],
      category: 'Scenes'
    },
    {
      id: 'transition',
      name: 'Scene Transition',
      description: 'Connect two scenes smoothly',
      template: 'Transition from [SCENE A] at [LOCATION A] to [SCENE B] at [LOCATION B]. Bridge: [CONNECTION]. Time passed: [TIME]. The transition emphasizes [THEME/CONTRAST].',
      variables: ['SCENE A', 'LOCATION A', 'SCENE B', 'LOCATION B', 'CONNECTION', 'TIME', 'THEME/CONTRAST'],
      category: 'Scenes'
    },
    {
      id: 'cliffhanger',
      name: 'Cliffhanger Ending',
      description: 'End a chapter with suspense',
      template: 'End the chapter with [CHARACTER] discovering [DISCOVERY] at [LOCATION]. This reveals [IMPLICATION]. The reader is left wondering [QUESTION]. The next chapter will [RESOLUTION HINT].',
      variables: ['CHARACTER', 'DISCOVERY', 'LOCATION', 'IMPLICATION', 'QUESTION', 'RESOLUTION HINT'],
      category: 'Scenes'
    },
    {
      id: 'emotional',
      name: 'Emotional Scene',
      description: 'Write a deeply emotional moment',
      template: '[CHARACTER] experiences [EMOTION] when [TRIGGER]. They are in [LOCATION]. Internal thoughts: [THOUGHTS]. Physical reaction: [PHYSICAL]. This moment changes them by [CHANGE].',
      variables: ['CHARACTER', 'EMOTION', 'TRIGGER', 'LOCATION', 'THOUGHTS', 'PHYSICAL', 'CHANGE'],
      category: 'Scenes'
    }
  ]
};

/**
 * Get all templates as a flat array
 */
export const getAllTemplates = () => {
  return Object.values(promptTemplates).flat();
};

/**
 * Get templates by category
 */
export const getTemplatesByCategory = (category) => {
  return promptTemplates[category.toLowerCase()] || [];
};

/**
 * Find a template by ID
 */
export const getTemplateById = (id) => {
  const allTemplates = getAllTemplates();
  return allTemplates.find(template => template.id === id);
};

/**
 * Get all categories
 */
export const getCategories = () => {
  return Object.keys(promptTemplates);
};

/**
 * Replace variables in template with values
 */
export const fillTemplate = (template, variables) => {
  let filled = template;
  Object.entries(variables).forEach(([varName, value]) => {
    const regex = new RegExp(`\\[${varName}\\]`, 'g');
    filled = filled.replace(regex, value || `[${varName}]`);
  });
  return filled;
};

export default promptTemplates;
