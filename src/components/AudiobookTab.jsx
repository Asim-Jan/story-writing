import React, { useState, useEffect } from 'react';
import { Volume2, Play, Pause, Download, Loader, Sparkles, BookOpen, CheckCircle } from 'lucide-react';
import { useAudioPlayer } from '../contexts/AudioPlayerContext';
import { getMediaUrl } from '../utils/mediaUrl';
import { stripMarkdown } from '../utils/markdown';

const AudiobookTab = ({ chapters, bookTitle, data, setData, saveBook, bookId }) => {
  const [selectedVoice, setSelectedVoice] = useState('alloy');
  const [speed, setSpeed] = useState(1.0);
  const [generatingChapter, setGeneratingChapter] = useState(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [audioFiles, setAudioFiles] = useState(data?.audioFiles || {});

  // Use global audio player
  const { play, currentTrack, isPlaying } = useAudioPlayer();

  // Sync audioFiles from book data on load
  useEffect(() => {
    if (data?.audioFiles) {
      setAudioFiles(data.audioFiles);
    }
  }, [data?.audioFiles]);

  // Voice options with descriptions
  const voices = [
    { id: 'alloy', name: 'Davis', description: 'Neutral, balanced male voice' },
    { id: 'echo', name: 'Carter', description: 'Clear, professional male voice' },
    { id: 'fable', name: 'Frank', description: 'Warm, relaxed male voice' },
    { id: 'onyx', name: 'Mike', description: 'Deep, authoritative male voice' },
    { id: 'nova', name: 'Emma', description: 'Energetic, friendly female voice' },
    { id: 'shimmer', name: 'Grace', description: 'Soft, gentle female voice' },
  ];

  const speedOptions = [
    { value: 0.5, label: '0.5x (Slow)' },
    { value: 0.75, label: '0.75x' },
    { value: 1.0, label: '1.0x (Normal)' },
    { value: 1.25, label: '1.25x' },
    { value: 1.5, label: '1.5x (Fast)' },
    { value: 2.0, label: '2.0x' },
  ];

  const generateChapterAudio = async (chapter) => {
    if (!chapter.content) {
      alert('This chapter has no content to convert to audio');
      return;
    }

    setGeneratingChapter(chapter.id);

    try {
      // Queue the audio generation job (non-blocking)
      const response = await fetch('/api/jobs/queue/audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          bookId: bookId,
          chapterId: chapter.id,
          text: `Chapter ${chapter.number}: ${chapter.title}.\n\n${stripMarkdown(chapter.content)}`,
          voice: selectedVoice,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to queue audio generation');
      }

      // Show success message
      alert(`Audio generation queued successfully!\n\nJob ID: ${result.jobId}\n\nYou can navigate away - the audio will generate in the background.\nCheck the Jobs tab to monitor progress.`);

      console.log('Audio generation queued:', result.jobId);
    } catch (error) {
      console.error('Error queueing audio generation:', error);
      const errorMsg = error.message || 'Unknown error occurred';
      alert(`Failed to queue audio generation:\n\n${errorMsg}\n\nPlease check:\n- You're logged in\n- Server is running\n- Job worker is running`);
    } finally {
      setGeneratingChapter(null);
    }
  };

  const generateAllAudio = async () => {
    if (chapters.length === 0) {
      alert('No chapters available to convert');
      return;
    }

    const chaptersWithContent = chapters.filter(ch => ch.content);
    if (chaptersWithContent.length === 0) {
      alert('No chapters have content to convert to audio');
      return;
    }

    setGeneratingAll(true);

    try {
      // Queue audio generation for each chapter (parallel jobs)
      const jobPromises = chaptersWithContent.map(async (chapter) => {
        const response = await fetch('/api/jobs/queue/audio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            bookId: bookId,
            chapterId: chapter.id,
            text: `Chapter ${chapter.number}: ${chapter.title}.\n\n${stripMarkdown(chapter.content)}`,
            voice: selectedVoice,
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || `Failed to queue chapter ${chapter.number}`);
        }

        return result;
      });

      const results = await Promise.all(jobPromises);

      alert(`Successfully queued audio generation for ${results.length} chapters!\n\nJobs are running in the background.\nCheck the Jobs tab to monitor progress.`);
      console.log('Queued jobs:', results);
    } catch (error) {
      console.error('Error generating audiobook:', error);
      const errorMsg = error.message || 'Unknown error occurred';
      alert(`Failed to generate audiobook:\n\n${errorMsg}\n\nPlease check:\n- Your plan includes AI audio\n- Server logs for details`);
    } finally {
      setGeneratingAll(false);
    }
  };

  const handlePlayChapter = (chapter, audioFile) => {
    console.log('Playing chapter:', chapter.number, 'Audio file:', audioFile);

    // Get audio URL - handle both old (audioUrl) and new (storageKey) formats
    let audioUrl;
    if (audioFile.audioUrl) {
      audioUrl = audioFile.audioUrl;
    } else if (audioFile.storageKey || audioFile.bucket) {
      audioUrl = getMediaUrl(audioFile, 'audio');
    } else {
      console.error('Invalid audio file format:', audioFile);
      alert('Cannot play audio - invalid file format');
      return;
    }

    console.log('Audio URL:', audioUrl);

    const track = {
      url: audioUrl,
      title: `Chapter ${chapter.number}: ${chapter.title}`,
      subtitle: bookTitle || 'Audiobook',
      chapterId: chapter.id,
    };

    // Create playlist from all chapters with audio
    const playlist = chapters
      .filter(ch => audioFiles[ch.id])
      .map(ch => {
        const af = audioFiles[ch.id];
        let url;
        if (af.audioUrl) {
          url = af.audioUrl;
        } else {
          url = getMediaUrl(af, 'audio');
        }
        return {
          url,
          title: `Chapter ${ch.number}: ${ch.title}`,
          subtitle: bookTitle || 'Audiobook',
          chapterId: ch.id,
        };
      });

    console.log('Track:', track);
    console.log('Playlist:', playlist);

    play(track, playlist);
  };

  const downloadAudio = (audioUrl, filename) => {
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Volume2 className="w-8 h-8 text-indigo-600" />
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Audiobook Generator</h2>
            <p className="text-gray-600">Convert your chapters to audio using AI text-to-speech</p>
          </div>
        </div>

        {/* Voice and Speed Controls */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Voice Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Select Voice
            </label>
            <div className="grid grid-cols-2 gap-2">
              {voices.map(voice => (
                <button
                  key={voice.id}
                  onClick={() => setSelectedVoice(voice.id)}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    selectedVoice === voice.id
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-gray-200 hover:border-indigo-300 bg-white'
                  }`}
                >
                  <div className="font-semibold text-gray-800">{voice.name}</div>
                  <div className="text-xs text-gray-600">{voice.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Speed Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Playback Speed
            </label>
            <div className="grid grid-cols-3 gap-2">
              {speedOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => setSpeed(option.value)}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    speed === option.value
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-semibold'
                      : 'border-gray-200 hover:border-indigo-300 bg-white text-gray-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Generate All Button */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <button
            onClick={generateAllAudio}
            disabled={generatingAll || chapters.length === 0}
            className="w-full py-3 px-6 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
          >
            {generatingAll ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Generating Audiobook...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Generate Full Audiobook ({chapters.filter(ch => ch.content).length} chapters)
              </>
            )}
          </button>
        </div>
      </div>

      {/* Chapters List */}
      <div className="space-y-4">
        {chapters.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-700 mb-2">No Chapters Yet</h3>
            <p className="text-gray-500">Add chapters to your book to generate audiobook</p>
          </div>
        ) : (
          chapters.map((chapter, idx) => {
            const hasAudio = audioFiles[chapter.id];
            const isGenerating = generatingChapter === chapter.id;
            const isCurrentTrack = currentTrack?.chapterId === chapter.id;
            const isCurrentlyPlaying = isCurrentTrack && isPlaying;

            return (
              <div
                key={chapter.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-4">
                  {/* Chapter Number */}
                  <div className="flex-shrink-0 w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <span className="text-lg font-bold text-indigo-700">{chapter.number || idx + 1}</span>
                  </div>

                  {/* Chapter Info */}
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-800 mb-1">{chapter.title}</h3>
                    {chapter.summary && (
                      <p className="text-sm text-gray-600 mb-2">{chapter.summary}</p>
                    )}

                    {/* Audio Player */}
                    {hasAudio && hasAudio.audioUrl && (
                      <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <button
                            onClick={() => handlePlayChapter(chapter, hasAudio)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors ${
                              isCurrentlyPlaying
                                ? 'bg-purple-500 text-white hover:bg-purple-600'
                                : 'bg-indigo-600 text-white hover:bg-indigo-700'
                            }`}
                          >
                            {isCurrentlyPlaying ? (
                              <>
                                <Pause className="w-4 h-4" />
                                Playing
                              </>
                            ) : (
                              <>
                                <Play className="w-4 h-4" />
                                {isCurrentTrack ? 'Resume' : 'Play'}
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => downloadAudio(hasAudio.audioUrl, hasAudio.filename)}
                            className="text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1"
                          >
                            <Download className="w-4 h-4" />
                            Download
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-600">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span>Audio ready{isCurrentTrack && ' (loaded in player)'}</span>
                        </div>
                      </div>
                    )}

                    {!chapter.content && (
                      <div className="mt-2 text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded">
                        This chapter has no content yet
                      </div>
                    )}
                  </div>

                  {/* Generate Button */}
                  {!hasAudio && chapter.content && (
                    <button
                      onClick={() => generateChapterAudio(chapter)}
                      disabled={isGenerating || generatingAll}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                      {isGenerating ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-4 h-4" />
                          Generate Audio
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Info Box */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold text-blue-900 mb-2">About Audiobook Generation</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Choose from 6 different AI voices with unique characteristics</li>
          <li>• Adjust playback speed from 0.5x to 2.0x</li>
          <li>• Generate individual chapters or the entire book at once</li>
          <li>• Download MP3 files for offline listening</li>
          <li>• High-quality neural text-to-speech technology</li>
        </ul>
      </div>
    </div>
  );
};

export default AudiobookTab;
