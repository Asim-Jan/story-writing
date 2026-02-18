import React, { useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useAudioPlayer } from '../contexts/AudioPlayerContext';

export default function GlobalAudioPlayer() {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    togglePlayPause,
    seek,
    setVolume,
    playNext,
    playPrevious,
    stop,
    hasNext,
    hasPrevious,
  } = useAudioPlayer();

  const [isExpanded, setIsExpanded] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(volume);

  if (!currentTrack) return null;

  const formatTime = (time) => {
    if (!time || isNaN(time) || !isFinite(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e) => {
    if (!duration || !isFinite(duration) || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * duration;
    seek(newTime);
  };

  const toggleMute = () => {
    if (isMuted) {
      setVolume(previousVolume);
      setIsMuted(false);
    } else {
      setPreviousVolume(volume);
      setVolume(0);
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const progress = duration > 0 && isFinite(duration) ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t-2 border-purple-500 shadow-2xl z-50">
      {/* Mini player (collapsed) */}
      {!isExpanded && (
        <div className="px-3 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
            <button
              onClick={togglePlayPause}
              className="w-11 h-11 flex items-center justify-center bg-purple-500 hover:bg-purple-600 rounded-full transition-colors flex-shrink-0"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-white" />
              ) : (
                <Play className="w-5 h-5 text-white ml-0.5" />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm truncate">
                {currentTrack.title}
              </p>
              <p className="text-gray-400 text-xs truncate">{currentTrack.subtitle}</p>
            </div>
          </div>
          <button
            onClick={() => setIsExpanded(true)}
            className="p-3 hover:bg-gray-800 rounded-lg transition-colors flex-shrink-0 ml-2"
          >
            <ChevronUp className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      )}

      {/* Full player (expanded) */}
      {isExpanded && (
        <div className="px-3 sm:px-6 py-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex-1 min-w-0 mr-2">
              <h3 className="text-white font-bold truncate text-sm sm:text-base">{currentTrack.title}</h3>
              <p className="text-gray-400 text-xs sm:text-sm truncate">{currentTrack.subtitle}</p>
            </div>
            <div className="flex gap-1 sm:gap-2 flex-shrink-0">
              <button
                onClick={() => setIsExpanded(false)}
                className="p-3 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <ChevronDown className="w-5 h-5 text-gray-400" />
              </button>
              <button
                onClick={stop}
                className="p-3 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-4">
            <div
              className={`w-full h-2 bg-gray-700 rounded-full group ${
                duration && isFinite(duration) && duration > 0 ? 'cursor-pointer' : 'cursor-not-allowed'
              }`}
              onClick={handleSeek}
            >
              <div
                className="h-full bg-purple-500 rounded-full relative group-hover:bg-purple-400 transition-colors"
                style={{ width: `${progress}%` }}
              >
                {duration && isFinite(duration) && duration > 0 && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{formatTime(currentTime)}</span>
              <span>
                {!duration || !isFinite(duration) ? (
                  <span className="text-gray-600">Loading...</span>
                ) : (
                  formatTime(duration)
                )}
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0">
            {/* Playback controls */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={playPrevious}
                disabled={!hasPrevious}
                className={`p-3 rounded-lg transition-colors ${
                  hasPrevious
                    ? 'hover:bg-gray-800 text-white'
                    : 'text-gray-600 cursor-not-allowed'
                }`}
              >
                <SkipBack className="w-5 h-5" />
              </button>

              <button
                onClick={togglePlayPause}
                className="w-14 h-14 flex items-center justify-center bg-purple-500 hover:bg-purple-600 rounded-full transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 text-white" />
                ) : (
                  <Play className="w-6 h-6 text-white ml-0.5" />
                )}
              </button>

              <button
                onClick={playNext}
                disabled={!hasNext}
                className={`p-3 rounded-lg transition-colors ${
                  hasNext
                    ? 'hover:bg-gray-800 text-white'
                    : 'text-gray-600 cursor-not-allowed'
                }`}
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Volume control */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
              <button onClick={toggleMute} className="p-3 hover:bg-gray-800 rounded-lg transition-colors">
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5 text-gray-400" />
                ) : (
                  <Volume2 className="w-5 h-5 text-gray-400" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                className="w-32 sm:w-24 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
