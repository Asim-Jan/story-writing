import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Zap, Users, MessageSquare, Search, BookOpen, TrendingUp, CheckCircle2, History, X, Copy, GitCompare, FileText, Layers } from 'lucide-react';
import AISuggestionBox from './AISuggestionBox';
import { promptTemplates, getTemplatesByCategory, getAllTemplates, fillTemplate } from '../data/promptTemplates';

const AIToolsTab = ({ data, setData, onGenerate, generating }) => {
  const [activeAITool, setActiveAITool] = useState(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [selectedCharacter, setSelectedCharacter] = useState('');
  const [selectedPlotlines, setSelectedPlotlines] = useState([]);
  const [aiResult, setAiResult] = useState(null);

  // History features
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState([]);
  const [compareMode, setCompareMode] = useState(false);

  // Template features
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateVariables, setTemplateVariables] = useState({});
  const [showTemplates, setShowTemplates] = useState(false);

  // Batch generation features
  const [batchMode, setBatchMode] = useState(false);
  const [batchQuantity, setBatchQuantity] = useState(3);
  const [batchResults, setBatchResults] = useState([]);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
  const token = localStorage.getItem('token');

  const tools = [
    {
      id: 'plot-analysis',
      icon: Search,
      title: 'Plot Hole Detector',
      description: 'Analyze your story for plot holes and inconsistencies',
      color: 'from-red-500 to-pink-500',
      needsPrompt: false
    },
    {
      id: 'dialogue',
      icon: MessageSquare,
      title: 'Dialogue Generator',
      description: 'Generate natural dialogue between your characters',
      color: 'from-blue-500 to-cyan-500',
      placeholder: 'E.g., "Emma confronts Detective Morgan about the missing evidence"'
    },
    {
      id: 'chapter-outline',
      icon: BookOpen,
      title: 'Chapter Outliner',
      description: 'Create detailed chapter outlines based on your plotlines',
      color: 'from-green-500 to-emerald-500',
      placeholder: 'E.g., "Chapter where the protagonist discovers the truth about their past"',
      needsPlotlineSelect: true
    },
    {
      id: 'character-arc',
      icon: TrendingUp,
      title: 'Character Arc Improver',
      description: 'Enhance character development and growth',
      color: 'from-purple-500 to-violet-500',
      needsCharacterSelect: true,
      placeholder: 'E.g., "Make the transformation more gradual and believable"'
    },
    {
      id: 'relationship-map',
      icon: Users,
      title: 'Relationship Mapper',
      description: 'Analyze and map character relationships',
      color: 'from-orange-500 to-amber-500',
      needsPrompt: false
    },
    {
      id: 'improve',
      icon: Zap,
      title: 'Content Improver',
      description: 'Improve any piece of your writing',
      color: 'from-indigo-500 to-blue-500',
      placeholder: 'Paste the content you want to improve and describe what to enhance'
    }
  ];

  // Fetch generation history
  const fetchHistory = useCallback(async () => {
    if (!data?.id) return;

    setLoadingHistory(true);
    try {
      const response = await fetch(
        `${API_URL}/api/ai-generations?bookId=${data.id}&limit=50`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (response.ok) {
        const result = await response.json();
        setHistory(result.history || []);
      }
    } catch (error) {
      console.error('Error fetching generation history:', error);
    } finally {
      setLoadingHistory(false);
    }
  }, [data?.id, API_URL, token]);

  // Load history when panel is opened
  useEffect(() => {
    if (showHistory && history.length === 0) {
      fetchHistory();
    }
  }, [showHistory, fetchHistory, history.length]);

  // Apply template
  const applyTemplate = () => {
    if (!selectedTemplate) return;

    const filled = fillTemplate(selectedTemplate.template, templateVariables);
    setAiPrompt(filled);
    setShowTemplates(false);
    setSelectedTemplate(null);
    setTemplateVariables({});
  };

  // View historical generation
  const viewHistoryItem = (item) => {
    setAiResult({ type: item.tool_type, data: item.result });
    setActiveAITool(item.tool_type);
    setShowHistory(false);
  };

  // Toggle compare mode
  const toggleCompare = (itemId) => {
    if (compareMode) {
      if (selectedHistory.includes(itemId)) {
        setSelectedHistory(selectedHistory.filter(id => id !== itemId));
      } else if (selectedHistory.length < 3) {
        setSelectedHistory([...selectedHistory, itemId]);
      }
    }
  };

  const handleGenerate = async (toolId) => {
    let finalPrompt = aiPrompt;

    if (toolId === 'character-arc' && selectedCharacter) {
      const character = data.characters.find(c => c.id.toString() === selectedCharacter);
      if (character) {
        finalPrompt = `Character: ${character.name}\nCurrent Arc: ${character.arc || 'Not defined'}\n\nImprovement Request: ${aiPrompt}`;
      }
    }

    if (toolId === 'chapter-outline' && selectedPlotlines.length > 0) {
      const plotlinesInfo = selectedPlotlines.map(id => {
        const plotline = data.plotlines.find(p => p.id.toString() === id);
        return plotline ? `- ${plotline.title}: ${plotline.description}` : '';
      }).filter(p => p).join('\n');

      finalPrompt = `${aiPrompt}\n\nInclude these plotlines in the chapter:\n${plotlinesInfo}`;
    }

    setAiResult(null);
    setBatchResults([]);

    if (batchMode) {
      // Batch generation
      try {
        const response = await fetch(`${API_URL}/api/generate-batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            type: toolId,
            prompt: finalPrompt,
            context: { bookId: data?.id },
            quantity: batchQuantity
          })
        });

        if (!response.ok) {
          const error = await response.json();
          alert(error.error || 'Failed to generate batch');
          return;
        }

        const result = await response.json();
        setBatchResults(result.variations || []);
        fetchHistory(); // Refresh history
      } catch (error) {
        console.error('Batch generation error:', error);
        alert('Failed to generate batch variations');
      }
    } else {
      // Single generation
      const result = await onGenerate(toolId, finalPrompt);
      if (result) {
        setAiResult({ type: toolId, data: result });
        fetchHistory(); // Refresh history
      }
    }
  };

  const acceptVariation = (variationData) => {
    setAiResult({ type: activeAITool, data: variationData });
    setBatchResults([]);
  };

  const handleAccept = () => {
    if (!aiResult) return;

    const { type, data: resultData } = aiResult;

    // Handle chapter-outline - save to chapters
    if (type === 'chapter-outline') {
      const wordCount = 0; // Outlines don't have content yet
      const newChapter = {
        id: Date.now(),
        number: resultData.number || '',
        title: resultData.title || 'Untitled Chapter',
        summary: resultData.summary || '',
        content: resultData.scenes ? resultData.scenes.join('\n\n') : '',
        wordCount
      };

      setData(prev => ({
        ...prev,
        chapters: [...prev.chapters, newChapter]
      }));

      alert('Chapter outline added to Chapters tab!');
    } else if (type === 'character-arc' && selectedCharacter) {
      // Update character's arc field
      setData(prev => ({
        ...prev,
        characters: prev.characters.map(ch => {
          if (ch.id.toString() === selectedCharacter) {
            return {
              ...ch,
              arc: resultData.arc || ch.arc,
              // Optionally save key moments and growth as notes
              background: ch.background || resultData.growth
            };
          }
          return ch;
        })
      }));

      alert('Character arc updated!');
      setSelectedCharacter('');
    } else {
      // For other tools, just show success message
      alert('Content accepted! You can now copy and use it in your book.');
    }

    setAiResult(null);
    setAiPrompt('');
    setActiveAITool(null);
    setSelectedPlotlines([]);
  };

  const handleReject = () => {
    setAiResult(null);
  };

  const handleRegenerate = () => {
    if (activeAITool) {
      handleGenerate(activeAITool);
    }
  };

  return (
    <div className="max-w-7xl mx-auto flex gap-6">
      {/* History Sidebar */}
      {showHistory && (
        <div className="w-80 bg-white rounded-xl shadow-lg border-2 border-purple-200 p-6 flex-shrink-0 max-h-[800px] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <History size={20} />
              Generation History
            </h3>
            <button
              onClick={() => {
                setShowHistory(false);
                setCompareMode(false);
                setSelectedHistory([]);
              }}
              className="text-gray-500 hover:text-gray-700"
            >
              <X size={20} />
            </button>
          </div>

          {!compareMode && (
            <button
              onClick={() => setCompareMode(true)}
              disabled={history.length < 2}
              className="w-full mb-4 px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold"
            >
              <GitCompare size={16} />
              Compare Results
            </button>
          )}

          {compareMode && (
            <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-purple-900">
                  Compare Mode ({selectedHistory.length}/3)
                </p>
                <button
                  onClick={() => {
                    setCompareMode(false);
                    setSelectedHistory([]);
                  }}
                  className="text-xs text-purple-700 hover:text-purple-900"
                >
                  Exit
                </button>
              </div>
              <p className="text-xs text-purple-700">
                Select up to 3 generations to compare
              </p>
            </div>
          )}

          {loadingHistory ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No generation history yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedHistory.includes(item.id)
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 hover:border-purple-300 bg-white'
                  }`}
                  onClick={() => {
                    if (compareMode) {
                      toggleCompare(item.id);
                    } else {
                      viewHistoryItem(item);
                    }
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs font-semibold">
                      {item.tool_type}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(item.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 line-clamp-2">
                    {item.prompt?.substring(0, 80)}...
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Compare View */}
      {compareMode && selectedHistory.length >= 2 && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 relative">
              <button
                onClick={() => {
                  setCompareMode(false);
                  setSelectedHistory([]);
                }}
                className="absolute top-4 right-4 text-white hover:bg-white/20 rounded-full p-2"
              >
                <X size={24} />
              </button>
              <h2 className="text-2xl font-bold flex items-center gap-3">
                <GitCompare size={28} />
                Compare Generations
              </h2>
              <p className="text-purple-100 mt-2">Side-by-side comparison of {selectedHistory.length} results</p>
            </div>

            <div className={`p-6 grid gap-6 ${selectedHistory.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
              {selectedHistory.map((historyId) => {
                const item = history.find(h => h.id === historyId);
                if (!item) return null;

                return (
                  <div key={item.id} className="border-2 border-purple-200 rounded-lg p-4">
                    <div className="mb-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-semibold">
                          {item.tool_type}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(item.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        <strong>Prompt:</strong> {item.prompt?.substring(0, 100)}...
                      </p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg max-h-96 overflow-y-auto">
                      <pre className="text-xs whitespace-pre-wrap">
                        {JSON.stringify(item.result, null, 2)}
                      </pre>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-gray-800 mb-3">AI Writing Tools</h2>
            <p className="text-gray-600">
              Advanced AI-powered tools to help you write better, faster, and more consistently.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition-colors ${
                showTemplates
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
              }`}
            >
              <FileText size={20} />
              Templates
            </button>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition-colors ${
                showHistory
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
              }`}
            >
              <History size={20} />
              History
            </button>
          </div>
        </div>

        {/* Template Selector */}
        {showTemplates && (
          <div className="mb-6 bg-white rounded-xl shadow-lg border-2 border-purple-200 p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <FileText size={24} />
              Prompt Templates
            </h3>

            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Select Template
              </label>
              <select
                value={selectedTemplate?.id || ''}
                onChange={(e) => {
                  const template = getAllTemplates().find(t => t.id === e.target.value);
                  setSelectedTemplate(template);
                  setTemplateVariables({});
                }}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
              >
                <option value="">-- Choose a template --</option>
                {Object.entries(promptTemplates).map(([category, templates]) => (
                  <optgroup key={category} label={category.toUpperCase()}>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} - {t.description}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {selectedTemplate && (
              <>
                <div className="mb-4 p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <p className="text-sm text-gray-700">
                    <strong>Template:</strong> {selectedTemplate.template}
                  </p>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-3">
                  {selectedTemplate.variables.map(varName => (
                    <div key={varName}>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        {varName}
                      </label>
                      <input
                        type="text"
                        placeholder={`Enter ${varName.toLowerCase()}`}
                        value={templateVariables[varName] || ''}
                        onChange={(e) => setTemplateVariables({
                          ...templateVariables,
                          [varName]: e.target.value
                        })}
                        className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-purple-400 outline-none"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={applyTemplate}
                    disabled={!Object.values(templateVariables).some(v => v.trim())}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                  >
                    Insert Template
                  </button>
                  <button
                    onClick={() => {
                      setSelectedTemplate(null);
                      setTemplateVariables({});
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
                  >
                    Clear
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tool Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => {
                setActiveAITool(tool.id);
                setAiPrompt('');
                setAiResult(null);
                setBatchResults([]);
              }}
              className={`p-6 bg-white rounded-xl shadow-md hover:shadow-xl transition-all border-2 ${
                activeAITool === tool.id ? 'border-purple-500 ring-2 ring-purple-200' : 'border-gray-200'
              } text-left group`}
            >
              <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${tool.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                <tool.icon className="text-white" size={24} />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">{tool.title}</h3>
              <p className="text-gray-600 text-sm">{tool.description}</p>
            </button>
          ))}
        </div>

        {/* Active Tool Panel */}
        {activeAITool && (
          <div className="bg-white rounded-xl shadow-lg border-2 border-purple-200 p-8">
            <div className="flex items-center gap-3 mb-6">
              <Sparkles className="text-purple-600" size={28} />
              <h3 className="text-2xl font-bold text-gray-800">
                {tools.find(t => t.id === activeAITool)?.title}
              </h3>
            </div>

            {!aiResult && batchResults.length === 0 && (
            <>
              {tools.find(t => t.id === activeAITool)?.needsCharacterSelect && (
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Select Character
                  </label>
                  <select
                    value={selectedCharacter}
                    onChange={(e) => setSelectedCharacter(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
                  >
                    <option value="">Choose a character...</option>
                    {data.characters.map((char) => (
                      <option key={char.id} value={char.id}>
                        {char.name} {char.role && `(${char.role})`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {tools.find(t => t.id === activeAITool)?.needsPlotlineSelect && (
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Select Plotlines (Optional)
                  </label>
                  <div className="border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                    {data.plotlines.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">No plotlines available. Create some plotlines first.</p>
                    ) : (
                      data.plotlines.map((plotline) => (
                        <label key={plotline.id} className="flex items-start gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
                          <input
                            type="checkbox"
                            checked={selectedPlotlines.includes(plotline.id.toString())}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPlotlines([...selectedPlotlines, plotline.id.toString()]);
                              } else {
                                setSelectedPlotlines(selectedPlotlines.filter(id => id !== plotline.id.toString()));
                              }
                            }}
                            className="mt-1 w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-400"
                          />
                          <div className="flex-1">
                            <div className="font-semibold text-gray-800">{plotline.title}</div>
                            {plotline.type && (
                              <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-800 rounded">
                                {plotline.type}
                              </span>
                            )}
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              {tools.find(t => t.id === activeAITool)?.needsPrompt !== false && (
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    {activeAITool === 'improve' ? 'Content and Instructions' : 'Description'}
                  </label>
                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder={tools.find(t => t.id === activeAITool)?.placeholder}
                    className="w-full p-4 border border-gray-300 rounded-lg resize-none h-32 focus:ring-2 focus:ring-purple-400 outline-none"
                    disabled={generating}
                  />
                </div>
              )}

              {/* Batch Mode Controls */}
              <div className="mb-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
                <label className="flex items-center gap-3 mb-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={batchMode}
                    onChange={(e) => setBatchMode(e.target.checked)}
                    className="w-5 h-5 text-purple-600 rounded focus:ring-2 focus:ring-purple-400"
                  />
                  <div className="flex items-center gap-2">
                    <Layers size={20} className="text-purple-600" />
                    <span className="font-semibold text-gray-800">
                      Batch Mode - Generate Multiple Variations
                    </span>
                  </div>
                </label>

                {batchMode && (
                  <div className="ml-8 space-y-3">
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="2"
                        max="5"
                        value={batchQuantity}
                        onChange={(e) => setBatchQuantity(parseInt(e.target.value))}
                        className="flex-1"
                      />
                      <span className="px-3 py-1 bg-purple-600 text-white rounded-lg font-bold text-sm">
                        {batchQuantity} variations
                      </span>
                    </div>
                    <div className="flex items-start gap-2 text-sm">
                      <Sparkles size={16} className="text-purple-600 mt-0.5" />
                      <p className="text-purple-800">
                        This will use <strong>{batchQuantity} AI requests</strong> and generate {batchQuantity} unique variations
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                  <button
                    onClick={() => handleGenerate(activeAITool)}
                    disabled={
                      generating ||
                      (tools.find(t => t.id === activeAITool)?.needsPrompt !== false && !aiPrompt.trim()) ||
                      (activeAITool === 'character-arc' && !selectedCharacter)
                    }
                    className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                  >
                    <Sparkles size={20} />
                    {generating ? 'Generating...' : batchMode ? `Generate ${batchQuantity} Variations` : 'Generate with AI'}
                  </button>
                  <button
                    onClick={() => {
                      setActiveAITool(null);
                      setAiPrompt('');
                      setSelectedCharacter('');
                      setSelectedPlotlines([]);
                      setBatchMode(false);
                      setBatchResults([]);
                    }}
                    className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {/* Batch Results */}
            {batchResults.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <Layers size={24} className="text-purple-600" />
                    {batchResults.length} Variations Generated
                  </h4>
                  <button
                    onClick={() => setBatchResults([])}
                    className="text-sm text-gray-600 hover:text-gray-800"
                  >
                    Clear All
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {batchResults.map((item, index) => (
                    <div
                      key={index}
                      className="bg-gradient-to-br from-purple-50 to-blue-50 border-2 border-purple-200 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="font-bold text-gray-800">Variation {item.id}</h5>
                        <button
                          onClick={() => acceptVariation(item.result)}
                          className="px-3 py-1 bg-purple-600 text-white rounded text-sm font-semibold hover:bg-purple-700 transition-colors flex items-center gap-1"
                        >
                          <CheckCircle2 size={14} />
                          Use This
                        </button>
                      </div>

                      <div className="bg-white p-3 rounded border border-purple-200 max-h-64 overflow-y-auto">
                        <pre className="text-xs whitespace-pre-wrap">
                          {JSON.stringify(item.result, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleRegenerate}
                    disabled={generating}
                    className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold disabled:opacity-50 flex items-center gap-2"
                  >
                    <Sparkles size={20} />
                    Regenerate All
                  </button>
                </div>
              </div>
            )}

            {/* Results */}
            {aiResult && (
            <div className="mt-6">
              {aiResult.type === 'plot-analysis' ? (
                // Custom display for plot analysis
                <div className="bg-gradient-to-br from-red-50 to-pink-50 border-2 border-red-200 rounded-lg p-6">
                  <h4 className="text-xl font-bold text-gray-800 mb-4">Plot Analysis Results</h4>

                  {aiResult.data.strengths && aiResult.data.strengths.length > 0 && (
                    <div className="mb-6">
                      <h5 className="font-bold text-green-700 mb-2 flex items-center gap-2">
                        <CheckCircle2 size={20} className="text-green-600" />
                        Strengths
                      </h5>
                      <ul className="space-y-2">
                        {aiResult.data.strengths.map((strength, i) => (
                          <li key={i} className="bg-green-50 p-3 rounded-lg border border-green-200 text-sm text-gray-800">
                            {strength}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiResult.data.issues && aiResult.data.issues.length > 0 && (
                    <div className="mb-6">
                      <h5 className="font-bold text-red-700 mb-2 flex items-center gap-2">
                        <Search size={20} className="text-red-600" />
                        Plot Holes & Issues
                      </h5>
                      <ul className="space-y-2">
                        {aiResult.data.issues.map((issue, i) => (
                          <li key={i} className="bg-red-50 p-3 rounded-lg border border-red-200 text-sm text-gray-800">
                            {issue}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiResult.data.suggestions && aiResult.data.suggestions.length > 0 && (
                    <div className="mb-6">
                      <h5 className="font-bold text-blue-700 mb-2 flex items-center gap-2">
                        <Sparkles size={20} className="text-blue-600" />
                        Suggestions
                      </h5>
                      <ul className="space-y-2">
                        {aiResult.data.suggestions.map((suggestion, i) => (
                          <li key={i} className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-sm text-gray-800">
                            {suggestion}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={handleAccept}
                      className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold"
                    >
                      Acknowledge
                    </button>
                    <button
                      onClick={handleReject}
                      className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors font-semibold"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={handleRegenerate}
                      disabled={generating}
                      className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold disabled:opacity-50 ml-auto"
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              ) : aiResult.type === 'relationship-map' ? (
                // Custom display for relationship map
                <div className="bg-gradient-to-br from-orange-50 to-amber-50 border-2 border-orange-200 rounded-lg p-6">
                  <h4 className="text-xl font-bold text-gray-800 mb-4">Character Relationships</h4>

                  {aiResult.data.relationships && aiResult.data.relationships.length > 0 && (
                    <div className="mb-6">
                      <div className="space-y-3">
                        {aiResult.data.relationships.map((rel, i) => (
                          <div key={i} className="bg-white p-4 rounded-lg border border-orange-200">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="font-bold text-gray-800">{rel.character1}</span>
                              <span className="text-gray-400">↔</span>
                              <span className="font-bold text-gray-800">{rel.character2}</span>
                              <span className="ml-auto px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-semibold">
                                {rel.relationship}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700">{rel.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {aiResult.data.dynamics && (
                    <div className="mb-6 bg-amber-100 p-4 rounded-lg border border-amber-300">
                      <h5 className="font-bold text-amber-900 mb-2">Overall Dynamics</h5>
                      <p className="text-sm text-gray-800">{aiResult.data.dynamics}</p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={handleAccept}
                      className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold"
                    >
                      Acknowledge
                    </button>
                    <button
                      onClick={handleReject}
                      className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors font-semibold"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={handleRegenerate}
                      disabled={generating}
                      className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold disabled:opacity-50 ml-auto"
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              ) : aiResult.type === 'character-arc' ? (
                // Custom display for character arc
                <div className="bg-gradient-to-br from-purple-50 to-violet-50 border-2 border-purple-200 rounded-lg p-6">
                  <h4 className="text-xl font-bold text-gray-800 mb-4">Improved Character Arc</h4>

                  {aiResult.data.arc && (
                    <div className="mb-4 bg-white p-4 rounded-lg border border-purple-200">
                      <h5 className="font-bold text-purple-700 mb-2">Character Arc</h5>
                      <p className="text-gray-800">{aiResult.data.arc}</p>
                    </div>
                  )}

                  {aiResult.data.keyMoments && aiResult.data.keyMoments.length > 0 && (
                    <div className="mb-4 bg-white p-4 rounded-lg border border-purple-200">
                      <h5 className="font-bold text-purple-700 mb-2">Key Moments</h5>
                      <ol className="list-decimal list-inside space-y-2">
                        {aiResult.data.keyMoments.map((moment, i) => (
                          <li key={i} className="text-sm text-gray-800">{moment}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {aiResult.data.growth && (
                    <div className="mb-4 bg-white p-4 rounded-lg border border-purple-200">
                      <h5 className="font-bold text-purple-700 mb-2">Character Growth</h5>
                      <p className="text-gray-800">{aiResult.data.growth}</p>
                    </div>
                  )}

                  {aiResult.data.relationships && (
                    <div className="mb-4 bg-white p-4 rounded-lg border border-purple-200">
                      <h5 className="font-bold text-purple-700 mb-2">Relationship Evolution</h5>
                      <p className="text-gray-800">{aiResult.data.relationships}</p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={handleAccept}
                      className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold"
                    >
                      Apply to Character
                    </button>
                    <button
                      onClick={handleReject}
                      className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors font-semibold"
                    >
                      Reject
                    </button>
                    <button
                      onClick={handleRegenerate}
                      disabled={generating}
                      className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold disabled:opacity-50 ml-auto"
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
              ) : (
                // Default AISuggestionBox for other tools
                <AISuggestionBox
                  suggestion={aiResult.data}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onRegenerate={handleRegenerate}
                  loading={generating}
                  title={`AI ${tools.find(t => t.id === activeAITool)?.title} Results`}
                />
              )}
            </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!activeAITool && (
          <div className="text-center py-12">
            <Sparkles className="w-20 h-20 text-purple-300 mx-auto mb-4" />
            <h3 className="text-2xl font-bold text-gray-700 mb-2">Select a Tool to Get Started</h3>
            <p className="text-gray-500">Choose an AI tool above to enhance your writing</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIToolsTab;
