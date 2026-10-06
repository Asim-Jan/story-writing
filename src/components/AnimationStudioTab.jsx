import React, { useState } from 'react';
import { Film, Play, Download, Trash2, Edit3, Loader, CheckCircle2, AlertCircle, Video } from 'lucide-react';
import { getMediaUrl } from '../utils/mediaUrl';

const AnimationStudioTab = ({ data, bookId, setData }) => {
  const [selectedTranscript, setSelectedTranscript] = useState('');
  const [parsedScenes, setParsedScenes] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState([]);
  const [editingScene, setEditingScene] = useState(null);
  const [generatingScenes, setGeneratingScenes] = useState(new Set());

  const transcripts = data.transcripts || [];
  const animationProjects = data.animationProjects || [];

  const handleParseTranscript = async () => {
    if (!selectedTranscript) return;

    setParsing(true);
    setParsedScenes(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/video/parse-transcript', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          transcriptId: selectedTranscript,
          bookId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to parse transcript');
      }

      const result = await response.json();
      setParsedScenes(result.scenes);
    } catch (error) {
      console.error('Parse error:', error);
      alert('Failed to parse transcript: ' + error.message);
    } finally {
      setParsing(false);
    }
  };

  const handleGenerateAnimation = async () => {
    if (!parsedScenes || parsedScenes.length === 0) return;

    setGenerating(true);
    setProgress([]);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/video/generate-animation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          bookId,
          transcriptId: selectedTranscript,
          scenes: parsedScenes,
          options: {
            resolution: '1080p',
            transitionType: 'fade',
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start generation');
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          setGenerating(false);
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              setProgress(prev => [...prev, data]);

              if (data.stage === 'complete') {
                // Reload book data to get new animation project
                window.location.reload();
              } else if (data.stage === 'error') {
                // Show helpful error message
                let errorMsg = data.message || 'Unknown error';
                if (errorMsg.includes('API is not enabled') || errorMsg.includes('PERMISSION_DENIED')) {
                  errorMsg = `⚠ Google API Not Enabled\n\n${errorMsg}\n\nPlease enable the Generative Language API in your Google Cloud Console, then try again.`;
                }
                alert(errorMsg);
                setGenerating(false);
              }
            } catch (e) {
              console.error('Error parsing SSE:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Generation error:', error);

      // Show helpful error message
      let errorMsg = error.message || 'Unknown error';
      if (errorMsg.includes('API is not enabled') || errorMsg.includes('PERMISSION_DENIED')) {
        errorMsg = `⚠ Google API Not Enabled\n\n${errorMsg}\n\nPlease enable the Generative Language API in your Google Cloud Console, then try again.`;
      } else if (errorMsg.includes('network')) {
        errorMsg = `Network error\n\nFailed to generate animation: ${errorMsg}\n\nPlease check your internet connection and API configuration.`;
      } else {
        errorMsg = 'Failed to generate animation: ' + errorMsg;
      }

      alert(errorMsg);
      setGenerating(false);
    }
  };

  const updateScene = (sceneNumber, updates) => {
    setParsedScenes(scenes =>
      scenes.map(s => s.sceneNumber === sceneNumber ? { ...s, ...updates } : s)
    );
  };

  const handleGenerateSingleScene = async (scene) => {
    const sceneNumber = scene.sceneNumber;
    setGeneratingScenes(prev => new Set([...prev, sceneNumber]));

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/video/generate-animation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          bookId,
          transcriptId: selectedTranscript,
          scenes: [scene],
          options: {
            resolution: '1080p',
            transitionType: 'fade',
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start generation');
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));

              if (data.stage === 'scene-complete' || data.stage === 'complete') {
                // Mark scene as completed
                updateScene(sceneNumber, { status: 'completed' });
                alert(`Scene ${sceneNumber} generated successfully.`);
              } else if (data.stage === 'error') {
                updateScene(sceneNumber, { status: 'failed', error: data.message });

                // Show helpful error message
                let errorMsg = data.message || 'Unknown error';
                if (errorMsg.includes('API is not enabled') || errorMsg.includes('PERMISSION_DENIED')) {
                  errorMsg = `⚠ Google API Not Enabled\n\n${errorMsg}\n\nPlease enable the Generative Language API in your Google Cloud Console, then try again.`;
                }
                alert(errorMsg);
              }
            } catch (e) {
              console.error('Error parsing SSE:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Generation error:', error);

      // Show helpful error message
      let errorMsg = error.message || 'Unknown error';
      if (errorMsg.includes('API is not enabled') || errorMsg.includes('PERMISSION_DENIED')) {
        errorMsg = `⚠ Google API Not Enabled\n\n${errorMsg}\n\nPlease enable the Generative Language API in your Google Cloud Console, then try again.`;
      } else if (errorMsg.includes('network')) {
        errorMsg = `Network error\n\nFailed to generate scene: ${errorMsg}\n\nPlease check your internet connection and API configuration.`;
      }

      alert(errorMsg);
      updateScene(sceneNumber, { status: 'failed', error: error.message });
    } finally {
      setGeneratingScenes(prev => {
        const next = new Set(prev);
        next.delete(sceneNumber);
        return next;
      });
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg p-6 text-white">
        <div className="flex items-center gap-3 mb-2">
          <Film className="w-8 h-8" />
          <h2 className="text-3xl font-bold">Animation Studio</h2>
        </div>
        <p className="text-purple-100">
          Transform your transcripts into AI-generated animated films using Google Veo 3
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
          <p className="text-gray-600 text-sm">Transcripts</p>
          <p className="text-2xl font-bold text-gray-900">{transcripts.length}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
          <p className="text-gray-600 text-sm">Animations</p>
          <p className="text-2xl font-bold text-purple-600">{animationProjects.length}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
          <p className="text-gray-600 text-sm">Parsed Scenes</p>
          <p className="text-2xl font-bold text-blue-600">{parsedScenes?.length || 0}</p>
        </div>
        <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
          <p className="text-gray-600 text-sm">Est. Duration</p>
          <p className="text-2xl font-bold text-green-600">
            {parsedScenes ? `${Math.floor(parsedScenes.reduce((sum, s) => sum + (s.duration || 8), 0) / 60)}m` : '0m'}
          </p>
        </div>
      </div>

      {/* Step 1: Select Transcript */}
      {!parsedScenes && (
        <div className="bg-white rounded-lg p-6 border-2 border-gray-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Step 1: Select Transcript</h3>

          {transcripts.length === 0 ? (
            <div className="text-center py-8">
              <Film className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No transcripts available</p>
              <p className="text-gray-500 text-sm mt-2">
                Go to the Transcripts tab to generate a screenplay from a chapter first
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <select
                value={selectedTranscript}
                onChange={(e) => setSelectedTranscript(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg text-lg focus:border-blue-500 focus:outline-none"
              >
                <option value="">Choose a transcript...</option>
                {transcripts.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.title} - {t.sceneCount} scenes ({t.estimatedDuration})
                  </option>
                ))}
              </select>

              <button
                onClick={handleParseTranscript}
                disabled={!selectedTranscript || parsing}
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-all font-semibold flex items-center justify-center gap-2"
              >
                {parsing ? (
                  <>
                    <Loader className="w-5 h-5 animate-spin" />
                    Parsing Transcript...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" />
                    Parse into Video Scenes
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Review & Edit Scenes */}
      {parsedScenes && !generating && (
        <div className="bg-white rounded-lg p-6 border-2 border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900">
              Step 2: Review Scenes ({parsedScenes.length} scenes)
            </h3>
            <button
              onClick={() => setParsedScenes(null)}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
            >
              Back to Selection
            </button>
          </div>

          <div className="space-y-4 max-h-96 overflow-y-auto mb-6">
            {parsedScenes.map((scene, idx) => (
              <div key={idx} className="border-2 border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded">
                        Scene {scene.sceneNumber}
                      </span>
                      <h4 className="font-semibold text-gray-900">{scene.title}</h4>
                      <span className="text-xs text-gray-500">{scene.duration}s • {scene.cameraDirection}</span>
                      {scene.status === 'completed' && (
                        <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded">
                          <CheckCircle2 className="w-3 h-3" />
                          Generated
                        </span>
                      )}
                      {scene.status === 'failed' && (
                        <span className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded">
                          <AlertCircle className="w-3 h-3" />
                          Failed
                        </span>
                      )}
                    </div>
                    {editingScene === scene.sceneNumber ? (
                      <textarea
                        value={scene.visualPrompt}
                        onChange={(e) => updateScene(scene.sceneNumber, { visualPrompt: e.target.value })}
                        className="w-full mt-2 px-3 py-2 border border-gray-300 rounded text-sm"
                        rows="3"
                      />
                    ) : (
                      <p className="text-gray-700 text-sm mt-2">{scene.visualPrompt}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingScene(editingScene === scene.sceneNumber ? null : scene.sceneNumber)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleGenerateSingleScene(scene)}
                      disabled={generatingScenes.has(scene.sceneNumber) || scene.status === 'completed'}
                      className="px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded transition-colors flex items-center gap-1"
                    >
                      {generatingScenes.has(scene.sceneNumber) ? (
                        <>
                          <Loader className="w-3 h-3 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          Generate
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {scene.dialogue && (
                  <p className="text-purple-700 text-sm italic mt-2">Dialogue: "{scene.dialogue}"</p>
                )}
                <div className="flex gap-2 mt-2 text-xs text-gray-600">
                  {scene.characters && scene.characters.length > 0 && (
                    <span>Cast: {scene.characters.join(', ')}</span>
                  )}
                  {scene.location && <span>Scene: {scene.location}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-blue-900 font-medium text-sm">
              ⚡ Estimated Cost: ${(parsedScenes.length * 0.10).toFixed(2)} - ${(parsedScenes.length * 0.15).toFixed(2)}
            </p>
            <p className="text-blue-700 text-xs mt-1">
              ~{parsedScenes.length} scenes × 8 seconds × $0.10-0.15 per scene using Veo 3
            </p>
            <p className="text-blue-700 text-xs mt-1">
              Generation time: {Math.ceil(parsedScenes.length * 30 / 60)} - {Math.ceil(parsedScenes.length * 45 / 60)} minutes
            </p>
          </div>

          <button
            onClick={handleGenerateAnimation}
            className="w-full px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg transition-all font-bold text-lg flex items-center justify-center gap-3"
          >
            <Video className="w-6 h-6" />
            Generate Animation Film ({parsedScenes.length} scenes)
          </button>
        </div>
      )}

      {/* Step 3: Generation Progress */}
      {generating && (
        <div className="bg-white rounded-lg p-6 border-2 border-purple-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Loader className="w-6 h-6 animate-spin text-purple-600" />
            Generating Animation...
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {progress.map((item, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border-l-4 ${
                  item.stage === 'error' ? 'bg-red-50 border-red-500' :
                  item.stage === 'complete' ? 'bg-green-50 border-green-500' :
                  item.stage === 'scene-complete' ? 'bg-blue-50 border-blue-500' :
                  'bg-gray-50 border-gray-400'
                }`}
              >
                <p className="text-sm font-medium text-gray-900">
                  {item.message}
                  {item.current && item.total && (
                    <span className="ml-2 text-xs bg-gray-900 text-white px-2 py-1 rounded">
                      {item.current}/{item.total}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Existing Animation Projects */}
      {animationProjects.length > 0 && (
        <div className="bg-white rounded-lg p-6 border-2 border-gray-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Your Animation Films</h3>

          <div className="space-y-4">
            {animationProjects.map(project => (
              <div key={project.id} className="border-2 border-gray-200 rounded-lg p-4 hover:border-purple-300 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h4 className="font-bold text-gray-900 text-lg">{project.title}</h4>
                    <div className="flex gap-4 text-sm text-gray-600 mt-1">
                      <span>{project.scenes?.length || 0} scenes</span>
                      <span>{Math.floor((project.finalVideo?.duration || 0) / 60)}m {(project.finalVideo?.duration || 0) % 60}s</span>
                      <span>{(project.finalVideo?.size / 1024 / 1024).toFixed(1)} MB</span>
                      <span className="text-purple-600">✓ Completed</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={getMediaUrl(project.finalVideo, 'videos')}
                      download
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </a>
                    <button
                      onClick={() => {
                        if (confirm('Delete this animation project?')) {
                          setData(prev => ({
                            ...prev,
                            animationProjects: prev.animationProjects.filter(p => p.id !== project.id),
                          }));
                        }
                      }}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                </div>

                {/* Video Preview */}
                {project.finalVideo && (
                  <div className="bg-black rounded-lg overflow-hidden">
                    <video
                      src={getMediaUrl(project.finalVideo, 'videos')}
                      controls
                      className="w-full"
                      style={{ maxHeight: '400px' }}
                    >
                      Your browser does not support video playback.
                    </video>
                  </div>
                )}

                {/* Scene Breakdown */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900 font-medium">
                    View {project.scenes?.length || 0} scenes
                  </summary>
                  <div className="mt-2 space-y-2">
                    {project.scenes?.map((scene, idx) => (
                      <div key={idx} className="bg-gray-50 rounded p-2 text-xs">
                        <span className="font-bold">Scene {scene.sceneNumber}:</span> {scene.title}
                        {scene.status === 'completed' && <span className="ml-2 text-green-600">✓</span>}
                        {scene.status === 'failed' && <span className="ml-2 text-red-600">✗ Failed</span>}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-6">
        <h4 className="font-bold text-purple-900 mb-3">About Animation Studio</h4>
        <ul className="space-y-2 text-sm text-purple-800">
          <li>• <strong>AI Video Generation:</strong> Uses Google Veo 3 to create cinematic 8-second video clips</li>
          <li>• <strong>Scene Parsing:</strong> Automatically breaks transcripts into filmable scenes</li>
          <li>• <strong>Native Audio:</strong> Veo 3 generates synchronized dialogue and sound effects</li>
          <li>• <strong>Professional Assembly:</strong> FFmpeg stitches scenes into complete films</li>
          <li>• <strong>High Quality:</strong> 1080p output with smooth transitions</li>
          <li>• <strong>Cloud Storage:</strong> All videos stored in MinIO, accessible from any device</li>
        </ul>
      </div>
    </div>
  );
};

export default AnimationStudioTab;
