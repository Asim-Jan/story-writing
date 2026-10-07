import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Users, MapPin, BookOpen, Sparkles, RefreshCw, TrendingUp, Zap, History, ChevronDown, ChevronUp, Check, Trash2 } from 'lucide-react';
import QuickFixModal from './QuickFixModal';
import { chapterHeading } from '../utils/chapters';

const ContinuityTab = ({ data, setData, onAnalyze, analyzing }) => {
  const [analysis, setAnalysis] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Focus areas state
  const [focusAreas, setFocusAreas] = useState([]);
  const [customFocusAreas, setCustomFocusAreas] = useState(data.customFocusAreas || []);
  const [newFocusArea, setNewFocusArea] = useState('');

  // Chapter selection state
  const [showChapterSelector, setShowChapterSelector] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState([]);

  // Quick fix modal state
  const [fixModalOpen, setFixModalOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState(null);

  const API_URL = import.meta.env.VITE_API_URL;

  // Fetch history on mount
  useEffect(() => {
    if (data.id) {
      fetchHistory();
    }
  }, [data.id]);

  // Sync custom focus areas when data changes
  useEffect(() => {
    if (data.customFocusAreas && Array.isArray(data.customFocusAreas)) {
      setCustomFocusAreas(data.customFocusAreas);
    }
  }, [data.customFocusAreas]);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/books/${data.id}/continuity-history?limit=10`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });

      if (response.ok) {
        const result = await response.json();
        setHistory(result.history);
      }
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleAnalyze = async () => {
    const chapterIds = showChapterSelector && selectedChapters.length > 0 ? selectedChapters : [];
    const result = await onAnalyze(data, focusAreas, chapterIds);
    if (result) {
      setAnalysis(result);
      // Refresh history after new analysis
      fetchHistory();
    }
  };

  const handleViewHistoryItem = (item) => {
    setAnalysis(item.analysis_result);
    setSelectedHistoryItem(item);
    setShowHistory(false);
  };

  const handleCompareWithHistory = (item) => {
    // Simple comparison: show both side by side
    alert(`Current Score: ${analysis?.summary?.score || 0}%\nPrevious Score: ${item.score}%\n\nImprovement: ${(analysis?.summary?.score || 0) - item.score}%`);
  };

  const handleDeleteHistory = async (historyId) => {
    if (!confirm('Are you sure you want to delete this analysis from history?')) {
      return;
    }

    try {
      const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
      const response = await fetch(`${API_URL}/api/continuity-analyses/${historyId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to delete analysis');
      }

      // Refresh history list
      fetchHistory();

      // Clear selected history item if it was deleted
      if (selectedHistoryItem?.id === historyId) {
        setSelectedHistoryItem(null);
      }
    } catch (error) {
      console.error('Error deleting history:', error);
      alert('Failed to delete analysis. Please try again.');
    }
  };

  const toggleFocusArea = (area) => {
    setFocusAreas(prev =>
      prev.includes(area)
        ? prev.filter(a => a !== area)
        : [...prev, area]
    );
  };

  const addCustomFocusArea = () => {
    const trimmed = newFocusArea.trim().toLowerCase();
    if (trimmed && !customFocusAreas.includes(trimmed)) {
      const updated = [...customFocusAreas, trimmed];
      setCustomFocusAreas(updated);
      setData(prev => ({ ...prev, customFocusAreas: updated }));
      setNewFocusArea('');
    }
  };

  const removeCustomFocusArea = (area) => {
    const updated = customFocusAreas.filter(a => a !== area);
    setCustomFocusAreas(updated);
    setData(prev => ({ ...prev, customFocusAreas: updated }));
    // Also remove from selected focus areas if it was selected
    setFocusAreas(prev => prev.filter(a => a !== area));
  };

  const toggleChapter = (chapterId) => {
    setSelectedChapters(prev =>
      prev.includes(chapterId)
        ? prev.filter(id => id !== chapterId)
        : [...prev, chapterId]
    );
  };

  const applyFix = async (editedSuggestion) => {
    const issue = selectedIssue;
    if (!issue) return;

    try {
      // Strategy 1: Apply to chapter if location mentions chapter
      if (issue.location?.match(/Chapter (\d+)/)) {
        const chapterNum = issue.location.match(/Chapter (\d+)/)?.[1];
        const chapter = data.chapters.find(ch => ch.number == chapterNum);

        if (chapter) {
          setData(prev => ({
            ...prev,
            chapters: prev.chapters.map(ch =>
              ch.id === chapter.id
                ? { ...ch, summary: `${ch.summary}\n\n[Continuity Fix]: ${editedSuggestion}` }
                : ch
            )
          }));
        }
      }

      // Strategy 2: Apply to character if character category
      if (issue.category === 'character') {
        const charName = issue.location?.match(/Character: (.+)/)?.[1];
        const character = data.characters.find(c => c.name === charName);

        if (character) {
          setData(prev => ({
            ...prev,
            characters: prev.characters.map(ch =>
              ch.id === character.id
                ? { ...ch, arc: `${ch.arc}\n\n[Continuity Fix]: ${editedSuggestion}` }
                : ch
            )
          }));
        }
      }

      // Strategy 3: Always add to notes as reference
      const newNote = {
        id: Date.now(),
        title: `Continuity Fix: ${issue.title}`,
        content: `**Issue:** ${issue.description}\n\n**Location:** ${issue.location}\n\n**Fix Applied:**\n${editedSuggestion}`,
        category: 'continuity',
        createdAt: new Date().toISOString()
      };

      setData(prev => ({
        ...prev,
        notes: [...(prev.notes || []), newNote]
      }));

      setFixModalOpen(false);
      setSelectedIssue(null);

      alert('Fix applied! Check the relevant chapter/character and your Notes tab for details.');
    } catch (error) {
      console.error('Error applying fix:', error);
      alert('Failed to apply fix. Please try again.');
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'info': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <AlertTriangle className="text-red-600" size={20} />;
      case 'warning': return <AlertTriangle className="text-yellow-600" size={20} />;
      case 'info': return <CheckCircle2 className="text-blue-600" size={20} />;
      default: return <CheckCircle2 className="text-gray-600" size={20} />;
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'timeline': return <Clock size={18} />;
      case 'character': return <Users size={18} />;
      case 'location': return <MapPin size={18} />;
      case 'plot': return <BookOpen size={18} />;
      case 'style': return <TrendingUp size={18} />;
      default: return <Zap size={18} />;
    }
  };

  const filteredIssues = analysis?.issues?.filter(issue =>
    selectedCategory === 'all' || issue.category === selectedCategory
  ) || [];

  const categories = [
    { id: 'all', label: 'All Issues', icon: Sparkles },
    { id: 'timeline', label: 'Timeline', icon: Clock },
    { id: 'character', label: 'Characters', icon: Users },
    { id: 'location', label: 'Locations', icon: MapPin },
    { id: 'plot', label: 'Plot', icon: BookOpen },
    { id: 'style', label: 'Style', icon: TrendingUp }
  ];

  const focusAreaOptions = ['timeline', 'characters', 'locations', 'plot', 'style'];

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 mb-3">AI Writing Continuity</h2>
          <p className="text-gray-600">Analyze your story for consistency, plot holes, and style issues</p>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2 font-medium"
        >
          <History size={20} />
          History ({history.length})
          {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* History Sidebar */}
      {showHistory && (
        <div className="bg-white rounded-lg border-2 border-gray-200 p-4 mb-6">
          <h3 className="font-bold text-lg mb-4">Analysis History</h3>
          {loadingHistory ? (
            <p className="text-gray-500">Loading...</p>
          ) : history.length === 0 ? (
            <p className="text-gray-500">No previous analyses yet.</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {history.map((item) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    selectedHistoryItem?.id === item.id
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
                  }`}
                  onClick={() => handleViewHistoryItem(item)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">
                      {new Date(item.created_at).toLocaleDateString()} {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-purple-600">{item.score}%</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteHistory(item.id);
                        }}
                        className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                        title="Delete this analysis"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {item.focus_areas && item.focus_areas.length > 0 && (
                    <p className="text-xs text-gray-500">Focus: {item.focus_areas.join(', ')}</p>
                  )}
                  {item.chapter_ids && item.chapter_ids.length > 0 && (
                    <p className="text-xs text-gray-500">Chapters: {item.chapter_ids.length} selected</p>
                  )}
                  {analysis && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCompareWithHistory(item);
                      }}
                      className="mt-2 text-xs text-blue-600 hover:text-blue-800 underline"
                    >
                      Compare with current
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Analysis Options */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-6 mb-6 border border-purple-200">
        {/* Focus Areas */}
        <div className="mb-4">
          <h4 className="font-semibold text-gray-800 mb-2">Focus Areas (optional):</h4>

          {/* Preset Focus Areas */}
          <div className="flex flex-wrap gap-2 mb-3">
            {focusAreaOptions.map(area => (
              <button
                key={area}
                onClick={() => toggleFocusArea(area)}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
                  focusAreas.includes(area)
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:border-purple-400'
                }`}
              >
                {focusAreas.includes(area) && <Check size={14} />}
                {getCategoryIcon(area)}
                <span className="capitalize text-sm">{area}</span>
              </button>
            ))}
          </div>

          {/* Custom Focus Areas */}
          {customFocusAreas.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {customFocusAreas.map(area => (
                <button
                  key={area}
                  onClick={() => toggleFocusArea(area)}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
                    focusAreas.includes(area)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-700 border border-indigo-300 hover:border-indigo-400'
                  }`}
                >
                  {focusAreas.includes(area) && <Check size={14} />}
                  <span className="capitalize text-sm">{area}</span>
                  <Trash2
                    size={12}
                    className="ml-1 hover:text-red-500 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCustomFocusArea(area);
                    }}
                  />
                </button>
              ))}
            </div>
          )}

          {/* Add Custom Focus Area */}
          <div className="flex items-center gap-2 mt-2">
            <input
              type="text"
              value={newFocusArea}
              onChange={(e) => setNewFocusArea(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addCustomFocusArea()}
              placeholder="Add custom focus area (e.g., magic system, dialogue)"
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={addCustomFocusArea}
              disabled={!newFocusArea.trim()}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>

          <p className="text-xs text-gray-600 mt-2">Select areas to focus the analysis. Custom areas shown in blue.</p>
        </div>

        {/* Chapter Selection */}
        <div className="mb-4">
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={showChapterSelector}
              onChange={(e) => {
                setShowChapterSelector(e.target.checked);
                if (!e.target.checked) setSelectedChapters([]);
              }}
              className="w-4 h-4"
            />
            <span className="font-semibold text-gray-800">Analyze specific chapters only</span>
          </label>

          {showChapterSelector && (
            <div className="bg-white rounded-lg p-3 border border-gray-300 max-h-40 overflow-y-auto">
              {data.chapters.length === 0 ? (
                <p className="text-gray-500 text-sm">No chapters available</p>
              ) : (
                <div className="space-y-1">
                  {data.chapters.map(ch => (
                    <label key={ch.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                      <input
                        type="checkbox"
                        checked={selectedChapters.includes(ch.id?.toString())}
                        onChange={() => toggleChapter(ch.id?.toString())}
                        className="w-4 h-4"
                      />
                      <span className="text-sm">
                        {chapterHeading(ch)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Run Analysis Button */}
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
              <Sparkles className="text-purple-600" size={24} />
              Story Analysis
            </h3>
            <p className="text-gray-700 text-sm">
              {focusAreas.length > 0 && `Focusing on: ${focusAreas.join(', ')}. `}
              {showChapterSelector && selectedChapters.length > 0 && `${selectedChapters.length} chapters selected. `}
              {focusAreas.length === 0 && !showChapterSelector && 'Full book analysis'}
            </p>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || data.chapters.length === 0}
            className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analyzing ? (
              <>
                <RefreshCw className="animate-spin" size={20} />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles size={20} />
                Run Analysis
              </>
            )}
          </button>
        </div>
      </div>

      {/* Analysis Results */}
      {analysis && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm border-2 border-green-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Passed</span>
                <CheckCircle2 className="text-green-600" size={20} />
              </div>
              <p className="text-3xl font-bold text-green-600">{analysis.summary?.passed || 0}</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border-2 border-yellow-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Warnings</span>
                <AlertTriangle className="text-yellow-600" size={20} />
              </div>
              <p className="text-3xl font-bold text-yellow-600">{analysis.summary?.warnings || 0}</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border-2 border-red-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Critical</span>
                <AlertTriangle className="text-red-600" size={20} />
              </div>
              <p className="text-3xl font-bold text-red-600">{analysis.summary?.critical || 0}</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border-2 border-purple-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Quality Score</span>
                <TrendingUp className="text-purple-600" size={20} />
              </div>
              <p className="text-3xl font-bold text-purple-600">{analysis.summary?.score || 0}%</p>
            </div>
          </div>

          {/* Category Filters */}
          <div className="flex flex-wrap gap-2 mb-6">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:border-purple-400'
                }`}
              >
                <cat.icon size={18} />
                {cat.label}
                {cat.id !== 'all' && (
                  <span className="ml-1 bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-xs font-bold">
                    {analysis.issues?.filter(i => i.category === cat.id).length || 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Issues List */}
          <div className="space-y-4">
            {filteredIssues.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No issues found in this category
              </div>
            ) : (
              filteredIssues.map((issue, index) => (
                <div
                  key={index}
                  className={`bg-white rounded-lg border-2 p-6 shadow-sm hover:shadow-md transition-shadow ${getSeverityColor(issue.severity)}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      {getSeverityIcon(issue.severity)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <h4 className="text-lg font-bold text-gray-800">{issue.title}</h4>
                          <span className="px-2 py-1 bg-white rounded-full text-xs font-semibold flex items-center gap-1">
                            {getCategoryIcon(issue.category)}
                            {issue.category}
                          </span>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${
                          issue.severity === 'critical' ? 'bg-red-600 text-white' :
                          issue.severity === 'warning' ? 'bg-yellow-600 text-white' :
                          'bg-blue-600 text-white'
                        }`}>
                          {issue.severity}
                        </span>
                      </div>
                      <p className="text-gray-700 mb-3">{issue.description}</p>

                      {issue.location && (
                        <div className="text-sm text-gray-600 mb-2">
                          <strong>Location:</strong> {issue.location}
                        </div>
                      )}

                      {issue.suggestion && (
                        <div className="mt-3 p-3 bg-white bg-opacity-50 rounded-lg border border-gray-200">
                          <p className="text-sm font-semibold text-gray-700 mb-1">
                            Suggestion:
                          </p>
                          <p className="text-sm text-gray-800 mb-2">{issue.suggestion}</p>
                          <button
                            onClick={() => {
                              setSelectedIssue(issue);
                              setFixModalOpen(true);
                            }}
                            className="text-sm bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors font-medium"
                          >
                            Apply Fix
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* Empty State */}
      {!analysis && !analyzing && (
        <div className="bg-white rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <Sparkles className="w-20 h-20 text-gray-400 mx-auto mb-4" />
          <h3 className="text-2xl font-bold text-gray-700 mb-2">Ready to Analyze</h3>
          <p className="text-gray-600 mb-4">
            Click "Run Analysis" to check your story for consistency issues, plot holes, and style problems
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto mt-8">
            <div className="p-4 bg-purple-50 rounded-lg">
              <Clock className="text-purple-600 mx-auto mb-2" size={32} />
              <h4 className="font-bold text-gray-800 mb-1">Timeline Analysis</h4>
              <p className="text-sm text-gray-600">Detect chronological conflicts and inconsistencies</p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg">
              <Users className="text-blue-600 mx-auto mb-2" size={32} />
              <h4 className="font-bold text-gray-800 mb-1">Character Tracking</h4>
              <p className="text-sm text-gray-600">Find character behavior and trait inconsistencies</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <BookOpen className="text-green-600 mx-auto mb-2" size={32} />
              <h4 className="font-bold text-gray-800 mb-1">Plot Holes</h4>
              <p className="text-sm text-gray-600">Identify unresolved plot threads and gaps</p>
            </div>
            <div className="p-4 bg-amber-50 rounded-lg">
              <TrendingUp className="text-amber-600 mx-auto mb-2" size={32} />
              <h4 className="font-bold text-gray-800 mb-1">Style Analysis</h4>
              <p className="text-sm text-gray-600">Check tone consistency and writing style</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Fix Modal */}
      {fixModalOpen && (
        <QuickFixModal
          issue={selectedIssue}
          onApply={applyFix}
          onCancel={() => {
            setFixModalOpen(false);
            setSelectedIssue(null);
          }}
        />
      )}
    </div>
  );
};

export default ContinuityTab;
