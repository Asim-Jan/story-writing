import React, { useState } from 'react';
import { X, Sparkles, CheckSquare, Square, Plus, FilePlus } from 'lucide-react';

const ChapterGeneratorModal = ({ data, setData, onGenerate, onClose, generatingAI }) => {
  const [selectedTimelines, setSelectedTimelines] = useState([]);
  const [selectedPlotlines, setSelectedPlotlines] = useState([]);
  const [generatingChapters, setGeneratingChapters] = useState([]);
  const [results, setResults] = useState([]);
  const [appendMode, setAppendMode] = useState(false);
  const [selectedChapterToAppend, setSelectedChapterToAppend] = useState('');

  // Group timeline scenes by chapter hint
  const scenesByChapter = (data.timelines || []).reduce((acc, scene) => {
    const chapterKey = scene.chapterHint || 'Ungrouped Scenes';
    if (!acc[chapterKey]) {
      acc[chapterKey] = [];
    }
    acc[chapterKey].push(scene);
    return acc;
  }, {});

  // Find chapter groups that don't already exist
  const availableChapterGroups = Object.entries(scenesByChapter).filter(([chapterHint, scenes]) => {
    const chapterTitle = chapterHint.replace(/^chapter \d+:\s*/i, '');
    return !data.chapters.some(ch =>
      ch.title.toLowerCase().includes(chapterTitle.toLowerCase())
    );
  });

  const handleGenerate = async () => {
    if (selectedTimelines.length === 0) {
      alert('Please select at least one chapter group');
      return;
    }

    if (appendMode && !selectedChapterToAppend) {
      alert('Please select a chapter to append to');
      return;
    }

    // In append mode, only use the first selected timeline
    const timelinestoProcess = appendMode ? [selectedTimelines[0]] : selectedTimelines;
    setGeneratingChapters(timelinestoProcess);
    const newResults = [];

    for (const chapterHint of timelinestoProcess) {
      const scenes = scenesByChapter[chapterHint];
      if (!scenes || scenes.length === 0) continue;

      // Combine all scenes for this chapter
      const scenesDescription = scenes.map(scene =>
        `Scene: ${scene.event}\nLocation: ${scene.location}\nType: ${scene.sceneType || 'general'}\n${scene.description}`
      ).join('\n\n');

      // Gather all plotlines including linked ones
      const allPlotlineIds = new Set(selectedPlotlines);

      selectedPlotlines.forEach(id => {
        const plot = data.plotlines.find(p => p.id.toString() === id);
        if (plot && plot.linkedPlotlines) {
          plot.linkedPlotlines.forEach(linkedId => allPlotlineIds.add(linkedId.toString()));
        }
      });

      const plotlinesContext = Array.from(allPlotlineIds).map(id => {
        const plot = data.plotlines.find(p => p.id.toString() === id);
        return plot ? `${plot.title}: ${plot.description}` : '';
      }).filter(p => p).join('\n');

      const chapterTitle = chapterHint.replace(/^chapter \d+:\s*/i, '');

      // Get existing chapter content if in append mode
      let existingContent = '';
      if (appendMode && selectedChapterToAppend) {
        const existingChapter = data.chapters.find(ch => ch.id.toString() === selectedChapterToAppend);
        if (existingChapter && existingChapter.content) {
          existingContent = `\n\nEXISTING CHAPTER CONTENT:\n${existingChapter.content}\n\n`;
        }
      }

      const prompt = appendMode
        ? `Add new content to an existing chapter that incorporates these new scenes:
${existingContent}
NEW Scenes to add:
${scenesDescription}

${plotlinesContext ? `Incorporate these plotlines:\n${plotlinesContext}\n` : ''}

Create ONLY the NEW content that adds these scenes to the existing chapter. The content should flow naturally from the existing content and maintain consistent tone and style. Do NOT rewrite the entire chapter.`
        : `Create a complete chapter that includes all these scenes:

Chapter Title: ${chapterTitle}

Scenes to include:
${scenesDescription}

${plotlinesContext ? `Incorporate these plotlines:\n${plotlinesContext}\n` : ''}

Create engaging narrative content that flows naturally through all these scenes with dialogue, descriptions, and smooth transitions between scenes.`;

      const result = await onGenerate('chapter', prompt);

      if (result) {
        newResults.push({
          chapterHint,
          sceneCount: scenes.length,
          chapterData: result
        });
      }
    }

    setResults(newResults);
    setGeneratingChapters([]);
  };

  const handleAcceptAll = () => {
    if (appendMode && selectedChapterToAppend) {
      // Append mode: Add content to existing chapter
      const result = results[0]; // Only one result in append mode
      if (!result) {
        alert('No generated content to append');
        return;
      }

      console.log('Appending to chapter:', selectedChapterToAppend);
      console.log('Result:', result);

      let chapterUpdated = false;

      setData(prev => {
        const updatedChapters = prev.chapters.map(ch => {
          if (ch.id.toString() === selectedChapterToAppend || ch.id === parseInt(selectedChapterToAppend)) {
            console.log('Found chapter to update:', ch.title);
            chapterUpdated = true;
            const newContent = ch.content
              ? `${ch.content}\n\n${result.chapterData.content || ''}`
              : result.chapterData.content || '';
            const wordCount = newContent.trim().split(/\s+/).filter(w => w).length;

            return {
              ...ch,
              content: newContent,
              wordCount,
              summary: ch.summary || result.chapterData.summary
            };
          }
          return ch;
        });

        return {
          ...prev,
          chapters: updatedChapters
        };
      });

      if (!chapterUpdated) {
        alert('Error: Could not find chapter to append to');
        return;
      }

      alert('Content appended to chapter!');
      onClose();
    } else {
      // Create new chapters
      results.forEach((result, index) => {
        const wordCount = (result.chapterData.content || '').trim().split(/\s+/).filter(w => w).length;
        const newChapter = {
          id: Date.now() + index,
          number: (data.chapters.length + index + 1).toString(),
          title: result.chapterData.title || 'Untitled Chapter',
          summary: result.chapterData.summary || '',
          content: result.chapterData.content || '',
          wordCount
        };

        setData(prev => ({
          ...prev,
          chapters: [...prev.chapters, newChapter]
        }));
      });

      alert(`${results.length} chapters added!`);
      onClose();
    }
  };

  const toggleTimeline = (id) => {
    setSelectedTimelines(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const togglePlotline = (id) => {
    setSelectedPlotlines(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles size={24} />
            <h2 className="text-2xl font-bold">Generate Chapters from Timeline</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {results.length > 0 ? (
            // Results view
            <div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">
                Generated {results.length} Chapter{results.length > 1 ? 's' : ''}
              </h3>
              <div className="space-y-4 mb-6">
                {results.map((result, index) => (
                  <div key={index} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <h4 className="font-bold text-gray-800 mb-2">{result.chapterData.title}</h4>
                    <p className="text-sm text-gray-600 mb-2">{result.chapterData.summary}</p>
                    <p className="text-xs text-indigo-600 mb-1">{result.sceneCount} scenes combined</p>
                    <p className="text-xs text-purple-600">
                      {(result.chapterData.content || '').split(/\s+/).filter(w => w).length} words
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleAcceptAll}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold"
                >
                  {appendMode ? 'Append to Chapter' : 'Accept All & Add to Chapters'}
                </button>
                <button
                  onClick={() => setResults([])}
                  className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors font-semibold"
                >
                  Discard
                </button>
              </div>
            </div>
          ) : (
            // Selection view
            <>
              {/* Timeline Selection */}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-800 mb-3">Select Timeline Events</h3>
                {availableChapterGroups.length === 0 ? (
                  <p className="text-gray-500 italic">
                    No available chapter groups. All timeline scenes already have chapters or create timeline events first.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    {availableChapterGroups.map(([chapterHint, scenes]) => (
                      <label
                        key={chapterHint}
                        className="flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => toggleTimeline(chapterHint)}
                          className="mt-1"
                        >
                          {selectedTimelines.includes(chapterHint) ? (
                            <CheckSquare className="text-purple-600" size={20} />
                          ) : (
                            <Square className="text-gray-400" size={20} />
                          )}
                        </button>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-800">{chapterHint}</div>
                          <div className="text-sm text-purple-600 font-semibold">{scenes.length} scene{scenes.length > 1 ? 's' : ''}</div>
                          <div className="text-sm text-gray-500 mt-1">
                            {scenes.map(s => s.event).join(' → ')}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Plotline Selection */}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-800 mb-3">Include Plotlines (Optional)</h3>
                {data.plotlines && data.plotlines.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    {data.plotlines.map((plotline) => (
                      <label
                        key={plotline.id}
                        className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() => togglePlotline(plotline.id.toString())}
                          className="mt-1"
                        >
                          {selectedPlotlines.includes(plotline.id.toString()) ? (
                            <CheckSquare className="text-indigo-600" size={18} />
                          ) : (
                            <Square className="text-gray-400" size={18} />
                          )}
                        </button>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-800 text-sm">{plotline.title}</div>
                          <div className="text-xs text-gray-500">{plotline.type}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 italic text-sm">No plotlines available</p>
                )}
              </div>

              {/* Append Mode Selection */}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-800 mb-3">Generation Mode</h3>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-indigo-300 transition-colors">
                    <input
                      type="radio"
                      checked={!appendMode}
                      onChange={() => {
                        setAppendMode(false);
                        setSelectedChapterToAppend('');
                      }}
                      className="w-5 h-5 text-indigo-600"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Plus size={18} className="text-indigo-600" />
                        <span className="font-semibold text-gray-800">Create New Chapters</span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">Generate brand new chapters from timeline events</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-teal-300 transition-colors">
                    <input
                      type="radio"
                      checked={appendMode}
                      onChange={() => setAppendMode(true)}
                      className="w-5 h-5 text-teal-600"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <FilePlus size={18} className="text-teal-600" />
                        <span className="font-semibold text-gray-800">Append to Existing Chapter</span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">Add new content to an existing chapter</p>
                    </div>
                  </label>

                  {appendMode && (
                    <div className="ml-8 mt-3">
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Select Chapter:</label>
                      <select
                        value={selectedChapterToAppend}
                        onChange={(e) => setSelectedChapterToAppend(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-400 outline-none"
                      >
                        <option value="">Choose a chapter...</option>
                        {data.chapters.sort((a, b) => parseInt(a.number) - parseInt(b.number)).map((chapter) => (
                          <option key={chapter.id} value={chapter.id}>
                            Chapter {chapter.number}: {chapter.title} ({chapter.wordCount || 0} words)
                          </option>
                        ))}
                      </select>
                      {appendMode && selectedTimelines.length > 1 && (
                        <p className="text-xs text-amber-600 mt-2">
                          ⚠️ In append mode, only the first selected timeline will be used
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {results.length === 0 && (
          <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {selectedTimelines.length} timeline event{selectedTimelines.length !== 1 ? 's' : ''} selected
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={
                  selectedTimelines.length === 0 ||
                  generatingChapters.length > 0 ||
                  (appendMode && !selectedChapterToAppend)
                }
                className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                <Sparkles size={20} className={generatingChapters.length > 0 ? 'animate-spin' : ''} />
                {generatingChapters.length > 0
                  ? `Generating ${generatingChapters.length} Chapter${generatingChapters.length > 1 ? 's' : ''}...`
                  : appendMode
                    ? `Append to Chapter`
                    : `Generate ${selectedTimelines.length} Chapter${selectedTimelines.length > 1 ? 's' : ''}`
                }
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChapterGeneratorModal;
