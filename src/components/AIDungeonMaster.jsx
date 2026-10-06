import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles, Send, Volume2, VolumeX, RotateCcw, BookOpen, Users, MapPin, Scroll, Zap
} from 'lucide-react';
import axios from 'axios';

const AIDungeonMaster = ({ bookId, rpgData, bookData, party, ruleSystem }) => {
  const [messages, setMessages] = useState([
    {
      role: 'dm',
      content: `Welcome to the world of "${bookData.bookTitle}"! I'm your AI Dungeon Master. What would you like to do?`,
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [gameState, setGameState] = useState({
    currentLocation: rpgData.locations?.[0] || null,
    activeQuests: rpgData.quests?.filter(q => q.status === 'active') || [],
    partyLevel: Math.max(...(party.map(p => p.level) || [1])),
    sessionLog: []
  });

  const messagesEndRef = useRef(null);
  const [autoGenerateContent, setAutoGenerateContent] = useState(true);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const speakMessage = async (text) => {
    if (!voiceEnabled) return;

    try {
      const response = await axios.post('/api/rpg/ai-dm/narrate', {
        text
      }, {
        responseType: 'blob'
      });

      const audioUrl = URL.createObjectURL(response.data);
      const audio = new Audio(audioUrl);
      audio.play();
    } catch (error) {
      console.error('TTS error:', error);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = {
      role: 'player',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post('/api/rpg/ai-dm/respond', {
        bookId,
        rpgData,
        gameState,
        messages: [...messages, userMessage],
        party,
        ruleSystem,
        autoGenerateContent
      });

      const dmMessage = {
        role: 'dm',
        content: response.data.response,
        timestamp: new Date(),
        actions: response.data.actions // encounter, quest update, etc.
      };

      setMessages(prev => [...prev, dmMessage]);

      // Update game state if AI made changes
      if (response.data.gameState) {
        setGameState(response.data.gameState);
      }

      // Speak the response
      if (voiceEnabled) {
        speakMessage(response.data.response);
      }

    } catch (error) {
      console.error('AI DM error:', error);
      setMessages(prev => [...prev, {
        role: 'system',
        content: 'Error: Failed to get DM response. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const generateProceduralQuest = async () => {
    setLoading(true);
    try {
      const response = await axios.post('/api/rpg/ai-dm/generate-quest', {
        bookId,
        rpgData,
        gameState,
        partyLevel: gameState.partyLevel
      });

      const quest = response.data.quest;
      setMessages(prev => [...prev, {
        role: 'dm',
        content: `⌖ New Quest Available: "${quest.title}"\n\n${quest.description}`,
        timestamp: new Date(),
        quest
      }]);

    } catch (error) {
      console.error('Generate quest error:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateBalancedEncounter = async () => {
    setLoading(true);
    try {
      const response = await axios.post('/api/rpg/ai-dm/generate-balanced-encounter', {
        party,
        location: gameState.currentLocation,
        difficulty: 'medium',
        ruleSystem
      });

      const encounter = response.data.encounter;
      setMessages(prev => [...prev, {
        role: 'dm',
        content: `⚔ Encounter: ${encounter.description}`,
        timestamp: new Date(),
        encounter
      }]);

    } catch (error) {
      console.error('Generate encounter error:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetSession = () => {
    if (!confirm('Reset the current session? This will clear all messages.')) return;
    setMessages([{
      role: 'dm',
      content: `Session reset. Welcome back to "${bookData.bookTitle}"! What would you like to do?`,
      timestamp: new Date()
    }]);
    setGameState({
      currentLocation: rpgData.locations?.[0] || null,
      activeQuests: rpgData.quests?.filter(q => q.status === 'active') || [],
      partyLevel: Math.max(...(party.map(p => p.level) || [1])),
      sessionLog: []
    });
  };

  return (
    <div className="flex h-[calc(100vh-300px)] gap-4">
      {/* Sidebar */}
      <div className="w-80 bg-white border border-gray-200 rounded-lg p-4 space-y-4 overflow-y-auto">
        <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          AI DM Controls
        </h3>

        {/* Game State */}
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h4 className="font-semibold text-sm mb-3">Current State</h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-purple-600" />
              <span>{gameState.currentLocation?.name || 'Unknown'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-600" />
              <span>Party Level: {gameState.partyLevel}</span>
            </div>
            <div className="flex items-center gap-2">
              <Scroll className="w-4 h-4 text-purple-600" />
              <span>{gameState.activeQuests.length} Active Quests</span>
            </div>
          </div>
        </div>

        {/* AI Settings */}
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => setVoiceEnabled(e.target.checked)}
              className="w-5 h-5 text-purple-600 rounded"
            />
            <div className="flex items-center gap-2">
              {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span className="text-sm font-medium">Voice Narration</span>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={autoGenerateContent}
              onChange={(e) => setAutoGenerateContent(e.target.checked)}
              className="w-5 h-5 text-purple-600 rounded"
            />
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              <span className="text-sm font-medium">Auto-Generate Content</span>
            </div>
          </label>
        </div>

        {/* Quick Actions */}
        <div className="border-t pt-4 space-y-2">
          <div className="text-sm font-medium text-gray-700 mb-2">Quick Actions</div>
          <button
            onClick={generateProceduralQuest}
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm disabled:opacity-50"
          >
            Generate Side Quest
          </button>
          <button
            onClick={generateBalancedEncounter}
            disabled={loading}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm disabled:opacity-50"
          >
            Generate Encounter
          </button>
          <button
            onClick={resetSession}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition text-sm flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Reset Session
          </button>
        </div>

        {/* Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
          <div className="lbl mb-1">Tips</div>
          <ul className="space-y-1">
            <li>• Describe what your party does</li>
            <li>• Ask questions about the world</li>
            <li>• Request skill checks or combat</li>
            <li>• AI adapts to your choices</li>
          </ul>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 bg-white border border-gray-200 rounded-lg flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'player' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-4 ${
                  msg.role === 'dm'
                    ? 'bg-purple-100 border border-purple-200'
                    : msg.role === 'player'
                    ? 'bg-blue-100 border border-blue-200'
                    : 'bg-gray-100 border border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {msg.role === 'dm' && <Sparkles className="w-4 h-4 text-purple-600" />}
                  {msg.role === 'player' && <Users className="w-4 h-4 text-blue-600" />}
                  <span className="font-semibold text-sm">
                    {msg.role === 'dm' ? 'Dungeon Master' : msg.role === 'player' ? 'Party' : 'System'}
                  </span>
                  <span className="text-xs text-gray-500">
                    {msg.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-sm whitespace-pre-wrap">{msg.content}</div>

                {/* Special Actions */}
                {msg.quest && (
                  <div className="mt-3 p-3 bg-white rounded border border-purple-300">
                    <div className="text-xs font-semibold text-purple-700">NEW QUEST</div>
                    <div className="text-sm font-medium">{msg.quest.title}</div>
                  </div>
                )}
                {msg.encounter && (
                  <div className="mt-3 p-3 bg-white rounded border border-red-300">
                    <div className="text-xs font-semibold text-red-700">ENCOUNTER</div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-purple-100 border border-purple-200 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                  <span className="text-sm text-purple-700">DM is thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t p-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Describe what your party does..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
              disabled={loading}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50 flex items-center gap-2"
            >
              <Send className="w-5 h-5" />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIDungeonMaster;
