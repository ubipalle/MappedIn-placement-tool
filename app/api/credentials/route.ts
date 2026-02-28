import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.MAPPEDIN_API_KEY;
  const apiSecret = process.env.MAPPEDIN_API_SECRET;
  const mapId = process.env.MAPPEDIN_DEFAULT_MAP_ID;

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'MappedIn credentials not configured' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    apiKey,
    apiSecret,
    mapId: mapId || '',
  });
}
