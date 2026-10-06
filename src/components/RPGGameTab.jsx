import React, { useState, useEffect } from 'react';
import {
  Swords, Dices, Users, Map, Scroll, BookOpen, Sparkles,
  Download, Settings, Play, Shield, Wand2, Crown, UserPlus, Eye, Star, Plus, Target, Trash2, Calculator, Briefcase
} from 'lucide-react';
import axios from 'axios';
import CharacterSheetEditor from './CharacterSheetEditor';
import QuestEditor from './QuestEditor';
import EncounterCard from './EncounterCard';
import WorldMapBuilder from './WorldMapBuilder';
import GameMechanics from './GameMechanics';
import GMTools from './GMTools';
import ExportHub from './ExportHub';
import AIDungeonMaster from './AIDungeonMaster';

const RPGGameTab = ({ bookId, bookData }) => {
  const [activeSubTab, setActiveSubTab] = useState('overview');
  const [rpgData, setRpgData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [selectedQuest, setSelectedQuest] = useState(null);
  const [party, setParty] = useState([]);
  const [activeEncounter, setActiveEncounter] = useState(null);
  const [gameSettings, setGameSettings] = useState({
    genre: 'fantasy',
    ruleSystem: 'd20', // d20, fate, pbta, custom
    difficultyLevel: 'medium',
    partySize: 4,
    enableCombat: true,
    enableMagic: true,
    campaignStyle: 'story-driven' // story-driven, sandbox, dungeon-crawl
  });

  const ruleSystemOptions = [
    { value: 'd20', label: 'D&D 5e / d20 System', description: 'Classic dungeon crawler with stats, classes, and levels' },
    { value: 'fate', label: 'Fate Core', description: 'Narrative-focused with aspects and fate points' },
    { value: 'pbta', label: 'Powered by the Apocalypse', description: 'Story-driven with moves and outcomes' },
    { value: 'custom', label: 'Custom Rules', description: 'Create your own rule system' }
  ];

  const campaignStyles = [
    { value: 'story-driven', label: 'Story-Driven', icon: BookOpen },
    { value: 'sandbox', label: 'Sandbox', icon: Map },
    { value: 'dungeon-crawl', label: 'Dungeon Crawl', icon: Shield }
  ];

  const generateRPGFromBook = async () => {
    setLoading(true);
    try {
      const response = await axios.post(`/api/rpg/generate`, {
        bookId,
        settings: gameSettings
      });
      setRpgData(response.data.rpgData);
    } catch (error) {
      console.error('Error generating RPG:', error);
      alert('Failed to generate RPG. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg p-8">
        <div className="flex items-center gap-4 mb-4">
          <Swords className="w-12 h-12" />
          <div>
            <h2 className="text-3xl font-bold">RPG Game Maker</h2>
            <p className="text-purple-100 mt-1">Transform your book into an interactive roleplaying game</p>
          </div>
        </div>

        {!rpgData ? (
          <div className="mt-6 bg-white/10 backdrop-blur rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-3">Ready to begin your adventure?</h3>
            <p className="text-purple-100 mb-4">
              Convert your story into a fully playable RPG with characters, quests, maps, and encounters.
            </p>
            <button
              onClick={generateRPGFromBook}
              disabled={loading}
              className="bg-white text-purple-600 px-6 py-3 rounded-lg font-semibold hover:bg-purple-50 transition flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600"></div>
                  Generating RPG...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate RPG from Book
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-4 gap-4">
            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
              <Users className="w-8 h-8 mb-2" />
              <div className="text-2xl font-bold">{rpgData.characters?.length || 0}</div>
              <div className="text-sm text-purple-100">Characters</div>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
              <Map className="w-8 h-8 mb-2" />
              <div className="text-2xl font-bold">{rpgData.locations?.length || 0}</div>
              <div className="text-sm text-purple-100">Locations</div>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
              <Scroll className="w-8 h-8 mb-2" />
              <div className="text-2xl font-bold">{rpgData.quests?.length || 0}</div>
              <div className="text-sm text-purple-100">Quests</div>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-lg p-4">
              <Swords className="w-8 h-8 mb-2" />
              <div className="text-2xl font-bold">{rpgData.encounters?.length || 0}</div>
              <div className="text-sm text-purple-100">Encounters</div>
            </div>
          </div>
        )}
      </div>

      {/* Game Settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-6">
          <Settings className="w-6 h-6 text-gray-700" />
          <h3 className="text-xl font-semibold">Game Settings</h3>
        </div>

        <div className="space-y-6">
          {/* Rule System */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Rule System</label>
            <div className="grid grid-cols-1 gap-3">
              {ruleSystemOptions.map(system => (
                <button
                  key={system.value}
                  onClick={() => setGameSettings(prev => ({ ...prev, ruleSystem: system.value }))}
                  className={`text-left p-4 rounded-lg border-2 transition ${
                    gameSettings.ruleSystem === system.value
                      ? 'border-purple-600 bg-purple-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold text-gray-900">{system.label}</div>
                  <div className="text-sm text-gray-600 mt-1">{system.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Campaign Style */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Campaign Style</label>
            <div className="grid grid-cols-3 gap-3">
              {campaignStyles.map(style => {
                const Icon = style.icon;
                return (
                  <button
                    key={style.value}
                    onClick={() => setGameSettings(prev => ({ ...prev, campaignStyle: style.value }))}
                    className={`p-4 rounded-lg border-2 transition flex flex-col items-center ${
                      gameSettings.campaignStyle === style.value
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="w-8 h-8 mb-2" />
                    <span className="font-medium text-sm">{style.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Additional Settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Difficulty Level</label>
              <select
                value={gameSettings.difficultyLevel}
                onChange={(e) => setGameSettings(prev => ({ ...prev, difficultyLevel: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="deadly">Deadly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Party Size</label>
              <input
                type="number"
                min="1"
                max="10"
                value={gameSettings.partySize}
                onChange={(e) => setGameSettings(prev => ({ ...prev, partySize: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Toggle Options */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={gameSettings.enableCombat}
                onChange={(e) => setGameSettings(prev => ({ ...prev, enableCombat: e.target.checked }))}
                className="w-5 h-5 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
              />
              <div>
                <div className="font-medium text-gray-900">Enable Combat System</div>
                <div className="text-sm text-gray-600">Include tactical combat encounters</div>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={gameSettings.enableMagic}
                onChange={(e) => setGameSettings(prev => ({ ...prev, enableMagic: e.target.checked }))}
                className="w-5 h-5 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
              />
              <div>
                <div className="font-medium text-gray-900">Enable Magic System</div>
                <div className="text-sm text-gray-600">Include spells and magical abilities</div>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Quick Start Guide */}
      {!rpgData && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-3 flex items-center gap-2">
            <Crown className="w-5 h-5" />
            How it Works
          </h3>
          <ol className="space-y-2 text-sm text-blue-900">
            <li className="flex gap-2">
              <span className="font-semibold">1.</span>
              <span>Configure your game settings (rule system, difficulty, party size)</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold">2.</span>
              <span>Click "Generate RPG from Book" to convert your story into game content</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold">3.</span>
              <span>Review and customize characters, quests, locations, and encounters</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold">4.</span>
              <span>Export to your favorite VTT platform (Foundry, Roll20) or play directly</span>
            </li>
          </ol>
        </div>
      )}
    </div>
  );

  const handleSaveCharacter = async (updatedChar) => {
    try {
      const updatedCharacters = rpgData.characters.map(c =>
        c.id === updatedChar.id ? updatedChar : c
      );
      const updatedRpgData = { ...rpgData, characters: updatedCharacters };

      await axios.put(`/api/rpg/${bookId}`, { rpgData: updatedRpgData });
      setRpgData(updatedRpgData);
    } catch (error) {
      console.error('Save character error:', error);
      throw error;
    }
  };

  const togglePartyMember = (charId) => {
    setParty(prev => {
      if (prev.includes(charId)) {
        return prev.filter(id => id !== charId);
      } else {
        return [...prev, charId];
      }
    });
  };

  const renderCharacters = () => (
    <div className="space-y-6">
      {/* Party Management */}
      {party.length > 0 && (
        <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-purple-900 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Active Party ({party.length} members)
            </h4>
            <button
              onClick={() => setParty([])}
              className="text-sm text-purple-600 hover:text-purple-800"
            >
              Clear Party
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {party.map(charId => {
              const char = rpgData?.characters?.find(c => c.id === charId);
              return char ? (
                <div key={charId} className="bg-white px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2">
                  {char.imageUrl && (
                    <img src={char.imageUrl} alt={char.name} className="w-5 h-5 rounded-full" />
                  )}
                  {char.name}
                  <button
                    onClick={() => togglePartyMember(charId)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-xl font-semibold">Character Sheets</h3>
        <div className="text-sm text-gray-600">
          {rpgData?.characters?.filter(c => c.type === 'pc').length || 0} PCs • {rpgData?.characters?.filter(c => c.type === 'npc').length || 0} NPCs
        </div>
      </div>

      {rpgData?.characters?.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rpgData.characters.map(char => {
            const isInParty = party.includes(char.id);
            const isPC = char.type === 'pc';

            return (
              <div
                key={char.id}
                className={`bg-white rounded-lg border-2 p-4 hover:shadow-lg transition ${
                  isInParty ? 'border-purple-400 bg-purple-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-lg">{char.name}</h4>
                      {isPC && (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
                          PC
                        </span>
                      )}
                      {isInParty && (
                        <Star className="w-4 h-4 text-purple-600 fill-purple-600" />
                      )}
                    </div>
                    <p className="text-sm text-gray-600">
                      {gameSettings.ruleSystem === 'd20' && `${char.class} • Level ${char.level}`}
                      {gameSettings.ruleSystem === 'fate' && 'Fate Core'}
                      {gameSettings.ruleSystem === 'pbta' && (char.playbook || 'PBTA')}
                      {gameSettings.ruleSystem === 'custom' && 'Custom'}
                    </p>
                  </div>
                  {char.imageUrl && (
                    <img src={char.imageUrl} alt={char.name} className="w-12 h-12 rounded-full object-cover" />
                  )}
                </div>

                {gameSettings.ruleSystem === 'd20' && (
                  <div className="space-y-2 text-sm mb-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600">HP:</span>
                      <span className="font-semibold">{char.hp}/{char.maxHp}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">AC:</span>
                      <span className="font-semibold">{char.armorClass}</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedCharacter(char)}
                    className="flex-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm font-medium transition flex items-center justify-center gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    View Sheet
                  </button>
                  {isPC && (
                    <button
                      onClick={() => togglePartyMember(char.id)}
                      className={`px-3 py-2 rounded text-sm font-medium transition ${
                        isInParty
                          ? 'bg-purple-600 text-white hover:bg-purple-700'
                          : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                      }`}
                      title={isInParty ? 'Remove from party' : 'Add to party'}
                    >
                      <UserPlus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No characters yet. Generate RPG from your book to create characters.</p>
        </div>
      )}
    </div>
  );

  const handleSaveQuest = async (updatedQuest) => {
    try {
      const updatedQuests = rpgData.quests.some(q => q.id === updatedQuest.id)
        ? rpgData.quests.map(q => q.id === updatedQuest.id ? updatedQuest : q)
        : [...rpgData.quests, { ...updatedQuest, id: updatedQuest.id || Date.now() }];

      const updatedRpgData = { ...rpgData, quests: updatedQuests };
      await axios.put(`/api/rpg/${bookId}`, { rpgData: updatedRpgData });
      setRpgData(updatedRpgData);
      setSelectedQuest(null);
    } catch (error) {
      console.error('Save quest error:', error);
      throw error;
    }
  };

  const handleDeleteQuest = async (questId) => {
    if (!confirm('Delete this quest?')) return;

    try {
      const updatedQuests = rpgData.quests.filter(q => q.id !== questId);
      const updatedRpgData = { ...rpgData, quests: updatedQuests };
      await axios.put(`/api/rpg/${bookId}`, { rpgData: updatedRpgData });
      setRpgData(updatedRpgData);
    } catch (error) {
      console.error('Delete quest error:', error);
      alert('Failed to delete quest');
    }
  };

  const renderQuests = () => {
    const questsByStatus = {
      active: rpgData?.quests?.filter(q => q.status === 'active') || [],
      available: rpgData?.quests?.filter(q => q.status === 'available') || [],
      completed: rpgData?.quests?.filter(q => q.status === 'completed') || [],
      failed: rpgData?.quests?.filter(q => q.status === 'failed') || []
    };

    const statusColors = {
      active: 'border-blue-400 bg-blue-50',
      available: 'border-gray-400 bg-gray-50',
      completed: 'border-green-400 bg-green-50',
      failed: 'border-red-400 bg-red-50'
    };

    const questTypeColors = {
      main: 'bg-purple-100 text-purple-700',
      side: 'bg-blue-100 text-blue-700',
      personal: 'bg-green-100 text-green-700',
      faction: 'bg-yellow-100 text-yellow-700'
    };

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-semibold">Quests & Storylines</h3>
          <button
            onClick={() => setSelectedQuest({})}
            className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Quest
          </button>
        </div>

        {/* Quest Stats */}
        <div className="grid grid-cols-4 gap-4">
          {Object.entries(questsByStatus).map(([status, quests]) => (
            <div key={status} className={`border-2 ${statusColors[status]} rounded-lg p-4`}>
              <div className="text-2xl font-bold">{quests.length}</div>
              <div className="text-sm capitalize">{status}</div>
            </div>
          ))}
        </div>

        {/* Quest List */}
        {rpgData?.quests?.length > 0 ? (
          <div className="space-y-4">
            {['active', 'available', 'completed', 'failed'].map(status => {
              const quests = questsByStatus[status];
              if (quests.length === 0) return null;

              return (
                <div key={status}>
                  <h4 className="text-lg font-semibold capitalize mb-3">{status} Quests</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {quests.map(quest => (
                      <div
                        key={quest.id}
                        className={`border-2 ${statusColors[status]} rounded-lg p-4 hover:shadow-lg transition`}
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h5 className="font-semibold text-lg">{quest.title}</h5>
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${questTypeColors[quest.type]}`}>
                                {quest.type}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 line-clamp-2">{quest.description}</p>
                          </div>
                        </div>

                        {/* Objectives Progress */}
                        {quest.objectives && quest.objectives.length > 0 && (
                          <div className="mb-3">
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="font-medium">Objectives</span>
                              <span className="text-gray-600">
                                {quest.objectives.filter(o => o.completed).length}/{quest.objectives.length}
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-purple-600 h-2 rounded-full transition-all"
                                style={{
                                  width: `${(quest.objectives.filter(o => o.completed).length / quest.objectives.length) * 100}%`
                                }}
                              ></div>
                            </div>
                          </div>
                        )}

                        {/* Rewards */}
                        <div className="flex items-center gap-3 text-sm text-gray-600 mb-3">
                          {quest.rewards?.experience && (
                            <div className="flex items-center gap-1">
                              <Target className="w-4 h-4" />
                              <span>{quest.rewards.experience} XP</span>
                            </div>
                          )}
                          {quest.rewards?.gold && (
                            <div>⛁ {quest.rewards.gold}g</div>
                          )}
                        </div>

                        {/* NPCs & Locations */}
                        <div className="flex gap-2 text-xs text-gray-600 mb-3">
                          {quest.npcsInvolved?.length > 0 && (
                            <span className="bg-white px-2 py-1 rounded">
                              {quest.npcsInvolved.length} NPCs
                            </span>
                          )}
                          {quest.locationsInvolved?.length > 0 && (
                            <span className="bg-white px-2 py-1 rounded">
                              {quest.locationsInvolved.length} Locations
                            </span>
                          )}
                          {quest.branches?.length > 0 && (
                            <span className="bg-white px-2 py-1 rounded">
                              {quest.branches.length} Branches
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => setSelectedQuest(quest)}
                            className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 transition text-sm font-medium"
                          >
                            Edit Quest
                          </button>
                          <button
                            onClick={() => handleDeleteQuest(quest.id)}
                            className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition text-sm"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            <Scroll className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No quests yet. Generate RPG from your book or create a quest manually.</p>
          </div>
        )}

        {/* Encounters Section */}
        <div className="border-t pt-6">
          <h3 className="text-xl font-semibold mb-4">Encounters</h3>
          {rpgData?.encounters?.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {rpgData.encounters.slice(0, 6).map(encounter => (
                <EncounterCard
                  key={encounter.id}
                  encounter={encounter}
                  ruleSystem={gameSettings.ruleSystem}
                  onRun={() => setActiveEncounter(encounter)}
                />
              ))}
            </div>
          ) : (
            <p className="text-center py-8 text-gray-500">No encounters generated yet</p>
          )}
        </div>
      </div>
    );
  };

  const handleUpdateLocations = async (updatedLocations) => {
    try {
      const updatedRpgData = { ...rpgData, locations: updatedLocations };
      await axios.put(`/api/rpg/${bookId}`, { rpgData: updatedRpgData });
      setRpgData(updatedRpgData);
    } catch (error) {
      console.error('Update locations error:', error);
      throw error;
    }
  };

  const renderWorldMap = () => {
    if (!rpgData?.locations) {
      return (
        <div className="text-center py-12 text-gray-500">
          <Map className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Generate RPG from your book to create the world map</p>
        </div>
      );
    }

    return (
      <WorldMapBuilder
        locations={rpgData.locations}
        onUpdateLocations={handleUpdateLocations}
        bookId={bookId}
      />
    );
  };

  const renderMechanics = () => {
    return (
      <GameMechanics
        ruleSystem={gameSettings.ruleSystem}
        party={party.map(charId => rpgData?.characters?.find(c => c.id === charId)).filter(Boolean)}
      />
    );
  };

  const renderGMTools = () => {
    return (
      <GMTools
        bookId={bookId}
        campaign={rpgData?.campaign || {}}
        onUpdateCampaign={async (campaignData) => {
          const updatedRpgData = { ...rpgData, campaign: campaignData };
          await axios.put(`/api/rpg/${bookId}`, { rpgData: updatedRpgData });
          setRpgData(updatedRpgData);
        }}
        characters={rpgData?.characters || []}
        locations={rpgData?.locations || []}
        ruleSystem={gameSettings.ruleSystem}
      />
    );
  };

  const renderExport = () => {
    return (
      <ExportHub
        bookId={bookId}
        rpgData={rpgData}
        bookData={bookData}
      />
    );
  };

  const renderAIDM = () => {
    return (
      <AIDungeonMaster
        bookId={bookId}
        rpgData={rpgData}
        bookData={bookData}
        party={party.map(charId => rpgData?.characters?.find(c => c.id === charId)).filter(Boolean)}
        ruleSystem={gameSettings.ruleSystem}
      />
    );
  };

  const subTabs = [
    { id: 'overview', label: 'Overview', icon: BookOpen },
    { id: 'characters', label: 'Characters', icon: Users },
    { id: 'quests', label: 'Quests', icon: Scroll },
    { id: 'worldmap', label: 'World Map', icon: Map },
    { id: 'mechanics', label: 'Game Mechanics', icon: Calculator },
    { id: 'gmtools', label: 'GM Tools', icon: Briefcase },
    { id: 'aidm', label: 'AI Dungeon Master', icon: Sparkles },
    { id: 'export', label: 'Export', icon: Download },
  ];

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`px-4 py-3 font-medium text-sm flex items-center gap-2 border-b-2 transition ${
                  activeSubTab === tab.id
                    ? 'border-purple-600 text-purple-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div>
        {activeSubTab === 'overview' && renderOverview()}
        {activeSubTab === 'characters' && renderCharacters()}
        {activeSubTab === 'quests' && renderQuests()}
        {activeSubTab === 'worldmap' && renderWorldMap()}
        {activeSubTab === 'mechanics' && renderMechanics()}
        {activeSubTab === 'gmtools' && renderGMTools()}
        {activeSubTab === 'aidm' && renderAIDM()}
        {activeSubTab === 'export' && renderExport()}
      </div>

      {/* Character Sheet Editor Modal */}
      {selectedCharacter && (
        <CharacterSheetEditor
          character={selectedCharacter}
          ruleSystem={gameSettings.ruleSystem}
          onClose={() => setSelectedCharacter(null)}
          onSave={handleSaveCharacter}
        />
      )}

      {/* Quest Editor Modal */}
      {selectedQuest && (
        <QuestEditor
          quest={selectedQuest.id ? selectedQuest : null}
          characters={rpgData?.characters || []}
          locations={rpgData?.locations || []}
          ruleSystem={gameSettings.ruleSystem}
          onClose={() => setSelectedQuest(null)}
          onSave={handleSaveQuest}
        />
      )}
    </div>
  );
};

export default RPGGameTab;
