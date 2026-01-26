import React, { useState } from 'react';
import {
  Swords, MessageCircle, Brain, Edit2, Trash2, Play, ChevronDown, ChevronRight,
  Users, Heart, Shield, Zap, TrendingUp, AlertTriangle
} from 'lucide-react';

const EncounterCard = ({ encounter, onEdit, onDelete, onRun, ruleSystem }) => {
  const [expanded, setExpanded] = useState(false);

  const encounterIcons = {
    combat: Swords,
    social: MessageCircle,
    puzzle: Brain,
    exploration: TrendingUp
  };

  const encounterColors = {
    combat: 'red',
    social: 'blue',
    puzzle: 'purple',
    exploration: 'green'
  };

  const difficultyColors = {
    easy: 'text-green-600 bg-green-50',
    medium: 'text-yellow-600 bg-yellow-50',
    hard: 'text-orange-600 bg-orange-50',
    deadly: 'text-red-600 bg-red-50'
  };

  const Icon = encounterIcons[encounter.type] || Swords;
  const color = encounterColors[encounter.type] || 'gray';

  const renderCombatDetails = () => {
    if (encounter.type !== 'combat' || !encounter.enemies) return null;

    return (
      <div className="mt-4 space-y-3">
        <h4 className="font-semibold text-sm text-gray-700">Enemies ({encounter.enemies.length})</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {encounter.enemies.map((enemy, idx) => (
            <div key={idx} className="bg-red-50 border border-red-200 rounded p-3">
              <div className="font-medium text-sm mb-2">{enemy.name}</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <Heart className="w-3 h-3 text-red-600" />
                  <span>HP: {enemy.hp}/{enemy.maxHp}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Shield className="w-3 h-3 text-blue-600" />
                  <span>AC: {enemy.ac}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Swords className="w-3 h-3 text-gray-600" />
                  <span>+{enemy.attackBonus}</span>
                </div>
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Damage: {enemy.damage}
              </div>
            </div>
          ))}
        </div>

        {ruleSystem === 'd20' && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
            <div className="font-medium mb-1">Challenge Rating</div>
            <div className="text-xs text-gray-600">
              Total XP: {encounter.enemies.reduce((sum, e) => sum + (e.xp || 100), 0)}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSocialDetails = () => {
    if (encounter.type !== 'social') return null;

    return (
      <div className="mt-4 space-y-3">
        <h4 className="font-semibold text-sm text-gray-700">NPCs</h4>
        {encounter.npcs && encounter.npcs.length > 0 ? (
          <div className="space-y-2">
            {encounter.npcs.map((npc, idx) => (
              <div key={idx} className="bg-blue-50 border border-blue-200 rounded p-2 text-sm">
                {npc}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No NPCs specified</p>
        )}

        <h4 className="font-semibold text-sm text-gray-700 mt-3">Possible Outcomes</h4>
        <div className="space-y-1">
          {(encounter.outcomes || ['success', 'partial', 'failure']).map((outcome, idx) => (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${
                outcome === 'success' ? 'bg-green-500' :
                outcome === 'partial' ? 'bg-yellow-500' :
                'bg-red-500'
              }`}></div>
              <span className="capitalize">{outcome}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPuzzleDetails = () => {
    if (encounter.type !== 'puzzle') return null;

    return (
      <div className="mt-4 space-y-3">
        <div>
          <h4 className="font-semibold text-sm text-gray-700 mb-2">Hints</h4>
          {encounter.hints && encounter.hints.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {encounter.hints.map((hint, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-purple-600">•</span>
                  <span>{hint}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No hints available</p>
          )}
        </div>

        {encounter.solution && (
          <div className="bg-purple-50 border border-purple-200 rounded p-3">
            <h4 className="font-semibold text-sm text-gray-700 mb-1">Solution</h4>
            <p className="text-sm">{encounter.solution}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`bg-white border-2 border-${color}-200 rounded-lg overflow-hidden hover:shadow-lg transition`}>
      {/* Header */}
      <div className={`bg-${color}-50 p-4 border-b border-${color}-200`}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-5 h-5 text-${color}-600`} />
              <h3 className="font-semibold text-lg">{encounter.title}</h3>
              <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${difficultyColors[encounter.difficulty]}`}>
                {encounter.difficulty}
              </span>
            </div>
            <p className="text-sm text-gray-600">{encounter.description}</p>
          </div>

          <div className="flex gap-1 ml-3">
            {onRun && (
              <button
                onClick={() => onRun(encounter)}
                className={`p-2 bg-${color}-600 text-white rounded hover:bg-${color}-700 transition`}
                title="Run encounter"
              >
                <Play className="w-4 h-4" />
              </button>
            )}
            {onEdit && (
              <button
                onClick={() => onEdit(encounter)}
                className="p-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition"
                title="Edit encounter"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(encounter)}
                className="p-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
                title="Delete encounter"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              <span className="capitalize">{encounter.type}</span>
            </div>
            {encounter.chapterId && (
              <div className="text-xs bg-gray-100 px-2 py-1 rounded">
                From Chapter
              </div>
            )}
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 transition"
          >
            {expanded ? (
              <>
                <span>Hide Details</span>
                <ChevronDown className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>Show Details</span>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        {/* Expanded Details */}
        {expanded && (
          <div className="border-t pt-3 mt-3">
            {encounter.type === 'combat' && renderCombatDetails()}
            {encounter.type === 'social' && renderSocialDetails()}
            {encounter.type === 'puzzle' && renderPuzzleDetails()}

            {encounter.location && (
              <div className="mt-3 text-sm">
                <span className="font-medium">Location:</span> {encounter.location}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Warning for deadly encounters */}
      {encounter.difficulty === 'deadly' && (
        <div className="bg-red-100 border-t border-red-200 p-2 flex items-center gap-2 text-sm text-red-800">
          <AlertTriangle className="w-4 h-4" />
          <span>Deadly encounter - TPK risk!</span>
        </div>
      )}
    </div>
  );
};

export default EncounterCard;
