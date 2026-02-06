import { X, Check, Lock } from 'lucide-react';
import { useState } from 'react';

const UpgradeModal = ({ isOpen, onClose, featureName, requiredTier }) => {
  const [loading, setLoading] = useState(false);
  const API_URL = import.meta.env.VITE_API_URL;

  if (!isOpen) return null;

  const handleUpgrade = async (tier) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/subscriptions/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: JSON.stringify({
          tier,
          success_url: `${window.location.origin}/profile?tab=quotas&upgraded=true`,
          cancel_url: window.location.href
        })
      });

      if (response.ok) {
        const data = await response.json();
        window.location.href = data.url;
      } else {
        const error = await response.json();
        alert(`Failed to start checkout: ${error.error}`);
      }
    } catch (error) {
      console.error('Upgrade error:', error);
      alert('Failed to start checkout. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const plans = {
    basic: {
      name: 'Basic',
      price: '£9.99',
      features: [
        '10 books, 250k words',
        'Image & audio generation',
        'Audiobook creation',
        'Comic mode',
        'Animation studio',
        'RPG game export',
        'Export to PDF, CBZ, EPUB'
      ]
    },
    premium: {
      name: 'Premium',
      price: '£19.99',
      features: [
        'Unlimited books & words',
        'All Basic features',
        'Priority processing',
        'Advanced continuity checks',
        'Version history',
        'Collaboration (coming soon)'
      ],
      badge: 'MOST POPULAR'
    }
  };

  const getFeatureDescription = (feature) => {
    const descriptions = {
      'Audiobook': 'Generate professional audiobooks from your chapters using AI voice synthesis.',
      'Comic Mode': 'Transform your story into a visual comic with AI-generated panels and characters.',
      'Animation Studio': 'Create animated videos from your story with AI-generated scenes and narration.',
      'RPG Game': 'Export your story as an interactive RPG game with character stats and quests.',
      'Visuals': 'Generate stunning AI images for your story, chapters, and characters.',
      'Continuity': 'Advanced AI continuity checking to ensure consistency across your entire story.'
    };
    return descriptions[feature] || 'Unlock premium features to enhance your storytelling experience.';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white hover:bg-white/20 rounded-full p-2"
          >
            <X size={24} />
          </button>
          <div className="flex items-center gap-3 mb-2">
            <Lock size={32} />
            <h2 className="text-2xl font-bold">Unlock {featureName}</h2>
          </div>
          <p className="text-purple-100">
            This feature requires a {requiredTier} subscription or higher
          </p>
        </div>

        <div className="p-6 border-b bg-amber-50">
          <h3 className="text-lg font-semibold mb-2">Why upgrade?</h3>
          <p className="text-gray-700">
            {getFeatureDescription(featureName)}
          </p>
        </div>

        <div className="p-6">
          <h3 className="text-xl font-bold mb-6 text-center">Choose Your Plan</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(plans).map(([tier, plan]) => (
              <div
                key={tier}
                className={`border-2 rounded-lg p-6 relative ${
                  tier === 'premium' ? 'border-purple-500 shadow-lg' : 'border-gray-300'
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                    {plan.badge}
                  </div>
                )}

                <h4 className="text-2xl font-bold mb-2">{plan.name}</h4>
                <div className="mb-4">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-gray-600">/month</span>
                </div>

                <ul className="space-y-3 mb-6">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleUpgrade(tier)}
                  disabled={loading}
                  className={`w-full py-3 rounded-lg font-semibold transition-colors ${
                    tier === 'premium'
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'bg-gray-800 text-white hover:bg-gray-900'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {loading ? 'Processing...' : `Upgrade to ${plan.name}`}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 bg-gray-50 text-center text-sm text-gray-600">
          <p>All plans are billed monthly. Cancel anytime with no penalties.</p>
          <p className="mt-2">Secure payment processing by Stripe.</p>
        </div>
      </div>
    </div>
  );
};

export default UpgradeModal;
