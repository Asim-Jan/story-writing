import React, { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Copy, Check, Eye, EyeOff, ExternalLink } from 'lucide-react';
import axios from 'axios';

const APIKeysManager = () => {
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  const fetchApiKeys = async () => {
    try {
      const response = await axios.get('/api/users/api-keys');
      setApiKeys(response.data.keys || []);
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const generateApiKey = async () => {
    try {
      const response = await axios.post('/api/users/api-keys', {
        name: newKeyName || 'API Key',
        permissions: ['read:books', 'read:chapters', 'read:plotlines']
      });

      setGeneratedKey(response.data.apiKey);
      fetchApiKeys();
      setNewKeyName('');
    } catch (error) {
      console.error('Failed to generate API key:', error);
      alert('Failed to generate API key');
    }
  };

  const revokeApiKey = async (key) => {
    if (!confirm('Revoke this API key? External apps using it will lose access.')) return;

    try {
      await axios.delete(`/api/users/api-keys/${key}`);
      fetchApiKeys();
    } catch (error) {
      console.error('Failed to revoke API key:', error);
      alert('Failed to revoke API key');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(text);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg p-6">
        <div className="flex items-center gap-4">
          <Key className="w-10 h-10" />
          <div>
            <h2 className="text-2xl font-bold">API Keys</h2>
            <p className="text-blue-100 mt-1">
              Generate API keys to allow external apps to access your book data
            </p>
          </div>
        </div>
      </div>

      {/* Generate Key Button */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-lg">Your API Keys</h3>
          <p className="text-sm text-gray-600">
            {apiKeys.length} key{apiKeys.length !== 1 ? 's' : ''} generated
          </p>
        </div>
        <button
          onClick={() => setShowNewKeyModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Generate New Key
        </button>
      </div>

      {/* API Keys List */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : apiKeys.length > 0 ? (
        <div className="space-y-4">
          {apiKeys.map((keyInfo, idx) => (
            <div key={idx} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold">{keyInfo.name}</h4>
                    {keyInfo.active ? (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded">
                        Revoked
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded">
                    {keyInfo.key}
                  </div>
                </div>
                <button
                  onClick={() => revokeApiKey(keyInfo.key.split('...')[0])}
                  className="p-2 text-red-600 hover:bg-red-50 rounded transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Created:</span>
                  <div className="font-medium">
                    {new Date(keyInfo.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">Last Used:</span>
                  <div className="font-medium">
                    {keyInfo.lastUsed ? new Date(keyInfo.lastUsed).toLocaleDateString() : 'Never'}
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">Requests:</span>
                  <div className="font-medium">{keyInfo.requestCount || 0}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white border border-gray-200 rounded-lg">
          <Key className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-600">No API keys yet. Generate one to get started.</p>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
          <ExternalLink className="w-5 h-5" />
          External API Endpoints
        </h3>
        <div className="space-y-2 text-sm text-blue-800">
          <div className="font-mono bg-white px-3 py-2 rounded">
            GET /api/external/books
          </div>
          <div className="font-mono bg-white px-3 py-2 rounded">
            GET /api/external/books/:bookId
          </div>
          <div className="font-mono bg-white px-3 py-2 rounded">
            GET /api/external/books/:bookId/chapters
          </div>
          <div className="font-mono bg-white px-3 py-2 rounded">
            GET /api/external/books/:bookId/plotlines
          </div>
        </div>
        <p className="text-xs text-blue-700 mt-3">
          Include your API key in the <code className="bg-blue-100 px-1 rounded">X-API-Key</code> header
        </p>
      </div>

      {/* Generate Key Modal */}
      {showNewKeyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h3 className="text-xl font-bold mb-4">Generate API Key</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Key Name (optional)
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Mobile App, WordPress Plugin"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4 text-sm text-yellow-800">
              ⚠️ <strong>Important:</strong> Copy your API key immediately after generation.
              It won't be shown again in full.
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowNewKeyModal(false);
                  setNewKeyName('');
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={generateApiKey}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                Generate Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generated Key Display Modal */}
      {generatedKey && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h3 className="text-xl font-bold mb-4 text-green-700">✓ API Key Generated!</h3>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <label className="block text-sm font-medium text-green-900 mb-2">
                Your API Key (copy this now):
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={generatedKey}
                  readOnly
                  className="flex-1 px-3 py-2 bg-white border border-green-300 rounded font-mono text-sm"
                />
                <button
                  onClick={() => copyToClipboard(generatedKey)}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition flex items-center gap-2"
                >
                  {copiedKey === generatedKey ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4 text-sm text-yellow-800">
              ⚠️ Save this key securely. It won't be shown in full again.
            </div>

            <button
              onClick={() => setGeneratedKey(null)}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              I've Saved the Key
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default APIKeysManager;
