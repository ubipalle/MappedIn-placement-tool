'use client';

import { useState } from 'react';
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

  const [formData, setFormData] = useState({
    apiKey: '',
    apiSecret: '',
    mapId: '',
    defaultFOV: '90',
    defaultRange: '10'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCredentials({
      apiKey: formData.apiKey,
      apiSecret: formData.apiSecret,
      mapId: formData.mapId,
    });
  };

  if (credentials) {
    return (
      <MapView
        apiKey={credentials.apiKey}
        apiSecret={credentials.apiSecret}
        mapId={credentials.mapId}
        defaultFOV={parseInt(formData.defaultFOV)}
        defaultRange={parseInt(formData.defaultRange)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold mb-2">Camera Placement Tool</h1>
        <p className="text-gray-600 mb-6">
          Place cameras on Mappedin maps with viewing cone visualization
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">API Key</label>
            <input
              type="text"
              value={formData.apiKey}
              onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">API Secret</label>
            <input
              type="password"
              value={formData.apiSecret}
              onChange={e => setFormData({ ...formData, apiSecret: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Map ID</label>
            <input
              type="text"
              value={formData.mapId}
              onChange={e => setFormData({ ...formData, mapId: e.target.value })}
              required
              className="w-full px-4 py-2 border rounded-lg"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700"
          >
            Load Map
          </button>
        </form>

        <div className="mt-4 text-xs text-center">
          <a
            href="https://developer.mappedin.com/docs/demo-keys-and-maps"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Get demo credentials
          </a>
        </div>
      </div>
    </div>
  );
}