import { BlueprintData } from "./parser";

// Root area constants: equator band, segment=200
const ROOT_SEGMENT = 200;
const GRID_PER_SEGMENT = 5;
const ROOT_GRID_SIZE = ROOT_SEGMENT * GRID_PER_SEGMENT; // 1000 grid columns
const ROOT_LATITUDE = -80; // Derived from size.y=161 via findPosForAreas

/**
 * Convert planet grid coordinates (latGrid, lonGrid) to local offsets within the root area.
 * Grid units: 1000 per full circumference (200 segments * 5 grids/segment).
 */
export function planetToLocal(latGrid: number, lonGrid: number): { x: number, y: number } {
    // Wrap longitude to [0, ROOT_GRID_SIZE)
    const x = ((lonGrid % ROOT_GRID_SIZE) + ROOT_GRID_SIZE) % ROOT_GRID_SIZE;
    // Shift latitude so that root area's latitude (-80) maps to offset.y=0
    const y = latGrid - ROOT_LATITUDE;
    return { x, y };
}

/**
 * Convert local offsets within the root area to planet grid coordinates.
 */
export function localToPlanet(offset: { x: number, y: number }): { lat: number, lon: number } {
    return {
        lat: offset.y + ROOT_LATITUDE,
        lon: offset.x,
    };
}

/**
 * Ensure the root area covers the given offset. Expands size.x if needed.
 * @returns areaIndex (always 0 for root area), or -1 if offset is outside the equator band
 */
export function ensureAreaFor(bp: BlueprintData, offset: { x: number, y: number }): number {
    if (bp.areas.length === 0)
        return -1;
    const root = bp.areas[0];
    if (offset.y < 0 || offset.y >= root.size.y)
        return -1; // Outside equator band
    if (offset.x < 0 || offset.x >= root.size.x)
        root.size.x = Math.floor(offset.x) + 1;
    return 0;
}
