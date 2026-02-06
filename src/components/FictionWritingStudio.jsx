import React, { useState, useEffect } from 'react';
import { Book, Users, MapPin, Route, Clock, FileText, Plus, Trash2, Save, Menu, Search, BookOpen, Palette, Sparkles, X, Edit3, ArrowLeft, Wand2, Film, Shield, Volume2, Layout, RefreshCw, Upload, Video, Briefcase, Swords, User, Lock } from 'lucide-react';
import { useBook } from '../hooks/useBook';
import { getMediaUrl } from '../utils/mediaUrl';
import { useSubscription } from '../contexts/SubscriptionContext';
import UpgradeModal from './UpgradeModal';
import AISuggestionBox from './AISuggestionBox';
import AIHelper from './AIHelper';
import AIToolsTab from './AIToolsTab';
import CharactersTab from './CharactersTab';
import StoryTab from './StoryTab';
import LocationsTab from './LocationsTab';
import PlotlinesTab from './PlotlinesTab';
import ChaptersTabView from './ChaptersTabView';
import NotesTab from './NotesTab';
import TimelineTab from './TimelineTab';
import ImagePreviewModal from './ImagePreviewModal';
import BookMetadataTab from './BookMetadataTab';
import TranscriptsTab from './TranscriptsTab';
import ContinuityTab from './ContinuityTab';
import AudiobookTab from './AudiobookTab';
import ComicTab from './ComicTab';
import ImportProgressTab from './ImportProgressTab';
import AnimationStudioTab from './AnimationStudioTab';
import JobsTab from './JobsTab';
import RPGGameTab from './RPGGameTab';
import ErrorBoundary from './ErrorBoundary';
import ProfilePage from './ProfilePage';
import QuotaBanner from './QuotaBanner';
import WarningToast from './WarningToast';
import DailyDigestModal from './DailyDigestModal';
import { useQuotaWarnings, shouldShowDailyDigest, markDailyDigestShown } from '../hooks/useQuotaWarnings';

const FictionWritingStudio = ({ bookId, onBack }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeModalProps, setUpgradeModalProps] = useState({ featureName: '', requiredTier: '', requiredFeature: '' });

  const { data, setData, loading, saving, error, saveBook, autosave } = useBook(bookId);
  const { tier, hasFeature, loading: subLoading } = useSubscription();

  // Quota tracking state
  const [quotas, setQuotas] = useState(null);
  const [showDailyDigest, setShowDailyDigest] = useState(false);
  const [currentWarning, setCurrentWarning] = useState(null);
  const { warnings, markWarningShown } = useQuotaWarnings(quotas);
  const API_URL = import.meta.env.VITE_API_URL;

  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState(null);

  // Fetch quotas on mount and set up refresh listener
  useEffect(() => {
    const fetchQuotas = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const response = await fetch(`${API_URL}/api/users/quotas`, {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include'
        });

        if (response.ok) {
          const data = await response.json();
          setQuotas(data);

          // Check if should show daily digest on first load
          if (shouldShowDailyDigest(data)) {
            setShowDailyDigest(true);
          }
        }
      } catch (error) {
        console.error('Error fetching quotas:', error);
      }
    };

    fetchQuotas();

    // Listen for quota refresh events
    window.addEventListener('quotaRefresh', fetchQuotas);
    return () => window.removeEventListener('quotaRefresh', fetchQuotas);
  }, [API_URL]);

  // Show warnings when they appear
  useEffect(() => {
    if (warnings.length > 0 && !currentWarning) {
      // Show first warning
      setCurrentWarning(warnings[0]);
    }
  }, [warnings, currentWarning]);

  // Handle warning dismissal
  const handleWarningDismiss = () => {
    if (currentWarning) {
      markWarningShown(currentWarning.id);
      setCurrentWarning(null);

      // Show next warning if any
      const nextWarning = warnings.find(w => w.id !== currentWarning.id);
      if (nextWarning) {
        setTimeout(() => setCurrentWarning(nextWarning), 500);
      }
    }
  };

  // Handle daily digest close
  const handleDigestClose = () => {
    markDailyDigestShown();
    setShowDailyDigest(false);
  };

  // Dispatch quota refresh event after successful save
  const handleSaveBook = async () => {
    await saveBook();
    // Dispatch custom event to refresh quotas
    window.dispatchEvent(new Event('quotaRefresh'));
  };

  // Warn on navigation if unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (autosave?.status === 'unsaved' || autosave?.status === 'saving') {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [autosave?.status]);

  const [characterForm, setCharacterForm] = useState({
    name: '', role: '', age: '', gender: '', skinColor: '', hairColor: '', eyeColor: '',
    height: '', weight: '', build: '', background: '', personality: '', arc: '',
    motivations: '', fears: '', quirks: '', relationships: []
  });

  const [locationForm, setLocationForm] = useState({
    name: '', type: '', description: '', significance: '', atmosphere: '', history: ''
  });

  const [plotlineForm, setPlotlineForm] = useState({
    title: '', type: '', description: '', status: 'planning', themes: '', conflicts: '', linkedPlotlines: []
  });

  const [timelineForm, setTimelineForm] = useState({
    event: '', date: '', location: '', description: ''
  });

  const [chapterForm, setChapterForm] = useState({
    number: '', title: '', summary: '', content: ''
  });

  const [noteForm, setNoteForm] = useState({
    title: '', content: '', category: 'general'
  });

  const [aiPrompt, setAiPrompt] = useState('');
  const [generatingAI, setGeneratingAI] = useState(false);
  const [showAIHelper, setShowAIHelper] = useState(false);
  const [aiContext, setAiContext] = useState(''); // character, location, plotline, chapter
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [characterViewMode, setCharacterViewMode] = useState('grid'); // 'grid' or 'table'
  const [selectedImage, setSelectedImage] = useState(null);

  const resetCharacterForm = () => {
    setCharacterForm({
      name: '', role: '', age: '', gender: '', skinColor: '', hairColor: '', eyeColor: '',
      height: '', weight: '', build: '', background: '', personality: '', arc: '',
      motivations: '', fears: '', quirks: '', relationships: []
    });
    setEditingId(null);
  };

  const addCharacter = () => {
    if (characterForm.name) {
      const newCharId = editingId || Date.now();

      setData(prev => {
        let updatedCharacters;

        if (editingId) {
          // Update existing character
          updatedCharacters = prev.characters.map(char =>
            char.id === editingId ? { ...characterForm, id: editingId } : char
          );
        } else {
          // Add new character
          updatedCharacters = [...prev.characters, { id: newCharId, ...characterForm }];
        }

        // Add reciprocal relationships
        const newRelationships = characterForm.relationships || [];
        newRelationships.forEach(rel => {
          if (rel.characterId) {
            updatedCharacters = updatedCharacters.map(char => {
              if (char.id === rel.characterId) {
                const existingRels = char.relationships || [];
                // Check if reciprocal relationship already exists
                const hasReciprocal = existingRels.some(r => r.characterId === newCharId);
                if (!hasReciprocal) {
                  // Determine reciprocal type
                  let reciprocalType = rel.type;
                  if (rel.type === 'Parent') reciprocalType = 'Child';
                  else if (rel.type === 'Child') reciprocalType = 'Parent';
                  else if (rel.type === 'Mentor') reciprocalType = 'Student';
                  else if (rel.type === 'Student') reciprocalType = 'Mentor';

                  return {
                    ...char,
                    relationships: [...existingRels, {
                      characterId: newCharId,
                      type: reciprocalType,
                      description: rel.description ? `Reciprocal: ${rel.description}` : ''
                    }]
                  };
                }
              }
              return char;
            });
          }
        });

        return { ...prev, characters: updatedCharacters };
      });

      resetCharacterForm();
    }
  };

  const editCharacter = (char) => {
    setCharacterForm(char);
    setEditingId(char.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addLocation = () => {
    if (locationForm.name) {
      if (editingId) {
        setData(prev => ({
          ...prev,
          locations: prev.locations.map(loc => 
            loc.id === editingId ? { ...locationForm, id: editingId } : loc
          )
        }));
      } else {
        setData(prev => ({
          ...prev,
          locations: [...prev.locations, { id: Date.now(), ...locationForm }]
        }));
      }
      setLocationForm({ name: '', type: '', description: '', significance: '', atmosphere: '', history: '' });
      setEditingId(null);
    }
  };

  const editLocation = (loc) => {
    setLocationForm(loc);
    setEditingId(loc.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addPlotline = () => {
    if (plotlineForm.title) {
      if (editingId) {
        setData(prev => ({
          ...prev,
          plotlines: prev.plotlines.map(plot => 
            plot.id === editingId ? { ...plotlineForm, id: editingId } : plot
          )
        }));
      } else {
        setData(prev => ({
          ...prev,
          plotlines: [...prev.plotlines, { id: Date.now(), ...plotlineForm }]
        }));
      }
      setPlotlineForm({ title: '', type: '', description: '', status: 'planning', themes: '', conflicts: '', linkedPlotlines: [] });
      setEditingId(null);
    }
  };

  const editPlotline = (plot) => {
    setPlotlineForm(plot);
    setEditingId(plot.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addTimeline = () => {
    if (timelineForm.event) {
      setData(prev => ({
        ...prev,
        timelines: [...prev.timelines, { id: Date.now(), ...timelineForm }]
      }));
      setTimelineForm({ event: '', date: '', location: '', description: '' });
    }
  };

  const addChapter = () => {
    if (chapterForm.title) {
      const wordCount = chapterForm.content.trim().split(/\s+/).filter(w => w).length;
      if (editingId) {
        setData(prev => ({
          ...prev,
          chapters: prev.chapters.map(chap => 
            chap.id === editingId ? { ...chapterForm, wordCount, id: editingId } : chap
          )
        }));
      } else {
        setData(prev => ({
          ...prev,
          chapters: [...prev.chapters, { id: Date.now(), ...chapterForm, wordCount }]
        }));
      }
      setChapterForm({ number: '', title: '', summary: '', content: '' });
      setEditingId(null);
    }
  };

  const editChapter = (chap) => {
    setChapterForm(chap);
    setEditingId(chap.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addNote = () => {
    if (noteForm.title) {
      setData(prev => ({
        ...prev,
        notes: [...prev.notes, { id: Date.now(), ...noteForm, createdAt: new Date().toISOString() }]
      }));
      setNoteForm({ title: '', content: '', category: 'general' });
    }
  };

  const deleteItem = (category, id) => {
    setData(prev => ({
      ...prev,
      [category]: prev[category].filter(item => item.id !== id)
    }));
  };

  const refreshMetadata = () => {
    // Recalculate word counts for all chapters
    setData(prev => ({
      ...prev,
      chapters: prev.chapters.map(ch => {
        if (ch.content) {
          const wordCount = ch.content.trim().split(/\s+/).filter(w => w).length;
          return { ...ch, wordCount };
        }
        return ch;
      })
    }));
    alert('Metadata refreshed! Word counts recalculated.');
  };

  const generateWithAI = async (type) => {
    if (!aiPrompt.trim()) return;

    setGeneratingAI(true);
    setAiSuggestion(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          prompt: aiPrompt,
          context: {
            bookTitle: data.bookTitle,
            overview: data.overview,
            characters: data.characters,
            locations: data.locations,
            plotlines: data.plotlines
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate content');
      }

      const generatedData = await response.json();
      setAiSuggestion({ type, data: generatedData });
    } catch (error) {
      console.error("Error generating content:", error);
      alert("Failed to generate content. Please try again.");
    } finally {
      setGeneratingAI(false);
    }
  };

  const acceptAISuggestion = () => {
    if (!aiSuggestion) return;

    const { type, data: generatedData } = aiSuggestion;

    if (type === 'character') {
      setCharacterForm(prev => ({ ...prev, ...generatedData }));
    } else if (type === 'location') {
      setLocationForm(prev => ({ ...prev, ...generatedData }));
    } else if (type === 'plotline') {
      setPlotlineForm(prev => ({ ...prev, ...generatedData, status: 'planning' }));
    } else if (type === 'chapter') {
      setChapterForm(prev => ({ ...prev, ...generatedData }));
    }

    setAiSuggestion(null);
    setShowAIHelper(false);
  };

  const rejectAISuggestion = () => {
    setAiSuggestion(null);
  };

  const regenerateAISuggestion = () => {
    if (aiSuggestion) {
      generateWithAI(aiSuggestion.type);
    }
  };

  const handleAIToolGenerate = async (toolType, prompt) => {
    setGeneratingAI(true);
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: toolType,
          prompt: prompt,
          context: {
            bookTitle: data.bookTitle,
            overview: data.overview,
            characters: data.characters,
            locations: data.locations,
            plotlines: data.plotlines,
            chapters: data.chapters
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('API Error Response:', errorData);
        throw new Error(errorData.error || errorData.details || 'Failed to generate content');
      }

      const generatedData = await response.json();
      return generatedData;
    } catch (error) {
      console.error("Error generating AI tool content:", error);
      alert(`Failed to generate content: ${error.message}`);
      return null;
    } finally {
      setGeneratingAI(false);
    }
  };

  const handleContinuityAnalysis = async () => {
    setGeneratingAI(true);
    try {
      const response = await fetch('/api/analyze-continuity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bookData: {
            bookTitle: data.bookTitle,
            overview: data.overview,
            characters: data.characters,
            locations: data.locations,
            plotlines: data.plotlines,
            timelines: data.timelines,
            chapters: data.chapters
          }
        })
      });

      if (!response.ok) {
        throw new Error('Failed to analyze continuity');
      }

      const analysis = await response.json();
      return analysis;
    } catch (error) {
      console.error("Error analyzing continuity:", error);
      alert(`Failed to analyze continuity: ${error.message}`);
      return null;
    } finally {
      setGeneratingAI(false);
    }
  };

  const generateVisual = async (description) => {
    setGeneratingAI(true);
    try {
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: description,
          context: {
            bookTitle: data.bookTitle,
            overview: data.overview,
            characters: data.characters,
            locations: data.locations,
            plotlines: data.plotlines
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to generate image');
      }

      const { imageUrl, filename } = await response.json();

      const newVisual = {
        id: Date.now(),
        description,
        url: imageUrl,
        filename,
        createdAt: new Date().toISOString()
      };

      setData(prev => ({
        ...prev,
        visuals: [...prev.visuals, newVisual]
      }));
    } catch (error) {
      console.error("Error generating visual:", error);
      alert(`Failed to generate image: ${error.message}`);
    } finally {
      setGeneratingAI(false);
    }
  };

  const tabs = [
    { id: 'overview', icon: BookOpen, label: 'Overview', requiredFeature: null },
    { id: 'metadata', icon: FileText, label: 'Book Info', requiredFeature: null },
    ...(data.importedFrom ? [{ id: 'import', icon: Upload, label: 'Import Info', requiredFeature: null }] : []),
    { id: 'story', icon: Book, label: 'Story', requiredFeature: null },
    { id: 'characters', icon: Users, label: 'Characters', requiredFeature: null },
    { id: 'locations', icon: MapPin, label: 'Locations', requiredFeature: null },
    { id: 'plotlines', icon: Route, label: 'Plotlines', requiredFeature: null },
    { id: 'timeline', icon: Clock, label: 'Timeline', requiredFeature: null },
    { id: 'chapters', icon: FileText, label: 'Chapters', requiredFeature: null },
    { id: 'notes', icon: FileText, label: 'Notes', requiredFeature: null },
    { id: 'visuals', icon: Palette, label: 'Visuals', requiredFeature: 'media_generation', requiredTier: 'Basic' },
    { id: 'audiobook', icon: Volume2, label: 'Audiobook', requiredFeature: 'media_generation', requiredTier: 'Basic' },
    { id: 'comic', icon: Layout, label: 'Comic Mode', requiredFeature: 'media_generation', requiredTier: 'Basic' },
    { id: 'transcripts', icon: Film, label: 'Transcripts', requiredFeature: null },
    { id: 'animation', icon: Video, label: 'Animation Studio', requiredFeature: 'media_generation', requiredTier: 'Basic' },
    { id: 'rpggame', icon: Swords, label: 'RPG Game', requiredFeature: 'export_rpg', requiredTier: 'Basic' },
    { id: 'continuity', icon: Shield, label: 'Continuity', requiredFeature: 'continuity_check', requiredTier: 'Basic' },
    { id: 'jobs', icon: Briefcase, label: 'Jobs', requiredFeature: null },
    { id: 'ai-tools', icon: Wand2, label: 'AI Tools', requiredFeature: null }
  ];

  if (showProfile) {
    return <ProfilePage onBack={() => setShowProfile(false)} />;
  }

  return (
    <div className="flex h-screen bg-gray-50 font-serif overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 fixed lg:relative z-50 lg:z-0 w-64 bg-amber-50 border-r border-amber-200 transition-transform duration-300 h-full flex flex-col`}>
        <div className="p-6 border-b border-amber-200">
          <div className="flex items-center gap-2 mb-4">
            <Book className="text-amber-700" size={24} />
            <input
              type="text"
              value={data.bookTitle}
              onChange={(e) => setData(prev => ({ ...prev, bookTitle: e.target.value }))}
              className="text-xl font-bold bg-transparent border-none outline-none text-amber-900 w-full"
            />
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-3 text-amber-600" />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-amber-300 bg-white text-sm focus:ring-2 focus:ring-amber-400 outline-none"
            />
          </div>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4">
          {tabs.map(tab => {
            const isRestricted = tab.requiredFeature && !hasFeature(tab.requiredFeature);
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (isRestricted) {
                    setUpgradeModalProps({
                      featureName: tab.label,
                      requiredTier: tab.requiredTier,
                      requiredFeature: tab.requiredFeature
                    });
                    setShowUpgradeModal(true);
                    return;
                  }
                  setActiveTab(tab.id);
                  if (window.innerWidth < 1024) {
                    setSidebarOpen(false);
                  }
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-all ${
                  isActive
                    ? 'bg-amber-200 text-amber-900 font-semibold'
                    : isRestricted
                    ? 'opacity-50 cursor-not-allowed text-amber-600 hover:opacity-60'
                    : 'text-amber-800 hover:bg-amber-100'
                }`}
                title={isRestricted ? `Requires ${tab.requiredTier} subscription` : ''}
              >
                {isRestricted ? (
                  <Lock size={20} className="text-red-500" />
                ) : (
                  <tab.icon size={20} />
                )}
                <span className="flex-1 text-left">{tab.label}</span>
                {tab.id === 'characters' && data.characters.length > 0 && (
                  <span className="ml-auto bg-amber-300 text-amber-900 text-xs px-2 py-1 rounded-full">
                    {data.characters.length}
                  </span>
                )}
                {isRestricted && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                    {tab.requiredTier}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-gray-600 hover:text-gray-900 lg:hidden"
            >
              <Menu size={24} />
            </button>
            <button
              onClick={onBack}
              className="text-gray-600 hover:text-gray-900 flex items-center gap-1 sm:gap-2"
              title="Back to Books"
            >
              <ArrowLeft size={20} />
              <span className="hidden sm:inline">Back to Books</span>
            </button>
            <h1 className="text-lg sm:text-2xl font-bold text-gray-800 capitalize">{activeTab}</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Autosave Status Indicator */}
            <div className="hidden sm:flex items-center gap-2 text-sm">
              {autosave?.status === 'saving' && (
                <span className="flex items-center gap-1 text-blue-600">
                  <RefreshCw size={14} className="animate-spin" />
                  Saving...
                </span>
              )}
              {autosave?.status === 'saved' && autosave?.lastSaved && (
                <span className="flex items-center gap-1 text-green-600">
                  <Save size={14} />
                  Saved {new Date(autosave.lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {autosave?.status === 'unsaved' && (
                <span className="flex items-center gap-1 text-amber-600">
                  <span className="w-2 h-2 bg-amber-600 rounded-full animate-pulse"></span>
                  Unsaved changes
                </span>
              )}
              {autosave?.status === 'error' && (
                <span className="flex items-center gap-1 text-red-600">
                  <X size={14} />
                  Save failed
                </span>
              )}
            </div>
            <button
              onClick={() => setShowProfile(true)}
              className="p-2 text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
              title="Profile"
            >
              <User size={20} />
            </button>
            <button
              onClick={handleSaveBook}
              disabled={saving}
              className="px-3 sm:px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 disabled:opacity-50 text-sm sm:text-base"
            >
              <Save size={16} />
              <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save Now'}</span>
            </button>
          </div>
        </header>

        {/* Quota Banner */}
        <QuotaBanner onNavigateToProfile={() => setShowProfile(true)} />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'overview' && (
            <div className="max-w-6xl mx-auto">
              {/* Story Overview Section */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-8 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl sm:text-3xl font-bold text-gray-800">Story Overview</h2>
                  <button
                    onClick={refreshMetadata}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-semibold"
                  >
                    <RefreshCw size={16} />
                    Refresh Stats
                  </button>
                </div>
                <textarea
                  value={data.overview}
                  onChange={(e) => setData(prev => ({ ...prev, overview: e.target.value }))}
                  placeholder="Write your story's synopsis, themes, and main concepts here..."
                  className="w-full h-48 p-4 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-amber-400 outline-none"
                />
              </div>

              {/* Quick Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 sm:p-6 border border-blue-200">
                  <div className="flex items-center gap-2 sm:gap-3 mb-2">
                    <Users className="text-blue-700" size={20} sm:size={24} />
                    <h3 className="font-bold text-blue-900 text-sm sm:text-base">Characters</h3>
                  </div>
                  <p className="text-2xl sm:text-3xl font-bold text-blue-700">{data.characters.length}</p>
                  <p className="text-sm text-blue-600 mt-1">
                    {data.characters.filter(c => c.role?.toLowerCase().includes('main') || c.role?.toLowerCase().includes('protagonist')).length} main
                  </p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6 border border-green-200">
                  <div className="flex items-center gap-3 mb-2">
                    <MapPin className="text-green-700" size={24} />
                    <h3 className="font-bold text-green-900">Locations</h3>
                  </div>
                  <p className="text-3xl font-bold text-green-700">{data.locations.length}</p>
                  <p className="text-sm text-green-600 mt-1">
                    {data.locations.filter(l => l.imageUrl).length} with images
                  </p>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6 border border-purple-200">
                  <div className="flex items-center gap-3 mb-2">
                    <Book className="text-purple-700" size={24} />
                    <h3 className="font-bold text-purple-900">Chapters</h3>
                  </div>
                  <p className="text-3xl font-bold text-purple-700">{data.chapters.length}</p>
                  <p className="text-sm text-purple-600 mt-1">
                    {data.chapters.filter(c => c.content).length} written
                  </p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-6 border border-amber-200">
                  <div className="flex items-center gap-3 mb-2">
                    <FileText className="text-amber-700" size={24} />
                    <h3 className="font-bold text-amber-900">Total Words</h3>
                  </div>
                  <p className="text-3xl font-bold text-amber-700">
                    {data.chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-amber-600 mt-1">
                    Avg: {data.chapters.length > 0 ? Math.round(data.chapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0) / data.chapters.length).toLocaleString() : 0}
                  </p>
                </div>
              </div>

              {/* Content Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                {/* Plotlines */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Route className="text-indigo-600" size={24} />
                    <h3 className="text-xl font-bold text-gray-800">Plotlines</h3>
                  </div>
                  {data.plotlines.length === 0 ? (
                    <p className="text-gray-500 italic">No plotlines yet</p>
                  ) : (
                    <div className="space-y-2">
                      {data.plotlines.slice(0, 5).map(plot => (
                        <div key={plot.id} className="flex items-start gap-2">
                          <span className={`mt-1 px-2 py-0.5 rounded text-xs font-semibold ${
                            plot.status === 'active' ? 'bg-green-100 text-green-800' :
                            plot.status === 'resolved' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {plot.status}
                          </span>
                          <p className="text-sm text-gray-700 flex-1">{plot.title}</p>
                        </div>
                      ))}
                      {data.plotlines.length > 5 && (
                        <p className="text-sm text-gray-500 italic">+{data.plotlines.length - 5} more</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Timeline */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Clock className="text-rose-600" size={24} />
                    <h3 className="text-xl font-bold text-gray-800">Timeline</h3>
                  </div>
                  {(data.timelines || []).length === 0 ? (
                    <p className="text-gray-500 italic">No timeline events yet</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Total Events:</span>
                        <span className="font-semibold">{(data.timelines || []).length}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Locked Events:</span>
                        <span className="font-semibold">{(data.timelines || []).filter(t => t.locked).length}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Branches:</span>
                        <span className="font-semibold">
                          {[...new Set((data.timelines || []).map(t => t.branch))].length}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Additional Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Visuals */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Palette className="text-pink-600" size={24} />
                    <h3 className="text-xl font-bold text-gray-800">Visuals</h3>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Total Images:</span>
                      <span className="font-semibold">{(data.visuals || []).length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Chapter Covers:</span>
                      <span className="font-semibold">
                        {(data.visuals || []).filter(v => v.chapterId).length}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Location Images:</span>
                      <span className="font-semibold">
                        {(data.visuals || []).filter(v => v.locationId).length}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <FileText className="text-teal-600" size={24} />
                    <h3 className="text-xl font-bold text-gray-800">Notes</h3>
                  </div>
                  {data.notes.length === 0 ? (
                    <p className="text-gray-500 italic">No notes yet</p>
                  ) : (
                    <div className="space-y-2">
                      {data.notes.slice(0, 3).map(note => (
                        <p key={note.id} className="text-sm text-gray-700 line-clamp-2">{note.title}</p>
                      ))}
                      {data.notes.length > 3 && (
                        <p className="text-sm text-gray-500 italic">+{data.notes.length - 3} more</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Transcripts */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Film className="text-violet-600" size={24} />
                    <h3 className="text-xl font-bold text-gray-800">Transcripts</h3>
                  </div>
                  {(data.transcripts || []).length === 0 ? (
                    <p className="text-gray-500 italic">No transcripts yet</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Total Episodes:</span>
                        <span className="font-semibold">{(data.transcripts || []).length}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Total Scenes:</span>
                        <span className="font-semibold">
                          {(data.transcripts || []).reduce((sum, t) => sum + (t.sceneCount || 0), 0)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'characters' && (
            <CharactersTab
              data={data}
              setData={setData}
              characterForm={characterForm}
              setCharacterForm={setCharacterForm}
              addCharacter={addCharacter}
              editCharacter={editCharacter}
              resetCharacterForm={resetCharacterForm}
              deleteItem={deleteItem}
              editingId={editingId}
              generateWithAI={generateWithAI}
              aiSuggestion={aiSuggestion}
              acceptAISuggestion={acceptAISuggestion}
              rejectAISuggestion={rejectAISuggestion}
              regenerateAISuggestion={regenerateAISuggestion}
              generatingAI={generatingAI}
              showAIHelper={showAIHelper}
              setShowAIHelper={setShowAIHelper}
              aiPrompt={aiPrompt}
              setAiPrompt={setAiPrompt}
              setAiContext={setAiContext}
              setAiSuggestion={setAiSuggestion}
              aiContext={aiContext}
            />
          )}

          {activeTab === 'locations' && (
            <LocationsTab
              data={data}
              setData={setData}
              locationForm={locationForm}
              setLocationForm={setLocationForm}
              addLocation={addLocation}
              editLocation={editLocation}
              deleteItem={deleteItem}
              editingId={editingId}
              generateWithAI={generateWithAI}
              aiSuggestion={aiSuggestion}
              acceptAISuggestion={acceptAISuggestion}
              rejectAISuggestion={rejectAISuggestion}
              regenerateAISuggestion={regenerateAISuggestion}
              generatingAI={generatingAI}
              showAIHelper={showAIHelper}
              setShowAIHelper={setShowAIHelper}
              aiPrompt={aiPrompt}
              setAiPrompt={setAiPrompt}
              setAiContext={setAiContext}
              setAiSuggestion={setAiSuggestion}
              aiContext={aiContext}
            />
          )}

          {activeTab === 'plotlines' && (
            <PlotlinesTab
              data={data}
              setData={setData}
              plotlineForm={plotlineForm}
              setPlotlineForm={setPlotlineForm}
              addPlotline={addPlotline}
              editPlotline={editPlotline}
              deleteItem={deleteItem}
              editingId={editingId}
              generateWithAI={generateWithAI}
              aiSuggestion={aiSuggestion}
              acceptAISuggestion={acceptAISuggestion}
              rejectAISuggestion={rejectAISuggestion}
              regenerateAISuggestion={regenerateAISuggestion}
              generatingAI={generatingAI}
              showAIHelper={showAIHelper}
              setShowAIHelper={setShowAIHelper}
              aiPrompt={aiPrompt}
              setAiPrompt={setAiPrompt}
              setAiContext={setAiContext}
              aiContext={aiContext}
            />
          )}

          {activeTab === 'timeline' && (
            <TimelineTab
              data={data}
              setData={setData}
              onGenerateTimeline={handleAIToolGenerate}
              generatingAI={generatingAI}
            />
          )}

          {activeTab === 'chapters' && (
            <ChaptersTabView
              data={data}
              setData={setData}
              chapterForm={chapterForm}
              setChapterForm={setChapterForm}
              addChapter={addChapter}
              editChapter={editChapter}
              deleteItem={deleteItem}
              editingId={editingId}
              generateWithAI={generateWithAI}
              aiSuggestion={aiSuggestion}
              acceptAISuggestion={acceptAISuggestion}
              rejectAISuggestion={rejectAISuggestion}
              regenerateAISuggestion={regenerateAISuggestion}
              generatingAI={generatingAI}
              showAIHelper={showAIHelper}
              setShowAIHelper={setShowAIHelper}
              aiPrompt={aiPrompt}
              setAiPrompt={setAiPrompt}
              setAiContext={setAiContext}
            />
          )}

          {activeTab === 'notes' && (
            <NotesTab
              data={data}
              setData={setData}
              noteForm={noteForm}
              setNoteForm={setNoteForm}
              addNote={addNote}
              deleteItem={deleteItem}
            />
          )}

          {activeTab === 'visuals' && (
            <div className="max-w-6xl mx-auto">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Generate Visual</h3>
                <p className="text-gray-600 mb-4">Describe a scene, character, or location to generate a visual reference.</p>
                <div className="flex gap-4">
                  <input
                    type="text"
                    placeholder="Describe what you want to visualize..."
                    id="visualDescription"
                    className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none"
                  />
                  <button
                    onClick={() => {
                      const desc = document.getElementById('visualDescription').value;
                      if (desc) {
                        generateVisual(desc);
                        document.getElementById('visualDescription').value = '';
                      }
                    }}
                    disabled={generatingAI}
                    className="px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Palette size={20} className={generatingAI ? 'animate-spin' : ''} />
                    {generatingAI ? 'Generating Image...' : 'Generate'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {(data.visuals || []).map(visual => {
                  const imageUrl = getMediaUrl(visual, 'images');
                  return (
                  <div key={visual.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <img
                      src={imageUrl}
                      alt={visual.description}
                      className="w-full h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      onClick={() => setSelectedImage({ ...visual, url: imageUrl })}
                    />
                    <div className="p-4">
                      <p className="text-gray-700 text-sm mb-2">{visual.description}</p>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-gray-500">{new Date(visual.createdAt).toLocaleDateString()}</span>
                        <button
                          onClick={() => deleteItem('visuals', visual.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'metadata' && (
            <BookMetadataTab
              data={data}
              setData={setData}
              visuals={data.visuals || []}
            />
          )}

          {activeTab === 'story' && (
            <StoryTab
              data={data}
              setData={setData}
              onGenerateChapter={handleAIToolGenerate}
              generatingAI={generatingAI}
            />
          )}

          {activeTab === 'audiobook' && (
            <ErrorBoundary>
              <AudiobookTab
                chapters={data.chapters || []}
                bookTitle={data.bookTitle}
                data={data}
                setData={setData}
                saveBook={saveBook}
                bookId={bookId}
              />
            </ErrorBoundary>
          )}

          {activeTab === 'comic' && (
            <ErrorBoundary>
              <ComicTab
                chapters={data.chapters || []}
                characters={data.characters || []}
                locations={data.locations || []}
                data={data}
                setData={setData}
                saveBook={saveBook}
              />
            </ErrorBoundary>
          )}

          {activeTab === 'transcripts' && (
            <TranscriptsTab
              data={data}
              setData={setData}
              onGenerateTranscript={handleAIToolGenerate}
              generatingAI={generatingAI}
            />
          )}

          {activeTab === 'ai-tools' && (
            <AIToolsTab
              data={data}
              setData={setData}
              onGenerate={handleAIToolGenerate}
              generating={generatingAI}
            />
          )}

          {activeTab === 'continuity' && (
            <ContinuityTab
              data={data}
              onAnalyze={handleContinuityAnalysis}
              analyzing={generatingAI}
            />
          )}

          {activeTab === 'import' && data.importedFrom && (
            <ImportProgressTab
              data={data}
              bookId={bookId}
              onAnalysisComplete={() => {
                // Reload book data after analysis
                window.location.reload();
              }}
            />
          )}

          {activeTab === 'animation' && (
            <AnimationStudioTab
              data={data}
              bookId={bookId}
              setData={setData}
            />
          )}

          {activeTab === 'jobs' && (
            <JobsTab />
          )}

          {activeTab === 'rpggame' && (
            <ErrorBoundary>
              <RPGGameTab
                bookId={bookId}
                bookData={data}
              />
            </ErrorBoundary>
          )}
        </main>
      </div>

      {/* Image Preview Modal */}
      <ImagePreviewModal
        imageUrl={selectedImage?.url}
        description={selectedImage?.description}
        onClose={() => setSelectedImage(null)}
      />

      {/* Upgrade Modal */}
      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        featureName={upgradeModalProps.featureName}
        requiredTier={upgradeModalProps.requiredTier}
      />

      {/* Quota Warning Toast */}
      <WarningToast
        warning={currentWarning}
        onDismiss={handleWarningDismiss}
        onNavigate={() => setShowProfile(true)}
      />

      {/* Daily Digest Modal */}
      {showDailyDigest && (
        <DailyDigestModal
          quotas={quotas}
          onClose={handleDigestClose}
          onNavigateToProfile={() => {
            setShowProfile(true);
            handleDigestClose();
          }}
        />
      )}
    </div>
  );
};

export default FictionWritingStudio;