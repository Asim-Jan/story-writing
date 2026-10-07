import React, { useState, useRef, useEffect } from 'react';
import { Plus, Users, Edit3, Trash2, Sparkles, Grid3x3, List, Image, Check, X, Upload, Network, Search, BookOpen } from 'lucide-react';
import AIHelper from './AIHelper';
import AISuggestionBox from './AISuggestionBox';
import BatchAISuggestionBox from './BatchAISuggestionBox';
import ImproveButton from './ImproveButton';
import ImagePreviewModal from './ImagePreviewModal';
import RelationshipGraph from './RelationshipGraph';
import CharacterReferences from './CharacterReferences';
import ItemPictures from './ItemPictures';
import EnhanceFromBookPanel from './EnhanceFromBookPanel';
import EnhanceAllBar from './EnhanceAllBar';
import MissingFromBook from './MissingFromBook';
import DuplicatesNotice from './DuplicatesNotice';
import { bookArtStyle } from '../utils/artStyles';
import { resolveEnhancement, closeEnhancement, enhanceParams, openItems } from '../utils/enhanceFromBook';
import { useMediaJobsContext, MediaJobList } from '../contexts/MediaJobsContext';
import { useIsMobile } from '../hooks/useMediaQuery';

// Characters carry their looks in separate fields (there is no `description`),
// so the portrait prompt is assembled from whichever of them are filled in.
const APPEARANCE_FIELDS = [
  ['gender', ''], ['age', 'age '], ['skinColor', 'skin: '], ['hairColor', 'hair: '],
  ['eyeColor', 'eyes: '], ['height', 'height: '], ['build', 'build: '],
  ['clothing', 'wearing '], ['distinguishingFeatures', ''], ['appearance', ''],
];

const describeAppearance = (character) => APPEARANCE_FIELDS
  .filter(([field]) => String(character[field] ?? '').trim())
  .map(([field, prefix]) => `${prefix}${String(character[field]).trim()}`)
  .join(', ');

const buildPortraitPrompt = (character) => {
  const looks = describeAppearance(character);
  return [
    `Character portrait of ${character.name}${character.role ? `, ${character.role}` : ''}.`,
    looks && `Appearance: ${looks}.`,
    'Consistent, clearly readable face and outfit, neutral background.',
  ].filter(Boolean).join(' ');
};

const CharactersTab = ({
  data,
  setData,
  characterForm,
  setCharacterForm,
  addCharacter,
  editCharacter,
  resetCharacterForm,
  deleteItem,
  editingId,
  setEditingId,
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
  setAiSuggestion,
  aiContext
}) => {
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [showForm, setShowForm] = useState(false); // mobile: the add form lives in the detail pane; without this the New Character click did nothing visible on phones
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grid'
  const [generatingImage, setGeneratingImage] = useState(null); // an upload in flight
  const [pendingImage, setPendingImage] = useState(null); // an uploaded image awaiting approval
  const { jobsFor, startJob } = useMediaJobsContext();
  // Portrait generations are book media jobs: they keep running (and land on
  // the character) while the user looks at another character or tab.
  const portraitJobs = (characterId) => jobsFor('character', characterId).filter(j => j.type === 'image');
  const portraitRunning = (characterId) => portraitJobs(characterId).some(j => j.status === 'running');
  // "Enhance from book": a job reads the saved chapters; its suggestions land
  // on the character (character.enhancement) for the author to use or skip
  const enhanceJobs = (characterId) => jobsFor('character', characterId).filter(j => j.type === 'enhance');
  const enhanceRunning = (characterId) => enhanceJobs(characterId).some(j => j.status === 'running');
  const [enhanceError, setEnhanceError] = useState(null);
  const hasChapterText = (data.chapters || []).some(c => String(c.content || '').trim());
  const [selectedImage, setSelectedImage] = useState(null);
  const [showRelationshipGraph, setShowRelationshipGraph] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef(null);

  // The detail view renders a snapshot of the character; keep it in step with
  // the book so a new portrait or reference shows without re-selecting.
  useEffect(() => {
    if (!selectedCharacter) return;
    const live = data.characters.find(c => c.id === selectedCharacter.id);
    if (live && live !== selectedCharacter) setSelectedCharacter(live);
  }, [data.characters]);

  // Filter characters based on search query
  const filteredCharacters = data.characters.filter(char => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    return (
      char.name?.toLowerCase().includes(query) ||
      char.role?.toLowerCase().includes(query) ||
      char.description?.toLowerCase().includes(query) ||
      char.personality?.toLowerCase().includes(query) ||
      char.background?.toLowerCase().includes(query) ||
      char.relationships?.some(rel => {
        const relatedChar = data.characters.find(c => c.id === rel.characterId);
        return relatedChar?.name.toLowerCase().includes(query) || rel.type?.toLowerCase().includes(query);
      })
    );
  });

  // The result is applied by the book-level jobs hook as the old accept step
  // did: the image becomes the portrait and joins the visuals library.
  const handleEnhance = async (character) => {
    setEnhanceError(null);
    try {
      await startJob('enhance', { type: 'character', id: character.id }, enhanceParams('character', character));
    } catch (error) {
      setEnhanceError({ characterId: character.id, message: error.message });
    }
  };

  const handleGenerateImage = async (character) => {
    setGeneratingImage(character.id);
    try {
      await startJob('image', { type: 'character', id: character.id }, {
        prompt: buildPortraitPrompt(character),
        context: {
          bookTitle: data.bookTitle,
          overview: data.overview,
          characters: data.characters,
          locations: data.locations,
          character: {
            name: character.name,
            role: character.role,
            appearance: describeAppearance(character),
            personality: character.personality,
            background: character.background
          }
        }
      }, `Portrait: ${character.name || 'character'}`);
    } catch (error) {
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
      characterId: pendingImage.characterId
    };

    // Update character with image and add to visuals
    setData(prev => ({
      ...prev,
      characters: prev.characters.map(char =>
        char.id === pendingImage.characterId
          ? { ...char, imageUrl: pendingImage.imageUrl, imageFilename: pendingImage.filename }
          : char
      ),
      visuals: [...(prev.visuals || []), newVisual]
    }));

    setPendingImage(null);
  };

  const handleRejectImage = () => {
    setPendingImage(null);
  };

  const handleUploadImage = async (event, character) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    if (fileInputRef.current) fileInputRef.current.value = '';

    setGeneratingImage(character.id);
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
      setPendingImage({ characterId: character.id, imageUrl: url, filename, description: character.name, isUpload: true });
    } catch (error) {
      alert(`Failed to upload image: ${error.message}`);
    } finally {
      setGeneratingImage(null);
    }
  };

  const isMobile = useIsMobile();
  const showingDetail = selectedCharacter !== null || editingId || showForm;

  return (
    <div className="flex flex-col md:flex-row h-full relative">
      {/* Left sidebar - Character list */}
      <div className={`${viewMode === 'grid' ? 'w-full' : 'w-full lg:w-80'} ${isMobile && showingDetail ? 'hidden' : 'flex'} bg-white md:border-r border-gray-200 flex-col ${viewMode === 'list' ? 'md:max-h-full' : ''}`}>
        <div className="p-4 border-b border-gray-200">
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => {
                setSelectedCharacter(null);
                resetCharacterForm();
                setShowForm(true); // mobile: make the form pane visible
              }}
              className="flex-1 px-4 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center justify-center gap-2 font-semibold"
            >
              <Plus size={20} />
              New Character
            </button>
            <button
              onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
              className="px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              title={viewMode === 'list' ? 'Switch to Grid View' : 'Switch to List View'}
            >
              {viewMode === 'list' ? <Grid3x3 size={20} /> : <List size={20} />}
            </button>
          </div>
          <DuplicatesNotice kind="character" data={data} setData={setData}
            onMerged={(keepId, dropId) => { if (selectedCharacter && String(selectedCharacter.id) === String(dropId)) setSelectedCharacter(data.characters.find(c => String(c.id) === String(keepId)) || null); }} />
          <EnhanceAllBar noun="characters" kind="character" items={data.characters} setData={setData} hasChapterText={hasChapterText} />
          <MissingFromBook which="people" data={data} setData={setData} />
          {data.characters.length > 1 && (
            <button
              onClick={() => setShowRelationshipGraph(true)}
              className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-colors flex items-center justify-center gap-2 font-semibold mb-3"
            >
              <Network size={20} />
              View Relationship Map
            </button>
          )}
          {/* Search Input */}
          {data.characters.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search characters..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {data.characters.length === 0 ? (
            <div className="p-6 text-center">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No characters yet</p>
            </div>
          ) : filteredCharacters.length === 0 ? (
            <div className="p-6 text-center">
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No characters found</p>
              <p className="text-gray-400 text-xs mt-1">Try a different search term</p>
            </div>
          ) : viewMode === 'list' ? (
            <div className="p-2">
              {filteredCharacters.map(char => (
                <button
                  key={char.id}
                  onClick={() => setSelectedCharacter(char)}
                  className={`w-full text-left p-4 rounded-lg mb-2 transition-all ${
                    selectedCharacter?.id === char.id
                      ? 'bg-amber-100 border-2 border-amber-500'
                      : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                  }`}
                >
                  <div className="font-semibold text-gray-900 mb-1">{char.name}</div>
                  {char.role && (
                    <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full">
                      {char.role}
                    </span>
                  )}
                  {openItems(char.enhancement) > 0 && (
                    <span className="ml-1 text-xs px-2 py-1 bg-emerald-100 text-emerald-800 rounded-full" data-testid="enhance-pending">
                      {openItems(char.enhancement)} from book
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredCharacters.map(char => (
                <div
                  key={char.id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900 mb-1">{char.name}</h3>
                      {char.role && (
                        <span className="inline-block text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded-full">
                          {char.role}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          editCharacter(char);
                          setViewMode('list');
                        }}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => deleteItem('characters', char.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {char.age && <p className="text-sm text-gray-600">Age: {char.age}</p>}
                  {char.background && (
                    <p className="text-xs text-gray-500 mt-2 line-clamp-3">{char.background}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel - Character details or form */}
      {viewMode === 'list' && (
        <div className={`${isMobile && showingDetail ? 'fixed inset-0 z-50 bg-white' : isMobile ? 'hidden' : 'flex-1'} overflow-y-auto p-4 sm:p-6`}>
          {selectedCharacter ? (
          // View existing character
          <div className="max-w-4xl mx-auto">
            <div className="bg-white lg:rounded-lg lg:shadow-sm lg:border lg:border-gray-200 p-3 sm:p-6 lg:p-8">
              {/* Mobile-optimized header */}
              <div className="mb-4 sm:mb-6">
                {/* Back button and title on mobile */}
                <div className="flex items-center gap-3 mb-3">
                  <button
                    onClick={() => setSelectedCharacter(null)}
                    className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title="Back to characters"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 flex-1">{selectedCharacter.name}</h2>
                </div>

                {/* Badges */}
                <div className="flex gap-2 mb-4 flex-wrap">
                  {selectedCharacter.role && (
                    <span className="px-3 py-1.5 bg-blue-100 text-blue-800 rounded-full text-sm sm:text-base font-medium">
                      {selectedCharacter.role}
                    </span>
                  )}
                  {selectedCharacter.age && (
                    <span className="px-3 py-1.5 bg-gray-100 text-gray-800 rounded-full text-sm sm:text-base">
                      Age {selectedCharacter.age}
                    </span>
                  )}
                </div>

                {/* Action buttons - full width on mobile */}
                <div className="grid grid-cols-2 lg:flex lg:flex-wrap gap-2">
                  <button
                    onClick={() => handleEnhance(selectedCharacter)}
                    disabled={!hasChapterText || enhanceRunning(selectedCharacter.id)}
                    title={hasChapterText ? 'Read the chapters and suggest what the book says about this character' : 'Add or import chapters first'}
                    data-testid="character-enhance"
                    className="px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base font-medium"
                  >
                    <BookOpen size={18} className={`flex-shrink-0 ${enhanceRunning(selectedCharacter.id) ? 'animate-pulse' : ''}`} />
                    <span>{enhanceRunning(selectedCharacter.id) ? 'Reading the book...' : 'Enhance from book'}</span>
                  </button>
                  <button
                    onClick={() => handleGenerateImage(selectedCharacter)}
                    disabled={generatingImage === selectedCharacter.id || portraitRunning(selectedCharacter.id)}
                    data-testid="portrait-generate"
                    className="px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base font-medium"
                  >
                    <Image size={18} className={`flex-shrink-0 ${generatingImage === selectedCharacter.id || portraitRunning(selectedCharacter.id) ? 'animate-spin' : ''}`} />
                    <span>{generatingImage === selectedCharacter.id || portraitRunning(selectedCharacter.id) ? 'Generating...' : 'Generate Image'}</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 text-sm sm:text-base font-medium"
                  >
                    <Upload size={18} className="flex-shrink-0" />
                    <span>Upload Image</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleUploadImage(e, selectedCharacter)}
                    className="hidden"
                  />
                  <button
                    onClick={() => {
                      editCharacter(selectedCharacter);
                      setSelectedCharacter(null);
                    }}
                    className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 text-sm sm:text-base font-medium"
                  >
                    <Edit3 size={18} className="flex-shrink-0" />
                    <span>Edit Character</span>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this character?')) {
                        deleteItem('characters', selectedCharacter.id);
                        setSelectedCharacter(null);
                      }
                    }}
                    className="px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-2 text-sm sm:text-base font-medium"
                  >
                    <Trash2 size={18} className="flex-shrink-0" />
                    <span>Delete</span>
                  </button>
                </div>
                <MediaJobList jobs={portraitJobs(selectedCharacter.id)} className="mt-3" />
                <MediaJobList jobs={enhanceJobs(selectedCharacter.id)} className="mt-3"
                  hint="Reading the saved chapters. You can leave this page; the suggestions wait here." />
                {enhanceError?.characterId === selectedCharacter.id && (
                  <p className="mt-3 text-sm text-red-600" role="alert" data-testid="enhance-error">{enhanceError.message}</p>
                )}
              </div>

              <EnhanceFromBookPanel
                kind="character"
                item={selectedCharacter}
                onResolve={(items, use) => setData(prev => resolveEnhancement(prev, 'character', selectedCharacter.id, items, use))}
                onClose={() => setData(prev => closeEnhancement(prev, 'character', selectedCharacter.id))}
              />

              {/* Character pictures: the main one, and every earlier one to use or delete */}
              <ItemPictures kind="character" item={selectedCharacter} book={data} setData={setData} onOpenImage={setSelectedImage} />

              <div className="space-y-6 sm:space-y-8">
                {(selectedCharacter.aliases || []).some(a => String(a).trim()) && (
                  <p className="text-gray-700 text-base" data-testid="character-aliases">
                    <span className="font-medium text-gray-600">Also known as:</span> {selectedCharacter.aliases.map(a => String(a).trim()).filter(Boolean).join(', ')}
                  </p>
                )}

                {['gender', 'skinColor', 'hairColor', 'eyeColor', 'height', 'weight', 'build', 'appearance'].some(f => String(selectedCharacter[f] || '').trim()) && (
                  <div className="pb-6 sm:pb-8 border-b border-gray-200">
                    <h3 className="font-bold text-gray-900 text-xl sm:text-2xl mb-4">Appearance</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-base">
                      {selectedCharacter.gender && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <span className="text-gray-600 font-medium block mb-1">Gender</span>
                          <span className="text-gray-900 text-lg">{selectedCharacter.gender}</span>
                        </div>
                      )}
                      {selectedCharacter.age && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <span className="text-gray-600 font-medium block mb-1">Age</span>
                          <span className="text-gray-900 text-lg">{selectedCharacter.age}</span>
                        </div>
                      )}
                      {selectedCharacter.skinColor && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <span className="text-gray-600 font-medium block mb-1">Skin</span>
                          <span className="text-gray-900 text-lg">{selectedCharacter.skinColor}</span>
                        </div>
                      )}
                      {selectedCharacter.hairColor && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <span className="text-gray-600 font-medium block mb-1">Hair</span>
                          <span className="text-gray-900 text-lg">{selectedCharacter.hairColor}</span>
                        </div>
                      )}
                      {selectedCharacter.eyeColor && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <span className="text-gray-600 font-medium block mb-1">Eyes</span>
                          <span className="text-gray-900 text-lg">{selectedCharacter.eyeColor}</span>
                        </div>
                      )}
                      {selectedCharacter.height && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <span className="text-gray-600 font-medium block mb-1">Height</span>
                          <span className="text-gray-900 text-lg">{selectedCharacter.height}</span>
                        </div>
                      )}
                      {selectedCharacter.weight && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <span className="text-gray-600 font-medium block mb-1">Weight</span>
                          <span className="text-gray-900 text-lg">{selectedCharacter.weight}</span>
                        </div>
                      )}
                      {selectedCharacter.build && (
                        <div className="p-3 bg-gray-50 rounded-lg">
                          <span className="text-gray-600 font-medium block mb-1">Build</span>
                          <span className="text-gray-900 text-lg">{selectedCharacter.build}</span>
                        </div>
                      )}
                    </div>
                    {selectedCharacter.appearance && (
                      <p className="text-gray-700 text-base sm:text-lg leading-relaxed mt-4">{selectedCharacter.appearance}</p>
                    )}
                  </div>
                )}

                <CharacterReferences
                  key={selectedCharacter.id}
                  character={selectedCharacter}
                  bookId={data.id}
                  setData={setData}
                  onOpenImage={setSelectedImage}
                  bookStyle={bookArtStyle(data)}
                />

                {selectedCharacter.background && (
                  <div className="pb-6 sm:pb-8 border-b border-gray-200">
                    <h3 className="font-bold text-gray-900 text-xl sm:text-2xl mb-3 sm:mb-4">Background</h3>
                    <p className="text-gray-700 text-base sm:text-lg leading-relaxed">{selectedCharacter.background}</p>
                  </div>
                )}

                {selectedCharacter.personality && (
                  <div className="pb-6 sm:pb-8 border-b border-gray-200">
                    <h3 className="font-bold text-gray-900 text-xl sm:text-2xl mb-3 sm:mb-4">Personality</h3>
                    <p className="text-gray-700 text-base sm:text-lg leading-relaxed">{selectedCharacter.personality}</p>
                  </div>
                )}

                {selectedCharacter.arc && (
                  <div className="pb-6 sm:pb-8 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-3 sm:mb-4">
                      <h3 className="font-bold text-gray-900 text-xl sm:text-2xl">Character Arc</h3>
                      <ImproveButton
                        content={selectedCharacter.arc}
                        contentType="character arc"
                        onImprove={(improved) => {
                          setData(prev => ({
                            ...prev,
                            characters: prev.characters.map(c =>
                              c.id === selectedCharacter.id ? { ...c, arc: improved } : c
                            )
                          }));
                          setSelectedCharacter({ ...selectedCharacter, arc: improved });
                        }}
                        context={{
                          bookTitle: data.bookTitle,
                          overview: data.overview,
                          characterName: selectedCharacter.name,
                          characterRole: selectedCharacter.role
                        }}
                      />
                    </div>
                    <p className="text-gray-700 text-base sm:text-lg leading-relaxed">{selectedCharacter.arc}</p>
                  </div>
                )}

                {selectedCharacter.motivations && (
                  <div className="pb-6 sm:pb-8 border-b border-gray-200">
                    <h3 className="font-bold text-gray-900 text-xl sm:text-2xl mb-3 sm:mb-4">Motivations</h3>
                    <p className="text-gray-700 text-base sm:text-lg leading-relaxed">{selectedCharacter.motivations}</p>
                  </div>
                )}

                {selectedCharacter.fears && (
                  <div className="pb-6 sm:pb-8 border-b border-gray-200">
                    <h3 className="font-bold text-gray-900 text-xl sm:text-2xl mb-3 sm:mb-4">Fears & Vulnerabilities</h3>
                    <p className="text-gray-700 text-base sm:text-lg leading-relaxed">{selectedCharacter.fears}</p>
                  </div>
                )}

                {selectedCharacter.quirks && (
                  <div className="pb-6 sm:pb-8 border-b border-gray-200">
                    <h3 className="font-bold text-gray-900 text-xl sm:text-2xl mb-3 sm:mb-4">Quirks & Mannerisms</h3>
                    <p className="text-gray-700 text-base sm:text-lg leading-relaxed">{selectedCharacter.quirks}</p>
                  </div>
                )}

                {selectedCharacter.relationships && selectedCharacter.relationships.length > 0 && (
                  <div>
                    <h3 className="font-bold text-gray-900 text-xl sm:text-2xl mb-4">Relationships</h3>
                    <div className="space-y-3 sm:space-y-4">
                      {selectedCharacter.relationships.map((rel, index) => {
                        const relatedChar = data.characters.find(c => c.id === rel.characterId);
                        return (
                          <div key={index} className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <span className="font-semibold text-gray-900 text-base sm:text-lg">
                                  {relatedChar?.name || 'Unknown Character'}
                                </span>
                                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                                  {rel.type}
                                </span>
                              </div>
                              {rel.description && (
                                <p className="text-base text-gray-600 leading-relaxed">{rel.description}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          // Add/Edit character form
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {/* Mobile back button */}
                  <button
                    onClick={() => { setEditingId(null); setShowForm(false); }}
                    className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title="Back to characters"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800">
                    {editingId ? 'Edit Character' : 'Add New Character'}
                  </h3>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => {
                      setShowAIHelper(!showAIHelper);
                      setAiContext('character');
                    }}
                    className="px-3 sm:px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
                  >
                    <Sparkles size={16} className="flex-shrink-0" />
                    <span className="hidden sm:inline">AI Assistant</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowAIHelper(!showAIHelper);
                      setAiContext('character-batch');
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
                type="character"
                prompt={aiPrompt}
                setPrompt={setAiPrompt}
                onGenerate={() => generateWithAI('character')}
                onCancel={() => {
                  setShowAIHelper(false);
                  setAiPrompt('');
                  setAiContext('');
                }}
                generating={generatingAI}
                title={aiContext === 'character-batch' ? "Batch AI Character Generator" : "AI Character Generator"}
                placeholder={aiContext === 'character-batch'
                  ? "E.g., 'Create all main characters for a heist crew' or 'Make a character for each member of a royal family'"
                  : "E.g., 'A retired detective in her 60s who runs a bookshop but gets pulled back into solving cold cases'"
                }
              />

              {aiSuggestion && aiSuggestion.type === 'character' && (
                Array.isArray(aiSuggestion.data) ? (
                  <BatchAISuggestionBox
                    suggestions={aiSuggestion.data}
                    onAccept={(index) => {
                      if (index === 'all') {
                      const newCharacters = aiSuggestion.data.map((char, i) => ({
                        id: Date.now() + i,
                        ...char
                      }));
                      setData(prev => ({
                        ...prev,
                        characters: [...prev.characters, ...newCharacters]
                      }));
                        setAiSuggestion(null);
                        setShowAIHelper(false);
                        setAiPrompt('');
                      } else {
                        const char = aiSuggestion.data[index];
                        setData(prev => ({
                          ...prev,
                          characters: [...prev.characters, { id: Date.now(), ...char }]
                        }));
                        const newSuggestions = aiSuggestion.data.filter((_, i) => i !== index);
                        if (newSuggestions.length === 0) {
                          setAiSuggestion(null);
                          setShowAIHelper(false);
                          setAiPrompt('');
                        } else {
                          setAiSuggestion({ type: 'character', data: newSuggestions });
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
                        } else {
                          setAiSuggestion({ type: 'character', data: newSuggestions });
                        }
                      }
                    }}
                    onRegenerate={regenerateAISuggestion}
                    loading={generatingAI}
                    title="AI Generated Characters"
                  />
                ) : (
                  <AISuggestionBox
                    suggestion={aiSuggestion.data}
                    onAccept={acceptAISuggestion}
                    onReject={rejectAISuggestion}
                    onRegenerate={regenerateAISuggestion}
                    loading={generatingAI}
                    title="AI Generated Character"
                  />
                )
              )}

              <div className="grid grid-cols-3 gap-4 mb-4">
                <input
                  type="text"
                  placeholder="Character Name *"
                  value={characterForm.name}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, name: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Role (Protagonist, etc.)"
                  value={characterForm.role}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, role: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Age"
                  value={characterForm.age}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, age: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <input
                  type="text"
                  placeholder="Gender"
                  value={characterForm.gender}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, gender: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Skin Color"
                  value={characterForm.skinColor}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, skinColor: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Hair Color"
                  value={characterForm.hairColor}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, hairColor: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
              </div>

              <div className="grid grid-cols-4 gap-4 mb-4">
                <input
                  type="text"
                  placeholder="Eye Color"
                  value={characterForm.eyeColor}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, eyeColor: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Height"
                  value={characterForm.height}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, height: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Weight"
                  value={characterForm.weight}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, weight: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Build"
                  value={characterForm.build}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, build: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 mb-4">
                <textarea
                  placeholder="Appearance details (face, clothes, marks)"
                  value={characterForm.appearance || ''}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, appearance: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-20 focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Also known as (other names, nicknames; comma separated)"
                  value={(characterForm.aliases || []).join(', ')}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, aliases: e.target.value.split(',').map(x => x.trimStart()) }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <textarea
                  placeholder="Background"
                  value={characterForm.background}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, background: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <textarea
                  placeholder="Personality Traits"
                  value={characterForm.personality}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, personality: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-amber-400 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <textarea
                  placeholder="Character Arc"
                  value={characterForm.arc}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, arc: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <textarea
                  placeholder="Motivations & Goals"
                  value={characterForm.motivations}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, motivations: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-amber-400 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <textarea
                  placeholder="Fears & Vulnerabilities"
                  value={characterForm.fears}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, fears: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-20 focus:ring-2 focus:ring-amber-400 outline-none"
                />
                <textarea
                  placeholder="Quirks & Mannerisms"
                  value={characterForm.quirks}
                  onChange={(e) => setCharacterForm(prev => ({ ...prev, quirks: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-20 focus:ring-2 focus:ring-amber-400 outline-none"
                />
              </div>

              {/* Relationships Section */}
              <div className="border border-gray-300 rounded-lg p-4 mb-4">
                <h3 className="font-bold text-gray-800 mb-3">Relationships</h3>
                <div className="space-y-3 mb-3">
                  {(characterForm.relationships || []).map((rel, index) => {
                    const relatedChar = data.characters.find(c => c.id === rel.characterId);
                    return (
                      <div key={index} className="flex items-start gap-2 p-3 bg-gray-50 rounded border border-gray-200">
                        <div className="flex-1 grid grid-cols-3 gap-2">
                          <select
                            value={rel.characterId || ''}
                            onChange={(e) => {
                              const newRels = [...characterForm.relationships];
                              // ids are numbers for characters made here, strings for imported ones
                              const picked = data.characters.find(c => String(c.id) === e.target.value);
                              newRels[index] = { ...newRels[index], characterId: picked ? picked.id : '' };
                              setCharacterForm(prev => ({ ...prev, relationships: newRels }));
                            }}
                            className="p-2 border border-gray-300 rounded focus:ring-2 focus:ring-amber-400 outline-none text-sm"
                          >
                            <option value="">Select Character...</option>
                            {data.characters
                              .filter(c => c.id !== editingId && !characterForm.relationships.some((r, i) => i !== index && r.characterId === c.id))
                              .map(char => (
                                <option key={char.id} value={char.id}>{char.name}</option>
                              ))}
                          </select>
                          <select
                            value={rel.type || ''}
                            onChange={(e) => {
                              const newRels = [...characterForm.relationships];
                              newRels[index] = { ...newRels[index], type: e.target.value };
                              setCharacterForm(prev => ({ ...prev, relationships: newRels }));
                            }}
                            className="p-2 border border-gray-300 rounded focus:ring-2 focus:ring-amber-400 outline-none text-sm"
                          >
                            <option value="">Type...</option>
                            <option value="Family">Family</option>
                            <option value="Friend">Friend</option>
                            <option value="Sibling">Sibling</option>
                            <option value="Parent">Parent</option>
                            <option value="Child">Child</option>
                            <option value="Spouse">Spouse</option>
                            <option value="Partner">Partner</option>
                            <option value="Love interest">Love interest</option>
                            <option value="Rival">Rival</option>
                            <option value="Enemy">Enemy</option>
                            <option value="Mentor">Mentor</option>
                            <option value="Student">Student</option>
                            <option value="Colleague">Colleague</option>
                            <option value="Other">Other</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Description..."
                            value={rel.description || ''}
                            onChange={(e) => {
                              const newRels = [...characterForm.relationships];
                              newRels[index] = { ...newRels[index], description: e.target.value };
                              setCharacterForm(prev => ({ ...prev, relationships: newRels }));
                            }}
                            className="p-2 border border-gray-300 rounded focus:ring-2 focus:ring-amber-400 outline-none text-sm"
                          />
                        </div>
                        <button
                          onClick={() => {
                            const newRels = characterForm.relationships.filter((_, i) => i !== index);
                            setCharacterForm(prev => ({ ...prev, relationships: newRels }));
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => {
                    setCharacterForm(prev => ({
                      ...prev,
                      relationships: [...(prev.relationships || []), { characterId: null, type: '', description: '' }]
                    }));
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm"
                >
                  <Plus size={16} />
                  Add Relationship
                </button>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={addCharacter}
                  className="px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2"
                >
                  <Plus size={20} />
                  {editingId ? 'Update Character' : 'Add Character'}
                </button>
                {editingId && (
                  <button
                    onClick={resetCharacterForm}
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

      {/* Pending Image Approval Modal */}
      {pendingImage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleRejectImage}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-gray-800 mb-4">Approve Character Portrait</h3>
            <img
              src={pendingImage.imageUrl}
              alt={pendingImage.description}
              className="w-full max-h-96 object-contain rounded-lg mb-4"
            />
            <p className="text-gray-600 mb-4">Do you want to use this as the portrait for {pendingImage.description}?</p>
            <p className="text-sm text-gray-500 mb-4">This image will be added to your Visuals library and assigned to the character.</p>
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

      {/* Relationship Graph Modal */}
      {showRelationshipGraph && (
        <RelationshipGraph
          characters={data.characters}
          onClose={() => setShowRelationshipGraph(false)}
        />
      )}
    </div>
  );
};

export default CharactersTab;
