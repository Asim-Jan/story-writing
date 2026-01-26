/**
 * RPG Exporters - Export RPG data to various VTT formats
 */

/**
 * Export to Foundry VTT format
 */
export function exportToFoundryVTT(rpgData, bookData) {
  const foundryData = {
    name: bookData.bookTitle || 'RPG Campaign',
    description: bookData.overview || '',
    version: '1.0.0',
    minimumCoreVersion: '11.0.0',
    compatibleCoreVersion: '11',
    authors: [{ name: 'Book Writing Studio' }],

    // Actors (Characters & NPCs)
    actors: rpgData.characters.map(char => ({
      _id: char.id,
      name: char.name,
      type: char.type === 'pc' ? 'character' : 'npc',
      img: char.imageUrl || 'icons/svg/mystery-man.svg',
      system: {
        abilities: char.stats ? {
          str: { value: char.stats.strength || 10 },
          dex: { value: char.stats.dexterity || 10 },
          con: { value: char.stats.constitution || 10 },
          int: { value: char.stats.intelligence || 10 },
          wis: { value: char.stats.wisdom || 10 },
          cha: { value: char.stats.charisma || 10 }
        } : {},
        attributes: {
          hp: { value: char.hp, max: char.maxHp },
          ac: { value: char.armorClass }
        },
        details: {
          class: char.class,
          level: char.level,
          background: char.originalData?.background || ''
        }
      }
    })),

    // Journal Entries (Quests & Lore)
    journal: [
      ...rpgData.quests.map(quest => ({
        _id: quest.id,
        name: quest.title,
        type: 'quest',
        content: `
          <h2>${quest.title}</h2>
          <p>${quest.description}</p>
          <h3>Objectives</h3>
          <ul>
            ${quest.objectives.map(obj => `<li>${obj.completed ? '✓' : '○'} ${obj.description}</li>`).join('')}
          </ul>
          <h3>Rewards</h3>
          <ul>
            <li>XP: ${quest.rewards.experience}</li>
            <li>Gold: ${quest.rewards.gold}</li>
            <li>Reputation: ${quest.rewards.reputation}</li>
          </ul>
        `,
        flags: {
          status: quest.status,
          type: quest.type
        }
      })),
      {
        _id: 'campaign-overview',
        name: 'Campaign Overview',
        content: `<h1>${bookData.bookTitle}</h1><p>${bookData.overview}</p>`
      }
    ],

    // Scenes (Locations)
    scenes: rpgData.locations.map(loc => ({
      _id: loc.id,
      name: loc.name,
      img: loc.imageUrl || 'worlds/world.jpg',
      description: loc.description,
      flags: {
        type: loc.type,
        atmosphere: loc.atmosphere,
        loot: loc.mapData?.loot || [],
        dangers: loc.mapData?.dangers || []
      },
      width: 4000,
      height: 3000,
      padding: 0.25,
      initial: false
    })),

    // Rollable Tables (Encounters)
    tables: [
      {
        _id: 'random-encounters',
        name: 'Random Encounters',
        description: 'Random encounters from the campaign',
        results: rpgData.encounters.map((enc, idx) => ({
          _id: enc.id,
          type: 0,
          text: enc.title,
          weight: 1,
          range: [idx + 1, idx + 1],
          drawn: false,
          flags: {
            description: enc.description,
            difficulty: enc.difficulty,
            type: enc.type
          }
        })),
        formula: `1d${rpgData.encounters.length}`
      }
    ]
  };

  return JSON.stringify(foundryData, null, 2);
}

/**
 * Export to Roll20 format
 */
export function exportToRoll20(rpgData, bookData) {
  const roll20Data = {
    schema_version: 3,
    name: bookData.bookTitle || 'RPG Campaign',

    // Characters
    characters: rpgData.characters.map(char => ({
      id: char.id,
      name: char.name,
      avatar: char.imageUrl || '',
      bio: char.originalData?.background || '',
      gmnotes: char.originalData?.personality || '',
      archived: false,
      inplayerjournals: char.type === 'pc' ? 'all' : '',
      controlledby: char.type === 'pc' ? 'all' : '',
      attribs: [
        { name: 'hp', current: char.hp, max: char.maxHp },
        { name: 'ac', current: char.armorClass, max: '' },
        { name: 'level', current: char.level, max: '' },
        { name: 'class', current: char.class, max: '' },
        ...(char.stats ? [
          { name: 'strength', current: char.stats.strength, max: '' },
          { name: 'dexterity', current: char.stats.dexterity, max: '' },
          { name: 'constitution', current: char.stats.constitution, max: '' },
          { name: 'intelligence', current: char.stats.intelligence, max: '' },
          { name: 'wisdom', current: char.stats.wisdom, max: '' },
          { name: 'charisma', current: char.stats.charisma, max: '' }
        ] : [])
      ]
    })),

    // Handouts (Quests & Locations)
    handouts: [
      ...rpgData.quests.map(quest => ({
        id: quest.id,
        name: quest.title,
        notes: quest.description,
        gmnotes: JSON.stringify(quest.objectives),
        inplayerjournals: quest.status === 'active' ? 'all' : '',
        archived: quest.status === 'completed'
      })),
      ...rpgData.locations.map(loc => ({
        id: loc.id,
        name: loc.name,
        notes: loc.description,
        gmnotes: JSON.stringify(loc.mapData),
        avatar: loc.imageUrl || ''
      }))
    ]
  };

  return JSON.stringify(roll20Data, null, 2);
}

/**
 * Generate Campaign PDF data structure
 */
export function generateCampaignPDFData(rpgData, bookData) {
  return {
    title: bookData.bookTitle || 'RPG Campaign',
    subtitle: 'Campaign Guide',
    overview: bookData.overview || '',

    sections: [
      {
        title: 'Characters',
        content: rpgData.characters.map(char => ({
          name: char.name,
          class: char.class,
          level: char.level,
          type: char.type,
          stats: char.stats,
          hp: char.hp,
          maxHp: char.maxHp,
          ac: char.armorClass,
          background: char.originalData?.background || '',
          personality: char.originalData?.personality || ''
        }))
      },
      {
        title: 'Quests',
        content: rpgData.quests.map(quest => ({
          title: quest.title,
          type: quest.type,
          status: quest.status,
          description: quest.description,
          objectives: quest.objectives,
          rewards: quest.rewards,
          branches: quest.branches || []
        }))
      },
      {
        title: 'Locations',
        content: rpgData.locations.map(loc => ({
          name: loc.name,
          type: loc.type,
          description: loc.description,
          atmosphere: loc.atmosphere,
          loot: loc.mapData?.loot || [],
          dangers: loc.mapData?.dangers || [],
          secrets: loc.mapData?.hiddenSecrets || []
        }))
      },
      {
        title: 'Encounters',
        content: rpgData.encounters.map(enc => ({
          title: enc.title,
          type: enc.type,
          difficulty: enc.difficulty,
          description: enc.description,
          enemies: enc.enemies || [],
          rewards: enc.rewards || {}
        }))
      }
    ]
  };
}

/**
 * Generate HTML5 playable game
 */
export function generateHTML5Game(rpgData, bookData) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${bookData.bookTitle || 'RPG Game'}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Georgia', serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .game-container {
      max-width: 800px;
      width: 100%;
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .content {
      padding: 30px;
    }
    .quest-card {
      background: #f9fafb;
      border: 2px solid #e5e7eb;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .quest-title {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 10px;
      color: #1f2937;
    }
    .quest-description {
      color: #4b5563;
      line-height: 1.6;
      margin-bottom: 15px;
    }
    .objectives {
      list-style: none;
      margin: 15px 0;
    }
    .objective {
      padding: 10px;
      background: white;
      border-left: 4px solid #667eea;
      margin-bottom: 8px;
      border-radius: 4px;
    }
    .button {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.3s;
    }
    .button:hover {
      background: #5568d3;
      transform: translateY(-2px);
    }
    .character-sheet {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin: 20px 0;
    }
    .stat-box {
      background: white;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      padding: 15px;
      text-align: center;
    }
    .stat-value {
      font-size: 32px;
      font-weight: bold;
      color: #667eea;
    }
    .stat-label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      margin-top: 5px;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="game-container">
    <div class="header">
      <h1>${bookData.bookTitle || 'RPG Adventure'}</h1>
      <p>${bookData.overview ? bookData.overview.substring(0, 200) + '...' : 'Your adventure awaits'}</p>
    </div>

    <div class="content">
      <div id="game-view"></div>
    </div>
  </div>

  <script>
    const gameData = ${JSON.stringify({ quests: rpgData.quests, characters: rpgData.characters, locations: rpgData.locations }, null, 2)};
    let currentQuest = 0;
    let party = [];

    function renderQuest(questIndex) {
      const quest = gameData.quests[questIndex];
      if (!quest) {
        document.getElementById('game-view').innerHTML = '<h2>Campaign Complete!</h2><p>Congratulations on finishing the adventure!</p>';
        return;
      }

      const html = \`
        <div class="quest-card">
          <div class="quest-title">\${quest.title}</div>
          <div class="quest-description">\${quest.description}</div>

          <h3>Objectives:</h3>
          <ul class="objectives">
            \${quest.objectives.map(obj => \`
              <li class="objective">\${obj.description}</li>
            \`).join('')}
          </ul>

          <div style="margin-top: 20px;">
            <button class="button" onclick="completeQuest()">Complete Quest</button>
          </div>
        </div>
      \`;

      document.getElementById('game-view').innerHTML = html;
    }

    function completeQuest() {
      currentQuest++;
      renderQuest(currentQuest);
    }

    // Initialize
    renderQuest(0);
  </script>
</body>
</html>`;
}

/**
 * Generate Discord bot configuration
 */
export function generateDiscordBotConfig(rpgData, bookData) {
  return {
    name: `${bookData.bookTitle || 'RPG'} Bot`,
    commands: [
      {
        name: 'character',
        description: 'View your character sheet',
        response: 'Character sheet data from RPG'
      },
      {
        name: 'quest',
        description: 'View active quests',
        response: rpgData.quests.filter(q => q.status === 'active')
      },
      {
        name: 'roll',
        description: 'Roll dice (e.g., /roll 1d20+5)',
        handler: 'dice-roller'
      },
      {
        name: 'location',
        description: 'Get info about current location',
        response: rpgData.locations
      }
    ],
    npcs: rpgData.characters.filter(c => c.type === 'npc').map(npc => ({
      name: npc.name,
      personality: npc.originalData?.personality,
      background: npc.originalData?.background
    }))
  };
}
