import React, { useState } from 'react';
import {
  BookOpen, Clock, Users, Lightbulb, Sparkles, Plus, Trash2, Save,
  Eye, EyeOff, Calendar, MapPin, MessageSquare, Shuffle, Zap
} from 'lucide-react';
import axios from 'axios';

const GMTools = ({ bookId, campaign, onUpdateCampaign, characters, locations, ruleSystem }) => {
  const [activeTab, setActiveTab] = useState('campaign');
  const [sessions, setSessions] = useState(campaign?.sessions || []);
  const [currentSession, setCurrentSession] = useState(null);
  const [dmNotes, setDmNotes] = useState(campaign?.dmNotes || []);
  const [generatingNPC, setGeneratingNPC] = useState(false);
  const [generatingEncounter, setGeneratingEncounter] = useState(false);
  const [generatingTwist, setGeneratingTwist] = useState(false);

  // Session Management
  const createSession = () => {
    const newSession = {
      id: Date.now(),
      number: sessions.length + 1,
      date: new Date().toISOString(),
      title: `Session ${sessions.length + 1}`,
      summary: '',
      notes: '',
      npcsEncountered: [],
      locationsVisited: [],
      questsProgressed: [],
      loot: [],
      combatLog: []
    };
    setSessions([...sessions, newSession]);
    setCurrentSession(newSession);
  };

  const updateSession = (id, updates) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    if (currentSession?.id === id) {
      setCurrentSession(prev => ({ ...prev, ...updates }));
    }
  };

  const deleteSession = (id) => {
    if (!confirm('Delete this session?')) return;
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSession?.id === id) {
      setCurrentSession(null);
    }
  };

  // DM Notes
  const addDMNote = () => {
    const newNote = {
      id: Date.now(),
      title: 'New Secret',
      content: '',
      tags: [],
      hidden: true,
      createdAt: new Date().toISOString()
    };
    setDmNotes([...dmNotes, newNote]);
  };

  const updateDMNote = (id, updates) => {
    setDmNotes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  };

  const deleteDMNote = (id) => {
    setDmNotes(prev => prev.filter(n => n.id !== id));
  };

  // AI Generators
  const generateNPCResponse = async (npcId, context) => {
    setGeneratingNPC(true);
    try {
      const npc = characters.find(c => c.id === npcId);
      const response = await axios.post('/api/rpg/gm/generate-npc-response', {
        npc,
        context,
        ruleSystem
      });
      return response.data.response;
    } catch (error) {
      console.error('Generate NPC response error:', error);
      alert('Failed to generate NPC response');
      return null;
    } finally {
      setGeneratingNPC(false);
    }
  };

  const generateRandomEncounter = async () => {
    setGeneratingEncounter(true);
    try {
      const response = await axios.post('/api/rpg/gm/generate-encounter', {
        bookId,
        locations,
        difficulty: 'medium',
        ruleSystem
      });
      return response.data.encounter;
    } catch (error) {
      console.error('Generate encounter error:', error);
      alert('Failed to generate encounter');
      return null;
    } finally {
      setGeneratingEncounter(false);
    }
  };

  const generatePlotTwist = async () => {
    setGeneratingTwist(true);
    try {
      const response = await axios.post('/api/rpg/gm/generate-plot-twist', {
        bookId,
        campaign,
        sessions
      });
      return response.data.twist;
    } catch (error) {
      console.error('Generate plot twist error:', error);
      alert('Failed to generate plot twist');
      return null;
    } finally {
      setGeneratingTwist(false);
    }
  };

  const saveCampaign = async () => {
    await onUpdateCampaign({
      sessions,
      dmNotes,
      updatedAt: new Date().toISOString()
    });
    alert('Campaign saved!');
  };

  // Render Campaign Tab
  const renderCampaignTab = () => (
    <div className="space-y-6">
      {/* Campaign Overview */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-purple-600" />
          Campaign Overview
        </h3>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-700">{sessions.length}</div>
            <div className="text-sm text-purple-600">Sessions</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-700">{dmNotes.length}</div>
            <div className="text-sm text-blue-600">DM Notes</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-700">
              {sessions.reduce((sum, s) => sum + (s.locationsVisited?.length || 0), 0)}
            </div>
            <div className="text-sm text-green-600">Locations Visited</div>
          </div>
        </div>

        <button
          onClick={saveCampaign}
          className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          Save Campaign
        </button>
      </div>

      {/* Campaign Timeline */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-600" />
          Campaign Timeline
        </h3>

        {sessions.length > 0 ? (
          <div className="space-y-3">
            {sessions.map((session, idx) => (
              <div key={session.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
                    {session.number}
                  </div>
                  {idx < sessions.length - 1 && (
                    <div className="w-0.5 h-full bg-blue-300 mt-2"></div>
                  )}
                </div>

                <div className="flex-1 pb-6">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-semibold">{session.title}</div>
                        <div className="text-sm text-gray-600">
                          {new Date(session.date).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => setCurrentSession(session)}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        View Details
                      </button>
                    </div>
                    {session.summary && (
                      <p className="text-sm text-gray-700">{session.summary}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No sessions yet. Create your first session!</p>
          </div>
        )}
      </div>
    </div>
  );

  // Render Sessions Tab
  const renderSessionsTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Session Management</h3>
        <button
          onClick={createSession}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Session
        </button>
      </div>

      {currentSession ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <input
                type="text"
                value={currentSession.title}
                onChange={(e) => updateSession(currentSession.id, { title: e.target.value })}
                className="text-xl font-bold border-b-2 border-transparent hover:border-gray-300 focus:border-blue-500 outline-none px-2"
              />
              <div className="text-sm text-gray-600 mt-1 px-2">
                {new Date(currentSession.date).toLocaleString()}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentSession(null)}
                className="px-3 py-2 bg-gray-200 rounded hover:bg-gray-300 transition"
              >
                Close
              </button>
              <button
                onClick={() => deleteSession(currentSession.id)}
                className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Summary</label>
              <textarea
                value={currentSession.summary}
                onChange={(e) => updateSession(currentSession.id, { summary: e.target.value })}
                placeholder="What happened in this session?"
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Detailed Notes</label>
              <textarea
                value={currentSession.notes}
                onChange={(e) => updateSession(currentSession.id, { notes: e.target.value })}
                placeholder="Detailed session notes..."
                rows={6}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  NPCs Encountered
                </label>
                <div className="text-sm text-gray-600">
                  {currentSession.npcsEncountered?.length || 0} NPCs
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Locations Visited
                </label>
                <div className="text-sm text-gray-600">
                  {currentSession.locationsVisited?.length || 0} locations
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 bg-white border border-gray-200 rounded-lg">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Select or create a session to view details</p>
        </div>
      )}

      {/* Session List */}
      {sessions.length > 0 && !currentSession && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sessions.map(session => (
            <div
              key={session.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-lg transition cursor-pointer"
              onClick={() => setCurrentSession(session)}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold">{session.title}</div>
                  <div className="text-sm text-gray-600">
                    {new Date(session.date).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-xl font-bold text-blue-600">#{session.number}</div>
              </div>
              {session.summary && (
                <p className="text-sm text-gray-700 line-clamp-2">{session.summary}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Render DM Notes Tab
  const renderDMNotesTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Eye className="w-5 h-5" />
          DM Secrets & Notes
        </h3>
        <button
          onClick={addDMNote}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Secret
        </button>
      </div>

      {dmNotes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dmNotes.map(note => (
            <div key={note.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between mb-3">
                <input
                  type="text"
                  value={note.title}
                  onChange={(e) => updateDMNote(note.id, { title: e.target.value })}
                  className="font-semibold flex-1 border-b border-transparent hover:border-gray-300 focus:border-purple-500 outline-none"
                  placeholder="Secret title..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => updateDMNote(note.id, { hidden: !note.hidden })}
                    className="text-gray-600 hover:text-gray-900"
                  >
                    {note.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => deleteDMNote(note.id)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <textarea
                value={note.content}
                onChange={(e) => updateDMNote(note.id, { content: e.target.value })}
                placeholder="Secret information..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
              />

              <div className="mt-2 flex items-center gap-2">
                {note.hidden ? (
                  <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">
                    🔒 Hidden from Players
                  </span>
                ) : (
                  <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                    👁️ Revealed
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 bg-white border border-gray-200 rounded-lg">
          <EyeOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No DM secrets yet. Add plot twists, hidden information, and more!</p>
        </div>
      )}
    </div>
  );

  // Render AI Tools Tab
  const renderAIToolsTab = () => (
    <div className="space-y-6">
      {/* NPC Response Generator */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-600" />
          NPC Response Generator
        </h3>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Select NPC</label>
            <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">Choose an NPC...</option>
              {characters?.filter(c => c.type === 'npc').map(npc => (
                <option key={npc.id} value={npc.id}>{npc.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Player's Question/Action</label>
            <textarea
              placeholder="What does the player say or do?"
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            disabled={generatingNPC}
            className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {generatingNPC ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Response
              </>
            )}
          </button>
        </div>
      </div>

      {/* Random Encounter Generator */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Shuffle className="w-5 h-5 text-green-600" />
          Random Encounter Generator
        </h3>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Difficulty</label>
              <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500">
                <option>Easy</option>
                <option>Medium</option>
                <option>Hard</option>
                <option>Deadly</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
              <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500">
                <option>Combat</option>
                <option>Social</option>
                <option>Exploration</option>
                <option>Random</option>
              </select>
            </div>
          </div>

          <button
            onClick={generateRandomEncounter}
            disabled={generatingEncounter}
            className="w-full py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {generatingEncounter ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Generating...
              </>
            ) : (
              <>
                <Shuffle className="w-4 h-4" />
                Generate Encounter
              </>
            )}
          </button>
        </div>
      </div>

      {/* Plot Twist Generator */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-yellow-600" />
          Plot Twist Suggester
        </h3>

        <p className="text-sm text-gray-600 mb-4">
          Generate unexpected plot twists based on your campaign history and current storyline.
        </p>

        <button
          onClick={generatePlotTwist}
          disabled={generatingTwist}
          className="w-full py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {generatingTwist ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Generating...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              Generate Plot Twist
            </>
          )}
        </button>
      </div>
    </div>
  );

  const tabs = [
    { id: 'campaign', label: 'Campaign', icon: BookOpen },
    { id: 'sessions', label: 'Sessions', icon: Clock },
    { id: 'notes', label: 'DM Notes', icon: Eye },
    { id: 'ai', label: 'AI Tools', icon: Sparkles }
  ];

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="flex border-b">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-4 py-3 font-medium text-sm flex items-center justify-center gap-2 transition ${
                  activeTab === tab.id
                    ? 'bg-purple-50 text-purple-600 border-b-2 border-purple-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'campaign' && renderCampaignTab()}
        {activeTab === 'sessions' && renderSessionsTab()}
        {activeTab === 'notes' && renderDMNotesTab()}
        {activeTab === 'ai' && renderAIToolsTab()}
      </div>
    </div>
  );
};

export default GMTools;
