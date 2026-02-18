import React, { useState } from 'react';
import { X, Wand2, Sparkles, BookOpen, Users, MapPin, Route, FileText, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useAIBookGenerator } from '../hooks/useAIBookGenerator';

const AIBookGeneratorModal = ({ onClose, onBookCreated }) => {
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState({
    numCharacters: 5,
    numLocations: 4,
    numPlotlines: 3,
    numChapters: 10,
    generateImages: false,
  });
  const [showOptions, setShowOptions] = useState(false);

  const { isGenerating, progress, currentStage, error, result, startGeneration, reset } = useAIBookGenerator();

  const examplePrompts = [
    'A cyberpunk detective story set in 2099 Tokyo where an AI becomes self-aware and needs the detective\'s help to survive',
    'A fantasy epic about a young blacksmith who discovers they can forge magical weapons, set in a world where five elemental kingdoms are at war',
    'A post-apocalyptic survival story following a group of scientists trying to rebuild civilization after a solar flare destroys all electronics',
    'A cozy mystery in a small coastal town where a baker solves crimes using her grandmother\'s secret recipes and local gossip',
    'A space opera about the last human diplomat negotiating peace between alien civilizations while hiding humanity\'s extinction',
  ];

  const handleGenerate = async () => {
    if (!description.trim()) return;
    await startGeneration(description, options);
  };

  const handleExampleClick = (example) => {
    setDescription(example);
  };

  const getStageIcon = (stage) => {
    const icons = {
      analyzing: Sparkles,
      characters: Users,
      locations: MapPin,
      plotlines: Route,
      outlines: FileText,
      relationships: Users,
      chapters: BookOpen,
      timeline: Route,
      images: Sparkles,
      quality: CheckCircle,
      complete: CheckCircle,
      done: CheckCircle,
      error: AlertCircle,
    };
    return icons[stage] || Loader;
  };

  const getStageColor = (stage) => {
    if (stage === 'error') return 'text-red-600';
    if (stage === 'complete' || stage === 'done') return 'text-green-600';
    if (stage === currentStage) return 'text-indigo-600';
    return 'text-gray-400';
  };

  const handleViewBook = () => {
    if (result?.bookId) {
      onBookCreated(result.bookId);
      onClose();
    }
  };

  const handleStartOver = () => {
    reset();
    setDescription('');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4 sm:p-6 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Wand2 className="w-6 h-6 sm:w-8 sm:h-8 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-lg sm:text-2xl font-bold truncate">AI Book Generator</h2>
              <p className="text-indigo-100 text-xs sm:text-sm truncate">Let AI create your story from start to finish</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 sm:p-3 transition-colors flex-shrink-0 ml-2"
          >
            <X className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {!isGenerating && !result && (
            <>
              {/* Description Input */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Describe Your Story Idea
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A young wizard discovers a hidden library that contains books from parallel universes..."
                  className="w-full h-32 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Be as detailed as you like! Include genre, themes, setting, characters, conflicts, etc.
                </p>
              </div>

              {/* Example Prompts */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Example Story Ideas</h3>
                <div className="grid gap-2">
                  {examplePrompts.map((example, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleExampleClick(example)}
                      className="text-left p-3 bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-300 rounded-lg text-sm text-gray-700 hover:text-indigo-700 transition-colors"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>

              {/* Options */}
              <div className="mb-6">
                <button
                  onClick={() => setShowOptions(!showOptions)}
                  className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 mb-3"
                >
                  {showOptions ? '− Hide' : '+ Show'} Advanced Options
                </button>

                {showOptions && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Number of Characters
                      </label>
                      <input
                        type="number"
                        min="3"
                        max="10"
                        value={options.numCharacters}
                        onChange={(e) => setOptions({ ...options, numCharacters: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Number of Locations
                      </label>
                      <input
                        type="number"
                        min="2"
                        max="8"
                        value={options.numLocations}
                        onChange={(e) => setOptions({ ...options, numLocations: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Number of Plotlines
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="5"
                        value={options.numPlotlines}
                        onChange={(e) => setOptions({ ...options, numPlotlines: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Number of Chapters
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="30"
                        value={options.numChapters}
                        onChange={(e) => setOptions({ ...options, numChapters: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={options.generateImages}
                          onChange={(e) => setOptions({ ...options, generateImages: e.target.checked })}
                          className="rounded"
                        />
                        <span>Generate character images (increases generation time)</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-red-800">Generation Failed</h4>
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Progress Display */}
          {isGenerating && (
            <div className="space-y-4">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-full mb-3">
                  <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800">Generating Your Book...</h3>
                <p className="text-sm text-gray-600">This may take 5-10 minutes depending on complexity</p>
              </div>

              <div className="space-y-2">
                {progress.map((item, idx) => {
                  const Icon = getStageIcon(item.stage);
                  const color = getStageColor(item.stage);

                  return (
                    <div
                      key={idx}
                      className={`flex items-start gap-3 p-3 rounded-lg ${
                        item.stage === currentStage ? 'bg-indigo-50' : 'bg-gray-50'
                      }`}
                    >
                      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${color}`} />
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${color}`}>{item.message}</p>
                        <p className="text-xs text-gray-500">{new Date(item.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Success Display */}
          {result && !error && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
                <CheckCircle className="w-12 h-12 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-2">Book Generated Successfully!</h3>
              <p className="text-gray-600 mb-6">Your AI-generated book is ready to edit and refine.</p>

              {result.continuityReport && result.continuityReport.summary.score && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg inline-block">
                  <p className="text-sm font-semibold text-blue-800">
                    Continuity Score: {result.continuityReport.summary.score}/100
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    {result.continuityReport.summary.critical} critical issues,{' '}
                    {result.continuityReport.summary.warnings} warnings
                  </p>
                </div>
              )}

              <div className="flex gap-3 justify-center">
                <button
                  onClick={handleViewBook}
                  className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 shadow-lg hover:shadow-xl transition-all"
                >
                  <BookOpen className="inline-block w-5 h-5 mr-2" />
                  Open Book
                </button>
                <button
                  onClick={handleStartOver}
                  className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-all"
                >
                  Generate Another
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!isGenerating && !result && (
          <div className="border-t p-6 bg-gray-50 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              <p className="font-semibold">Estimated time: 5-10 minutes</p>
              <p className="text-xs">Keep this tab open during generation</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!description.trim()}
                className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl flex items-center gap-2"
              >
                <Wand2 className="w-5 h-5" />
                Generate Book
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIBookGeneratorModal;
