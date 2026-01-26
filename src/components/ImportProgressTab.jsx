import React, { useState } from 'react';
import { FileText, CheckCircle2, Clock, AlertCircle, Play, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

const ImportProgressTab = ({ data, bookId, onAnalysisComplete }) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [showChapterList, setShowChapterList] = useState(false);
  const [analyzingChapter, setAnalyzingChapter] = useState(null);

  const importInfo = data.importedFrom;
  const analysisStatus = data.importAnalysis;

  if (!importInfo) {
    return (
      <div className="text-center py-12">
        <FileText className="w-16 h-16 text-gray-500 mx-auto mb-4" />
        <p className="text-gray-400">This book was not imported</p>
      </div>
    );
  }

  const handleStartAnalysis = async (chapterIndexes = null) => {
    setAnalyzing(true);
    setProgress([]);
    setAnalysisResult(null);
    if (chapterIndexes !== null) {
      setAnalyzingChapter(chapterIndexes[0]);
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/books/${bookId}/analyze-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ chapterIndexes }),
      });

      if (!response.ok) {
        throw new Error('Failed to start analysis');
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          setAnalyzing(false);
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              setProgress(prev => [...prev, data]);

              if (data.stage === 'complete') {
                setAnalysisResult(data);
                if (onAnalysisComplete) {
                  onAnalysisComplete();
                }
              } else if (data.stage === 'error') {
                setAnalyzing(false);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Analysis error:', error);
      setProgress(prev => [...prev, {
        stage: 'error',
        message: error.message || 'Analysis failed',
      }]);
      setAnalyzing(false);
    }
  };

  const isCompleted = analysisStatus?.status === 'completed';
  const isPending = analysisStatus?.status === 'pending';
  const isPartial = analysisStatus?.status === 'partial';
  const analyzedCount = analysisStatus?.analyzedChapters || 0;
  const totalChapters = data.chapters?.length || 0;
  const isPartiallyAnalyzed = isPartial || (analyzedCount > 0 && analyzedCount < totalChapters);

  return (
    <div className="p-6 space-y-6">
      {/* Import Info */}
      <div className="bg-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-400" />
          Import Information
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-gray-400 text-sm">Filename</p>
            <p className="text-white font-medium">{importInfo.filename}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">File Type</p>
            <p className="text-white font-medium uppercase">{importInfo.fileType}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">Imported</p>
            <p className="text-white font-medium">
              {new Date(importInfo.importedAt).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">Chapters</p>
            <p className="text-white font-medium">{data.chapters?.length || 0}</p>
          </div>
        </div>
      </div>

      {/* Analysis Status */}
      <div className="bg-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          AI Analysis Status
        </h3>

        {isPending && !analyzing && (
          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-blue-400 font-medium">Analysis Not Started</p>
                <p className="text-blue-400/80 text-sm mt-1">
                  Run AI analysis to extract characters, locations, and plot information from the imported book.
                </p>
                <p className="text-blue-400/60 text-xs mt-2">
                  This process analyzes each chapter incrementally and may take several minutes depending on book length.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleStartAnalysis()}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg transition-all font-medium flex items-center justify-center gap-2"
              >
                <Play className="w-5 h-5" />
                Analyze All Chapters
              </button>
              <button
                onClick={() => setShowChapterList(!showChapterList)}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
              >
                {showChapterList ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                Select Chapters
              </button>
            </div>

            {/* Chapter Selection List */}
            {showChapterList && (
              <div className="mt-4 bg-gray-800 border border-gray-600 rounded-lg p-4 max-h-96 overflow-y-auto">
                <p className="text-gray-300 text-sm mb-3">Select specific chapters to analyze:</p>
                <div className="space-y-2">
                  {data.chapters.map((chapter, idx) => {
                    const hasAnalysis = chapter.summary && chapter.summary.trim();
                    return (
                      <div key={chapter.id} className={`flex items-center justify-between rounded p-3 ${hasAnalysis ? 'bg-green-900/20 border border-green-700' : 'bg-gray-700'}`}>
                        <div className="flex-1 flex items-center gap-2">
                          {hasAnalysis && <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />}
                          <div>
                            <p className="text-white font-medium text-sm">
                              Chapter {chapter.number}: {chapter.title}
                            </p>
                            <p className="text-gray-400 text-xs mt-1">
                              {chapter.wordCount?.toLocaleString() || 0} words
                              {hasAnalysis && <span className="ml-2 text-green-400">• Analyzed</span>}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleStartAnalysis([idx])}
                          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                            hasAnalysis
                              ? 'bg-gray-600 hover:bg-gray-500 text-white'
                              : 'bg-purple-600 hover:bg-purple-700 text-white'
                          }`}
                        >
                          {hasAnalysis ? 'Re-analyze' : 'Analyze'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {analyzing && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-white font-medium">Analyzing book...</p>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {progress.map((item, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border-l-4 ${
                    item.stage === 'error' ? 'bg-red-900/20 border-red-500 text-red-200' :
                    item.stage === 'complete' ? 'bg-green-900/20 border-green-500 text-green-200' :
                    item.stage === 'chapter-complete' ? 'bg-blue-900/20 border-blue-500 text-blue-200' :
                    'bg-gray-700 border-gray-500 text-gray-100'
                  }`}
                >
                  <p className="text-sm font-medium">
                    {item.message}
                    {item.analyzed && item.total && (
                      <span className="ml-2 text-xs font-bold bg-white/10 px-2 py-1 rounded">
                        {item.analyzed}/{item.total}
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {isCompleted && !analyzing && (
          <div className="space-y-4">
            <div className="bg-green-500/10 border border-green-500 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-green-400 font-medium">Analysis Complete</p>
                <p className="text-green-400/80 text-sm mt-1">
                  Completed on {new Date(analysisStatus.completedAt).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-600 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Chapters Analyzed</p>
                <p className="text-2xl font-bold text-white">
                  {analysisStatus.analyzedChapters} / {analysisStatus.totalChapters}
                </p>
              </div>
              <div className="bg-gray-600 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Characters Found</p>
                <p className="text-2xl font-bold text-white">
                  {data.characters?.filter(c => c.fromImport).length || 0}
                </p>
              </div>
              <div className="bg-gray-600 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Locations Found</p>
                <p className="text-2xl font-bold text-white">
                  {data.locations?.filter(l => l.fromImport).length || 0}
                </p>
              </div>
            </div>

            {analysisResult && (
              <div className="bg-gray-600 rounded-lg p-4">
                <p className="text-gray-400 text-sm mb-2">Analysis Summary</p>
                <div className="flex flex-wrap gap-2">
                  {analysisResult.charactersFound > 0 && (
                    <span className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm">
                      {analysisResult.charactersFound} Characters
                    </span>
                  )}
                  {analysisResult.locationsFound > 0 && (
                    <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-sm">
                      {analysisResult.locationsFound} Locations
                    </span>
                  )}
                  {analysisResult.plotThreadsFound > 0 && (
                    <span className="px-3 py-1 bg-purple-500/20 text-purple-400 rounded-full text-sm">
                      {analysisResult.plotThreadsFound} Plot Threads
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => handleStartAnalysis()}
                className="flex-1 px-6 py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors font-medium"
              >
                Re-analyze All Chapters
              </button>
              <button
                onClick={() => setShowChapterList(!showChapterList)}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
              >
                {showChapterList ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                Analyze More Chapters
              </button>
            </div>

            {/* Chapter Selection List for completed analysis */}
            {showChapterList && (
              <div className="mt-4 bg-gray-800 border border-gray-600 rounded-lg p-4 max-h-96 overflow-y-auto">
                <p className="text-gray-300 text-sm mb-3">Select specific chapters to re-analyze:</p>
                <div className="space-y-2">
                  {data.chapters.map((chapter, idx) => (
                    <div key={chapter.id} className="flex items-center justify-between bg-gray-700 rounded p-3">
                      <div className="flex-1">
                        <p className="text-white font-medium text-sm">
                          Chapter {chapter.number}: {chapter.title}
                        </p>
                        <p className="text-gray-400 text-xs mt-1">
                          {chapter.wordCount?.toLocaleString() || 0} words
                        </p>
                      </div>
                      <button
                        onClick={() => handleStartAnalysis([idx])}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium transition-colors"
                      >
                        Analyze
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Partially Analyzed State */}
        {isPartiallyAnalyzed && !analyzing && (
          <div className="space-y-4">
            <div className="bg-yellow-500/10 border border-yellow-500 rounded-lg p-4 flex items-start gap-3">
              <Clock className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-yellow-400 font-medium">Partial Analysis Complete</p>
                <p className="text-yellow-400/80 text-sm mt-1">
                  {analyzedCount} of {totalChapters} chapters analyzed. Continue analyzing remaining chapters or select specific ones.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-600 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Progress</p>
                <p className="text-2xl font-bold text-white">
                  {analyzedCount} / {totalChapters}
                </p>
                <div className="mt-2 w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-purple-500 h-2 rounded-full transition-all"
                    style={{ width: `${(analyzedCount / totalChapters) * 100}%` }}
                  ></div>
                </div>
              </div>
              <div className="bg-gray-600 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Characters Found</p>
                <p className="text-2xl font-bold text-white">
                  {data.characters?.filter(c => c.fromImport).length || 0}
                </p>
              </div>
              <div className="bg-gray-600 rounded-lg p-4">
                <p className="text-gray-400 text-sm">Locations Found</p>
                <p className="text-2xl font-bold text-white">
                  {data.locations?.filter(l => l.fromImport).length || 0}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleStartAnalysis()}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-lg transition-all font-medium flex items-center justify-center gap-2"
              >
                <Play className="w-5 h-5" />
                Continue All Remaining
              </button>
              <button
                onClick={() => setShowChapterList(!showChapterList)}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
              >
                {showChapterList ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                Select Chapters
              </button>
            </div>

            {/* Chapter Selection List */}
            {showChapterList && (
              <div className="mt-4 bg-gray-800 border border-gray-600 rounded-lg p-4 max-h-96 overflow-y-auto">
                <p className="text-gray-300 text-sm mb-3">Select specific chapters to analyze:</p>
                <div className="space-y-2">
                  {data.chapters.map((chapter, idx) => {
                    const hasAnalysis = chapter.summary && chapter.summary.trim();
                    return (
                      <div key={chapter.id} className={`flex items-center justify-between rounded p-3 ${hasAnalysis ? 'bg-green-900/20 border border-green-700' : 'bg-gray-700'}`}>
                        <div className="flex-1 flex items-center gap-2">
                          {hasAnalysis && <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />}
                          <div>
                            <p className="text-white font-medium text-sm">
                              Chapter {chapter.number}: {chapter.title}
                            </p>
                            <p className="text-gray-400 text-xs mt-1">
                              {chapter.wordCount?.toLocaleString() || 0} words
                              {hasAnalysis && <span className="ml-2 text-green-400">• Analyzed</span>}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleStartAnalysis([idx])}
                          className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                            hasAnalysis
                              ? 'bg-gray-600 hover:bg-gray-500 text-white'
                              : 'bg-purple-600 hover:bg-purple-700 text-white'
                          }`}
                        >
                          {hasAnalysis ? 'Re-analyze' : 'Analyze'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="bg-gray-800 border-2 border-gray-600 rounded-lg p-6">
        <h4 className="text-white font-bold text-lg mb-3">Next Steps</h4>
        <ul className="space-y-3 text-gray-200 text-sm">
          <li className="flex items-start gap-3">
            <span className="text-blue-400 text-lg font-bold">•</span>
            <span className="leading-relaxed">Review and enhance the extracted characters and locations in their respective tabs</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-blue-400 text-lg font-bold">•</span>
            <span className="leading-relaxed">Use the AI Tools tab to generate additional content based on the imported book</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-blue-400 text-lg font-bold">•</span>
            <span className="leading-relaxed">Generate new chapters to extend the story or create a sequel</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-blue-400 text-lg font-bold">•</span>
            <span className="leading-relaxed">Convert chapters to audiobooks or comic format</span>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default ImportProgressTab;
