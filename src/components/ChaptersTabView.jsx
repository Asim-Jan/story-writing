import React, { useState, useRef } from 'react';
import { FileText, Plus, Edit3, Trash2, Sparkles, Grid3x3, List, Image, Check, X, Upload, Search, History } from 'lucide-react';
import AIHelper from './AIHelper';
import AISuggestionBox from './AISuggestionBox';
import BatchAISuggestionBox from './BatchAISuggestionBox';
import ImproveButton from './ImproveButton';
import ChapterGeneratorModal from './ChapterGeneratorModal';
import ImagePreviewModal from './ImagePreviewModal';
import RichTextEditor from './RichTextEditor';
import VersionHistory from './VersionHistory';

const ChaptersTabView = ({
  data,
  setData,
  chapterForm,
  setChapterForm,
  addChapter,
  editChapter,
  deleteItem,
  editingId,
  generateWithAI,
  aiSuggestion,
  acceptAISuggestion,
  rejectAISuggestion,
  regenerateAISuggestion,
  generatingAI,
  showAIHelper,
  setShowAIHelper,
  aiPrompt,
  setAiPrompt,
  setAiContext,
  onUpgrade}) => {
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const [showGeneratorModal, setShowGeneratorModal] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(null);
  const [pendingImage, setPendingImage] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const fileInputRef = useRef(null);

  const sortedChapters = [...data.chapters].sort((a, b) => {
    const numA = parseInt(a.number) || 0;
    const numB = parseInt(b.number) || 0;
    return numA - numB;
  });

  // Filter chapters based on search query
  const filteredChapters = sortedChapters.filter(chap => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    return (
      chap.title?.toLowerCase().includes(query) ||
      chap.number?.toString().includes(query) ||
      chap.summary?.toLowerCase().includes(query) ||
      chap.content?.toLowerCase().includes(query)
    );
  });

  const resetForm = () => {
    setChapterForm({ number: '', title: '', summary: '', content: '' });
    setSelectedChapter(null);
  };

  const handleEdit = (chap) => {
    editChapter(chap);
    setSelectedChapter(null);
  };

  const handleAddNew = () => {
    setSelectedChapter(null);
    resetForm();
  };

  const handleGenerateImage = async (chapter) => {
    setGeneratingImage(chapter.id);
    try {
      // Build context-aware prompt based on chapter details
      const prompt = `Create a cover image for Chapter ${chapter.number}: ${chapter.title}. ${chapter.summary || ''}`;

      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          context: {
            bookTitle: data.bookTitle,
            overview: data.overview,
            characters: data.characters,
            locations: data.locations,
            plotlines: data.plotlines,
            chapter: {
              number: chapter.number,
              title: chapter.title,
              summary: chapter.summary,
              content: chapter.content ? chapter.content.substring(0, 500) : '' // First 500 chars for context
            }
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 403 && onUpgrade) {
          // tier-gated: open the upgrade modal instead of a dead-end alert
          onUpgrade({ featureName: 'Chapter cover images', requiredTier: 'Basic', requiredFeature: 'media_generation' });
          setGeneratingImage(null);
          return;
        }
        throw new Error(errorData.error || 'Failed to generate image');
      }

      const { imageUrl, filename } = await response.json();

      // Show pending image for approval
      setPendingImage({
        chapterId: chapter.id,
        imageUrl,
        filename,
        description: `Chapter ${chapter.number}: ${chapter.title}`
      });
    } catch (error) {
      console.error('Error generating image:', error);
      alert(`Failed to generate image: ${error.message}`);
    } finally {
      setGeneratingImage(null);
    }
  };

  const handleAcceptImage = () => {
    if (!pendingImage) return;

    // Add to visuals library
    const newVisual = {
      id: Date.now(),
      description: pendingImage.description,
      url: pendingImage.imageUrl,
      filename: pendingImage.filename,
      createdAt: new Date().toISOString(),
      chapterId: pendingImage.chapterId
    };

    // Update chapter with cover image
    setData(prev => ({
      ...prev,
      chapters: prev.chapters.map(ch =>
        ch.id === pendingImage.chapterId
          ? { ...ch, coverImage: pendingImage.imageUrl, coverImageFilename: pendingImage.filename }
          : ch
      ),
      visuals: [...(prev.visuals || []), newVisual]
    }));

    setPendingImage(null);
  };

  const handleRejectImage = () => {
    setPendingImage(null);
  };

  const handleVersionRestore = (restoredChapter) => {
    // Update the chapter in the data
    setData(prev => ({
      ...prev,
      chapters: prev.chapters.map(ch =>
        ch.id === restoredChapter.id ? {
          ...ch,
          content: restoredChapter.content,
          wordCount: restoredChapter.wordCount,
          updatedAt: restoredChapter.updatedAt || new Date().toISOString()
        } : ch
      )
    }));

    // Update selected chapter if it's the one being restored
    if (selectedChapter?.id === restoredChapter.id) {
      setSelectedChapter(prev => ({
        ...prev,
        content: restoredChapter.content,
        wordCount: restoredChapter.wordCount,
        updatedAt: restoredChapter.updatedAt || new Date().toISOString()
      }));
    }
  };

  const handleUploadImage = async (event, chapter) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    if (fileInputRef.current) fileInputRef.current.value = '';

    setGeneratingImage(chapter.id);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bucketType', 'images');
      const token = localStorage.getItem('token');
      const response = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      const { url, filename } = await response.json();
      setPendingImage({ chapterId: chapter.id, imageUrl: url, filename, description: `Chapter ${chapter.number}: ${chapter.title}`, isUpload: true });
    } catch (error) {
      alert(`Failed to upload image: ${error.message}`);
    } finally {
      setGeneratingImage(null);
    }
  };

  const showingDetail = selectedChapter !== null || editingId;

  return (
    <div className="flex h-full relative">
      {/* Left sidebar - Chapters list */}
      <div className={`${viewMode === 'grid' ? 'w-full' : 'w-full lg:w-96'} ${showingDetail ? 'hidden lg:flex' : 'flex'} bg-white border-r border-gray-200 flex-col`}>
        <div className="p-4 border-b border-gray-200">
          <div className="flex flex-col gap-2 mb-3">
            <div className="flex gap-2">
              <button
                onClick={handleAddNew}
                className="flex-1 px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 font-semibold"
              >
                <Plus size={20} />
                New Chapter
              </button>
              <button
                onClick={() => setShowGeneratorModal(true)}
                className="flex-1 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 font-semibold"
                title="Generate from Timeline"
              >
                <Sparkles size={20} />
                From Timeline
              </button>
            </div>
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
              className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
              title={viewMode === 'list' ? 'Switch to Grid View' : 'Switch to List View'}
            >
              {viewMode === 'list' ? <><Grid3x3 size={18} /> Grid View</> : <><List size={18} /> List View</>}
            </button>
          </div>
          {/* Search Input */}
          {data.chapters.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search chapters..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {data.chapters.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-2 text-gray-400" />
              <p>No chapters yet</p>
            </div>
          ) : filteredChapters.length === 0 ? (
            <div className="p-6 text-center">
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No chapters found</p>
              <p className="text-gray-400 text-xs mt-1">Try a different search term</p>
            </div>
          ) : viewMode === 'list' ? (
            <>
              {filteredChapters.map((chap) => (
            <button
              key={chap.id}
              onClick={() => setSelectedChapter(chap)}
              className={`w-full p-4 text-left border-b border-gray-200 hover:bg-gray-50 transition-colors ${
                selectedChapter?.id === chap.id ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <FileText className="text-indigo-600 mt-1 flex-shrink-0" size={20} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {chap.number && (
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded text-xs font-semibold">
                        Ch. {chap.number}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-gray-800 truncate">{chap.title}</h3>
                  {chap.wordCount > 0 && (
                    <p className="text-xs text-gray-500 mt-1">{chap.wordCount} words</p>
                  )}
                </div>
              </div>
            </button>
              ))}
            </>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredChapters.map((chap) => (
                <div key={chap.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {chap.number && (
                          <span className="px-2 py-0.5 bg-indigo-600 text-white rounded text-xs font-semibold">
                            Ch. {chap.number}
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-gray-900">{chap.title}</h3>
                      {chap.wordCount > 0 && (
                        <p className="text-xs text-indigo-600 mt-1">{chap.wordCount} words</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          handleEdit(chap);
                          setViewMode('list');
                        }}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => deleteItem('chapters', chap.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {chap.summary && (
                    <p className="text-xs text-gray-500 mt-2 line-clamp-3">{chap.summary}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel - Details or form */}
      {viewMode === 'list' && (
        <div className={`${showingDetail ? 'fixed inset-0 lg:relative lg:flex-1 z-50 bg-white' : 'hidden lg:block lg:flex-1'} overflow-y-auto p-4 sm:p-6`}>
          {selectedChapter ? (
            // Detailed view
          <div className="max-w-4xl">
            <div className="flex items-start justify-between mb-4 sm:mb-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
                  {/* Mobile back button */}
                  <button
                    onClick={() => setSelectedChapter(null)}
                    className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title="Back to chapters"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  {selectedChapter.number && (
                    <span className="px-2 sm:px-3 py-1 bg-indigo-600 text-white rounded-full text-xs sm:text-sm font-bold">
                      Chapter {selectedChapter.number}
                    </span>
                  )}
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800 truncate">{selectedChapter.title}</h2>
                </div>
                {selectedChapter.wordCount > 0 && (
                  <p className="text-indigo-600 font-semibold text-sm sm:text-base">{selectedChapter.wordCount.toLocaleString()} words</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <button
                  onClick={() => handleGenerateImage(selectedChapter)}
                  disabled={generatingImage === selectedChapter.id}
                  className="px-3 sm:px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-1 sm:gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                >
                  <Image size={16} className={`${generatingImage === selectedChapter.id ? 'animate-spin' : ''} flex-shrink-0`} />
                  <span className="hidden sm:inline">{generatingImage === selectedChapter.id ? 'Generating...' : 'Generate'}</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 sm:px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-1 sm:gap-2 text-sm sm:text-base"
                >
                  <Upload size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Upload</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleUploadImage(e, selectedChapter)}
                  className="hidden"
                />
                <button
                  onClick={() => setShowVersionHistory(true)}
                  className="px-3 sm:px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-1 sm:gap-2 text-sm sm:text-base"
                  title="Version History"
                >
                  <History size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">History</span>
                </button>
                <button
                  onClick={() => handleEdit(selectedChapter)}
                  className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1 sm:gap-2 text-sm sm:text-base"
                >
                  <Edit3 size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  onClick={() => {
                    deleteItem('chapters', selectedChapter.id);
                    setSelectedChapter(null);
                  }}
                  className="px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-1 sm:gap-2 text-sm sm:text-base"
                >
                  <Trash2 size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </div>
            </div>

            {/* Chapter Cover Image */}
            {selectedChapter.coverImage && (
              <div className="mb-6">
                <img
                  src={selectedChapter.coverImage}
                  alt={`Chapter ${selectedChapter.number} Cover`}
                  className="w-full max-h-96 object-cover rounded-lg shadow-md cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setSelectedImage({ imageUrl: selectedChapter.coverImage, description: `Chapter ${selectedChapter.number}: ${selectedChapter.title}` })}
                />
              </div>
            )}

            <div className="space-y-6">
              {selectedChapter.summary && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-700">Summary</h3>
                    <ImproveButton
                      content={selectedChapter.summary}
                      contentType="chapter summary"
                      context={data}
                    />
                  </div>
                  <p className="text-gray-800 leading-relaxed">{selectedChapter.summary}</p>
                </div>
              )}

              {selectedChapter.content && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-700">Content</h3>
                    <ImproveButton
                      content={selectedChapter.content}
                      contentType="chapter content"
                      context={data}
                    />
                  </div>
                  <div className="prose prose-lg max-w-none">
                    <div className="font-serif text-lg leading-relaxed text-gray-800 whitespace-pre-wrap bg-gray-50 p-6 rounded-lg border border-gray-200">
                      {selectedChapter.content}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          // Form view
          <div className="max-w-4xl">
            <div className="flex justify-between items-center mb-4 sm:mb-6 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {/* Mobile back button */}
                <button
                  onClick={resetForm}
                  className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                  title="Back to chapters"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-800 truncate">
                  {editingId ? 'Edit Chapter' : 'Add New Chapter'}
                </h2>
              </div>
              <button
                onClick={() => {
                  setShowAIHelper(!showAIHelper);
                  setAiContext('chapter');
                }}
                className="px-3 sm:px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-1 sm:gap-2 text-sm sm:text-base flex-shrink-0"
              >
                <Sparkles size={16} className="sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">AI Assistant</span>
              </button>
            </div>

            <AIHelper
              show={showAIHelper}
              type="chapter"
              prompt={aiPrompt}
              setPrompt={setAiPrompt}
              onGenerate={() => generateWithAI('chapter')}
              onCancel={() => {
                setShowAIHelper(false);
                setAiPrompt('');
              }}
              generating={generatingAI}
              title="AI Chapter Generator"
              placeholder="E.g., 'The protagonist discovers a hidden room in the library that contains evidence of a conspiracy'"
            />

            {aiSuggestion && aiSuggestion.type === 'chapter' && (
              <AISuggestionBox
                suggestion={aiSuggestion.data}
                onAccept={acceptAISuggestion}
                onReject={rejectAISuggestion}
                onRegenerate={regenerateAISuggestion}
                loading={generatingAI}
                title="AI Generated Chapter"
              />
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Chapter Number"
                  value={chapterForm.number}
                  onChange={(e) => setChapterForm(prev => ({ ...prev, number: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Chapter Title *"
                  value={chapterForm.title}
                  onChange={(e) => setChapterForm(prev => ({ ...prev, title: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none"
                />
              </div>

              <textarea
                placeholder="Summary"
                value={chapterForm.summary}
                onChange={(e) => setChapterForm(prev => ({ ...prev, summary: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-indigo-400 outline-none"
              />

              <RichTextEditor
                value={chapterForm.content}
                onChange={(value) => setChapterForm(prev => ({ ...prev, content: value }))}
                placeholder="Write your chapter content here..."
                autoFocus={false}
              />

              <div className="flex gap-2 pt-4">
                <button
                  onClick={addChapter}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                  <Plus size={20} />
                  {editingId ? 'Update Chapter' : 'Add Chapter'}
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

      {/* Chapter Generator Modal */}
      {showGeneratorModal && (
        <ChapterGeneratorModal
          data={data}
          setData={setData}
          onGenerate={generateWithAI}
          onClose={() => setShowGeneratorModal(false)}
          generatingAI={generatingAI}
        />
      )}

      {/* Pending Image Approval Modal */}
      {pendingImage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleRejectImage}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-gray-800 mb-4">Approve Chapter Cover Image</h3>
            <img
              src={pendingImage.imageUrl}
              alt={pendingImage.description}
              className="w-full max-h-96 object-contain rounded-lg mb-4"
            />
            <p className="text-gray-600 mb-4">Do you want to use this as the cover for {pendingImage.description}?</p>
            <p className="text-sm text-gray-500 mb-4">This image will be added to your Visuals library and assigned to the chapter.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleRejectImage}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
              >
                <X size={18} />
                Reject
              </button>
              <button
                onClick={handleAcceptImage}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
              >
                <Check size={18} />
                Accept & Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      <ImagePreviewModal
        imageUrl={selectedImage?.imageUrl}
        description={selectedImage?.description}
        onClose={() => setSelectedImage(null)}
      />

      {/* Version History Modal */}
      {showVersionHistory && selectedChapter && (
        <VersionHistory
          bookId={data.id}
          chapterId={selectedChapter.id}
          onRestore={handleVersionRestore}
          onClose={() => setShowVersionHistory(false)}
        />
      )}
    </div>
  );
};

export default ChaptersTabView;
