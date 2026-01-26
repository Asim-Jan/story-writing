import React, { useState } from 'react';
import {
  X, Save, Plus, Trash2, Check, Circle, Target, Gift, Users, MapPin,
  ChevronDown, ChevronRight, Sparkles, MessageSquare
} from 'lucide-react';
import axios from 'axios';

const QuestEditor = ({ quest, characters, locations, onClose, onSave, ruleSystem }) => {
  const [editedQuest, setEditedQuest] = useState(quest ? { ...quest } : {
    title: '',
    type: 'main',
    description: '',
    status: 'active',
    objectives: [],
    rewards: {
      experience: 100,
      gold: 50,
      items: [],
      reputation: 5
    },
    npcsInvolved: [],
    locationsInvolved: [],
    branches: []
  });

  const [expandedSections, setExpandedSections] = useState({
    objectives: true,
    rewards: true,
    npcs: false,
    locations: false,
    branches: false
  });

  const [generatingDialogue, setGeneratingDialogue] = useState(false);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const updateField = (path, value) => {
    setEditedQuest(prev => {
      const newQuest = { ...prev };
      const keys = path.split('.');
      let obj = newQuest;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return newQuest;
    });
  };

  const addObjective = () => {
    const newObjective = {
      id: Date.now(),
      description: '',
      completed: false,
      optional: false
    };
    setEditedQuest(prev => ({
      ...prev,
      objectives: [...prev.objectives, newObjective]
    }));
  };

  const updateObjective = (id, field, value) => {
    setEditedQuest(prev => ({
      ...prev,
      objectives: prev.objectives.map(obj =>
        obj.id === id ? { ...obj, [field]: value } : obj
      )
    }));
  };

  const deleteObjective = (id) => {
    setEditedQuest(prev => ({
      ...prev,
      objectives: prev.objectives.filter(obj => obj.id !== id)
    }));
  };

  const addBranch = () => {
    const newBranch = {
      id: Date.now(),
      condition: '',
      title: '',
      description: '',
      outcome: ''
    };
    setEditedQuest(prev => ({
      ...prev,
      branches: [...(prev.branches || []), newBranch]
    }));
  };

  const updateBranch = (id, field, value) => {
    setEditedQuest(prev => ({
      ...prev,
      branches: prev.branches.map(branch =>
        branch.id === id ? { ...branch, [field]: value } : branch
      )
    }));
  };

  const deleteBranch = (id) => {
    setEditedQuest(prev => ({
      ...prev,
      branches: prev.branches.filter(branch => branch.id !== id)
    }));
  };

  const generateDialogue = async () => {
    setGeneratingDialogue(true);
    try {
      const response = await axios.post('/api/rpg/quest/generate-dialogue', {
        quest: editedQuest,
        characters: characters.filter(c => editedQuest.npcsInvolved.includes(c.id)),
        ruleSystem
      });

      if (response.data.dialogueTree) {
        setEditedQuest(prev => ({
          ...prev,
          dialogueTree: response.data.dialogueTree
        }));
      }
    } catch (error) {
      console.error('Generate dialogue error:', error);
      alert('Failed to generate dialogue. Please try again.');
    } finally {
      setGeneratingDialogue(false);
    }
  };

  const handleSave = async () => {
    if (!editedQuest.title) {
      alert('Quest title is required');
      return;
    }
    await onSave(editedQuest);
  };

  const questTypes = [
    { value: 'main', label: 'Main Quest', color: 'purple' },
    { value: 'side', label: 'Side Quest', color: 'blue' },
    { value: 'personal', label: 'Personal Quest', color: 'green' },
    { value: 'faction', label: 'Faction Quest', color: 'yellow' }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold">
              {quest ? 'Edit Quest' : 'Create New Quest'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">Design your quest with objectives, rewards, and branching paths</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Quest Title *</label>
              <input
                type="text"
                value={editedQuest.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder="Enter quest title..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Quest Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {questTypes.map(type => (
                    <button
                      key={type.value}
                      onClick={() => updateField('type', type.value)}
                      className={`px-3 py-2 rounded-lg border-2 text-sm font-medium transition ${
                        editedQuest.type === type.value
                          ? `border-${type.color}-600 bg-${type.color}-50 text-${type.color}-700`
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  value={editedQuest.status}
                  onChange={(e) => updateField('status', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                >
                  <option value="active">Active</option>
                  <option value="available">Available</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                value={editedQuest.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Describe the quest and its background..."
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>
          </div>

          {/* Objectives Section */}
          <div className="border border-gray-200 rounded-lg">
            <button
              onClick={() => toggleSection('objectives')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
            >
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-purple-600" />
                <h3 className="font-semibold">Objectives ({editedQuest.objectives.length})</h3>
              </div>
              {expandedSections.objectives ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>

            {expandedSections.objectives && (
              <div className="p-4 border-t space-y-3">
                {editedQuest.objectives.map((objective, idx) => (
                  <div key={objective.id} className="flex gap-3 items-start bg-gray-50 p-3 rounded-lg">
                    <div className="flex items-center gap-2 pt-2">
                      <span className="text-sm font-semibold text-gray-500">{idx + 1}.</span>
                      <button
                        onClick={() => updateObjective(objective.id, 'completed', !objective.completed)}
                        className={`p-1 rounded transition ${
                          objective.completed ? 'text-green-600' : 'text-gray-400 hover:text-green-600'
                        }`}
                      >
                        {objective.completed ? <Check className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                      </button>
                    </div>

                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={objective.description}
                        onChange={(e) => updateObjective(objective.id, 'description', e.target.value)}
                        placeholder="Objective description..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={objective.optional}
                          onChange={(e) => updateObjective(objective.id, 'optional', e.target.checked)}
                          className="rounded text-purple-600"
                        />
                        <span className="text-gray-600">Optional objective</span>
                      </label>
                    </div>

                    <button
                      onClick={() => deleteObjective(objective.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <button
                  onClick={addObjective}
                  className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-purple-400 hover:text-purple-600 transition flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Objective
                </button>
              </div>
            )}
          </div>

          {/* Rewards Section */}
          <div className="border border-gray-200 rounded-lg">
            <button
              onClick={() => toggleSection('rewards')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
            >
              <div className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-yellow-600" />
                <h3 className="font-semibold">Rewards</h3>
              </div>
              {expandedSections.rewards ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>

            {expandedSections.rewards && (
              <div className="p-4 border-t">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Experience</label>
                    <input
                      type="number"
                      value={editedQuest.rewards.experience}
                      onChange={(e) => updateField('rewards.experience', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Gold</label>
                    <input
                      type="number"
                      value={editedQuest.rewards.gold}
                      onChange={(e) => updateField('rewards.gold', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Reputation</label>
                    <input
                      type="number"
                      value={editedQuest.rewards.reputation}
                      onChange={(e) => updateField('rewards.reputation', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* NPCs Section */}
          <div className="border border-gray-200 rounded-lg">
            <button
              onClick={() => toggleSection('npcs')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
            >
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold">NPCs Involved ({editedQuest.npcsInvolved.length})</h3>
              </div>
              {expandedSections.npcs ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>

            {expandedSections.npcs && (
              <div className="p-4 border-t space-y-2">
                {characters.map(char => (
                  <label key={char.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editedQuest.npcsInvolved.includes(char.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateField('npcsInvolved', [...editedQuest.npcsInvolved, char.id]);
                        } else {
                          updateField('npcsInvolved', editedQuest.npcsInvolved.filter(id => id !== char.id));
                        }
                      }}
                      className="rounded text-purple-600"
                    />
                    <div className="flex items-center gap-2">
                      {char.imageUrl && (
                        <img src={char.imageUrl} alt={char.name} className="w-8 h-8 rounded-full" />
                      )}
                      <span className="font-medium">{char.name}</span>
                      {char.type === 'npc' && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">NPC</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Locations Section */}
          <div className="border border-gray-200 rounded-lg">
            <button
              onClick={() => toggleSection('locations')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
            >
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-green-600" />
                <h3 className="font-semibold">Locations ({editedQuest.locationsInvolved.length})</h3>
              </div>
              {expandedSections.locations ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>

            {expandedSections.locations && (
              <div className="p-4 border-t space-y-2">
                {locations.map(loc => (
                  <label key={loc.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editedQuest.locationsInvolved.includes(loc.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateField('locationsInvolved', [...editedQuest.locationsInvolved, loc.id]);
                        } else {
                          updateField('locationsInvolved', editedQuest.locationsInvolved.filter(id => id !== loc.id));
                        }
                      }}
                      className="rounded text-purple-600"
                    />
                    <span className="font-medium">{loc.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Branching Paths */}
          <div className="border border-gray-200 rounded-lg">
            <button
              onClick={() => toggleSection('branches')}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-indigo-600" />
                <h3 className="font-semibold">Branching Paths ({(editedQuest.branches || []).length})</h3>
              </div>
              {expandedSections.branches ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>

            {expandedSections.branches && (
              <div className="p-4 border-t space-y-3">
                {(editedQuest.branches || []).map((branch, idx) => (
                  <div key={branch.id} className="bg-indigo-50 p-4 rounded-lg space-y-3">
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-semibold text-indigo-900">Branch {idx + 1}</span>
                      <button
                        onClick={() => deleteBranch(branch.id)}
                        className="p-1 text-red-600 hover:bg-red-100 rounded transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <input
                      type="text"
                      value={branch.title}
                      onChange={(e) => updateBranch(branch.id, 'title', e.target.value)}
                      placeholder="Branch title..."
                      className="w-full px-3 py-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />

                    <input
                      type="text"
                      value={branch.condition}
                      onChange={(e) => updateBranch(branch.id, 'condition', e.target.value)}
                      placeholder="Condition (e.g., 'If player chose to help the merchant')"
                      className="w-full px-3 py-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />

                    <textarea
                      value={branch.outcome}
                      onChange={(e) => updateBranch(branch.id, 'outcome', e.target.value)}
                      placeholder="Outcome description..."
                      rows={2}
                      className="w-full px-3 py-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                ))}

                <button
                  onClick={addBranch}
                  className="w-full px-4 py-2 border-2 border-dashed border-indigo-300 rounded-lg text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50 transition flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Branch
                </button>
              </div>
            )}
          </div>

          {/* AI Dialogue Generation */}
          {editedQuest.npcsInvolved.length > 0 && (
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                AI Dialogue Generation
              </h3>
              <p className="text-sm text-gray-600 mb-3">
                Generate contextual dialogue for NPCs involved in this quest
              </p>
              <button
                onClick={generateDialogue}
                disabled={generatingDialogue}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center gap-2 disabled:opacity-50"
              >
                {generatingDialogue ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Dialogue
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save Quest
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestEditor;
