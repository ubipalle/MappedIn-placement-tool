'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen">
      <div className="text-xl">Initializing...</div>
    </div>
  ),
});

export default function Home() {
  const [credentials, setCredentials] = useState<{
    apiKey: string;
    apiSecret: string;
    mapId: string;
  } | null>(null);

  const [serverCreds, setServerCreds] = useState<{
    apiKey: string;
    apiSecret: string;
    mapId: string;
  } | null>(null);

  const [mapId, setMapId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch MappedIn credentials from server-side API
  useEffect(() => {
    fetch('/api/credentials')
      .then(res => res.json())
      .then(data => {
        if (data.apiKey && data.apiSecret) {
          setServerCreds(data);
          setMapId(data.mapId || '');
          // Auto-load if default mapId is configured
          if (data.mapId) {
            setCredentials({
              apiKey: data.apiKey,
              apiSecret: data.apiSecret,
              mapId: data.mapId,
            });
          }
        } else {
          setError(data.error || 'Failed to load credentials');
        }
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to connect to server');
        setLoading(false);
      });
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverCreds) return;
    setCredentials({
      apiKey: serverCreds.apiKey,
      apiSecret: serverCreds.apiSecret,
      mapId: mapId.trim(),
    });
  };

  if (credentials) {
    return (
      <MapView
        apiKey={credentials.apiKey}
        apiSecret={credentials.apiSecret}
        mapId={credentials.mapId}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold mb-2">Camera Placement Tool</h1>
        <p className="text-gray-600 mb-6">
          Place cameras on MappedIn maps with viewing cone visualization
        </p>

        {loading && (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {!loading && serverCreds && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Map ID</label>
              <input
                type="text"
                value={mapId}
                onChange={e => setMapId(e.target.value)}
                placeholder="Enter MappedIn Map ID"
                required
                autoFocus
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>

            <button
              type="submit"
              disabled={!mapId.trim()}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300"
            >
              Load Map
            </button>
          </form>
        )}

        {!loading && !serverCreds && !error && (
          <div className="text-center text-gray-500 py-4">
            MappedIn credentials not configured on server.
          </div>
        )}
      </div>
    </div>
  );
}
