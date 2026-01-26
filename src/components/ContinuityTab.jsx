import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Users, MapPin, BookOpen, Sparkles, RefreshCw, TrendingUp, Zap } from 'lucide-react';

const ContinuityTab = ({ data, onAnalyze, analyzing }) => {
  const [analysis, setAnalysis] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');

  const handleAnalyze = async () => {
    const result = await onAnalyze();
    setAnalysis(result);
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

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-3">AI Writing Continuity</h2>
        <p className="text-gray-600">Analyze your story for consistency, plot holes, and style issues</p>
      </div>

      {/* Analyze Button */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-6 mb-6 border border-purple-200">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-800 mb-2 flex items-center gap-2">
              <Sparkles className="text-purple-600" size={24} />
              Story Analysis
            </h3>
            <p className="text-gray-700">
              Run AI analysis to detect inconsistencies, timeline conflicts, character issues, and style problems
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
                <CheckCircle2 className="text-green-600" size={32} />
                <span className="text-3xl font-bold text-green-600">{analysis.summary?.passed || 0}</span>
              </div>
              <p className="text-sm font-semibold text-gray-700">Passed Checks</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border-2 border-yellow-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <AlertTriangle className="text-yellow-600" size={32} />
                <span className="text-3xl font-bold text-yellow-600">{analysis.summary?.warnings || 0}</span>
              </div>
              <p className="text-sm font-semibold text-gray-700">Warnings</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border-2 border-red-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <AlertTriangle className="text-red-600" size={32} />
                <span className="text-3xl font-bold text-red-600">{analysis.summary?.critical || 0}</span>
              </div>
              <p className="text-sm font-semibold text-gray-700">Critical Issues</p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border-2 border-indigo-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <TrendingUp className="text-indigo-600" size={32} />
                <span className="text-3xl font-bold text-indigo-600">{analysis.summary?.score || 0}%</span>
              </div>
              <p className="text-sm font-semibold text-gray-700">Quality Score</p>
            </div>
          </div>

          {/* Category Filters */}
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const count = cat.id === 'all'
                ? analysis.issues?.length || 0
                : analysis.issues?.filter(i => i.category === cat.id).length || 0;

              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${
                    selectedCategory === cat.id
                      ? 'bg-purple-600 text-white shadow-lg'
                      : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  <Icon size={18} />
                  {cat.label}
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    selectedCategory === cat.id
                      ? 'bg-purple-700 text-white'
                      : 'bg-gray-200 text-gray-700'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Issues List */}
          <div className="space-y-4">
            {filteredIssues.length === 0 ? (
              <div className="bg-green-50 border-2 border-green-200 rounded-lg p-8 text-center">
                <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-green-800 mb-2">
                  {selectedCategory === 'all' ? 'No Issues Found!' : `No ${selectedCategory} issues found!`}
                </h3>
                <p className="text-green-700">
                  Your story looks consistent in this area. Keep up the great work!
                </p>
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
                            💡 Suggestion:
                          </p>
                          <p className="text-sm text-gray-800">{issue.suggestion}</p>
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
    </div>
  );
};

export default ContinuityTab;
