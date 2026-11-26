// lib/fetchListings.ts
import type { Listing } from "./types";
import { getD1Client } from "./d1Client";

// ---------- helpers ----------
function slugify(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function parseBoolish(v: any): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(s)) return true;
  if (["n", "no", "false", "0"].includes(s)) return false;
  return undefined;
}
/** 支持粘贴整条 Google Drive folder 链接 或 直接粘 folderId */
function parseDriveFolderId(input?: string | null): string | undefined {
  if (!input) return undefined;
  const s = String(input).trim();
  // .../drive/folders/<id>
  const m = s.match(/\/folders\/([A-Za-z0-9_\-]+)/);
  if (m) return m[1];
  // 直接给了 id
  if (/^[A-Za-z0-9_\-]{10,}$/.test(s)) return s;
  return undefined;
}


/**
 * Parse image URLs from image_folder_url_r2_urls column
 * Supports JSON array string or comma-separated string
 */
function parseImageUrls(value: any): string[] {
  if (!value) return [];
  
  const str = String(value).trim();
  if (!str) return [];
  
  // Try parsing as JSON array first
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) {
      return parsed.filter((url): url is string => typeof url === 'string' && url.length > 0);
    }
  } catch {
    // Not JSON, continue to comma-separated parsing
  }
  
  // Parse as comma-separated string
  return str
    .split(',')
    .map(url => url.trim())
    .filter(url => url.length > 0);
}

// ---------- D1 fetch ----------
type D1Row = Record<string, any>;

/**
 * Map D1 row to Listing type
 */
function mapD1RowToListing(row: D1Row): Listing {
  // Map D1 columns to Listing fields (supports both Title and title case variations)
  const title: string = row["Title"] ?? row["title"] ?? "";
  const rawSlug = row["Slug"] ?? row["slug"];
  const slug: string = rawSlug != null ? String(rawSlug) : slugify(title);
  const price: number = toNum(row["Monthly Rent"] ?? row["monthly_rent"]);
  const bedrooms: number = toNum(row["Bedrooms"] ?? row["bedrooms"]);
  const bathrooms: number = toNum(row["Bathrooms"] ?? row["bathrooms"]);
  const status: string = row["Status"] ?? row["status"] ?? "Available";
  const city: string = row["City"] ?? row["city"] ?? "";
  const address: string = row["Address"] ?? row["address"] ?? "";
  const description: string = row["Description"] ?? row["description"] ?? "";
  const pets: string | undefined = row["Pets"] ?? row["pets"] ?? undefined;

  // Parking is always text - convert to string
  const rawParking = row["Parking"] ?? row["parking"];
  const parking = rawParking != null ? String(rawParking).trim() : undefined;

  // Image folder URL (for reference)
  const imageFolderUrl: string | undefined = row["Image Folder URL"] ?? row["image_folder_url"] ?? undefined;

  // Parse image URLs from image_folder_url_r2_urls column
  const imageUrls = parseImageUrls(row["image_folder_url_r2_urls"] ?? row["Image Folder URL R2 URLs"]);
  
  // Use row ID or generate one
  const rowId = row["id"] ?? row["ID"] ?? row["rowid"] ?? slug || crypto.randomUUID();

  return {
    id: String(rowId),
    title,
    slug,
    price,
    city,
    address,
    status,
    bedrooms,
    bathrooms: bathrooms || undefined,
    parking,
    pets,
    description,
    imageFolderUrl,
    imageUrl: imageUrls.length > 0 ? imageUrls[0] : undefined,
    images: imageUrls.length > 0 ? imageUrls : undefined,
  };
}

export async function fetchListings(): Promise<Listing[]> {
  const tableName = process.env.D1_TABLE_NAME || "table_740124";
  
  try {
    const d1Client = getD1Client();
    
    // Query D1 table - order by title
    const sql = `SELECT * FROM ${tableName} ORDER BY title`;
    console.log(`[D1] Querying table: ${tableName}`);
    
    const rows = await d1Client.select<D1Row>(sql);
    console.log(`[D1] ✅ Fetched ${rows.length} rows from D1`);

    // Map D1 rows to Listing type
    const baseItems: Listing[] = rows.map(mapD1RowToListing);

    // Ensure all items have imageUrl and images, use placeholders as fallback
    console.log(`\n📝 [Placeholder Fallback] Applying placeholders where needed...`);
    for (let i = 0; i < baseItems.length; i++) {
      const item = baseItems[i];
      if (!item.imageUrl || item.imageUrl.trim() === "") {
        // Alternate between placeholder images for demo purposes
        item.imageUrl = i % 2 === 0 ? "/placeholder1.jpg" : "/placeholder2.jpg";
        console.log(`[Placeholder Fallback] ${item.slug}: Using placeholder for imageUrl`);
      }
      // If no images array, provide both placeholders for gallery demo
      if (!item.images || item.images.length === 0) {
        item.images = ["/placeholder1.jpg", "/placeholder2.jpg"];
        console.log(`[Placeholder Fallback] ${item.slug}: Using placeholders for images array`);
      }
    }
    console.log(`[Placeholder Fallback] Complete!\n`);

    return baseItems;
  } catch (error) {
    // In CI/build environments, return empty array instead of throwing
    // This allows builds to succeed even without D1 credentials
    if (process.env.CI || process.env.NODE_ENV === 'production') {
      console.warn("D1 fetch failed - returning empty listings array:", error);
      if (error instanceof Error) {
        console.warn("Error message:", error.message);
      }
      return [];
    }
    // For non-CI environments, throw errors to help with debugging
    if (error instanceof Error) {
      throw new Error(`D1 fetch failed: ${error.message}`);
    }
    throw error;
  }
}
