import React, { useState, useEffect } from 'react';
import { Book, Image as ImageIcon, Plus, Trash2, Wand2, Loader, Save, Eye, Download, Grid, Layout, Film, FileText } from 'lucide-react';
import ComicExportModal from './ComicExportModal';
import { characterFields } from './CharacterReferences';
import { COMIC_REFERENCE_LABEL } from '../hooks/useMediaJobs';
import { useMediaJobsContext, MediaJobList } from '../contexts/MediaJobsContext';
import { ComicRenderer } from '../utils/comicRenderer';
import { CBZExporter } from '../utils/cbzExporter';
import { ComicPDFExporter } from '../utils/comicPdfExporter';

const ComicTab = ({ chapters, characters, locations, data, setData, saveBook }) => {
  const [comicPages, setComicPages] = useState(data?.comicPages || []);
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [selectedTranscript, setSelectedTranscript] = useState('');
  const [characterRefs, setCharacterRefs] = useState(data?.characterRefs || {});
  const [startingRef, setStartingRef] = useState(null); // character id while the job is being created
  const { jobsFor, startJob } = useMediaJobsContext();
  const comicRefJobs = (characterId) => jobsFor('character', characterId)
    .filter(j => j.type === 'reference' && String(j.label || '').startsWith(COMIC_REFERENCE_LABEL));
  const [generatingPanel, setGeneratingPanel] = useState(null);
  const [parsingTranscript, setParsingTranscript] = useState(false);
  const [currentPage, setCurrentPage] = useState(null);
  const [viewMode, setViewMode] = useState('edit'); // 'edit' or 'preview'
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);

  // Sync from book data
  useEffect(() => {
    if (data?.comicPages) {
      setComicPages(data.comicPages);
    }
    if (data?.characterRefs) {
      setCharacterRefs(data.characterRefs);
    }
  }, [data?.comicPages, data?.characterRefs]);

  // Helper to get character reference image (use existing profile image or generated ref)
  const getCharacterRefImage = (characterId) => {
    // First check if we have a comic-specific reference
    if (characterRefs[characterId]) {
      return characterRefs[characterId];
    }

    // Otherwise use the character's profile image if it exists
    const character = characters.find(c => c.id === characterId);
    return character?.imageUrl || null;
  };

  // A comic reference is a book media job (a turnaround sheet takes minutes).
  // The book-level jobs hook applies it when done, even if this tab is closed:
  // the sheet joins the character's references and, because of its label,
  // becomes the comic reference (characterRefs); the autosave writes it.
  const generateCharacterReference = async (character) => {
    setStartingRef(character.id);
    try {
      await startJob('reference', { type: 'character', id: character.id }, {
        kind: 'turnaround',
        character: characterFields(character),
        style: 'professional comic book art style'
      }, `${COMIC_REFERENCE_LABEL}${character.name || 'character'}`);
    } catch (error) {
      alert('Failed to generate character reference: ' + error.message);
    } finally {
      setStartingRef(null);
    }
  };

  const createNewPage = () => {
    const newPage = {
      id: Date.now(),
      pageNumber: comicPages.length + 1,
      panels: [],
      createdAt: new Date().toISOString()
    };
    setComicPages([...comicPages, newPage]);
    setCurrentPage(newPage);
  };

  const importFromTranscript = async () => {
    if (!selectedTranscript) {
      alert('Please select a transcript');
      return;
    }

    const transcript = (data.transcripts || []).find(t => t.id.toString() === selectedTranscript);
    if (!transcript) {
      alert('Transcript not found');
      return;
    }

    setParsingTranscript(true);

    try {
      const response = await fetch('/api/parse-transcript-to-comic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcript.transcript,
          chapterTitle: transcript.chapterTitle
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to parse transcript');
      }

      // Convert parsed panels to comic format
      const newPanels = result.panels.map((panel, idx) => {
        // Match character names to character IDs
        const matchedCharacterIds = (panel.characterNames || []).map(name => {
          const char = characters.find(c =>
            c.name.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().includes(c.name.toLowerCase())
          );
          return char?.id;
        }).filter(id => id !== undefined);

        // Match location name to location ID
        let locationId = null;
        if (panel.location) {
          const loc = locations.find(l =>
            l.name.toLowerCase().includes(panel.location.toLowerCase()) ||
            panel.location.toLowerCase().includes(l.name.toLowerCase())
          );
          locationId = loc?.id || null;
        }

        return {
          id: Date.now() + idx,
          sceneDescription: panel.sceneDescription,
          dialogue: panel.dialogue,
          characters: matchedCharacterIds,
          location: locationId,
          imageUrl: null,
          layout: panel.panelType === 'wide' ? 'full' : 'half'
        };
      });

      // Create pages with 6 panels each
      const panelsPerPage = 6;
      const newPages = [];
      for (let i = 0; i < newPanels.length; i += panelsPerPage) {
        const pagePanels = newPanels.slice(i, i + panelsPerPage);
        newPages.push({
          id: Date.now() + 10000 + i,
          pageNumber: comicPages.length + newPages.length + 1,
          panels: pagePanels,
          source: 'transcript',
          transcriptId: transcript.id,
          createdAt: new Date().toISOString()
        });
      }

      setComicPages([...comicPages, ...newPages]);

      alert(`Created ${newPages.length} comic pages from transcript with ${newPanels.length} panels!`);
      setSelectedTranscript('');
    } catch (error) {
      console.error('Error importing transcript:', error);
      alert('Failed to import transcript: ' + error.message);
    } finally {
      setParsingTranscript(false);
    }
  };

  const addPanel = (pageId) => {
    const newPanel = {
      id: Date.now(),
      sceneDescription: '',
      dialogue: '',
      characters: [],
      location: null,
      imageUrl: null,
      layout: 'full' // full, half, third
    };

    setComicPages(pages =>
      pages.map(page =>
        page.id === pageId
          ? { ...page, panels: [...page.panels, newPanel] }
          : page
      )
    );
  };

  const updatePanel = (pageId, panelId, updates) => {
    setComicPages(pages =>
      pages.map(page =>
        page.id === pageId
          ? {
              ...page,
              panels: page.panels.map(panel =>
                panel.id === panelId ? { ...panel, ...updates } : panel
              )
            }
          : page
      )
    );
  };

  const generatePanelImage = async (pageId, panel) => {
    setGeneratingPanel(panel.id);
    try {
      // Get full character details for selected characters
      const panelCharacters = characters.filter(c =>
        panel.characters.includes(c.id)
      );

      const panelLocation = locations.find(l => l.id === panel.location);

      const response = await fetch('/api/generate-comic-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: data?.id,
          sceneDescription: panel.sceneDescription,
          characters: panelCharacters,
          location: panelLocation,
          style: 'dynamic comic book panel, professional manga style'
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to generate panel');
      }

      updatePanel(pageId, panel.id, { imageUrl: result.imageUrl });
      return true;
    } catch (error) {
      console.error('Error generating panel:', error);
      alert('Failed to generate panel: ' + error.message);
      return false;
    } finally {
      setGeneratingPanel(null);
    }
  };

  const generateAllPanelsForPage = async (page) => {
    const panelsToGenerate = page.panels.filter(p => !p.imageUrl && p.sceneDescription);

    if (panelsToGenerate.length === 0) {
      alert('All panels already have images or are missing scene descriptions!');
      return;
    }

    if (!confirm(`Generate images for ${panelsToGenerate.length} panels? This may take a few minutes.`)) {
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < panelsToGenerate.length; i++) {
      const panel = panelsToGenerate[i];
      console.log(`Generating panel ${i + 1}/${panelsToGenerate.length}...`);

      const success = await generatePanelImage(page.id, panel);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }

      // Small delay to avoid rate limiting
      if (i < panelsToGenerate.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    alert(`Generation complete!\n✓ ${successCount} panels generated\n${failCount > 0 ? `✗ ${failCount} failed` : ''}`);
  };

  const saveComicPages = async () => {
    if (setData && saveBook) {
      setData(prev => ({ ...prev, comicPages, characterRefs }));
      // The save must carry THIS tick's state: `data` in the hook still holds
      // the previous render's closure, so without the override the save sends
      // the stale comic state (the old silent-data-loss path).
      await saveBook({ comicPages, characterRefs });
      alert('Comic pages saved!');
    }
  };

  const deletePanel = (pageId, panelId) => {
    if (!confirm('Delete this panel?')) return;
    setComicPages(pages =>
      pages.map(page =>
        page.id === pageId
          ? { ...page, panels: page.panels.filter(p => p.id !== panelId) }
          : page
      )
    );
  };

  const deletePage = (pageId) => {
    if (!confirm('Delete this entire page?')) return;
    setComicPages(pages => pages.filter(p => p.id !== pageId));
    if (currentPage?.id === pageId) {
      setCurrentPage(null);
    }
  };

  const handleExportAll = async (exportOptions) => {
    setExportingAll(true);

    try {
      const { format, layout, dpi } = exportOptions;

      // Create renderer with selected quality
      const renderer = new ComicRenderer({
        dpi,
        pageWidth: 6.625,
        pageHeight: 10.25,
      });

      // Render all pages
      const renderedPages = [];
      for (const page of comicPages) {
        const canvas = await renderer.renderPage(page, layout);
        renderedPages.push(canvas);
      }

      // Export based on format
      if (format === 'cbz') {
        const exporter = new CBZExporter();
        await exporter.exportCBZ(renderedPages, {
          title: data.bookTitle || 'Untitled Comic',
          series: data.bookTitle,
          summary: data.overview || '',
          writer: data.metadata?.author || 'Unknown',
          genre: data.genre || 'Fiction',
        }, data.bookTitle || 'comic');
      } else if (format === 'pdf') {
        const exporter = new ComicPDFExporter({ dpi });
        await exporter.exportPDF(renderedPages, {
          title: data.bookTitle || 'Untitled Comic',
          writer: data.metadata?.author || 'Unknown',
          summary: data.overview || '',
          genre: data.genre || 'Fiction',
        }, data.bookTitle || 'comic');
      } else if (format === 'images') {
        const exporter = new CBZExporter();
        await exporter.exportImages(renderedPages, data.bookTitle || 'comic', true);
      }

      setShowExportModal(false);
      alert(`Successfully exported ${renderedPages.length} pages as ${format.toUpperCase()}!`);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export comic: ' + error.message);
    } finally {
      setExportingAll(false);
    }
  };

  const exportSinglePage = async (page) => {
    try {
      // Use default settings for single page export
      const renderer = new ComicRenderer({ dpi: 300 });
      const canvas = await renderer.renderPage(page, 'grid-2x3');

      // Export as PNG
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comic-page-${page.pageNumber}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export page: ' + error.message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Layout className="w-8 h-8 text-purple-600" />
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Comic Mode</h2>
              <p className="text-gray-600">Transform your story into visual comic book pages</p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowExportModal(true)}
              disabled={comicPages.length === 0 || exportingAll}
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 font-semibold"
            >
              {exportingAll ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export All
                </>
              )}
            </button>
            <button
              onClick={createNewPage}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Page
            </button>
            <button
              onClick={saveComicPages}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              Save All
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 text-center">
          <div className="p-3 bg-purple-50 rounded-lg">
            <div className="text-2xl font-bold text-purple-700">{comicPages.length}</div>
            <div className="text-xs text-purple-600">Pages</div>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {comicPages.reduce((sum, p) => sum + p.panels.length, 0)}
            </div>
            <div className="text-xs text-blue-600">Panels</div>
          </div>
          <div className="p-3 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {characters.filter(c => getCharacterRefImage(c.id)).length}
            </div>
            <div className="text-xs text-green-600">Chars with Images</div>
          </div>
          <div className="p-3 bg-amber-50 rounded-lg">
            <div className="text-2xl font-bold text-amber-700">{characters.length}</div>
            <div className="text-xs text-amber-600">Total Characters</div>
          </div>
        </div>
      </div>

      {/* Import from Transcript */}
      {data.transcripts && data.transcripts.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border-2 border-indigo-200 p-6 mb-6">
          <div className="flex items-start gap-4">
            <Film className="w-8 h-8 text-indigo-600 flex-shrink-0 mt-1" />
            <div className="flex-1">
              <h3 className="text-lg font-bold text-gray-800 mb-2">Import from Transcript</h3>
              <p className="text-sm text-gray-600 mb-4">
                Automatically convert a screenplay transcript into comic book panels with scene descriptions and dialogue
              </p>

              <div className="flex gap-3">
                <select
                  value={selectedTranscript}
                  onChange={(e) => setSelectedTranscript(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">Select a transcript...</option>
                  {data.transcripts.map(transcript => (
                    <option key={transcript.id} value={transcript.id}>
                      {transcript.title} - {transcript.sceneCount} scenes
                    </option>
                  ))}
                </select>

                <button
                  onClick={importFromTranscript}
                  disabled={!selectedTranscript || parsingTranscript}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-semibold"
                >
                  {parsingTranscript ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin" />
                      Parsing...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-5 h-5" />
                      Import & Create Pages
                    </>
                  )}
                </button>
              </div>

              <p className="text-xs text-indigo-600 mt-2">
                AI will analyze the transcript and automatically create comic panels with descriptions and dialogue
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Character References Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <ImageIcon className="w-5 h-5" />
          Character Reference Images
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Character images from the Characters tab are automatically used. Generate comic-specific references for even better consistency.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {characters.map(character => {
            const refImage = getCharacterRefImage(character.id);
            const hasProfileImage = character.imageUrl;
            const hasComicRef = characterRefs[character.id];
            const refJobs = comicRefJobs(character.id);
            const isGenerating = startingRef === character.id || refJobs.some(j => j.status === 'running');

            return (
              <div key={character.id} className="border-2 border-gray-200 rounded-lg p-3">
                <div className="aspect-square bg-gray-100 rounded-lg mb-2 overflow-hidden relative">
                  {refImage ? (
                    <>
                      <img
                        src={refImage}
                        alt={character.name}
                        className="w-full h-full object-cover"
                      />
                      {hasProfileImage && !hasComicRef && (
                        <div className="absolute top-1 right-1 bg-blue-500 text-white text-xs px-2 py-0.5 rounded">
                          From Profile
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <ImageIcon className="w-12 h-12" />
                    </div>
                  )}
                </div>
                <h4 className="font-semibold text-sm text-gray-800 mb-1">{character.name}</h4>
                <p className="text-xs text-gray-600 mb-2">{character.role}</p>
                {hasProfileImage && !hasComicRef && (
                  <p className="text-xs text-green-600 mb-2 flex items-center gap-1">
                    ✓ Using profile image
                  </p>
                )}
                <MediaJobList jobs={refJobs} compact className="mb-2 text-xs" />
                <button
                  onClick={() => generateCharacterReference(character)}
                  disabled={isGenerating}
                  data-testid="comic-ref-generate"
                  className="w-full px-3 py-2 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                >
                  {isGenerating ? (
                    <>
                      <Loader className="w-3 h-3 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-3 h-3" />
                      {hasComicRef ? 'Regenerate Ref' : hasProfileImage ? 'Generate Comic Ref' : 'Generate'}
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Comic Pages */}
      <div className="space-y-6">
        {comicPages.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <Layout className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-700 mb-2">No Comic Pages Yet</h3>
            <p className="text-gray-500 mb-4">Create your first comic page to get started</p>
            <button
              onClick={createNewPage}
              className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 inline-flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create First Page
            </button>
          </div>
        ) : (
          comicPages.map(page => (
            <div key={page.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">
                    Page {page.pageNumber}
                  </h3>
                  {page.source === 'transcript' && (
                    <p className="text-xs text-indigo-600 flex items-center gap-1 mt-1">
                      <Film className="w-3 h-3" />
                      Imported from transcript
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => addPanel(page.id)}
                    className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add Panel
                  </button>
                  <button
                    onClick={() => generateAllPanelsForPage(page)}
                    disabled={generatingPanel !== null || page.panels.filter(p => !p.imageUrl && p.sceneDescription).length === 0}
                    className="px-3 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <Wand2 className="w-4 h-4" />
                    Generate All
                  </button>
                  <button
                    onClick={() => exportSinglePage(page)}
                    disabled={page.panels.filter(p => p.imageUrl).length === 0}
                    className="px-3 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <Download className="w-4 h-4" />
                    Export PNG
                  </button>
                  <button
                    onClick={() => deletePage(page.id)}
                    className="px-3 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 flex items-center gap-1"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>

              {/* Panels - Staggered Comic Layout */}
              <div className="space-y-6">
                {page.panels.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <p className="text-gray-500">No panels yet. Add a panel to start creating!</p>
                  </div>
                ) : (
                  page.panels.map((panel, index) => {
                    // Stagger panels: left, right, left, right...
                    const isLeft = index % 2 === 0;
                    const maxWidth = 'max-w-2xl'; // Narrower constraint for comic feel

                    return (
                    <div key={panel.id} className={`border-4 border-black rounded-lg overflow-hidden shadow-lg ${maxWidth} ${isLeft ? 'ml-0 mr-auto' : 'ml-auto mr-0'}`}>
                      {/* Panel Image (Full Width at Top) */}
                      <div className="aspect-video bg-gray-100 relative">
                        {panel.imageUrl ? (
                          <>
                            <img
                              src={panel.imageUrl}
                              alt="Comic panel"
                              className="w-full h-full object-cover"
                            />
                            {/* Dialogue Overlay */}
                            {panel.dialogue && (
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                                <div className="bg-white rounded-lg px-3 py-2 text-sm font-medium text-gray-800 shadow-lg">
                                  {panel.dialogue}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                            <ImageIcon className="w-16 h-16 mb-2" />
                            {panel.dialogue && (
                              <div className="absolute bottom-2 left-2 right-2 bg-white rounded px-2 py-1 text-xs text-gray-700 text-center">
                                {panel.dialogue.substring(0, 80)}{panel.dialogue.length > 80 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Panel Editor */}
                      <div className="bg-purple-50 p-4 space-y-3">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">
                            Scene Description
                          </label>
                          <textarea
                            value={panel.sceneDescription}
                            onChange={(e) => updatePanel(page.id, panel.id, { sceneDescription: e.target.value })}
                            placeholder="Describe what's happening in this panel..."
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none"
                            rows="3"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1">
                            Dialogue / Caption
                          </label>
                          <textarea
                            value={panel.dialogue}
                            onChange={(e) => updatePanel(page.id, panel.id, { dialogue: e.target.value })}
                            placeholder="Character dialogue or narration..."
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none"
                            rows="2"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">
                              Characters
                            </label>
                            <select
                              multiple
                              value={panel.characters}
                              onChange={(e) => updatePanel(page.id, panel.id, {
                                characters: Array.from(e.target.selectedOptions, option => parseInt(option.value))
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                              size="3"
                            >
                              {characters.map(char => (
                                <option key={char.id} value={char.id}>
                                  {char.name}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple</p>
                          </div>

                          <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">
                              Location
                            </label>
                            <select
                              value={panel.location || ''}
                              onChange={(e) => updatePanel(page.id, panel.id, {
                                location: e.target.value ? parseInt(e.target.value) : null
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                            >
                              <option value="">None</option>
                              {locations.map(loc => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => generatePanelImage(page.id, panel)}
                            disabled={generatingPanel === panel.id || !panel.sceneDescription}
                            className="flex-1 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            {generatingPanel === panel.id ? (
                              <>
                                <Loader className="w-4 h-4 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Wand2 className="w-4 h-4" />
                                Generate Image
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => deletePanel(page.id, panel.id)}
                            className="px-4 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600 flex items-center justify-center gap-1"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Info Box */}
      <div className="mt-6 bg-purple-50 border border-purple-200 rounded-lg p-4">
        <h4 className="font-semibold text-purple-900 mb-2">About Comic Mode</h4>
        <ul className="text-sm text-purple-800 space-y-1">
          <li>• <strong>Automatic Reference Use:</strong> Character images from the Characters tab are automatically used as references!</li>
          <li>• <strong>Character Consistency:</strong> Generate comic-specific reference images for better panel consistency</li>
          <li>• <strong>Visual Panels:</strong> Create comic pages with multiple panels and layouts</li>
          <li>• <strong>Context-Aware AI:</strong> Panel images generated using character appearance, location details, and scene descriptions</li>
          <li>• <strong>Professional Export:</strong> Export as CBZ (comic archive), PDF (print-ready), or high-res PNG images</li>
          <li>• <strong>Multiple Layouts:</strong> Choose from grid layouts, cinematic wide panels, or manga-style dynamic layouts</li>
          <li>• <strong>Persistent Storage:</strong> All comic pages saved with your book data</li>
        </ul>
      </div>

      {/* Export Modal */}
      <ComicExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        onExport={handleExportAll}
      />
    </div>
  );
};

export default ComicTab;
