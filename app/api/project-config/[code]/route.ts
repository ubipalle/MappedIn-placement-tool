import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

/**
 * GET /api/project-config/[code]
 *
 * Looks up a project folder in GDrive by its 5-digit project code,
 * reads project-config.json, and returns it (including mapId).
 *
 * Requires env vars:
 *   GOOGLE_SERVICE_ACCOUNT_KEY_PATH — path to SA key file (local dev)
 *     OR
 *   GOOGLE_SERVICE_ACCOUNT_KEY_JSON — SA credentials as JSON string (Cloud Run)
 *
 *   GDRIVE_ROOT_FOLDER_ID          — root folder containing all project folders
 */

function loadServiceAccountCredentials() {
  // Try JSON string first (Cloud Run / Secret Manager)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON);
  }
  // Fall back to file path (local dev)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH) {
    const keyPath = path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH);
    const raw = fs.readFileSync(keyPath, 'utf-8');
    return JSON.parse(raw);
  }
  return null;
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // Validate project code format (5 digits)
  if (!/^\d{5}$/.test(code)) {
    return NextResponse.json(
      { error: 'Invalid project code. Expected 5 digits.' },
      { status: 400 }
    );
  }

  const credentials = loadServiceAccountCredentials();
  const rootFolderId = process.env.GDRIVE_ROOT_FOLDER_ID;

  if (!credentials || !rootFolderId) {
    return NextResponse.json(
      { error: 'GDrive credentials not configured on server' },
      { status: 500 }
    );
  }

  try {
    // Authenticate with service account
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Find project folder: name starts with "{code} - "
    const folderSearch = await drive.files.list({
      q: `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name contains '${code}' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const folders = folderSearch.data.files || [];
    // Match folder whose name starts with the code followed by " - "
    const projectFolder = folders.find((f) =>
      f.name?.startsWith(`${code} - `)
    );

    if (!projectFolder) {
      return NextResponse.json(
        { error: `No project folder found for code ${code}` },
        { status: 404 }
      );
    }

    // Find project-config.json inside the project folder
    const configSearch = await drive.files.list({
      q: `'${projectFolder.id}' in parents and name = 'project-config.json' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const configFiles = configSearch.data.files || [];
    if (configFiles.length === 0) {
      return NextResponse.json(
        { error: `No project-config.json found in folder "${projectFolder.name}"` },
        { status: 404 }
      );
    }

    // Download and parse project-config.json
    const fileResponse = await drive.files.get(
      { fileId: configFiles[0].id!, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    );

    const config = typeof fileResponse.data === 'string'
      ? JSON.parse(fileResponse.data)
      : fileResponse.data;

    return NextResponse.json({
      projectCode: code,
      folderName: projectFolder.name,
      folderId: projectFolder.id,
      mapId: config.mapId || null,
      dealId: config.dealId || null,
      customerName: config.customerName || null,
      config, // full config for reference
    });
  } catch (err: any) {
    console.error('project-config API error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch project config' },
      { status: 500 }
    );
  }
}
