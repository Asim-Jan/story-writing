import React, { useState } from 'react';
import { BookOpen, Image as ImageIcon, Upload, X, Users, Plus, Trash2, Mail, Key, Sparkles, Loader } from 'lucide-react';
import ImagePreviewModal from './ImagePreviewModal';

const BookMetadataTab = ({ data, setData, visuals }) => {
  const [selectedPreviewImage, setSelectedPreviewImage] = useState(null);
  const [newCollaboratorEmail, setNewCollaboratorEmail] = useState('');
  const [newCollaboratorRole, setNewCollaboratorRole] = useState('editor');
  const [generatingCover, setGeneratingCover] = useState(false);
  const [pendingCoverImage, setPendingCoverImage] = useState(null);

  const handleMetadataChange = (field, value) => {
    setData(prev => ({
      ...prev,
      metadata: {
        ...prev.metadata,
        [field]: value
      }
    }));
  };

  const handleGenerateCover = async () => {
    setGeneratingCover(true);
    try {
      const token = localStorage.getItem('token');
      const prompt = `Book cover for "${data.bookTitle || 'Untitled'}"${metadata.genre ? `. Genre: ${metadata.genre}` : ''}. ${data.overview || ''}. Portrait orientation, professional book cover design, visually striking.`;
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({
          prompt,
          bookId: data.id,
          size: '1024x1792',
          context: {
            bookTitle: data.bookTitle,
            overview: data.overview,
            characters: data.characters,
            locations: data.locations,
          },
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || err.error || 'Failed to generate cover');
      }
      const { imageUrl, filename } = await response.json();
      setPendingCoverImage({ imageUrl, filename });
    } catch (error) {
      alert(`Failed to generate cover: ${error.message}`);
    } finally {
      setGeneratingCover(false);
    }
  };

  const handleAcceptCover = () => {
    if (!pendingCoverImage) return;
    handleMetadataChange('coverImage', pendingCoverImage.imageUrl);
    setData(prev => ({
      ...prev,
      visuals: [...(prev.visuals || []), {
        id: Date.now(),
        description: `Cover - ${data.bookTitle || 'Book'}`,
        url: pendingCoverImage.imageUrl,
        filename: pendingCoverImage.filename,
        createdAt: new Date().toISOString(),
      }],
    }));
    setPendingCoverImage(null);
  };

  const handleAddCollaborator = () => {
    if (!newCollaboratorEmail.trim()) return;

    const newCollaborator = {
      id: Date.now(),
      email: newCollaboratorEmail.trim(),
      role: newCollaboratorRole,
      addedAt: new Date().toISOString(),
      status: 'pending' // pending, accepted, declined
    };

    setData(prev => ({
      ...prev,
      collaborators: [...(prev.collaborators || []), newCollaborator]
    }));

    setNewCollaboratorEmail('');
    setNewCollaboratorRole('editor');
  };

  const handleRemoveCollaborator = (collaboratorId) => {
    setData(prev => ({
      ...prev,
      collaborators: (prev.collaborators || []).filter(c => c.id !== collaboratorId)
    }));
  };

  const metadata = data.metadata || {};
  const collaborators = data.collaborators || [];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-800 mb-3">Book Metadata</h2>
        <p className="text-gray-600">Manage your book's cover images, information, and publishing details</p>
      </div>

      {/* Cover Image Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <ImageIcon size={24} className="text-blue-600" />
          Cover Image
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Cover Preview */}
          <div>
            {pendingCoverImage ? (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Generated cover — keep it?</p>
                <div className="relative">
                  <img
                    src={pendingCoverImage.imageUrl}
                    alt="Pending book cover"
                    className="w-full rounded-lg shadow-md"
                  />
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleAcceptCover}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm"
                  >
                    Set as Cover
                  </button>
                  <button
                    onClick={() => setPendingCoverImage(null)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : metadata.coverImage ? (
              <div className="relative group">
                <img
                  src={metadata.coverImage}
                  alt="Book Cover"
                  className="w-full rounded-lg shadow-md cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setSelectedPreviewImage({ url: metadata.coverImage, description: 'Book Cover' })}
                />
                <button
                  onClick={() => handleMetadataChange('coverImage', null)}
                  className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={16} />
                </button>
                <button
                  onClick={handleGenerateCover}
                  disabled={generatingCover}
                  className="absolute bottom-2 right-2 bg-blue-600 text-white rounded-lg px-3 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 text-xs font-semibold"
                >
                  {generatingCover ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {generatingCover ? 'Generating...' : 'Regenerate'}
                </button>
              </div>
            ) : (
              <div className="w-full h-64 bg-gray-100 rounded-lg flex flex-col items-center justify-center border-2 border-dashed border-gray-300 gap-3">
                <ImageIcon className="w-12 h-12 text-gray-400" />
                <p className="text-gray-500 text-sm">No cover image selected</p>
                <button
                  onClick={handleGenerateCover}
                  disabled={generatingCover}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm font-semibold disabled:opacity-60"
                >
                  {generatingCover ? <Loader size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {generatingCover ? 'Generating...' : 'Generate with AI'}
                </button>
              </div>
            )}
          </div>

          {/* Select from Visuals */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Select from your visuals:
            </label>
            <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto p-2 border border-gray-200 rounded-lg">
              {visuals.length === 0 ? (
                <p className="col-span-2 text-sm text-gray-500 text-center py-8">
                  No visuals available. Generate some images in the Visuals tab first.
                </p>
              ) : (
                visuals.map((visual) => (
                  <button
                    key={visual.id}
                    onClick={() => handleMetadataChange('coverImage', visual.url)}
                    className={`relative rounded-lg overflow-hidden border-2 transition-all ${
                      metadata.coverImage === visual.url
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <img
                      src={visual.url}
                      alt={visual.description}
                      className="w-full h-24 object-cover"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-20 transition-all"></div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Book Information */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <BookOpen size={24} className="text-green-600" />
          Book Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Author Name</label>
            <input
              type="text"
              value={metadata.author || ''}
              onChange={(e) => handleMetadataChange('author', e.target.value)}
              placeholder="Your name"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Genre</label>
            <input
              type="text"
              value={metadata.genre || ''}
              onChange={(e) => handleMetadataChange('genre', e.target.value)}
              placeholder="E.g., Fantasy, Sci-Fi, Mystery"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Target Audience</label>
            <select
              value={metadata.targetAudience || ''}
              onChange={(e) => handleMetadataChange('targetAudience', e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            >
              <option value="">Select audience...</option>
              <option value="children">Children (5-12)</option>
              <option value="young-adult">Young Adult (13-18)</option>
              <option value="adult">Adult (18+)</option>
              <option value="all-ages">All Ages</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Expected Word Count</label>
            <input
              type="number"
              value={metadata.targetWordCount || ''}
              onChange={(e) => handleMetadataChange('targetWordCount', e.target.value)}
              placeholder="E.g., 80000"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Series Information</label>
            <input
              type="text"
              value={metadata.series || ''}
              onChange={(e) => handleMetadataChange('series', e.target.value)}
              placeholder="E.g., Book 1 of The Chronicles Trilogy"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Tagline / Hook</label>
            <input
              type="text"
              value={metadata.tagline || ''}
              onChange={(e) => handleMetadataChange('tagline', e.target.value)}
              placeholder="A compelling one-line description for marketing"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Back Cover Blurb</label>
            <textarea
              value={metadata.blurb || ''}
              onChange={(e) => handleMetadataChange('blurb', e.target.value)}
              placeholder="Write a compelling back cover description (150-250 words)"
              className="w-full p-3 border border-gray-300 rounded-lg resize-none h-32 focus:ring-2 focus:ring-blue-400 outline-none"
            />
            {metadata.blurb && (
              <p className="text-sm text-gray-500 mt-1">
                {metadata.blurb.split(/\s+/).filter(w => w).length} words
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Collaborators Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Users size={24} className="text-indigo-600" />
          Collaborators
        </h3>
        <p className="text-gray-600 mb-4">Invite others to collaborate on your book</p>

        {/* Add Collaborator Form */}
        <div className="flex gap-3 mb-6">
          <div className="flex-1">
            <input
              type="email"
              value={newCollaboratorEmail}
              onChange={(e) => setNewCollaboratorEmail(e.target.value)}
              placeholder="Enter collaborator's email"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCollaborator();
              }}
            />
          </div>
          <select
            value={newCollaboratorRole}
            onChange={(e) => setNewCollaboratorRole(e.target.value)}
            className="p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-400 outline-none"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="co-author">Co-Author</option>
          </select>
          <button
            onClick={handleAddCollaborator}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2 font-semibold"
          >
            <Plus size={20} />
            Add
          </button>
        </div>

        {/* Collaborators List */}
        <div className="space-y-3">
          {collaborators.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-500">No collaborators yet</p>
              <p className="text-sm text-gray-400 mt-1">Add collaborators to work together on this book</p>
            </div>
          ) : (
            collaborators.map((collaborator) => (
              <div
                key={collaborator.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 hover:border-indigo-300 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                    <Mail className="text-indigo-600" size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">{collaborator.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        collaborator.role === 'co-author' ? 'bg-purple-100 text-purple-800' :
                        collaborator.role === 'editor' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {collaborator.role}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        collaborator.status === 'accepted' ? 'bg-green-100 text-green-800' :
                        collaborator.status === 'declined' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {collaborator.status}
                      </span>
                      <span className="text-xs text-gray-500">
                        Added {new Date(collaborator.addedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveCollaborator(collaborator.id)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Remove collaborator"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Collaboration Info */}
        {collaborators.length > 0 && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> Collaborators will receive an email invitation to access this book. They can view or edit based on their assigned role.
            </p>
          </div>
        )}
      </div>

      {/* Chapter Images */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <ImageIcon size={24} className="text-purple-600" />
          Chapter Images
        </h3>
        <p className="text-gray-600 mb-4">Assign images to specific chapters for enhanced storytelling</p>

        <div className="space-y-4">
          {data.chapters && data.chapters.length > 0 ? (
            data.chapters.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0)).map((chapter) => (
              <div key={chapter.id} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-800">
                    {chapter.number && `Chapter ${chapter.number}: `}
                    {chapter.title}
                  </h4>
                </div>

                {chapter.imageUrl ? (
                  <div className="flex items-center gap-2">
                    <img
                      src={chapter.imageUrl}
                      alt={chapter.title}
                      className="w-16 h-16 object-cover rounded cursor-pointer hover:opacity-80"
                      onClick={() => setSelectedPreviewImage({ url: chapter.imageUrl, description: chapter.title })}
                    />
                    <button
                      onClick={() => {
                        setData(prev => ({
                          ...prev,
                          chapters: prev.chapters.map(ch =>
                            ch.id === chapter.id ? { ...ch, imageUrl: null } : ch
                          )
                        }));
                      }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        setData(prev => ({
                          ...prev,
                          chapters: prev.chapters.map(ch =>
                            ch.id === chapter.id ? { ...ch, imageUrl: e.target.value } : ch
                          )
                        }));
                      }
                    }}
                    className="p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-400 outline-none"
                  >
                    <option value="">Select image...</option>
                    {visuals.map((visual) => (
                      <option key={visual.id} value={visual.url}>
                        {visual.description.substring(0, 40)}...
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))
          ) : (
            <p className="text-gray-500 text-center py-8">
              No chapters available. Create chapters first to assign images.
            </p>
          )}
        </div>
      </div>

      {/* Image Preview Modal */}
      <ImagePreviewModal
        imageUrl={selectedPreviewImage?.url}
        description={selectedPreviewImage?.description}
        onClose={() => setSelectedPreviewImage(null)}
      />
    </div>
  );
};

export default BookMetadataTab;
