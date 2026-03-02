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

interface ProjectInfo {
  projectCode: string;
  folderName: string;
  customerName: string | null;
  mapId: string | null;
}

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

  const [projectCode, setProjectCode] = useState('');
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [mapId, setMapId] = useState('');
  const [mode, setMode] = useState<'project' | 'manual'>('project');
  const [loading, setLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [error, setError] = useState('');
  const [projectError, setProjectError] = useState('');

  // Fetch MappedIn credentials from server-side API
  useEffect(() => {
    fetch('/api/credentials')
      .then(res => res.json())
      .then(data => {
        if (data.apiKey && data.apiSecret) {
          setServerCreds(data);
          // If default mapId configured, auto-load directly
          if (data.mapId) {
            setMapId(data.mapId);
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
      .catch(() => {
        setError('Failed to connect to server');
        setLoading(false);
      });
  }, []);

  // Look up project config from GDrive
  const handleProjectLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverCreds || !projectCode.trim()) return;

    setProjectLoading(true);
    setProjectError('');
    setProjectInfo(null);

    try {
      const res = await fetch(`/api/project-config/${projectCode.trim()}`);
      const data = await res.json();

      if (!res.ok) {
        setProjectError(data.error || 'Failed to fetch project config');
        setProjectLoading(false);
        return;
      }

      setProjectInfo(data);

      if (data.mapId) {
        setMapId(data.mapId);
      } else {
        setProjectError('Project found but no mapId set yet. You can enter it manually below.');
        setMode('manual');
      }
    } catch {
      setProjectError('Failed to connect to server');
    }

    setProjectLoading(false);
  };

  // Load the map
  const handleLoadMap = () => {
    if (!serverCreds || !mapId.trim()) return;
    setCredentials({
      apiKey: serverCreds.apiKey,
      apiSecret: serverCreds.apiSecret,
      mapId: mapId.trim(),
    });
  };

  // If map is loaded, show MapView
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
          <>
            {/* Mode tabs */}
            <div className="flex border-b mb-4">
              <button
                onClick={() => setMode('project')}
                className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
                  mode === 'project'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Project Code
              </button>
              <button
                onClick={() => setMode('manual')}
                className={`flex-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
                  mode === 'manual'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Manual Map ID
              </button>
            </div>

            {mode === 'project' && (
              <div className="space-y-4">
                <form onSubmit={handleProjectLookup} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Project Code</label>
                    <input
                      type="text"
                      value={projectCode}
                      onChange={e => {
                        // Allow only digits, max 5
                        const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                        setProjectCode(val);
                      }}
                      placeholder="e.g. 10042"
                      required
                      autoFocus
                      pattern="\d{5}"
                      maxLength={5}
                      className="w-full px-4 py-2 border rounded-lg font-mono text-lg tracking-wider"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={projectCode.length !== 5 || projectLoading}
                    className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                  >
                    {projectLoading ? 'Looking up project...' : 'Look Up Project'}
                  </button>
                </form>

                {projectError && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm">
                    {projectError}
                  </div>
                )}

                {projectInfo && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
                    <div className="text-sm text-green-800">
                      <span className="font-medium">Project:</span>{' '}
                      {projectInfo.folderName}
                    </div>
                    {projectInfo.mapId && (
                      <>
                        <div className="text-sm text-green-800">
                          <span className="font-medium">Map ID:</span>{' '}
                          <span className="font-mono text-xs">{projectInfo.mapId}</span>
                        </div>
                        <button
                          onClick={handleLoadMap}
                          className="w-full bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
                        >
                          Load Map
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {mode === 'manual' && (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  handleLoadMap();
                }}
                className="space-y-4"
              >
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
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                >
                  Load Map
                </button>
              </form>
            )}
          </>
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
