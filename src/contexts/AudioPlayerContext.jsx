import React, { createContext, useContext, useState, useRef, useEffect } from 'react';

const AudioPlayerContext = createContext();

export const useAudioPlayer = () => {
  const context = useContext(AudioPlayerContext);
  if (!context) {
    throw new Error('useAudioPlayer must be used within AudioPlayerProvider');
  }
  return context;
};

export const AudioPlayerProvider = ({ children }) => {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const audioRef = useRef(new Audio());

  useEffect(() => {
    const audio = audioRef.current;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      if (currentIndex < playlist.length - 1) {
        playNext();
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('durationchange', updateDuration);
    audio.addEventListener('canplay', updateDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('durationchange', updateDuration);
      audio.removeEventListener('canplay', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [currentIndex, playlist.length]);

  useEffect(() => {
    audioRef.current.volume = volume;
  }, [volume]);

  const play = (track, trackPlaylist = null) => {
    const audio = audioRef.current;

    // If new track
    if (!currentTrack || track.url !== currentTrack.url) {
      audio.src = track.url;
      setCurrentTrack(track);

      // If playlist provided, set it
      if (trackPlaylist) {
        setPlaylist(trackPlaylist);
        const index = trackPlaylist.findIndex(t => t.url === track.url);
        setCurrentIndex(index >= 0 ? index : 0);
      } else {
        setPlaylist([track]);
        setCurrentIndex(0);
      }
    }

    audio.play().then(() => {
      setIsPlaying(true);
    }).catch(err => {
      console.error('Error playing audio:', err);
    });
  };

  const pause = () => {
    audioRef.current.pause();
    setIsPlaying(false);
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      pause();
    } else if (currentTrack) {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      });
    }
  };

  const seek = (time) => {
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const playNext = () => {
    if (currentIndex < playlist.length - 1) {
      const nextTrack = playlist[currentIndex + 1];
      setCurrentIndex(currentIndex + 1);
      setCurrentTrack(nextTrack);
      audioRef.current.src = nextTrack.url;
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      });
    }
  };

  const playPrevious = () => {
    if (currentIndex > 0) {
      const prevTrack = playlist[currentIndex - 1];
      setCurrentIndex(currentIndex - 1);
      setCurrentTrack(prevTrack);
      audioRef.current.src = prevTrack.url;
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      });
    }
  };

  const stop = () => {
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const value = {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    playlist,
    currentIndex,
    play,
    pause,
    togglePlayPause,
    seek,
    setVolume,
    playNext,
    playPrevious,
    stop,
    hasNext: currentIndex < playlist.length - 1,
    hasPrevious: currentIndex > 0,
  };

  return (
    <AudioPlayerContext.Provider value={value}>
      {children}
    </AudioPlayerContext.Provider>
  );
};
