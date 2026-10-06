import React, { useState } from 'react';
import { Route, Plus, Edit3, Trash2, Sparkles, Grid3x3, List, Search, Link, X } from 'lucide-react';
import AIHelper from './AIHelper';
import AISuggestionBox from './AISuggestionBox';
import BatchAISuggestionBox from './BatchAISuggestionBox';
import ImproveButton from './ImproveButton';
import { useIsMobile } from '../hooks/useMediaQuery';

const PlotlinesTab = ({
  data,
  setData,
  plotlineForm,
  setPlotlineForm,
  addPlotline,
  editPlotline,
  deleteItem,
  editingId,
  setEditingId,
  generateWithAI,
  aiSuggestion,
  setAiSuggestion,
  acceptAISuggestion,
  rejectAISuggestion,
  regenerateAISuggestion,
  generatingAI,
  showAIHelper,
  setShowAIHelper,
  aiPrompt,
  setAiPrompt,
  setAiContext,
  aiContext
}) => {
  const [selectedPlotline, setSelectedPlotline] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const [searchQuery, setSearchQuery] = useState('');

  const isMobile = useIsMobile();
  const showingDetail = selectedPlotline !== null || editingId;

  // Filter plotlines based on search query
  const filteredPlotlines = data.plotlines.filter(plot => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    const linkedChars = plot.linkedCharacters?.map(id => {
      const char = data.characters.find(c => c.id === id);
      return char?.name || '';
    }).join(' ').toLowerCase() || '';

    const linkedLocs = plot.linkedLocations?.map(id => {
      const loc = data.locations.find(l => l.id === id);
      return loc?.name || '';
    }).join(' ').toLowerCase() || '';

    return (
      plot.title?.toLowerCase().includes(query) ||
      plot.type?.toLowerCase().includes(query) ||
      plot.description?.toLowerCase().includes(query) ||
      plot.status?.toLowerCase().includes(query) ||
      plot.themes?.toLowerCase().includes(query) ||
      plot.conflicts?.toLowerCase().includes(query) ||
      linkedChars.includes(query) ||
      linkedLocs.includes(query)
    );
  });

  const resetForm = () => {
    setPlotlineForm({ title: '', type: '', description: '', status: 'planning', themes: '', conflicts: '', linkedPlotlines: [] });
    setSelectedPlotline(null);
  };

  const handleEdit = (plot) => {
    editPlotline(plot);
    setSelectedPlotline(null);
  };

  const handleAddNew = () => {
    setSelectedPlotline(null);
    resetForm();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'planning': return 'bg-yellow-100 text-yellow-800';
      case 'in-progress': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'main': return 'bg-purple-100 text-purple-800';
      case 'subplot': return 'bg-indigo-100 text-indigo-800';
      case 'backstory': return 'bg-amber-100 text-amber-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="flex h-full relative">
      {/* Left sidebar - Plotlines list */}
      <div className={`${viewMode === 'grid' ? 'w-full' : 'w-full lg:w-80'} ${isMobile && showingDetail ? 'hidden' : 'flex'} bg-white border-r border-gray-200 flex-col`}>
        <div className="p-4 border-b border-gray-200">
          <div className="flex gap-2 mb-3">
            <button
              onClick={handleAddNew}
              className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 font-semibold"
            >
              <Plus size={20} />
              New Plotline
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
              className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              title={viewMode === 'list' ? 'Switch to Grid View' : 'Switch to List View'}
            >
              {viewMode === 'list' ? <Grid3x3 size={20} /> : <List size={20} />}
            </button>
          </div>
          {/* Search Input */}
          {data.plotlines.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search plotlines..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {data.plotlines.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Route className="w-12 h-12 mx-auto mb-2 text-gray-400" />
              <p>No plotlines yet</p>
            </div>
          ) : filteredPlotlines.length === 0 ? (
            <div className="p-6 text-center">
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No plotlines found</p>
              <p className="text-gray-400 text-xs mt-1">Try a different search term</p>
            </div>
          ) : viewMode === 'list' ? (
            <>
              {filteredPlotlines.map((plot) => (
            <button
              key={plot.id}
              onClick={() => setSelectedPlotline(plot)}
              className={`w-full p-4 text-left border-b border-gray-200 hover:bg-gray-50 transition-colors ${
                selectedPlotline?.id === plot.id ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <Route className="text-purple-600 mt-1 flex-shrink-0" size={20} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-800 truncate">{plot.title}</h3>
                  <div className="flex gap-2 mt-1">
                    {plot.type && (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${getTypeColor(plot.type)}`}>
                        {plot.type}
                      </span>
                    )}
                    {plot.status && (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${getStatusColor(plot.status)}`}>
                        {plot.status}
                      </span>
                    )}
                    {plot.linkedPlotlines && plot.linkedPlotlines.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs font-semibold">
                        <Link size={12} />
                        {plot.linkedPlotlines.length}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
              ))}
            </>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPlotlines.map((plot) => (
                <div key={plot.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900 mb-1">{plot.title}</h3>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {plot.type && (
                          <span className={`inline-block text-xs px-2 py-1 rounded ${getTypeColor(plot.type)}`}>
                            {plot.type}
                          </span>
                        )}
                        {plot.status && (
                          <span className={`inline-block text-xs px-2 py-1 rounded ${getStatusColor(plot.status)}`}>
                            {plot.status}
                          </span>
                        )}
                        {plot.linkedPlotlines && plot.linkedPlotlines.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-semibold">
                            <Link size={12} />
                            {plot.linkedPlotlines.length} linked
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          handleEdit(plot);
                          setViewMode('list');
                        }}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => deleteItem('plotlines', plot.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {plot.description && (
                    <p className="text-xs text-gray-500 mt-2 line-clamp-3">{plot.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel - Details or form */}
      {viewMode === 'list' && (
        <div className={`${isMobile && showingDetail ? 'fixed inset-0 z-50 bg-white' : isMobile ? 'hidden' : 'flex-1'} overflow-y-auto p-4 sm:p-6`}>
          {selectedPlotline ? (
            // Detailed view
          <div className="max-w-4xl">
            <div className="flex items-start justify-between mb-4 sm:mb-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
                  {/* Mobile back button */}
                  <button
                    onClick={() => setSelectedPlotline(null)}
                    className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title="Back to plotlines"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800">{selectedPlotline.title}</h2>
                </div>
                <div className="flex gap-2">
                  {selectedPlotline.type && (
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getTypeColor(selectedPlotline.type)}`}>
                      {selectedPlotline.type}
                    </span>
                  )}
                  {selectedPlotline.status && (
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getStatusColor(selectedPlotline.status)}`}>
                      {selectedPlotline.status}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <button
                  onClick={() => handleEdit(selectedPlotline)}
                  className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Edit3 size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  onClick={() => {
                    deleteItem('plotlines', selectedPlotline.id);
                    setSelectedPlotline(null);
                  }}
                  className="px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                >
                  <Trash2 size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {selectedPlotline.description && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-700">Description</h3>
                    <ImproveButton
                      content={selectedPlotline.description}
                      contentType="plotline description"
                      onImprove={(improved) => {
                        setData(prev => ({
                          ...prev,
                          plotlines: prev.plotlines.map(p =>
                            p.id === selectedPlotline.id ? { ...p, description: improved } : p
                          ),
                        }));
                        setSelectedPlotline({ ...selectedPlotline, description: improved });
                      }}
                      context={data}
                    />
                  </div>
                  <p className="text-gray-800 leading-relaxed">{selectedPlotline.description}</p>
                </div>
              )}

              {selectedPlotline.themes && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-700">Themes Explored</h3>
                    <ImproveButton
                      content={selectedPlotline.themes}
                      contentType="themes"
                      onImprove={(improved) => {
                        setData(prev => ({
                          ...prev,
                          plotlines: prev.plotlines.map(p =>
                            p.id === selectedPlotline.id ? { ...p, themes: improved } : p
                          ),
                        }));
                        setSelectedPlotline({ ...selectedPlotline, themes: improved });
                      }}
                      context={data}
                    />
                  </div>
                  <p className="text-gray-800 leading-relaxed">{selectedPlotline.themes}</p>
                </div>
              )}

              {selectedPlotline.conflicts && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-700">Key Conflicts</h3>
                    <ImproveButton
                      content={selectedPlotline.conflicts}
                      contentType="conflicts"
                      onImprove={(improved) => {
                        setData(prev => ({
                          ...prev,
                          plotlines: prev.plotlines.map(p =>
                            p.id === selectedPlotline.id ? { ...p, conflicts: improved } : p
                          ),
                        }));
                        setSelectedPlotline({ ...selectedPlotline, conflicts: improved });
                      }}
                      context={data}
                    />
                  </div>
                  <p className="text-gray-800 leading-relaxed">{selectedPlotline.conflicts}</p>
                </div>
              )}

              {selectedPlotline.linkedPlotlines && selectedPlotline.linkedPlotlines.length > 0 && (
                <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                  <h3 className="text-lg font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Link size={18} className="text-purple-600" />
                    Linked Plotlines
                  </h3>
                  <p className="text-xs text-gray-600 mb-3">These plotlines will be automatically included when using this plotline in AI generation</p>
                  <div className="space-y-2">
                    {selectedPlotline.linkedPlotlines.map((linkedId) => {
                      const linkedPlot = data.plotlines.find(p => p.id === linkedId);
                      if (!linkedPlot) return null;
                      return (
                        <div key={linkedId} className="bg-white p-3 rounded-lg border border-purple-200 flex items-start gap-3">
                          <Route className="text-purple-600 mt-1" size={16} />
                          <div className="flex-1">
                            <div className="font-semibold text-gray-800">{linkedPlot.title}</div>
                            <p className="text-xs text-gray-600 mt-1">{linkedPlot.description}</p>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${getTypeColor(linkedPlot.type)}`}>
                            {linkedPlot.type}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          // Form view
          <div className="max-w-4xl">
            <div className="flex justify-between items-center mb-4 sm:mb-6">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* Mobile back button */}
                <button
                  onClick={() => setEditingId(null)}
                  className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                  title="Back to plotlines"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-800">
                  {editingId ? 'Edit Plotline' : 'Add New Plotline'}
                </h2>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    setShowAIHelper(!showAIHelper);
                    setAiContext('plotline');
                  }}
                  className="px-3 sm:px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
                >
                  <Sparkles size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">AI Assistant</span>
                </button>
                <button
                  onClick={() => {
                    setShowAIHelper(!showAIHelper);
                    setAiContext('plotline-batch');
                  }}
                  className="px-3 sm:px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                  <Sparkles size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Batch Generate</span>
                </button>
              </div>
            </div>

            <AIHelper
              show={showAIHelper}
              type="plotline"
              prompt={aiPrompt}
              setPrompt={setAiPrompt}
              onGenerate={() => generateWithAI('plotline')}
              onCancel={() => {
                setShowAIHelper(false);
                setAiPrompt('');
                setAiContext('');
              }}
              generating={generatingAI}
              title={aiContext === 'plotline-batch' ? "Batch AI Plotline Generator" : "AI Plotline Generator"}
              placeholder={aiContext === 'plotline-batch'
                ? "E.g., 'Create plotlines for each act of a three-act structure' or 'Generate subplots for each main character'"
                : "E.g., 'A subplot about a character discovering their true heritage while the main quest continues'"
              }
            />

            {aiSuggestion && aiSuggestion.type === 'plotline' && (
              Array.isArray(aiSuggestion.data) ? (
                <BatchAISuggestionBox
                  suggestions={aiSuggestion.data}
                  onAccept={(index) => {
                    if (index === 'all') {
                      const newPlotlines = aiSuggestion.data.map((plot, i) => ({
                        id: Date.now() + i,
                        status: 'planning',
                        ...plot
                      }));
                      setData(prev => ({
                        ...prev,
                        plotlines: [...prev.plotlines, ...newPlotlines]
                      }));
                      setAiSuggestion(null);
                      setShowAIHelper(false);
                      setAiPrompt('');
                    } else {
                      const plot = aiSuggestion.data[index];
                      setData(prev => ({
                        ...prev,
                        plotlines: [...prev.plotlines, { id: Date.now(), status: 'planning', ...plot }]
                      }));
                      const newSuggestions = aiSuggestion.data.filter((_, i) => i !== index);
                      if (newSuggestions.length === 0) {
                        setAiSuggestion(null);
                        setShowAIHelper(false);
                        setAiPrompt('');
                      } else {
                        setAiSuggestion({ type: 'plotline', data: newSuggestions });
                      }
                    }
                  }}
                  onReject={(index) => {
                    if (index === 'all') {
                      setAiSuggestion(null);
                      setAiPrompt('');
                      setShowAIHelper(false);
                      setAiContext('');
                    } else {
                      const newSuggestions = aiSuggestion.data.filter((_, i) => i !== index);
                      if (newSuggestions.length === 0) {
                        setAiSuggestion(null);
                        setShowAIHelper(false);
                        setAiPrompt('');
                        setAiContext('');
                      } else {
                        setAiSuggestion({ type: 'plotline', data: newSuggestions });
                      }
                    }
                  }}
                  onRegenerate={regenerateAISuggestion}
                  loading={generatingAI}
                  title="AI Generated Plotlines"
                />
              ) : (
                <AISuggestionBox
                  suggestion={aiSuggestion.data}
                  onAccept={acceptAISuggestion}
                  onReject={rejectAISuggestion}
                  onRegenerate={regenerateAISuggestion}
                  loading={generatingAI}
                  title="AI Generated Plotline"
                />
              )
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Plotline Title *"
                  value={plotlineForm.title}
                  onChange={(e) => setPlotlineForm(prev => ({ ...prev, title: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
                />
                <select
                  value={plotlineForm.type}
                  onChange={(e) => setPlotlineForm(prev => ({ ...prev, type: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
                >
                  <option value="">Select Type</option>
                  <option value="main">Main Plot</option>
                  <option value="subplot">Subplot</option>
                  <option value="backstory">Backstory</option>
                </select>
              </div>

              <textarea
                placeholder="Description"
                value={plotlineForm.description}
                onChange={(e) => setPlotlineForm(prev => ({ ...prev, description: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg resize-none h-32 focus:ring-2 focus:ring-purple-400 outline-none"
              />

              <div className="grid grid-cols-2 gap-4">
                <textarea
                  placeholder="Themes Explored"
                  value={plotlineForm.themes}
                  onChange={(e) => setPlotlineForm(prev => ({ ...prev, themes: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-purple-400 outline-none"
                />
                <textarea
                  placeholder="Key Conflicts"
                  value={plotlineForm.conflicts}
                  onChange={(e) => setPlotlineForm(prev => ({ ...prev, conflicts: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-purple-400 outline-none"
                />
              </div>

              <select
                value={plotlineForm.status}
                onChange={(e) => setPlotlineForm(prev => ({ ...prev, status: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
              >
                <option value="planning">Planning</option>
                <option value="in-progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>

              {/* Linked Plotlines */}
              <div className="border border-gray-300 rounded-lg p-4">
                <label className="block text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Link size={18} className="text-purple-600" />
                  Linked Plotlines
                </label>
                <p className="text-xs text-gray-600 mb-3">Link related plotlines. When using this plotline, linked plotlines' context will also be included in AI generation.</p>

                {/* Display linked plotlines */}
                {plotlineForm.linkedPlotlines && plotlineForm.linkedPlotlines.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {plotlineForm.linkedPlotlines.map((linkedId) => {
                      const linkedPlot = data.plotlines.find(p => p.id === linkedId);
                      if (!linkedPlot) return null;
                      return (
                        <div key={linkedId} className="flex items-center justify-between bg-purple-50 p-2 rounded-lg border border-purple-200">
                          <span className="text-sm font-medium text-gray-800">{linkedPlot.title}</span>
                          <button
                            onClick={() => {
                              setPlotlineForm(prev => ({
                                ...prev,
                                linkedPlotlines: prev.linkedPlotlines.filter(id => id !== linkedId)
                              }));
                            }}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add linked plotline */}
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      const linkedId = parseInt(e.target.value);
                      if (!plotlineForm.linkedPlotlines.includes(linkedId)) {
                        setPlotlineForm(prev => ({
                          ...prev,
                          linkedPlotlines: [...(prev.linkedPlotlines || []), linkedId]
                        }));
                      }
                      e.target.value = '';
                    }
                  }}
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-400 outline-none"
                >
                  <option value="">Add linked plotline...</option>
                  {data.plotlines
                    .filter(p => p.id !== editingId && !(plotlineForm.linkedPlotlines || []).includes(p.id))
                    .map((plot) => (
                      <option key={plot.id} value={plot.id}>
                        {plot.title}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  onClick={addPlotline}
                  className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
                >
                  <Plus size={20} />
                  {editingId ? 'Update Plotline' : 'Add Plotline'}
                </button>
                {editingId && (
                  <button
                    onClick={resetForm}
                    className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PlotlinesTab;
