import React, { useState, useRef, useEffect } from 'react';
import { MapPin, Plus, Edit3, Trash2, Sparkles, Grid3x3, List, Image, Check, X, Upload, Search, BookOpen } from 'lucide-react';
import AIHelper from './AIHelper';
import AISuggestionBox from './AISuggestionBox';
import BatchAISuggestionBox from './BatchAISuggestionBox';
import ImproveButton from './ImproveButton';
import ImagePreviewModal from './ImagePreviewModal';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useMediaJobsContext, MediaJobList } from '../contexts/MediaJobsContext';
import EnhanceFromBookPanel from './EnhanceFromBookPanel';
import { resolveEnhancement, closeEnhancement, enhanceParams, openItems } from '../utils/enhanceFromBook';

const LocationsTab = ({
  data,
  setData,
  locationForm,
  setLocationForm,
  addLocation,
  editLocation,
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
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [showForm, setShowForm] = useState(false); // mobile: without this the New Location click did nothing visible on phones
  const [viewMode, setViewMode] = useState('list');
  const [generatingImage, setGeneratingImage] = useState(null); // an upload in flight
  const [pendingImage, setPendingImage] = useState(null); // an uploaded image awaiting approval
  const { jobsFor, startJob } = useMediaJobsContext();
  // Location images are book media jobs: they keep running (and land on the
  // location) while the user is elsewhere.
  const imageJobs = (locationId) => jobsFor('location', locationId).filter(j => j.type === 'image');
  const imageRunning = (locationId) => imageJobs(locationId).some(j => j.status === 'running');
  // "Enhance from book": as on Characters, the suggestions land on the location
  const enhanceJobs = (locationId) => jobsFor('location', locationId).filter(j => j.type === 'enhance');
  const enhanceRunning = (locationId) => enhanceJobs(locationId).some(j => j.status === 'running');
  const [enhanceError, setEnhanceError] = useState(null);
  const hasChapterText = (data.chapters || []).some(c => String(c.content || '').trim());
  const handleEnhance = async (location) => {
    setEnhanceError(null);
    try {
      await startJob('enhance', { type: 'location', id: location.id }, enhanceParams('location', location));
    } catch (error) {
      setEnhanceError({ locationId: location.id, message: error.message });
    }
  };

  // The detail view renders a snapshot; keep it in step with the book so a
  // finished image shows without re-selecting.
  useEffect(() => {
    if (!selectedLocation) return;
    const live = data.locations.find(l => l.id === selectedLocation.id);
    if (live && live !== selectedLocation) setSelectedLocation(live);
  }, [data.locations]);
  const [selectedImage, setSelectedImage] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef(null);

  const isMobile = useIsMobile();
  const showingDetail = selectedLocation !== null || editingId || showForm;

  // Filter locations based on search query
  const filteredLocations = data.locations.filter(loc => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    return (
      loc.name?.toLowerCase().includes(query) ||
      loc.type?.toLowerCase().includes(query) ||
      loc.description?.toLowerCase().includes(query) ||
      loc.significance?.toLowerCase().includes(query) ||
      loc.atmosphere?.toLowerCase().includes(query) ||
      loc.history?.toLowerCase().includes(query)
    );
  });

  const resetForm = () => {
    setLocationForm({ name: '', type: '', description: '', significance: '', atmosphere: '', history: '' });
    setSelectedLocation(null);
  };

  const handleEdit = (loc) => {
    editLocation(loc);
    setSelectedLocation(null);
  };

  const handleAddNew = () => {
    setSelectedLocation(null);
    resetForm();
    setShowForm(true); // mobile: make the form pane visible
  };

  // Applied by the book-level jobs hook as the old accept step did: the image
  // goes on the location and joins the visuals library.
  const handleGenerateImage = async (location) => {
    setGeneratingImage(location.id);
    try {
      // Build context-aware prompt
      const prompt = `Create an image for this location: ${location.name}${location.type ? ` (${location.type})` : ''}. ${location.description || ''}`;
      await startJob('image', { type: 'location', id: location.id }, {
        prompt,
        context: {
          bookTitle: data.bookTitle,
          overview: data.overview,
          characters: data.characters,
          locations: data.locations,
          location: location
        }
      }, `Location: ${location.name || 'location'}`);
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
      locationId: pendingImage.locationId
    };

    // Update location with image and add to visuals
    setData(prev => ({
      ...prev,
      locations: prev.locations.map(loc =>
        loc.id === pendingImage.locationId
          ? { ...loc, imageUrl: pendingImage.imageUrl, imageFilename: pendingImage.filename }
          : loc
      ),
      visuals: [...(prev.visuals || []), newVisual]
    }));

    setPendingImage(null);
  };

  const handleRejectImage = () => {
    setPendingImage(null);
  };

  const handleUploadImage = async (event, location) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    if (fileInputRef.current) fileInputRef.current.value = '';

    setGeneratingImage(location.id);
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
      setPendingImage({ locationId: location.id, imageUrl: url, filename, description: location.name, isUpload: true });
    } catch (error) {
      alert(`Failed to upload image: ${error.message}`);
    } finally {
      setGeneratingImage(null);
    }
  };

  return (
    <div className="flex h-full relative">
      {/* Left sidebar - Locations list */}
      <div className={`${viewMode === 'grid' ? 'w-full' : 'w-full lg:w-80'} ${isMobile && showingDetail ? 'hidden' : 'flex'} bg-white border-r border-gray-200 flex-col`}>
        <div className="p-4 border-b border-gray-200">
          <div className="flex gap-2 mb-3">
            <button
              onClick={handleAddNew}
              className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 font-semibold"
            >
              <Plus size={20} />
              New Location
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
          {data.locations.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search locations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {data.locations.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <MapPin className="w-12 h-12 mx-auto mb-2 text-gray-400" />
              <p>No locations yet</p>
            </div>
          ) : filteredLocations.length === 0 ? (
            <div className="p-6 text-center">
              <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No locations found</p>
              <p className="text-gray-400 text-xs mt-1">Try a different search term</p>
            </div>
          ) : viewMode === 'list' ? (
            <>
              {filteredLocations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => setSelectedLocation(loc)}
              className={`w-full p-4 text-left border-b border-gray-200 hover:bg-gray-50 transition-colors ${
                selectedLocation?.id === loc.id ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <MapPin className="text-green-600 mt-1 flex-shrink-0" size={20} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-800 truncate">{loc.name}</h3>
                  {loc.type && (
                    <span className="inline-block mt-1 px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs">
                      {loc.type}
                    </span>
                  )}
                  {openItems(loc.enhancement) > 0 && (
                    <span className="inline-block mt-1 ml-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-xs" data-testid="enhance-pending">
                      {openItems(loc.enhancement)} from book
                    </span>
                  )}
                </div>
              </div>
            </button>
              ))}
            </>
          ) : (
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLocations.map((loc) => (
                <div key={loc.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-gray-900 mb-1">{loc.name}</h3>
                      {loc.type && (
                        <span className="inline-block text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">
                          {loc.type}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          handleEdit(loc);
                          setViewMode('list');
                        }}
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => {
                          deleteItem('locations', loc.id);
                        }}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {loc.description && (
                    <p className="text-xs text-gray-500 mt-2 line-clamp-3">{loc.description}</p>
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
          {selectedLocation ? (
            // Detailed view
          <div className="max-w-4xl">
            <div className="flex items-start justify-between mb-4 sm:mb-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
                  {/* Mobile back button */}
                  <button
                    onClick={() => setSelectedLocation(null)}
                    className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                    title="Back to locations"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800">{selectedLocation.name}</h2>
                </div>
                {selectedLocation.type && (
                  <span className="inline-block px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
                    {selectedLocation.type}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 flex-shrink-0">
                <button
                  onClick={() => handleEnhance(selectedLocation)}
                  disabled={!hasChapterText || enhanceRunning(selectedLocation.id)}
                  title={hasChapterText ? 'Read the chapters and suggest what the book says about this place' : 'Add or import chapters first'}
                  data-testid="location-enhance"
                  className="px-3 sm:px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <BookOpen size={16} className={`flex-shrink-0 ${enhanceRunning(selectedLocation.id) ? 'animate-pulse' : ''}`} />
                  <span className="hidden sm:inline">{enhanceRunning(selectedLocation.id) ? 'Reading the book...' : 'Enhance from book'}</span>
                </button>
                <button
                  onClick={() => handleGenerateImage(selectedLocation)}
                  disabled={generatingImage === selectedLocation.id || imageRunning(selectedLocation.id)}
                  data-testid="location-generate"
                  className="px-3 sm:px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Image size={16} className={`flex-shrink-0 ${generatingImage === selectedLocation.id || imageRunning(selectedLocation.id) ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{generatingImage === selectedLocation.id || imageRunning(selectedLocation.id) ? 'Generating...' : 'Generate'}</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 sm:px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                  <Upload size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Upload</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleUploadImage(e, selectedLocation)}
                  className="hidden"
                />
                <button
                  onClick={() => handleEdit(selectedLocation)}
                  className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Edit3 size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  onClick={() => {
                    deleteItem('locations', selectedLocation.id);
                    setSelectedLocation(null);
                  }}
                  className="px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                >
                  <Trash2 size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </div>
            </div>

            <MediaJobList jobs={imageJobs(selectedLocation.id)} className="mb-4" />
            <MediaJobList jobs={enhanceJobs(selectedLocation.id)} className="mb-4"
              hint="Reading the saved chapters. You can leave this page; the suggestions wait here." />
            {enhanceError?.locationId === selectedLocation.id && (
              <p className="mb-4 text-sm text-red-600" role="alert" data-testid="enhance-error">{enhanceError.message}</p>
            )}
            <EnhanceFromBookPanel
              kind="location"
              item={selectedLocation}
              onResolve={(items, use) => setData(prev => resolveEnhancement(prev, 'location', selectedLocation.id, items, use))}
              onClose={() => setData(prev => closeEnhancement(prev, 'location', selectedLocation.id))}
            />
            {(selectedLocation.aliases || []).some(a => String(a).trim()) && (
              <p className="mb-4 text-gray-700" data-testid="location-aliases">
                <span className="font-medium text-gray-600">Also known as:</span> {selectedLocation.aliases.map(a => String(a).trim()).filter(Boolean).join(', ')}
              </p>
            )}

            {/* Location Image */}
            {selectedLocation.imageUrl && (
              <div className="mb-6">
                <img
                  src={selectedLocation.imageUrl}
                  alt={selectedLocation.name}
                  className="w-full max-h-96 object-cover rounded-lg shadow-md cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setSelectedImage({ imageUrl: selectedLocation.imageUrl, description: selectedLocation.name })}
                />
              </div>
            )}

            <div className="space-y-6">
              {selectedLocation.description && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-700">Description</h3>
                    <ImproveButton
                      content={selectedLocation.description}
                      contentType="location description"
                      onImprove={(improved) => {
                        setData(prev => ({
                          ...prev,
                          locations: prev.locations.map(l =>
                            l.id === selectedLocation.id ? { ...l, description: improved } : l
                          ),
                        }));
                        setSelectedLocation({ ...selectedLocation, description: improved });
                      }}
                      context={data}
                    />
                  </div>
                  <p className="text-gray-800 leading-relaxed">{selectedLocation.description}</p>
                </div>
              )}

              {selectedLocation.atmosphere && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-700">Atmosphere & Mood</h3>
                    <ImproveButton
                      content={selectedLocation.atmosphere}
                      contentType="atmosphere description"
                      onImprove={(improved) => {
                        setData(prev => ({
                          ...prev,
                          locations: prev.locations.map(l =>
                            l.id === selectedLocation.id ? { ...l, atmosphere: improved } : l
                          ),
                        }));
                        setSelectedLocation({ ...selectedLocation, atmosphere: improved });
                      }}
                      context={data}
                    />
                  </div>
                  <p className="text-gray-800 leading-relaxed">{selectedLocation.atmosphere}</p>
                </div>
              )}

              {selectedLocation.history && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-700">History & Background</h3>
                    <ImproveButton
                      content={selectedLocation.history}
                      contentType="location history"
                      onImprove={(improved) => {
                        setData(prev => ({
                          ...prev,
                          locations: prev.locations.map(l =>
                            l.id === selectedLocation.id ? { ...l, history: improved } : l
                          ),
                        }));
                        setSelectedLocation({ ...selectedLocation, history: improved });
                      }}
                      context={data}
                    />
                  </div>
                  <p className="text-gray-800 leading-relaxed">{selectedLocation.history}</p>
                </div>
              )}

              {selectedLocation.significance && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-gray-700">Story Significance</h3>
                    <ImproveButton
                      content={selectedLocation.significance}
                      contentType="story significance"
                      onImprove={(improved) => {
                        setData(prev => ({
                          ...prev,
                          locations: prev.locations.map(l =>
                            l.id === selectedLocation.id ? { ...l, significance: improved } : l
                          ),
                        }));
                        setSelectedLocation({ ...selectedLocation, significance: improved });
                      }}
                      context={data}
                    />
                  </div>
                  <p className="text-gray-800 leading-relaxed">{selectedLocation.significance}</p>
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
                  onClick={() => { setEditingId(null); setShowForm(false); }}
                  className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                  title="Back to locations"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-800">
                  {editingId ? 'Edit Location' : 'Add New Location'}
                </h2>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    setShowAIHelper(!showAIHelper);
                    setAiContext('location');
                  }}
                  className="px-3 sm:px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
                >
                  <Sparkles size={16} className="flex-shrink-0" />
                  <span className="hidden sm:inline">AI Assistant</span>
                </button>
                <button
                  onClick={() => {
                    setShowAIHelper(!showAIHelper);
                    setAiContext('location-batch');
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
              type="location"
              prompt={aiPrompt}
              setPrompt={setAiPrompt}
              onGenerate={() => generateWithAI('location')}
              onCancel={() => {
                setShowAIHelper(false);
                setAiPrompt('');
                setAiContext('');
              }}
              generating={generatingAI}
              title={aiContext === 'location-batch' ? "Batch AI Location Generator" : "AI Location Generator"}
              placeholder={aiContext === 'location-batch'
                ? "E.g., 'Make a location for each room in the Heeler house' or 'Create all major locations for a fantasy kingdom'"
                : "E.g., 'An abandoned Victorian mansion on a cliff overlooking the sea, rumored to be haunted'"
              }
            />

            {aiSuggestion && aiSuggestion.type === 'location' && (
              Array.isArray(aiSuggestion.data) ? (
                <BatchAISuggestionBox
                  suggestions={aiSuggestion.data}
                  onAccept={(index) => {
                    if (index === 'all') {
                      const newLocations = aiSuggestion.data.map((loc, i) => ({
                        id: Date.now() + i,
                        ...loc
                      }));
                      setData(prev => ({
                        ...prev,
                        locations: [...prev.locations, ...newLocations]
                      }));
                      setAiSuggestion(null);
                      setShowAIHelper(false);
                      setAiPrompt('');
                    } else {
                      // Accept single location
                      const loc = aiSuggestion.data[index];
                      setData(prev => ({
                        ...prev,
                        locations: [...prev.locations, { id: Date.now(), ...loc }]
                      }));
                      // Remove accepted item from suggestions
                      const newSuggestions = aiSuggestion.data.filter((_, i) => i !== index);
                      if (newSuggestions.length === 0) {
                        setAiSuggestion(null);
                        setShowAIHelper(false);
                        setAiPrompt('');
                      } else {
                        setAiSuggestion({ type: 'location', data: newSuggestions });
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
                        setAiSuggestion({ type: 'location', data: newSuggestions });
                      }
                    }
                  }}
                  onRegenerate={regenerateAISuggestion}
                  loading={generatingAI}
                  title="AI Generated Locations"
                />
              ) : (
                <AISuggestionBox
                  suggestion={aiSuggestion.data}
                  onAccept={acceptAISuggestion}
                  onReject={rejectAISuggestion}
                  onRegenerate={regenerateAISuggestion}
                  loading={generatingAI}
                  title="AI Generated Location"
                />
              )
            )}

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Location Name *"
                  value={locationForm.name}
                  onChange={(e) => setLocationForm(prev => ({ ...prev, name: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-400 outline-none"
                />
                <input
                  type="text"
                  placeholder="Type (City, Building, Forest, etc.)"
                  value={locationForm.type}
                  onChange={(e) => setLocationForm(prev => ({ ...prev, type: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-400 outline-none"
                />
              </div>

              <textarea
                placeholder="Description"
                value={locationForm.description}
                onChange={(e) => setLocationForm(prev => ({ ...prev, description: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg resize-none h-32 focus:ring-2 focus:ring-green-400 outline-none"
              />

              <div className="grid grid-cols-2 gap-4">
                <textarea
                  placeholder="Atmosphere & Mood"
                  value={locationForm.atmosphere}
                  onChange={(e) => setLocationForm(prev => ({ ...prev, atmosphere: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-green-400 outline-none"
                />
                <textarea
                  placeholder="History & Background"
                  value={locationForm.history}
                  onChange={(e) => setLocationForm(prev => ({ ...prev, history: e.target.value }))}
                  className="p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-green-400 outline-none"
                />
              </div>

              <textarea
                placeholder="Significance to Story"
                value={locationForm.significance}
                onChange={(e) => setLocationForm(prev => ({ ...prev, significance: e.target.value }))}
                className="w-full p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-green-400 outline-none"
              />

              <input
                type="text"
                placeholder="Also known as (other names; comma separated)"
                value={(locationForm.aliases || []).join(', ')}
                onChange={(e) => setLocationForm(prev => ({ ...prev, aliases: e.target.value.split(',').map(x => x.trimStart()) }))}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-400 outline-none"
              />

              <div className="flex gap-2 pt-4">
                <button
                  onClick={addLocation}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                >
                  <Plus size={20} />
                  {editingId ? 'Update Location' : 'Add Location'}
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

      {/* Pending Image Approval Modal */}
      {pendingImage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleRejectImage}>
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-gray-800 mb-4">Approve Generated Image</h3>
            <img
              src={pendingImage.imageUrl}
              alt={pendingImage.description}
              className="w-full max-h-96 object-contain rounded-lg mb-4"
            />
            <p className="text-gray-600 mb-4">Do you want to assign this image to {pendingImage.description}?</p>
            <p className="text-sm text-gray-500 mb-4">This image will be added to your Visuals library and assigned to the location.</p>
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
    </div>
  );
};

export default LocationsTab;
