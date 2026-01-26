import React, { useState } from 'react';
import { Sparkles, Zap, Users, MessageSquare, Search, BookOpen, TrendingUp, CheckCircle2 } from 'lucide-react';
import AISuggestionBox from './AISuggestionBox';

const AIToolsTab = ({ data, setData, onGenerate, generating }) => {
  const [activeAITool, setActiveAITool] = useState(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [selectedCharacter, setSelectedCharacter] = useState('');
  const [selectedPlotlines, setSelectedPlotlines] = useState([]);
  const [aiResult, setAiResult] = useState(null);

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
    const result = await onGenerate(toolId, finalPrompt);
    if (result) {
      setAiResult({ type: toolId, data: result });
    }
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
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-3">AI Writing Tools</h2>
        <p className="text-gray-600">
          Advanced AI-powered tools to help you write better, faster, and more consistently.
        </p>
      </div>

      {/* Tool Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => {
              setActiveAITool(tool.id);
              setAiPrompt('');
              setAiResult(null);
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

          {!aiResult && (
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
                  {generating ? 'Generating...' : 'Generate with AI'}
                </button>
                <button
                  onClick={() => {
                    setActiveAITool(null);
                    setAiPrompt('');
                    setSelectedCharacter('');
                    setSelectedPlotlines([]);
                  }}
                  className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
                >
                  Cancel
                </button>
              </div>
            </>
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
  );
};

export default AIToolsTab;
