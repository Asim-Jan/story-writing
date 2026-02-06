import { createContext, useContext, useState, useEffect } from 'react';

export const SubscriptionContext = createContext(null);

export const SubscriptionProvider = ({ children }) => {
  const [subscription, setSubscription] = useState(null);
  const [tier, setTier] = useState('free');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSubscription = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setTier('free');
        setLoading(false);
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/subscriptions/my`, {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setSubscription(data.subscription);
        setTier(data.subscription?.tier || 'free');
      } else {
        setTier('free');
      }
    } catch (err) {
      console.error('Failed to fetch subscription:', err);
      setTier('free');
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscription();
  }, []);

  const hasFeature = (featureName) => {
    if (!featureName) return true;

    const tierFeatures = {
      free: [],
      basic: ['media_generation', 'export_pdf', 'export_cbz', 'export_rpg', 'continuity_check', 'version_history'],
      premium: ['media_generation', 'export_pdf', 'export_cbz', 'export_rpg', 'continuity_check', 'version_history', 'collaboration', 'priority_processing']
    };

    return tierFeatures[tier]?.includes(featureName) || false;
  };

  return (
    <SubscriptionContext.Provider value={{
      tier,
      subscription,
      hasFeature,
      loading,
      error,
      refresh: fetchSubscription
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within SubscriptionProvider');
  }
  return context;
};
