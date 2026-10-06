import React, { useState, useEffect } from 'react';
import { X, Info, AlertCircle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'https://story-writing.com';

// ORDNANCE: a dialog is a bordered panel on a scrim — border alone, no shadow.
const SettingsModal = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
    }
  }, [isOpen]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/users/settings`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
      });

      if (response.ok) {
        await response.json();
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" role="dialog" aria-label="AI and Usage">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
          <h2 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
            <Info className="w-5 h-5 text-[var(--blue)]" />
            AI &amp; Usage
          </h2>
          <button
            onClick={onClose}
            className="iconb"
            title="Close"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Info Box */}
          <div className="border border-[var(--line2)] bg-[var(--glass2)] p-4">
            <div className="flex gap-3">
              <AlertCircle className="w-4 h-4 text-[var(--blue)] flex-shrink-0 mt-0.5" />
              <div className="text-sm text-[var(--ink)]">
                <p className="lbl mb-1">No API keys needed</p>
                <p className="text-[var(--dim)]">
                  All AI features run on the platform's own models, included with your plan.
                  Usage is metered against your plan's quota.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 py-4 border-t border-[var(--line)]">
          <button
            onClick={onClose}
            className="btn sm"
            disabled={loading}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
