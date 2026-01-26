import React, { useState } from 'react';
import {
  X, Save, Download, User, Heart, Shield, Zap, Brain, Eye, MessageCircle,
  Sword, Book, Package, Award, Plus, Minus, Edit2, FileDown
} from 'lucide-react';
import axios from 'axios';

const CharacterSheetEditor = ({ character, ruleSystem, onClose, onSave }) => {
  const [editedChar, setEditedChar] = useState({ ...character });
  const [activeTab, setActiveTab] = useState('stats');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(editedChar);
      onClose();
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save character');
    } finally {
      setSaving(false);
    }
  };

  const exportToPDF = async () => {
    setExporting(true);
    try {
      const response = await axios.post('/api/rpg/character/export-pdf', {
        character: editedChar,
        ruleSystem
      }, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${editedChar.name}-character-sheet.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  const exportToJSON = () => {
    const dataStr = JSON.stringify(editedChar, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${editedChar.name}-character.json`;
    link.click();
  };

  const updateStat = (path, value) => {
    setEditedChar(prev => {
      const newChar = { ...prev };
      const keys = path.split('.');
      let obj = newChar;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return newChar;
    });
  };

  const renderD20Stats = () => {
    const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const abilityIcons = {
      strength: Sword,
      dexterity: Zap,
      constitution: Heart,
      intelligence: Brain,
      wisdom: Eye,
      charisma: MessageCircle
    };

    const getModifier = (score) => {
      return Math.floor((score - 10) / 2);
    };

    return (
      <div className="space-y-6">
        {/* Header Info */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={editedChar.name}
              onChange={(e) => updateStat('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
            <select
              value={editedChar.class}
              onChange={(e) => updateStat('class', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            >
              <option>Barbarian</option>
              <option>Bard</option>
              <option>Cleric</option>
              <option>Druid</option>
              <option>Fighter</option>
              <option>Monk</option>
              <option>Paladin</option>
              <option>Ranger</option>
              <option>Rogue</option>
              <option>Sorcerer</option>
              <option>Warlock</option>
              <option>Wizard</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Level</label>
            <input
              type="number"
              min="1"
              max="20"
              value={editedChar.level}
              onChange={(e) => updateStat('level', parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        {/* Main Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Heart className="w-5 h-5 text-red-600" />
              <span className="font-semibold text-red-900">Hit Points</span>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={editedChar.hp}
                onChange={(e) => updateStat('hp', parseInt(e.target.value))}
                className="w-20 px-2 py-1 border border-red-300 rounded text-center text-lg font-bold"
              />
              <span className="text-gray-500 text-lg">/</span>
              <input
                type="number"
                value={editedChar.maxHp}
                onChange={(e) => updateStat('maxHp', parseInt(e.target.value))}
                className="w-20 px-2 py-1 border border-red-300 rounded text-center text-lg font-bold"
              />
            </div>
          </div>

          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-blue-600" />
              <span className="font-semibold text-blue-900">Armor Class</span>
            </div>
            <input
              type="number"
              value={editedChar.armorClass}
              onChange={(e) => updateStat('armorClass', parseInt(e.target.value))}
              className="w-full px-2 py-1 border border-blue-300 rounded text-center text-2xl font-bold"
            />
          </div>

          <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-purple-600" />
              <span className="font-semibold text-purple-900">Initiative</span>
            </div>
            <input
              type="number"
              value={editedChar.initiative}
              onChange={(e) => updateStat('initiative', parseInt(e.target.value))}
              className="w-full px-2 py-1 border border-purple-300 rounded text-center text-2xl font-bold"
            />
          </div>

          <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-5 h-5 text-green-600" />
              <span className="font-semibold text-green-900">Proficiency</span>
            </div>
            <input
              type="number"
              value={editedChar.proficiencyBonus}
              onChange={(e) => updateStat('proficiencyBonus', parseInt(e.target.value))}
              className="w-full px-2 py-1 border border-green-300 rounded text-center text-2xl font-bold"
            />
          </div>

          <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-yellow-600" />
              <span className="font-semibold text-yellow-900">Speed</span>
            </div>
            <div className="text-center">
              <input
                type="number"
                value={editedChar.speed}
                onChange={(e) => updateStat('speed', parseInt(e.target.value))}
                className="w-20 px-2 py-1 border border-yellow-300 rounded text-center text-2xl font-bold"
              />
              <span className="text-sm text-gray-600 ml-1">ft</span>
            </div>
          </div>
        </div>

        {/* Ability Scores */}
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <User className="w-5 h-5" />
            Ability Scores
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {abilities.map(ability => {
              const Icon = abilityIcons[ability];
              const score = editedChar.stats?.[ability] || 10;
              const modifier = getModifier(score);

              return (
                <div key={ability} className="bg-white border-2 border-gray-300 rounded-lg p-3">
                  <div className="flex items-center gap-1 mb-2">
                    <Icon className="w-4 h-4 text-gray-600" />
                    <span className="text-xs font-semibold uppercase text-gray-700">
                      {ability.substring(0, 3)}
                    </span>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={score}
                    onChange={(e) => updateStat(`stats.${ability}`, parseInt(e.target.value))}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xl font-bold mb-1"
                  />
                  <div className={`text-center text-sm font-semibold ${modifier >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {modifier >= 0 ? '+' : ''}{modifier}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderFateStats = () => {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={editedChar.name}
              onChange={(e) => updateStat('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Refresh</label>
              <input
                type="number"
                value={editedChar.refresh || 3}
                onChange={(e) => updateStat('refresh', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fate Points</label>
              <input
                type="number"
                value={editedChar.fatePoints || 3}
                onChange={(e) => updateStat('fatePoints', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>
        </div>

        {/* Aspects */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Aspects</h3>
          <div className="space-y-3">
            {(editedChar.aspects || []).map((aspect, idx) => (
              <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <label className="block text-sm font-medium text-blue-900 mb-1">{aspect.type}</label>
                <input
                  type="text"
                  value={aspect.value}
                  onChange={(e) => {
                    const newAspects = [...editedChar.aspects];
                    newAspects[idx].value = e.target.value;
                    updateStat('aspects', newAspects);
                  }}
                  className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Skills */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Skills</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(editedChar.skills || {}).map(([skill, rating]) => (
              <div key={skill} className="bg-white border border-gray-300 rounded-lg p-3">
                <div className="text-sm font-medium text-gray-700 mb-1">{skill}</div>
                <select
                  value={rating}
                  onChange={(e) => {
                    const newSkills = { ...editedChar.skills };
                    newSkills[skill] = parseInt(e.target.value);
                    updateStat('skills', newSkills);
                  }}
                  className="w-full px-2 py-1 border border-gray-300 rounded"
                >
                  <option value="0">Mediocre (0)</option>
                  <option value="1">Average (+1)</option>
                  <option value="2">Fair (+2)</option>
                  <option value="3">Good (+3)</option>
                  <option value="4">Great (+4)</option>
                  <option value="5">Superb (+5)</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderPbtaStats = () => {
    const stats = ['cool', 'hard', 'hot', 'sharp', 'weird'];
    const statDescriptions = {
      cool: 'Keep your cool under pressure',
      hard: 'Be aggressive and intimidating',
      hot: 'Be charming and manipulative',
      sharp: 'Be observant and intelligent',
      weird: 'Use strange powers'
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={editedChar.name}
              onChange={(e) => updateStat('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Playbook</label>
            <input
              type="text"
              value={editedChar.playbook || ''}
              onChange={(e) => updateStat('playbook', e.target.value)}
              placeholder="e.g., The Hunter, The Chosen"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        {/* Stats */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Stats</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stats.map(stat => (
              <div key={stat} className="bg-white border-2 border-gray-300 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-lg font-bold uppercase">{stat}</div>
                    <div className="text-xs text-gray-600">{statDescriptions[stat]}</div>
                  </div>
                  <input
                    type="number"
                    min="-2"
                    max="3"
                    value={editedChar[stat] || 0}
                    onChange={(e) => updateStat(stat, parseInt(e.target.value))}
                    className="w-16 px-2 py-1 border border-gray-300 rounded text-center text-xl font-bold"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Harm */}
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Heart className="w-5 h-5 text-red-600" />
            Harm
          </h3>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min="0"
              max={editedChar.maxHarm || 6}
              value={editedChar.harm || 0}
              onChange={(e) => updateStat('harm', parseInt(e.target.value))}
              className="w-20 px-3 py-2 border border-red-300 rounded text-center text-2xl font-bold"
            />
            <span className="text-gray-500 text-xl">/</span>
            <span className="text-2xl font-bold">{editedChar.maxHarm || 6}</span>
          </div>
        </div>

        {/* Experience */}
        <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Award className="w-5 h-5 text-purple-600" />
            Experience
          </h3>
          <input
            type="number"
            min="0"
            value={editedChar.experience || 0}
            onChange={(e) => updateStat('experience', parseInt(e.target.value))}
            className="w-24 px-3 py-2 border border-purple-300 rounded text-center text-xl font-bold"
          />
        </div>
      </div>
    );
  };

  const renderCustomStats = () => {
    return (
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={editedChar.name}
            onChange={(e) => updateStat('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Health</h3>
            <div className="flex gap-2">
              <input
                type="number"
                value={editedChar.health || 100}
                onChange={(e) => updateStat('health', parseInt(e.target.value))}
                className="w-24 px-2 py-1 border border-red-300 rounded text-center text-xl font-bold"
              />
              <span className="text-gray-500">/</span>
              <input
                type="number"
                value={editedChar.maxHealth || 100}
                onChange={(e) => updateStat('maxHealth', parseInt(e.target.value))}
                className="w-24 px-2 py-1 border border-red-300 rounded text-center text-xl font-bold"
              />
            </div>
          </div>

          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Energy</h3>
            <div className="flex gap-2">
              <input
                type="number"
                value={editedChar.energy || 50}
                onChange={(e) => updateStat('energy', parseInt(e.target.value))}
                className="w-24 px-2 py-1 border border-blue-300 rounded text-center text-xl font-bold"
              />
              <span className="text-gray-500">/</span>
              <input
                type="number"
                value={editedChar.maxEnergy || 50}
                onChange={(e) => updateStat('maxEnergy', parseInt(e.target.value))}
                className="w-24 px-2 py-1 border border-blue-300 rounded text-center text-xl font-bold"
              />
            </div>
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600 text-center">
            Custom rule system - Add your own attributes and mechanics
          </p>
        </div>
      </div>
    );
  };

  const renderBackstory = () => {
    return (
      <div className="space-y-4">
        {editedChar.originalData?.background && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Background</label>
            <textarea
              value={editedChar.originalData.background}
              readOnly
              className="w-full h-32 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            />
          </div>
        )}

        {editedChar.originalData?.personality && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Personality</label>
            <textarea
              value={editedChar.originalData.personality}
              readOnly
              className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            />
          </div>
        )}

        {editedChar.originalData?.motivations && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Motivations</label>
            <textarea
              value={editedChar.originalData.motivations}
              readOnly
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            />
          </div>
        )}

        {editedChar.originalData?.fears && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Fears</label>
            <textarea
              value={editedChar.originalData.fears}
              readOnly
              className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            />
          </div>
        )}
      </div>
    );
  };

  const tabs = [
    { id: 'stats', label: 'Stats', icon: User },
    { id: 'backstory', label: 'Backstory', icon: Book }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            {editedChar.imageUrl && (
              <img
                src={editedChar.imageUrl}
                alt={editedChar.name}
                className="w-12 h-12 rounded-full object-cover"
              />
            )}
            <div>
              <h2 className="text-2xl font-bold">{editedChar.name}</h2>
              <p className="text-sm text-gray-600">
                {ruleSystem === 'd20' && `${editedChar.class} • Level ${editedChar.level}`}
                {ruleSystem === 'fate' && 'Fate Core Character'}
                {ruleSystem === 'pbta' && (editedChar.playbook || 'PBTA Character')}
                {ruleSystem === 'custom' && 'Custom Character'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b px-6">
          <div className="flex gap-2">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-3 font-medium text-sm flex items-center gap-2 border-b-2 transition ${
                    activeTab === tab.id
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
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'stats' && (
            <>
              {ruleSystem === 'd20' && renderD20Stats()}
              {ruleSystem === 'fate' && renderFateStats()}
              {ruleSystem === 'pbta' && renderPbtaStats()}
              {ruleSystem === 'custom' && renderCustomStats()}
            </>
          )}
          {activeTab === 'backstory' && renderBackstory()}
        </div>

        {/* Footer */}
        <div className="border-t p-6 flex justify-between">
          <div className="flex gap-2">
            <button
              onClick={exportToPDF}
              disabled={exporting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50"
            >
              {exporting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Exporting...
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4" />
                  Export PDF
                </>
              )}
            </button>
            <button
              onClick={exportToJSON}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export JSON
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterSheetEditor;
