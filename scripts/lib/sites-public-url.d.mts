export type SitesPublicUrlResult =
  | { valid: true; origin: string }
  | { valid: false; code: string };

export declare function parseSitesPublicUrl(raw: unknown): SitesPublicUrlResult;
