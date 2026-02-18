import React, { useState } from 'react';
import { Clock, Plus, Trash2, Sparkles, GitBranch, MapPin, BookOpen, Lock, Unlock, Edit3, Save, X, Search, GripVertical, Download, Check, Wand2 } from 'lucide-react';
import ChapterGeneratorModal from './ChapterGeneratorModal';
import { jsPDF } from 'jspdf';

const TimelineTab = ({ data, setData, onGenerateTimeline, generatingAI }) => {
  const [showGenerator, setShowGenerator] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showChapterGenerator, setShowChapterGenerator] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedEvent, setDraggedEvent] = useState(null);
  const [draggedOverEvent, setDraggedOverEvent] = useState(null);
  const [editingDateFor, setEditingDateFor] = useState(null);
  const [tempDate, setTempDate] = useState('');
  const [showAIEventGenerator, setShowAIEventGenerator] = useState(false);
  const [aiEventPrompt, setAiEventPrompt] = useState('');
  const [eventForm, setEventForm] = useState({
    event: '',
    sceneType: 'action',
    chapterHint: '',
    date: '',
    location: '',
    description: '',
    branch: 'main'
  });

  // Filter timeline events based on search query
  const filteredTimelines = data.timelines.filter(event => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    const locationName = data.locations.find(l => l.id === event.location)?.name || '';

    return (
      event.event?.toLowerCase().includes(query) ||
      event.sceneType?.toLowerCase().includes(query) ||
      event.chapterHint?.toLowerCase().includes(query) ||
      event.date?.toLowerCase().includes(query) ||
      event.description?.toLowerCase().includes(query) ||
      event.branch?.toLowerCase().includes(query) ||
      locationName.toLowerCase().includes(query)
    );
  });

  // Group events by branch
  const groupedEvents = filteredTimelines.reduce((acc, event) => {
    const branch = event.branch || 'main';
    if (!acc[branch]) acc[branch] = [];
    acc[branch].push(event);
    return acc;
  }, {});

  const branches = Object.keys(groupedEvents);
  const hasBranches = branches.length > 1 || (branches.length === 1 && branches[0] !== 'main');

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      console.log('Starting timeline generation...');

      // Get locked events to preserve
      const lockedEvents = data.timelines.filter(e => e.locked);
      console.log('Preserving', lockedEvents.length, 'locked events');

      // Build prompt with locked events context
      let prompt = 'Analyze all chapters and extract key scenes to create a comprehensive timeline. Break down each chapter into individual scenes. Group scenes by chapter using chapterHint.';

      if (lockedEvents.length > 0) {
        prompt += '\n\nIMPORTANT: The following timeline events are already locked and should NOT be duplicated or recreated:\n';
        lockedEvents.forEach((event, i) => {
          prompt += `${i + 1}. ${event.event} (${event.date}) - ${event.description}\n`;
        });
        prompt += '\nGenerate ONLY new timeline events that are NOT already in the locked events above. Do not duplicate any of these locked events.';
      }

      const result = await onGenerateTimeline('timeline', prompt);
      console.log('Timeline result:', result);
      if (result) {
        // Handle both array and object responses
        const events = Array.isArray(result) ? result : [result];
        setTimelineEvents(events);
      }
    } catch (error) {
      console.error('Timeline generation error:', error);
      alert('Failed to generate timeline: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateSingleEvent = async () => {
    if (!aiEventPrompt.trim()) return;

    setIsGenerating(true);
    try {
      const result = await onGenerateTimeline('timeline', aiEventPrompt);
      if (result) {
        const event = Array.isArray(result) ? result[0] : result;
        const newEvent = {
          id: Date.now(),
          locked: false,
          ...event
        };

        setData(prev => ({
          ...prev,
          timelines: [...prev.timelines, newEvent]
        }));

        setAiEventPrompt('');
        setShowAIEventGenerator(false);
      }
    } catch (error) {
      console.error('Single event generation error:', error);
      alert('Failed to generate event: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddEvent = () => {
    if (!eventForm.event) return;

    const newEvent = {
      id: Date.now(),
      ...eventForm,
      locked: false
    };

    setData(prev => ({
      ...prev,
      timelines: [...prev.timelines, newEvent]
    }));

    setEventForm({
      event: '',
      sceneType: 'action',
      chapterHint: '',
      date: '',
      location: '',
      description: '',
      branch: 'main'
    });
    setShowAddForm(false);
  };

  const handleEditEvent = (event) => {
    setEditingEvent(event.id);
    setEventForm({
      event: event.event,
      sceneType: event.sceneType || 'action',
      chapterHint: event.chapterHint || '',
      date: event.date,
      location: event.location,
      description: event.description,
      branch: event.branch || 'main'
    });
  };

  const handleSaveEdit = () => {
    setData(prev => ({
      ...prev,
      timelines: prev.timelines.map(e =>
        e.id === editingEvent ? { ...e, ...eventForm } : e
      )
    }));
    setEditingEvent(null);
    setEventForm({
      event: '',
      sceneType: 'action',
      chapterHint: '',
      date: '',
      location: '',
      description: '',
      branch: 'main'
    });
  };

  const handleCancelEdit = () => {
    setEditingEvent(null);
    setEventForm({
      event: '',
      sceneType: 'action',
      chapterHint: '',
      date: '',
      location: '',
      description: '',
      branch: 'main'
    });
  };

  const toggleLock = (eventId) => {
    setData(prev => ({
      ...prev,
      timelines: prev.timelines.map(e =>
        e.id === eventId ? { ...e, locked: !e.locked } : e
      )
    }));
  };

  // Inline date editing handlers
  const startEditingDate = (event) => {
    setEditingDateFor(event.id);
    setTempDate(event.date || '');
  };

  const saveDateEdit = (eventId) => {
    setData(prev => ({
      ...prev,
      timelines: prev.timelines.map(e =>
        e.id === eventId ? { ...e, date: tempDate } : e
      )
    }));
    setEditingDateFor(null);
    setTempDate('');
  };

  const cancelDateEdit = () => {
    setEditingDateFor(null);
    setTempDate('');
  };

  // Export timeline as PDF
  const handleExportPDF = () => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    let yPosition = margin;

    // Title page
    pdf.setFillColor(139, 92, 246); // Purple
    pdf.rect(0, 0, pageWidth, 50, 'F');

    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(28);
    pdf.setFont(undefined, 'bold');
    pdf.text('Story Timeline', pageWidth / 2, 30, { align: 'center' });

    pdf.setFontSize(14);
    pdf.setFont(undefined, 'normal');
    pdf.text(data.bookTitle || 'Untitled Book', pageWidth / 2, 42, { align: 'center' });

    yPosition = 60;
    pdf.setTextColor(0, 0, 0);

    // Stats
    pdf.setFontSize(11);
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Total Events: ${data.timelines.length}`, margin, yPosition);
    yPosition += 6;
    pdf.text(`Branches: ${branches.length}`, margin, yPosition);
    yPosition += 6;
    pdf.text(`Generated: ${new Date().toLocaleDateString()}`, margin, yPosition);
    yPosition += 15;

    // Timeline events
    pdf.setFontSize(12);
    pdf.setTextColor(0, 0, 0);

    if (hasBranches) {
      // Multi-branch timeline
      branches.forEach((branch, branchIndex) => {
        if (yPosition > pageHeight - 40) {
          pdf.addPage();
          yPosition = margin;
        }

        // Branch header
        pdf.setFont(undefined, 'bold');
        pdf.setFontSize(14);
        pdf.text(branch.replace('-', ' ').toUpperCase(), margin, yPosition);
        yPosition += 8;

        pdf.setLineWidth(1);
        pdf.setDrawColor(139, 92, 246);
        pdf.line(margin, yPosition, pageWidth - margin, yPosition);
        yPosition += 10;

        // Events in branch
        groupedEvents[branch].forEach((event, index) => {
          if (yPosition > pageHeight - 50) {
            pdf.addPage();
            yPosition = margin;
          }

          pdf.setFont(undefined, 'bold');
          pdf.setFontSize(11);
          pdf.text(`${index + 1}. ${event.event}`, margin + 5, yPosition);
          yPosition += 6;

          pdf.setFont(undefined, 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(100, 100, 100);

          if (event.date) {
            pdf.text(`Date: ${event.date}`, margin + 5, yPosition);
            yPosition += 5;
          }

          if (event.location) {
            pdf.text(`Location: ${event.location}`, margin + 5, yPosition);
            yPosition += 5;
          }

          if (event.chapterHint) {
            pdf.text(`Chapter: ${event.chapterHint}`, margin + 5, yPosition);
            yPosition += 5;
          }

          pdf.setTextColor(0, 0, 0);
          if (event.description) {
            const descLines = pdf.splitTextToSize(event.description, pageWidth - margin * 2 - 10);
            descLines.forEach(line => {
              if (yPosition > pageHeight - 30) {
                pdf.addPage();
                yPosition = margin;
              }
              pdf.text(line, margin + 5, yPosition);
              yPosition += 4;
            });
          }

          yPosition += 8;
        });

        yPosition += 5;
      });
    } else {
      // Single timeline
      filteredTimelines.forEach((event, index) => {
        if (yPosition > pageHeight - 50) {
          pdf.addPage();
          yPosition = margin;
        }

        pdf.setFont(undefined, 'bold');
        pdf.setFontSize(11);
        pdf.text(`${index + 1}. ${event.event}`, margin, yPosition);
        yPosition += 6;

        pdf.setFont(undefined, 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(100, 100, 100);

        if (event.date) {
          pdf.text(`Date: ${event.date}`, margin, yPosition);
          yPosition += 5;
        }

        if (event.location) {
          pdf.text(`Location: ${event.location}`, margin, yPosition);
          yPosition += 5;
        }

        if (event.chapterHint) {
          pdf.text(`Chapter: ${event.chapterHint}`, margin, yPosition);
          yPosition += 5;
        }

        pdf.setTextColor(0, 0, 0);
        if (event.description) {
          const descLines = pdf.splitTextToSize(event.description, pageWidth - margin * 2);
          descLines.forEach(line => {
            if (yPosition > pageHeight - 30) {
              pdf.addPage();
              yPosition = margin;
            }
            pdf.text(line, margin, yPosition);
            yPosition += 4;
          });
        }

        yPosition += 8;
      });
    }

    const filename = `${(data.bookTitle || 'timeline').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_timeline.pdf`;
    pdf.save(filename);
  };

  // Drag and drop handlers
  const handleDragStart = (e, event) => {
    setDraggedEvent(event);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target);
  };

  const handleDragOver = (e, event) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDraggedOverEvent(event);
  };

  const handleDragEnd = () => {
    setDraggedEvent(null);
    setDraggedOverEvent(null);
  };

  const handleDrop = (e, targetEvent) => {
    e.preventDefault();

    if (!draggedEvent || draggedEvent.id === targetEvent.id) {
      setDraggedEvent(null);
      setDraggedOverEvent(null);
      return;
    }

    // Only allow reordering within the same branch
    if (draggedEvent.branch !== targetEvent.branch) {
      setDraggedEvent(null);
      setDraggedOverEvent(null);
      return;
    }

    const branch = draggedEvent.branch || 'main';
    const branchEvents = data.timelines.filter(e => (e.branch || 'main') === branch);
    const otherEvents = data.timelines.filter(e => (e.branch || 'main') !== branch);

    const draggedIndex = branchEvents.findIndex(e => e.id === draggedEvent.id);
    const targetIndex = branchEvents.findIndex(e => e.id === targetEvent.id);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const reorderedBranchEvents = [...branchEvents];
    const [removed] = reorderedBranchEvents.splice(draggedIndex, 1);
    reorderedBranchEvents.splice(targetIndex, 0, removed);

    setData(prev => ({
      ...prev,
      timelines: [...otherEvents, ...reorderedBranchEvents]
    }));

    setDraggedEvent(null);
    setDraggedOverEvent(null);
  };

  const handleAcceptAll = () => {
    if (!timelineEvents) return;

    // Keep locked events, replace unlocked ones
    const lockedEvents = data.timelines.filter(e => e.locked);
    const newEvents = timelineEvents.map((event, i) => ({
      id: Date.now() + i,
      locked: false,
      ...event
    }));

    setData(prev => ({
      ...prev,
      timelines: [...lockedEvents, ...newEvents]
    }));

    setTimelineEvents(null);
    setShowGenerator(false);
  };

  const handleAcceptSingle = (index) => {
    if (!timelineEvents) return;

    const lockedEvents = data.timelines.filter(e => e.locked);
    const acceptedEvent = {
      id: Date.now(),
      locked: false,
      ...timelineEvents[index]
    };

    setData(prev => ({
      ...prev,
      timelines: [...prev.timelines, acceptedEvent]
    }));

    // Remove accepted event from suggestions
    const remainingEvents = timelineEvents.filter((_, i) => i !== index);
    if (remainingEvents.length === 0) {
      setTimelineEvents(null);
      setShowGenerator(false);
    } else {
      setTimelineEvents(remainingEvents);
    }
  };

  const handleRejectSingle = (index) => {
    if (!timelineEvents) return;

    const remainingEvents = timelineEvents.filter((_, i) => i !== index);
    if (remainingEvents.length === 0) {
      setTimelineEvents(null);
      setShowGenerator(false);
    } else {
      setTimelineEvents(remainingEvents);
    }
  };

  const handleReject = () => {
    setTimelineEvents(null);
  };

  const getBranchColor = (branch) => {
    const colors = {
      main: 'bg-blue-500',
      'subplot-A': 'bg-purple-500',
      'subplot-B': 'bg-green-500',
      'subplot-C': 'bg-orange-500',
      backstory: 'bg-gray-500'
    };
    return colors[branch] || 'bg-amber-500';
  };

  const getBranchLineColor = (branch) => {
    const colors = {
      main: 'bg-blue-300',
      'subplot-A': 'bg-purple-300',
      'subplot-B': 'bg-green-300',
      'subplot-C': 'bg-orange-300',
      backstory: 'bg-gray-300'
    };
    return colors[branch] || 'bg-amber-300';
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-0">
      {/* Header */}
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-800 mb-1 sm:mb-2">Story Timeline</h2>
            <p className="text-sm sm:text-base text-gray-600">Chronological events from your story</p>
          </div>
          <div className="grid grid-cols-2 sm:flex gap-2 flex-wrap">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-3 sm:px-4 py-2 sm:py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2 font-semibold text-sm sm:text-base"
          >
            <Plus size={18} className="sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Add Scene</span>
            <span className="sm:hidden">Add</span>
          </button>
          <button
            onClick={() => setShowAIEventGenerator(!showAIEventGenerator)}
            className="px-3 sm:px-4 py-2 sm:py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center justify-center gap-2 font-semibold text-sm sm:text-base"
          >
            <Wand2 size={18} className="sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">AI Generate Scene</span>
            <span className="sm:hidden">AI Scene</span>
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating || generatingAI}
            className="px-3 sm:px-6 py-2 sm:py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm sm:text-base"
          >
            <Sparkles size={18} className={`sm:w-5 sm:h-5 ${isGenerating ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isGenerating ? 'Generating Timeline...' : 'Auto-Generate Timeline'}</span>
            <span className="sm:hidden">Auto</span>
          </button>
          <button
            onClick={() => setShowChapterGenerator(true)}
            disabled={data.timelines.length === 0}
            className="px-3 sm:px-6 py-2 sm:py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm sm:text-base"
          >
            <BookOpen size={18} className="sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Generate Chapters</span>
            <span className="sm:hidden">Chapters</span>
          </button>
          <button
            onClick={handleExportPDF}
            disabled={data.timelines.length === 0}
            className="px-3 sm:px-6 py-2 sm:py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm sm:text-base"
          >
            <Download size={18} className="sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">Export PDF</span>
            <span className="sm:hidden">PDF</span>
          </button>
          </div>
        </div>
        {/* Search Input */}
        {data.timelines.length > 0 && (
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search timeline events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-400 focus:border-transparent outline-none"
            />
          </div>
        )}
      </div>

      {/* Add/Edit Scene Form */}
      {(showAddForm || editingEvent) && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">
            {editingEvent ? 'Edit Scene' : 'Add New Scene'}
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <input
              type="text"
              placeholder="Scene title *"
              value={eventForm.event}
              onChange={(e) => setEventForm(prev => ({ ...prev, event: e.target.value }))}
              className="col-span-2 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />
            <input
              type="text"
              placeholder="Chapter Hint (e.g., 'Chapter 1: The Adventure')"
              value={eventForm.chapterHint}
              onChange={(e) => setEventForm(prev => ({ ...prev, chapterHint: e.target.value }))}
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />
            <select
              value={eventForm.sceneType}
              onChange={(e) => setEventForm(prev => ({ ...prev, sceneType: e.target.value }))}
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            >
              <option value="action">Action</option>
              <option value="dialogue">Dialogue</option>
              <option value="exposition">Exposition</option>
              <option value="transition">Transition</option>
            </select>
            <input
              type="text"
              placeholder="Date/Time"
              value={eventForm.date}
              onChange={(e) => setEventForm(prev => ({ ...prev, date: e.target.value }))}
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />
            <input
              type="text"
              placeholder="Location"
              value={eventForm.location}
              onChange={(e) => setEventForm(prev => ({ ...prev, location: e.target.value }))}
              className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />
            <select
              value={eventForm.branch}
              onChange={(e) => setEventForm(prev => ({ ...prev, branch: e.target.value }))}
              className="col-span-2 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            >
              <option value="main">Main Story</option>
              <option value="subplot-A">Subplot A</option>
              <option value="subplot-B">Subplot B</option>
              <option value="subplot-C">Subplot C</option>
              <option value="backstory">Backstory</option>
            </select>
            <textarea
              placeholder="Scene description"
              value={eventForm.description}
              onChange={(e) => setEventForm(prev => ({ ...prev, description: e.target.value }))}
              className="col-span-2 p-3 border border-gray-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-blue-400 outline-none"
            />
          </div>
          <div className="flex gap-2">
            {editingEvent ? (
              <>
                <button
                  onClick={handleSaveEdit}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Save size={18} />
                  Save Changes
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors flex items-center gap-2"
                >
                  <X size={18} />
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleAddEvent}
                  disabled={!eventForm.event}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Plus size={18} />
                  Add Scene
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* AI Single Event Generator */}
      {showAIEventGenerator && (
        <div className="bg-teal-50 border-2 border-teal-200 rounded-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <Wand2 className="text-teal-600" size={24} />
            <h3 className="text-xl font-bold text-teal-900">AI Scene Generator</h3>
          </div>
          <p className="text-gray-700 mb-4">Describe the scene you want to add to the timeline</p>
          <textarea
            value={aiEventPrompt}
            onChange={(e) => setAiEventPrompt(e.target.value)}
            placeholder="E.g., 'The protagonist confronts the antagonist in the abandoned warehouse at midnight'"
            className="w-full p-4 border border-teal-300 rounded-lg resize-none h-24 focus:ring-2 focus:ring-teal-400 outline-none mb-4"
          />
          <div className="flex gap-3">
            <button
              onClick={handleGenerateSingleEvent}
              disabled={isGenerating || !aiEventPrompt.trim()}
              className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            >
              <Sparkles size={20} className={isGenerating ? 'animate-spin' : ''} />
              {isGenerating ? 'Generating...' : 'Generate Scene'}
            </button>
            <button
              onClick={() => {
                setShowAIEventGenerator(false);
                setAiEventPrompt('');
              }}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Generated Timeline Preview */}
      {timelineEvents && (
        <div className="mb-6 p-6 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg border-2 border-purple-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Sparkles className="text-purple-600" size={24} />
              <h3 className="text-xl font-bold text-purple-900">Generated Timeline</h3>
            </div>
            <span className="px-3 py-1 bg-purple-600 text-white rounded-full text-sm font-semibold">
              {timelineEvents.length} events
            </span>
          </div>

          <div className="bg-white rounded-lg p-4 max-h-96 overflow-y-auto mb-4">
            <div className="space-y-2">
              {timelineEvents.map((event, index) => (
                <div key={index} className="p-3 bg-gray-50 rounded border border-gray-200">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-gray-800">{event.event}</span>
                        {event.branch && event.branch !== 'main' && (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs">
                            {event.branch}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600">
                        <span className="font-semibold">{event.date}</span>
                        {event.location && (
                          <>
                            {' • '}
                            <span className="flex items-center gap-1 inline-flex">
                              <MapPin size={12} />
                              {event.location}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 mt-1">{event.description}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleAcceptSingle(index)}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="Accept this event"
                      >
                        <Check size={18} />
                      </button>
                      <button
                        onClick={() => handleRejectSingle(index)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Reject this event"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleAcceptAll}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold"
            >
              Accept All Events
            </button>
            <button
              onClick={handleReject}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-semibold"
            >
              Reject
            </button>
            <button
              onClick={handleGenerate}
              disabled={generatingAI}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold ml-auto disabled:opacity-50"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}

      {/* Timeline Visualization */}
      {data.timelines.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <Clock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-600 mb-2">No Timeline Events Yet</h3>
          <p className="text-gray-500">Auto-generate a timeline from your chapters or add events manually</p>
        </div>
      ) : filteredTimelines.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <Search className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-600 mb-2">No Events Found</h3>
          <p className="text-gray-500">Try a different search term</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          {hasBranches ? (
            // Multi-branch timeline
            <div className="relative">
              <div className="flex gap-12">
                {branches.map((branch, branchIndex) => (
                  <div key={branch} className="flex-1">
                    {/* Branch header */}
                    <div className="mb-6 sticky top-0 bg-white z-10 pb-2">
                      <div className="flex items-center gap-2 mb-2">
                        <GitBranch className="text-gray-600" size={18} />
                        <h3 className="font-bold text-gray-800 capitalize">{branch.replace('-', ' ')}</h3>
                      </div>
                      <div className={`h-1 w-full ${getBranchLineColor(branch)} rounded`}></div>
                    </div>

                    {/* Events in this branch */}
                    <div className="relative">
                      <div className={`absolute left-8 top-0 bottom-0 w-0.5 ${getBranchLineColor(branch)}`}></div>
                      <div className="space-y-6">
                        {groupedEvents[branch].map((event, index) => (
                          <div
                            key={event.id}
                            className="relative pl-20"
                            draggable
                            onDragStart={(e) => handleDragStart(e, event)}
                            onDragOver={(e) => handleDragOver(e, event)}
                            onDragEnd={handleDragEnd}
                            onDrop={(e) => handleDrop(e, event)}
                          >
                            <div className={`absolute left-5 w-8 h-8 ${getBranchColor(branch)} rounded-full border-4 border-white shadow flex items-center justify-center`}>
                              <span className="text-white text-xs font-bold">{index + 1}</span>
                            </div>
                            <div className={`bg-gray-50 rounded-lg p-4 hover:shadow-md transition-shadow border-2 ${
                              draggedOverEvent?.id === event.id && draggedEvent?.id !== event.id
                                ? 'border-blue-400 bg-blue-50'
                                : draggedEvent?.id === event.id
                                  ? 'border-gray-400 opacity-50'
                                  : 'border-gray-200'
                            } cursor-move`}>
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex items-start gap-2 flex-1">
                                  <GripVertical className="text-gray-400 flex-shrink-0 mt-1" size={16} />
                                  <div>
                                  <h4 className="font-bold text-gray-800">{event.event}</h4>
                                  {event.chapterHint && (
                                    <span className="inline-block mt-1 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                                      {event.chapterHint}
                                    </span>
                                  )}
                                </div>
                                  {editingDateFor === event.id ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        value={tempDate}
                                        onChange={(e) => setTempDate(e.target.value)}
                                        className="text-sm px-2 py-1 border border-blue-400 rounded focus:ring-2 focus:ring-blue-400 outline-none"
                                        placeholder="Date/Time"
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') saveDateEdit(event.id);
                                          if (e.key === 'Escape') cancelDateEdit();
                                        }}
                                      />
                                      <button
                                        onClick={() => saveDateEdit(event.id)}
                                        className="p-1 text-green-600 hover:bg-green-50 rounded"
                                      >
                                        <Save size={14} />
                                      </button>
                                      <button
                                        onClick={cancelDateEdit}
                                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                                      >
                                        <X size={14} />
                                      </button>
                                    </div>
                                  ) : (
                                    <p
                                      className="text-sm text-gray-600 font-semibold cursor-pointer hover:text-blue-600 hover:underline"
                                      onClick={() => startEditingDate(event)}
                                      title="Click to edit date"
                                    >
                                      {event.date || 'No date'}
                                    </p>
                                  )}
                                  {event.location && (
                                    <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">
                                      <MapPin size={14} />
                                      {event.location}
                                    </p>
                                  )}
                                  {event.fromImport && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded mt-1">
                                      <BookOpen size={12} />
                                      From Import
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => toggleLock(event.id)}
                                    disabled={event.fromImport}
                                    className={`p-2 rounded-lg transition-colors ${
                                      event.locked
                                        ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                                        : event.fromImport
                                        ? 'text-amber-600 bg-amber-50 cursor-not-allowed'
                                        : 'text-gray-400 hover:bg-gray-100'
                                    }`}
                                    title={event.fromImport ? 'Auto-locked (from import)' : event.locked ? 'Unlock (will be replaced on regenerate)' : 'Lock (preserve on regenerate)'}
                                  >
                                    {event.locked || event.fromImport ? <Lock size={16} /> : <Unlock size={16} />}
                                  </button>
                                  <button
                                    onClick={() => handleEditEvent(event)}
                                    disabled={event.locked && event.fromImport}
                                    className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    title={event.fromImport && event.locked ? 'Locked import events cannot be edited' : 'Edit scene'}
                                  >
                                    <Edit3 size={16} />
                                  </button>
                                  <button
                                    onClick={() => setData(prev => ({
                                      ...prev,
                                      timelines: prev.timelines.filter(t => t.id !== event.id)
                                    }))}
                                    disabled={event.locked}
                                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    title={event.locked ? 'Cannot delete locked events' : 'Delete scene'}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                              <p className="text-gray-700 text-sm">{event.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // Single timeline
            <div className="relative">
              <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-amber-300"></div>
              <div className="space-y-8">
                {filteredTimelines.map((event, index) => (
                  <div
                    key={event.id}
                    className="relative pl-20"
                    draggable
                    onDragStart={(e) => handleDragStart(e, event)}
                    onDragOver={(e) => handleDragOver(e, event)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDrop(e, event)}
                  >
                    <div className="absolute left-5 w-8 h-8 bg-amber-500 rounded-full border-4 border-white shadow flex items-center justify-center">
                      <span className="text-white text-sm font-bold">{index + 1}</span>
                    </div>
                    <div className={`bg-gray-50 rounded-lg p-6 hover:shadow-md transition-shadow border-2 ${
                      draggedOverEvent?.id === event.id && draggedEvent?.id !== event.id
                        ? 'border-blue-400 bg-blue-50'
                        : draggedEvent?.id === event.id
                          ? 'border-gray-400 opacity-50'
                          : 'border-gray-200'
                    } cursor-move`}>
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-start gap-2 flex-1">
                          <GripVertical className="text-gray-400 flex-shrink-0 mt-1" size={18} />
                          <div>
                          <h3 className="text-lg font-bold text-gray-800">{event.event}</h3>
                          {event.chapterHint && (
                            <span className="inline-block mt-1 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                              {event.chapterHint}
                            </span>
                          )}
                        </div>
                          {editingDateFor === event.id ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={tempDate}
                                onChange={(e) => setTempDate(e.target.value)}
                                className="text-sm px-2 py-1 border border-amber-400 rounded focus:ring-2 focus:ring-amber-400 outline-none"
                                placeholder="Date/Time"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveDateEdit(event.id);
                                  if (e.key === 'Escape') cancelDateEdit();
                                }}
                              />
                              <button
                                onClick={() => saveDateEdit(event.id)}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                              >
                                <Save size={14} />
                              </button>
                              <button
                                onClick={cancelDateEdit}
                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <p
                              className="text-sm text-amber-700 font-semibold cursor-pointer hover:text-amber-900 hover:underline"
                              onClick={() => startEditingDate(event)}
                              title="Click to edit date"
                            >
                              {event.date || 'No date'}
                            </p>
                          )}
                          {event.location && (
                            <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">
                              <MapPin size={14} />
                              {event.location}
                            </p>
                          )}
                          {event.fromImport && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded mt-1">
                              <BookOpen size={12} />
                              From Import
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => toggleLock(event.id)}
                            disabled={event.fromImport}
                            className={`p-2 rounded-lg transition-colors ${
                              event.locked
                                ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                                : event.fromImport
                                ? 'text-amber-600 bg-amber-50 cursor-not-allowed'
                                : 'text-gray-400 hover:bg-gray-100'
                            }`}
                            title={event.fromImport ? 'Auto-locked (from import)' : event.locked ? 'Unlock (will be replaced on regenerate)' : 'Lock (preserve on regenerate)'}
                          >
                            {event.locked || event.fromImport ? <Lock size={18} /> : <Unlock size={18} />}
                          </button>
                          <button
                            onClick={() => handleEditEvent(event)}
                            disabled={event.locked && event.fromImport}
                            className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title={event.fromImport && event.locked ? 'Locked import events cannot be edited' : 'Edit scene'}
                          >
                            <Edit3 size={18} />
                          </button>
                          <button
                            onClick={() => setData(prev => ({
                              ...prev,
                              timelines: prev.timelines.filter(t => t.id !== event.id)
                            }))}
                            disabled={event.locked}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title={event.locked ? 'Cannot delete locked events' : 'Delete scene'}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                      <p className="text-gray-700">{event.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chapter Generator Modal */}
      {showChapterGenerator && (
        <ChapterGeneratorModal
          data={data}
          setData={setData}
          onGenerate={onGenerateTimeline}
          onClose={() => setShowChapterGenerator(false)}
          generatingAI={generatingAI}
        />
      )}
    </div>
  );
};

export default TimelineTab;
