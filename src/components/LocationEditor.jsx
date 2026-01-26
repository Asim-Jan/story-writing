import React, { useState } from 'react';
import {
  X, Save, Plus, Trash2, MapPin, Package, AlertTriangle, Star, Sparkles
} from 'lucide-react';

const LocationEditor = ({ location, onClose, onSave }) => {
  const [editedLocation, setEditedLocation] = useState(location ? { ...location } : {
    name: '',
    type: 'area',
    description: '',
    atmosphere: '',
    significance: '',
    imageUrl: '',
    mapData: {
      connections: [],
      pointsOfInterest: [],
      loot: [],
      dangers: [],
      hiddenSecrets: []
    }
  });

  const [newPOI, setNewPOI] = useState('');
  const [newLoot, setNewLoot] = useState({ name: '', value: 0, description: '' });
  const [newDanger, setNewDanger] = useState({ type: '', description: '', difficulty: 'medium' });
  const [newSecret, setNewSecret] = useState('');

  const updateField = (path, value) => {
    setEditedLocation(prev => {
      const newLoc = { ...prev };
      const keys = path.split('.');
      let obj = newLoc;
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return newLoc;
    });
  };

  const addPOI = () => {
    if (!newPOI.trim()) return;
    updateField('mapData.pointsOfInterest', [
      ...(editedLocation.mapData?.pointsOfInterest || []),
      newPOI
    ]);
    setNewPOI('');
  };

  const removePOI = (index) => {
    updateField('mapData.pointsOfInterest',
      editedLocation.mapData.pointsOfInterest.filter((_, i) => i !== index)
    );
  };

  const addLoot = () => {
    if (!newLoot.name.trim()) return;
    updateField('mapData.loot', [
      ...(editedLocation.mapData?.loot || []),
      { ...newLoot, id: Date.now() }
    ]);
    setNewLoot({ name: '', value: 0, description: '' });
  };

  const removeLoot = (id) => {
    updateField('mapData.loot',
      editedLocation.mapData.loot.filter(l => l.id !== id)
    );
  };

  const addDanger = () => {
    if (!newDanger.type.trim()) return;
    updateField('mapData.dangers', [
      ...(editedLocation.mapData?.dangers || []),
      { ...newDanger, id: Date.now() }
    ]);
    setNewDanger({ type: '', description: '', difficulty: 'medium' });
  };

  const removeDanger = (id) => {
    updateField('mapData.dangers',
      editedLocation.mapData.dangers.filter(d => d.id !== id)
    );
  };

  const addSecret = () => {
    if (!newSecret.trim()) return;
    updateField('mapData.hiddenSecrets', [
      ...(editedLocation.mapData?.hiddenSecrets || []),
      newSecret
    ]);
    setNewSecret('');
  };

  const removeSecret = (index) => {
    updateField('mapData.hiddenSecrets',
      editedLocation.mapData.hiddenSecrets.filter((_, i) => i !== index)
    );
  };

  const handleSave = () => {
    if (!editedLocation.name) {
      alert('Location name is required');
      return;
    }
    onSave(editedLocation);
  };

  const locationTypes = [
    'city', 'village', 'town', 'dungeon', 'castle', 'fortress',
    'forest', 'mountain', 'ocean', 'desert', 'cave', 'ruins',
    'temple', 'tower', 'inn', 'shop', 'area'
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold">
              {location ? 'Edit Location' : 'Create New Location'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">Define your game world location with loot, dangers, and secrets</p>
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Location Name *</label>
                <input
                  type="text"
                  value={editedLocation.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="e.g., Blackwood Forest"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                <select
                  value={editedLocation.type}
                  onChange={(e) => updateField('type', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                >
                  {locationTypes.map(type => (
                    <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                value={editedLocation.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Describe the location..."
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Atmosphere</label>
                <input
                  type="text"
                  value={editedLocation.atmosphere}
                  onChange={(e) => updateField('atmosphere', e.target.value)}
                  placeholder="e.g., Dark and foreboding"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Significance</label>
                <input
                  type="text"
                  value={editedLocation.significance}
                  onChange={(e) => updateField('significance', e.target.value)}
                  placeholder="e.g., Ancient burial ground"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
          </div>

          {/* Points of Interest */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-600" />
              Points of Interest
            </h3>
            <div className="space-y-2 mb-3">
              {(editedLocation.mapData?.pointsOfInterest || []).map((poi, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-yellow-50 px-3 py-2 rounded">
                  <span className="flex-1">{poi}</span>
                  <button
                    onClick={() => removePOI(idx)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPOI}
                onChange={(e) => setNewPOI(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addPOI()}
                placeholder="Add point of interest..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
              />
              <button
                onClick={addPOI}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Loot */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Package className="w-5 h-5 text-green-600" />
              Loot & Treasures
            </h3>
            <div className="space-y-2 mb-3">
              {(editedLocation.mapData?.loot || []).map((item) => (
                <div key={item.id} className="bg-green-50 border border-green-200 rounded p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-sm text-gray-600">Value: {item.value}g</div>
                      {item.description && (
                        <div className="text-sm text-gray-600 mt-1">{item.description}</div>
                      )}
                    </div>
                    <button
                      onClick={() => removeLoot(item.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <input
                type="text"
                value={newLoot.name}
                onChange={(e) => setNewLoot(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Item name"
                className="px-3 py-2 border border-gray-300 rounded-lg"
              />
              <input
                type="number"
                value={newLoot.value}
                onChange={(e) => setNewLoot(prev => ({ ...prev, value: parseInt(e.target.value) || 0 }))}
                placeholder="Value"
                className="px-3 py-2 border border-gray-300 rounded-lg"
              />
              <button
                onClick={addLoot}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                <Plus className="w-4 h-4 mx-auto" />
              </button>
            </div>
            <input
              type="text"
              value={newLoot.description}
              onChange={(e) => setNewLoot(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Description (optional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          {/* Dangers */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Dangers & Encounters
            </h3>
            <div className="space-y-2 mb-3">
              {(editedLocation.mapData?.dangers || []).map((danger) => (
                <div key={danger.id} className="bg-red-50 border border-red-200 rounded p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium">{danger.type}</div>
                      <div className="text-sm text-gray-600">{danger.description}</div>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${
                        danger.difficulty === 'easy' ? 'bg-green-100 text-green-700' :
                        danger.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        danger.difficulty === 'hard' ? 'bg-orange-100 text-orange-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {danger.difficulty}
                      </span>
                    </div>
                    <button
                      onClick={() => removeDanger(danger.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newDanger.type}
                  onChange={(e) => setNewDanger(prev => ({ ...prev, type: e.target.value }))}
                  placeholder="Danger type (e.g., Trap, Monster)"
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                />
                <select
                  value={newDanger.difficulty}
                  onChange={(e) => setNewDanger(prev => ({ ...prev, difficulty: e.target.value }))}
                  className="px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                  <option value="deadly">Deadly</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDanger.description}
                  onChange={(e) => setNewDanger(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Description"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                />
                <button
                  onClick={addDanger}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Hidden Secrets */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Hidden Secrets
            </h3>
            <div className="space-y-2 mb-3">
              {(editedLocation.mapData?.hiddenSecrets || []).map((secret, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-purple-50 px-3 py-2 rounded">
                  <span className="flex-1 text-sm">{secret}</span>
                  <button
                    onClick={() => removeSecret(idx)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addSecret()}
                placeholder="Add hidden secret..."
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
              />
              <button
                onClick={addSecret}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
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
            Save Location
          </button>
        </div>
      </div>
    </div>
  );
};

export default LocationEditor;
